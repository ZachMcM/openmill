import {
  WATCHED_STATES,
  diffObservation,
  isTrusted,
  observe,
  stackedOn,
  type Config,
  type JobState,
  type PrEvent,
  type PrObservation,
  type PrSnapshot,
  type PrState,
} from "@openmill/core";
import {
  getJob,
  getObservation,
  listJobs,
  saveObservation,
  updateObservation,
  type Db,
  type Job,
} from "@openmill/db";
import { FastLane, type LaneTarget } from "./fast-lane.ts";
import type { GitHub } from "./github.ts";
import {
  appendPage,
  pageQuery,
  parsePrUrl,
  parseWatchResponse,
  watchQuery,
  type PrRef,
} from "./pr-query.ts";

const LOW_BUDGET = 0.1;
const SAFETY_NET_INTERVAL = 120_000;
const CHECK_WINDOW = 2_000;

interface Target {
  job: Job;
  ref: PrRef;
}

export interface WatcherOptions {
  db: Db;
  github: GitHub;
  config: () => Config;
  onChange: (job: Job, events: PrEvent[], observation: PrObservation) => void;
  onMergeable: (job: Job, mergeable: boolean | null) => void;
  log: (message: string) => void;
  debug: (message: string) => void;
}

export class PrWatcher {
  private timer: NodeJS.Timeout | undefined;
  private polling: Promise<void> | undefined;
  private waitUntil = 0;
  private closed = false;
  private readonly fetchedAt = new Map<number, number>();
  private readonly trailing = new Map<number, NodeJS.Timeout>();
  private readonly fetching = new Set<Promise<void>>();
  private readonly lane: FastLane;
  private readonly options: WatcherOptions;

  constructor(options: WatcherOptions) {
    this.options = options;
    this.lane = new FastLane({
      targets: () => this.laneTargets(),
      check: (job, mergeable) => this.check(job, mergeable),
      token: (host) => options.github.token(host),
      log: options.log,
      debug: options.debug,
    });
  }

  poll(): void {
    if (this.closed || this.polling) {
      return;
    }

    clearTimeout(this.timer);
    this.timer = undefined;
    this.polling = this.tick()
      .catch((error: unknown) => this.options.log(`PR watcher tick failed: ${String(error)}`))
      .finally(() => {
        this.polling = undefined;
        this.wake();
      });
  }

  wake(): void {
    this.lane.start();

    if (this.closed || this.timer || this.polling || this.targets().length === 0) {
      return;
    }

    const delay = Math.max(SAFETY_NET_INTERVAL, this.waitUntil - Date.now());

    this.timer = setTimeout(() => this.poll(), delay);
  }

  check(job: Job, mergeable?: boolean | null): void {
    if (mergeable !== undefined) {
      this.recordMergeable(job, mergeable);
    }

    if (this.closed || this.trailing.has(job.key)) {
      return;
    }

    const wait = (this.fetchedAt.get(job.key) ?? -Infinity) + CHECK_WINDOW - Date.now();

    if (wait <= 0) {
      this.fetch(job);

      return;
    }

    this.trailing.set(
      job.key,
      setTimeout(() => {
        this.trailing.delete(job.key);
        this.fetch(job);
      }, wait),
    );
  }

  async refresh(job: Job): Promise<PrObservation | undefined> {
    const ref = job.prUrl ? parsePrUrl(job.prUrl) : undefined;

    return ref ? (await this.pollRepo([{ job, ref }])).get(job.key) : undefined;
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);

    for (const timer of this.trailing.values()) {
      clearTimeout(timer);
    }

    await Promise.all([this.polling, this.lane.close(), ...this.fetching]);
  }

  private fetch(job: Job): void {
    const ref = job.prUrl ? parsePrUrl(job.prUrl) : undefined;

    if (!ref || Date.now() < this.waitUntil) {
      return;
    }

    this.fetchedAt.set(job.key, Date.now());
    const fetching = this.pollRepo([{ job, ref }])
      .then(() => {})
      .catch((error: unknown) =>
        this.repoFailed(`${ref.host}/${ref.owner}/${ref.name}`, [{ job, ref }], error),
      )
      .finally(() => this.fetching.delete(fetching));

    this.fetching.add(fetching);
  }

  private recordMergeable(job: Job, mergeable: boolean | null): void {
    if (getObservation(this.options.db, job.key)?.prUrl === job.prUrl) {
      updateObservation(this.options.db, job.key, { mergeable });
    }

    this.options.onMergeable(job, mergeable);
  }

  private targets(): Target[] {
    return listJobs(this.options.db).flatMap((job) => {
      const ref =
        WATCHED_STATES.includes(job.state as JobState) && job.prUrl
          ? parsePrUrl(job.prUrl)
          : undefined;

      return ref ? [{ job, ref }] : [];
    });
  }

  private laneTargets(): LaneTarget[] {
    const { db } = this.options;
    const jobs = listJobs(db);

    return this.targets().map(({ job, ref }) => {
      const stored = getObservation(db, job.key);
      const observation = stored?.prUrl === job.prUrl ? stored : undefined;

      return {
        job,
        ref,
        headSha: observation?.headSha,
        statuses: observation?.checks.checks.some((check) => check.kind === "status") ?? false,
        dependents: jobs.some((other) => stackedOn(other, job)),
      };
    });
  }

  private async tick(): Promise<void> {
    const repos = Map.groupBy(this.targets(), ({ ref }) => `${ref.host}/${ref.owner}/${ref.name}`);

    await Promise.all(
      [...repos].map(([repo, targets]) =>
        this.pollRepo(targets).catch((error: unknown) => this.repoFailed(repo, targets, error)),
      ),
    );
  }

  private async pollRepo(targets: Target[]): Promise<Map<number, PrObservation>> {
    const { github } = this.options;
    const [first] = targets as [Target, ...Target[]];
    const { host, owner, name } = first.ref;
    const cwd = first.job.repoPath;
    const response = parseWatchResponse(
      await github.graphql(cwd, host, watchQuery(targets.map(({ ref }) => ref.number)), {
        owner,
        name,
      }),
    );
    const { limit, remaining, resetAt } = response.rateLimit;

    if (remaining < limit * LOW_BUDGET) {
      this.waitFor(resetAt, `${remaining} of ${limit} GitHub GraphQL points left`);
    }

    const observations = new Map<number, PrObservation>();

    for (const { job, ref } of targets) {
      const pr = response.prs.get(ref.number);

      if (!pr) {
        this.options.log(`PR watcher could not find ${job.prUrl} for ${job.id}`);
        continue;
      }

      const pages = [...pr.more];

      for (let page = pages.shift(); page; page = pages.shift()) {
        const json = await github.graphql(cwd, host, pageQuery(page.connection), {
          owner,
          name,
          number: ref.number,
          after: page.after,
        });

        pages.push(...appendPage(pr.snapshot, json));
      }

      const observation = this.record(job, pr.snapshot);

      if (observation) {
        observations.set(job.key, observation);
      }
    }

    return observations;
  }

  private async repoFailed(repo: string, targets: Target[], error: unknown): Promise<void> {
    this.options.log(`PR watcher failed for ${repo}: ${String(error)}`);

    if (!/rate limit/i.test(String(error))) {
      return;
    }

    const { job, ref } = targets[0] as Target;
    const resetAt = await this.options.github
      .graphqlResetAt(job.repoPath, ref.host)
      .catch(() => new Date(Date.now() + 60 * 60 * 1000));

    this.waitFor(resetAt, "GitHub rate limited the watcher");
  }

  private waitFor(resetAt: Date, why: string): void {
    this.waitUntil = Math.max(this.waitUntil, resetAt.getTime());
    this.options.log(`PR watcher waiting until ${resetAt.toISOString()}: ${why}`);
  }

  private record(job: Job, snapshot: PrSnapshot): PrObservation | undefined {
    const { db, config, debug, onChange } = this.options;
    const current = getJob(db, job.key);

    if (!current || current.prUrl !== job.prUrl || job.prUrl === null) {
      return undefined;
    }

    const trustedBots = config().trusted_bots;

    for (const item of [...snapshot.threads, ...snapshot.reviews]) {
      if (!isTrusted(item.author, trustedBots)) {
        const by = item.author ? `${item.author.login} (${item.author.association})` : "unknown";

        debug(`PR watcher ignoring ${item.id} on ${job.id} from untrusted author ${by}`);
      }
    }

    const observation = observe(snapshot, trustedBots);
    const stored = getObservation(db, job.key);
    const same = stored?.prUrl === job.prUrl ? stored : undefined;
    const previous: PrObservation | undefined = same && { ...same, state: same.state as PrState };
    const events = diffObservation(previous, observation);

    saveObservation(db, {
      jobKey: job.key,
      prUrl: job.prUrl,
      polledAt: new Date(),
      ...observation,
      readyNotifiedSha: same?.readyNotifiedSha ?? null,
      mergeable: same?.mergeable ?? null,
    });

    if (events.length > 0) {
      onChange(current, events, observation);
    }

    return observation;
  }
}
