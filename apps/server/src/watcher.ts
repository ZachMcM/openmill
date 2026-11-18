import {
  WATCHED_STATES,
  diffObservation,
  isTrusted,
  observe,
  type Config,
  type JobState,
  type PrEvent,
  type PrObservation,
  type PrSnapshot,
  type PrState,
} from "@openmill/core";
import { getJob, getObservation, listJobs, saveObservation, type Db, type Job } from "@openmill/db";
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

interface Target {
  job: Job;
  ref: PrRef;
}

export interface WatcherOptions {
  db: Db;
  github: GitHub;
  config: () => Config;
  onChange: (job: Job, events: PrEvent[], observation: PrObservation) => void;
  log: (message: string) => void;
  debug: (message: string) => void;
}

export class PrWatcher {
  private timer: NodeJS.Timeout | undefined;
  private polling: Promise<void> | undefined;
  private waitUntil = 0;
  private closed = false;
  private readonly options: WatcherOptions;

  constructor(options: WatcherOptions) {
    this.options = options;
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
    if (this.closed || this.timer || this.polling || this.targets().length === 0) {
      return;
    }

    const interval = this.options.config().watch_interval * 1000;
    const delay = Math.max(interval, this.waitUntil - Date.now());

    this.timer = setTimeout(() => this.poll(), delay);
  }

  restart(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.wake();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    await this.polling;
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

  private async tick(): Promise<void> {
    const repos = Map.groupBy(this.targets(), ({ ref }) => `${ref.host}/${ref.owner}/${ref.name}`);

    await Promise.all(
      [...repos].map(([repo, targets]) =>
        this.pollRepo(targets).catch((error: unknown) => this.repoFailed(repo, targets, error)),
      ),
    );
  }

  private async pollRepo(targets: Target[]): Promise<void> {
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

      this.record(job, pr.snapshot);
    }
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

  private record(job: Job, snapshot: PrSnapshot): void {
    const { db, config, debug, onChange } = this.options;
    const current = getJob(db, job.key);

    if (!current || current.prUrl !== job.prUrl || job.prUrl === null) {
      return;
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
    });

    if (events.length > 0) {
      onChange(current, events, observation);
    }
  }
}
