export type PrState = "OPEN" | "CLOSED" | "MERGED";

export interface PrAuthor {
  login: string;
  association: string;
}

export interface PrCheck {
  name: string;
  status: string;
  conclusion: string | null;
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

// No checks at all usually means CI hasn't registered yet, so it doesn't count as finished.
function checksFinished(checks: PrChecks): boolean {
  return checks.checks.length > 0 && checks.checks.every((check) => check.status === "COMPLETED");
}

function failed(check: PrCheck): boolean {
  return !SUCCESSFUL_CONCLUSIONS.includes(check.conclusion ?? "");
}

export function checksSucceeded(checks: PrChecks): boolean {
  return checksFinished(checks) && !checks.checks.some(failed);
}

export function failingChecks(checks: PrChecks): string[] {
  return checksFinished(checks) ? checks.checks.filter(failed).map((check) => check.name) : [];
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
