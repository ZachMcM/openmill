import { fastLaneInterval } from "@openmill/core";
import type { Job } from "@openmill/db";
import { z } from "zod";
import type { PrRef } from "./pr-query.ts";

const REQUEST_TIMEOUT = 5_000;
const CONCURRENCY = 8;
const DEFAULT_PAUSE = 60_000;

export interface LaneTarget {
  job: Job;
  ref: PrRef;
  headSha: string | undefined;
  statuses: boolean;
  dependents: boolean;
}

export interface FastLaneOptions {
  targets: () => LaneTarget[];
  check: (job: Job, mergeable?: boolean | null) => void;
  token: (host: string) => Promise<string>;
  log: (message: string) => void;
  debug: (message: string) => void;
}

interface LaneRequest {
  target: LaneTarget;
  url: string;
  pulls: boolean;
}

const pullSchema = z.object({
  head: z.object({ sha: z.string() }),
  mergeable: z.boolean().nullable(),
});

function apiBase(host: string): string {
  return host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`;
}

export class FastLane {
  private timer: NodeJS.Timeout | undefined;
  private ticking: Promise<void> | undefined;
  private closed = false;
  private pausedUntil = 0;
  private readonly etags = new Map<string, string>();
  private readonly heads = new Map<number, string>();
  private readonly tokens = new Map<string, Promise<string>>();
  private readonly options: FastLaneOptions;

  constructor(options: FastLaneOptions) {
    this.options = options;
  }

  start(): void {
    if (this.closed || this.timer || this.ticking) {
      return;
    }

    const requests = this.requests();

    if (requests.length === 0) {
      return;
    }

    this.ticking = this.tick(requests).finally(() => {
      this.ticking = undefined;

      if (this.closed) {
        return;
      }

      const delay = Math.max(
        fastLaneInterval(requests.length) * 1000,
        this.pausedUntil - Date.now(),
      );

      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.start();
      }, delay);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    await this.ticking;
  }

  private requests(): LaneRequest[] {
    const requests = this.options
      .targets()
      .toSorted((a, b) => Number(b.dependents) - Number(a.dependents))
      .flatMap((target) => {
        const { host, owner, name, number } = target.ref;
        const repo = `${apiBase(host)}/repos/${owner}/${name}`;
        const head = this.heads.get(target.job.key) ?? target.headSha;
        const commits = head
          ? [
              `${repo}/commits/${head}/check-runs`,
              ...(target.statuses ? [`${repo}/commits/${head}/status`] : []),
            ]
          : [];

        return [
          { target, url: `${repo}/pulls/${number}`, pulls: true },
          ...commits.map((url) => ({ target, url, pulls: false })),
        ];
      });
    const urls = new Set(requests.map(({ url }) => url));

    for (const url of this.etags.keys()) {
      if (!urls.has(url)) {
        this.etags.delete(url);
      }
    }

    return requests;
  }

  private async tick(requests: LaneRequest[]): Promise<void> {
    const queue = [...requests];

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (Date.now() >= this.pausedUntil) {
          const next = queue.shift();

          if (!next) {
            return;
          }

          await this.send(next).catch((error: unknown) =>
            this.options.debug(`PR fast lane request to ${next.url} failed: ${String(error)}`),
          );
        }
      }),
    );
  }

  private async send({ target, url, pulls }: LaneRequest): Promise<void> {
    const { host } = target.ref;
    const etag = this.etags.get(url);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${await this.token(host)}`,
        Accept: "application/vnd.github+json",
        ...(etag ? { "If-None-Match": etag } : {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });

    if (response.status !== 200 || !pulls) {
      await response.body?.cancel();
    }

    if (response.status === 304) {
      return;
    }

    if (response.status === 401) {
      this.tokens.delete(host);
      this.options.debug(`PR fast lane got 401 from ${url}; reading the token again`);

      return;
    }

    if (response.status === 403 || response.status === 429) {
      this.pause(response);

      return;
    }

    if (response.status !== 200) {
      this.options.debug(`PR fast lane got ${response.status} from ${url}`);

      return;
    }

    const pr = pulls ? pullSchema.parse(await response.json()) : undefined;
    const etagAfter = response.headers.get("etag");

    if (etagAfter) {
      this.etags.set(url, etagAfter);
    }

    if (pr) {
      this.heads.set(target.job.key, pr.head.sha);
    }

    this.options.check(target.job, pr?.mergeable);
  }

  private pause(response: Response): void {
    const seconds = Number(response.headers.get("retry-after"));
    const until = Date.now() + (seconds > 0 ? seconds * 1000 : DEFAULT_PAUSE);
    const running = Date.now() >= this.pausedUntil;

    this.pausedUntil = Math.max(this.pausedUntil, until);

    if (running) {
      this.options.log(
        `PR fast lane paused until ${new Date(this.pausedUntil).toISOString()}: GitHub returned ${response.status}`,
      );
    }
  }

  private token(host: string): Promise<string> {
    let token = this.tokens.get(host);

    if (!token) {
      token = this.options.token(host);
      this.tokens.set(host, token);
      token.catch(() => this.tokens.delete(host));
    }

    return token;
  }
}
