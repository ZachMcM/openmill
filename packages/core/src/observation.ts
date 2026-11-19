export type PrState = "OPEN" | "CLOSED" | "MERGED";

export interface PrAuthor {
  login: string;
  association: string;
}

export interface PrCheck {
  name: string;
  status: string;
  conclusion: string | null;
  kind?: "status";
}

export interface PrChecks {
  state: string | null;
  checks: PrCheck[];
}

export interface PrSnapshot {
  state: PrState;
  isDraft: boolean;
  headSha: string;
  baseRef: string;
  checks: PrChecks;
  threads: Array<{ id: string; isResolved: boolean; author: PrAuthor | null }>;
  reviews: Array<{
    id: string;
    state: string;
    submittedAt: string | null;
    author: PrAuthor | null;
  }>;
}

export interface PrObservation {
  state: PrState;
  headSha: string;
  checks: PrChecks;
  unresolvedThreads: string[];
  latestReviewId: string | null;
}

export type PrEvent =
  | "merged"
  | "closed"
  | "reopened"
  | "checks_finished"
  | "review_submitted"
  | "head_moved";

const TRUSTED_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];

const SUCCESSFUL_CONCLUSIONS = ["SUCCESS", "NEUTRAL", "SKIPPED"];

export function isTrusted(author: PrAuthor | null, trustedBots: readonly string[]): boolean {
  if (!author) {
    return false;
  }

  const login = author.login.toLowerCase();

  return (
    TRUSTED_ASSOCIATIONS.includes(author.association) ||
    trustedBots.some((bot) => bot.toLowerCase() === login)
  );
}

export function observe(snapshot: PrSnapshot, trustedBots: readonly string[]): PrObservation {
  const latestReview = snapshot.reviews
    .filter((review) => review.submittedAt !== null && isTrusted(review.author, trustedBots))
    .reduce<PrSnapshot["reviews"][number] | null>(
      (latest, review) =>
        !latest || (review.submittedAt as string) > (latest.submittedAt as string)
          ? review
          : latest,
      null,
    );

  return {
    state: snapshot.state,
    headSha: snapshot.headSha,
    checks: snapshot.checks,
    unresolvedThreads: snapshot.threads
      .filter((thread) => !thread.isResolved && isTrusted(thread.author, trustedBots))
      .map((thread) => thread.id),
    latestReviewId: latestReview?.id ?? null,
  };
}

// A cancelled run is usually one a newer run of the same check replaced. When the newer run hasn't
// registered yet, the cancelled one counts as unfinished.
function currentChecks(checks: PrChecks): PrCheck[] {
  const replaced = new Set(
    checks.checks.filter((check) => check.conclusion !== "CANCELLED").map((check) => check.name),
  );

  return checks.checks.filter(
    (check) => check.conclusion !== "CANCELLED" || !replaced.has(check.name),
  );
}

// No checks at all usually means CI hasn't registered yet, so it doesn't count as finished.
export function checksFinished(checks: PrChecks): boolean {
  const current = currentChecks(checks);

  return (
    current.length > 0 &&
    current.every((check) => check.status === "COMPLETED" && check.conclusion !== "CANCELLED")
  );
}

function failed(check: PrCheck): boolean {
  return !SUCCESSFUL_CONCLUSIONS.includes(check.conclusion ?? "");
}

export function checksSucceeded(checks: PrChecks): boolean {
  return checksFinished(checks) && !currentChecks(checks).some(failed);
}

export function failingChecks(checks: PrChecks): string[] {
  return checksFinished(checks)
    ? currentChecks(checks)
        .filter(failed)
        .map((check) => check.name)
    : [];
}

export function diffObservation(
  previous: PrObservation | undefined,
  current: PrObservation,
): PrEvent[] {
  const events: PrEvent[] = [];
  const sameHead = previous !== undefined && previous.headSha === current.headSha;
  const finishedBefore = sameHead && checksFinished(previous.checks);

  if (current.state !== previous?.state) {
    if (current.state === "MERGED") {
      events.push("merged");
    } else if (current.state === "CLOSED") {
      events.push("closed");
    } else if (previous?.state === "CLOSED") {
      events.push("reopened");
    }
  }

  if (previous && !sameHead) {
    events.push("head_moved");
  }

  if (checksFinished(current.checks) && !finishedBefore) {
    events.push("checks_finished");
  }

  if (
    current.latestReviewId !== null &&
    current.latestReviewId !== previous?.latestReviewId &&
    current.unresolvedThreads.length > 0
  ) {
    events.push("review_submitted");
  }

  return events;
}
