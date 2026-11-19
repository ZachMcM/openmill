import type { PrAuthor, PrCheck, PrSnapshot } from "@openmill/core";
import { z } from "zod";

export interface PrRef {
  host: string;
  owner: string;
  name: string;
  number: number;
}

type PagedConnection = "reviewThreads" | "reviews";

interface WatchedPr {
  snapshot: PrSnapshot;
  more: Array<{ connection: PagedConnection; after: string }>;
}

interface WatchResponse {
  rateLimit: { limit: number; remaining: number; resetAt: Date };
  prs: Map<number, WatchedPr | null>;
}

const PAGE_INFO = "pageInfo { hasNextPage endCursor }";

const NODE_FIELDS: Record<PagedConnection, string> = {
  reviewThreads:
    "id isResolved comments(first: 1) { nodes { author { type: __typename login } authorAssociation } }",
  reviews: "id state submittedAt author { type: __typename login } authorAssociation",
};

function connectionField(connection: PagedConnection, after = ""): string {
  return `${connection}(first: 100${after}) { ${PAGE_INFO} nodes { ${NODE_FIELDS[connection]} } }`;
}

const PR_FIELDS = [
  "state merged isDraft headRefOid baseRefName",
  "commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes {",
  "type: __typename ... on CheckRun { name status conclusion } ... on StatusContext { context state }",
  "} } } } } }",
  connectionField("reviewThreads"),
  connectionField("reviews"),
].join(" ");

export function watchQuery(numbers: number[]): string {
  const prs = numbers
    .map((number) => `pr${number}: pullRequest(number: ${number}) { ...watched }`)
    .join(" ");

  return [
    "query($owner: String!, $name: String!) {",
    "rateLimit { limit remaining resetAt }",
    `repository(owner: $owner, name: $name) { ${prs} }`,
    "}",
    `fragment watched on PullRequest { ${PR_FIELDS} }`,
  ].join(" ");
}

export function pageQuery(connection: PagedConnection): string {
  return [
    "query($owner: String!, $name: String!, $number: Int!, $after: String!) {",
    "repository(owner: $owner, name: $name) { pullRequest(number: $number) {",
    connectionField(connection, ", after: $after"),
    "} } }",
  ].join(" ");
}

export function parsePrUrl(url: string): PrRef | undefined {
  const match = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(url);

  if (!match) {
    return undefined;
  }

  const [, host, owner, name, number] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];

  return { host, owner, name, number: Number(number) };
}

const authorSchema = z.object({ type: z.string(), login: z.string() }).nullable();

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });

const threadSchema = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  comments: z.object({
    nodes: z.array(z.object({ author: authorSchema, authorAssociation: z.string() })),
  }),
});

const reviewSchema = z.object({
  id: z.string(),
  state: z.string(),
  submittedAt: z.string().nullable(),
  author: authorSchema,
  authorAssociation: z.string(),
});

const threadsSchema = z.object({ pageInfo: pageInfoSchema, nodes: z.array(threadSchema) });

const reviewsSchema = z.object({ pageInfo: pageInfoSchema, nodes: z.array(reviewSchema) });

const contextSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CheckRun"),
    name: z.string(),
    status: z.string(),
    conclusion: z.string().nullable(),
  }),
  z.object({ type: z.literal("StatusContext"), context: z.string(), state: z.string() }),
]);

const pullRequestSchema = z.object({
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  merged: z.boolean(),
  isDraft: z.boolean(),
  headRefOid: z.string(),
  baseRefName: z.string(),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          statusCheckRollup: z
            .object({ state: z.string(), contexts: z.object({ nodes: z.array(contextSchema) }) })
            .nullable(),
        }),
      }),
    ),
  }),
  reviewThreads: threadsSchema,
  reviews: reviewsSchema,
});

const watchResponseSchema = z.object({
  data: z.object({
    rateLimit: z.object({ limit: z.number(), remaining: z.number(), resetAt: z.string() }),
    repository: z.record(z.string(), pullRequestSchema.nullable()),
  }),
});

function author(
  item: { author: z.infer<typeof authorSchema>; authorAssociation: string } | undefined,
): PrAuthor | null {
  if (!item?.author) {
    return null;
  }

  const { author: node, authorAssociation: association } = item;

  // GraphQL drops the [bot] suffix that GitHub shows, so put it back to match trusted_bots.
  const login =
    node.type === "Bot" && !node.login.endsWith("[bot]") ? `${node.login}[bot]` : node.login;

  return { login, association };
}

function threads(connection: z.infer<typeof threadsSchema>): PrSnapshot["threads"] {
  return connection.nodes.map((thread) => ({
    id: thread.id,
    isResolved: thread.isResolved,
    author: author(thread.comments.nodes[0]),
  }));
}

function reviews(connection: z.infer<typeof reviewsSchema>): PrSnapshot["reviews"] {
  return connection.nodes.map((review) => ({
    id: review.id,
    state: review.state,
    submittedAt: review.submittedAt,
    author: author(review),
  }));
}

function check(context: z.infer<typeof contextSchema>): PrCheck {
  if (context.type === "CheckRun") {
    return { name: context.name, status: context.status, conclusion: context.conclusion };
  }

  const pending = context.state === "PENDING" || context.state === "EXPECTED";

  return {
    name: context.context,
    status: pending ? "PENDING" : "COMPLETED",
    conclusion: pending ? null : context.state,
    kind: "status",
  };
}

function nextPage(
  connection: PagedConnection,
  pageInfo: z.infer<typeof pageInfoSchema>,
): WatchedPr["more"] {
  return pageInfo.hasNextPage && pageInfo.endCursor
    ? [{ connection, after: pageInfo.endCursor }]
    : [];
}

function watchedPr(pr: z.infer<typeof pullRequestSchema>): WatchedPr {
  const rollup = pr.commits.nodes[0]?.commit.statusCheckRollup ?? null;

  return {
    snapshot: {
      state: pr.merged ? "MERGED" : pr.state,
      isDraft: pr.isDraft,
      headSha: pr.headRefOid,
      baseRef: pr.baseRefName,
      checks: {
        state: rollup?.state ?? null,
        checks: rollup?.contexts.nodes.map(check) ?? [],
      },
      threads: threads(pr.reviewThreads),
      reviews: reviews(pr.reviews),
    },
    more: [
      ...nextPage("reviewThreads", pr.reviewThreads.pageInfo),
      ...nextPage("reviews", pr.reviews.pageInfo),
    ],
  };
}

export function parseWatchResponse(json: unknown): WatchResponse {
  const { data } = watchResponseSchema.parse(json);

  return {
    rateLimit: { ...data.rateLimit, resetAt: new Date(data.rateLimit.resetAt) },
    prs: new Map(
      Object.entries(data.repository).map(([alias, pr]) => [
        Number(alias.slice(2)),
        pr ? watchedPr(pr) : null,
      ]),
    ),
  };
}

const pageResponseSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: pullRequestSchema.pick({ reviewThreads: true, reviews: true }).partial(),
    }),
  }),
});

export function appendPage(snapshot: PrSnapshot, json: unknown): WatchedPr["more"] {
  const pr = pageResponseSchema.parse(json).data.repository.pullRequest;
  const more: WatchedPr["more"] = [];

  if (pr.reviewThreads) {
    snapshot.threads.push(...threads(pr.reviewThreads));
    more.push(...nextPage("reviewThreads", pr.reviewThreads.pageInfo));
  }

  if (pr.reviews) {
    snapshot.reviews.push(...reviews(pr.reviews));
    more.push(...nextPage("reviews", pr.reviews.pageInfo));
  }

  return more;
}
