import { describe, expect, it } from "vitest";
import fixture from "./pr-query.fixture.json" with { type: "json" };
import { appendPage, parsePrUrl, parseWatchResponse } from "./pr-query.ts";

describe("parseWatchResponse", () => {
  it("turns a recorded watch query response into snapshots", () => {
    const { rateLimit, prs } = parseWatchResponse(fixture);

    expect(rateLimit).toEqual({
      limit: 5000,
      remaining: 4956,
      resetAt: new Date("2026-11-17T22:25:30Z"),
    });
    expect(prs.get(1)?.snapshot).toMatchObject({ state: "MERGED", threads: [], reviews: [] });
    expect(prs.get(2)).toEqual({
      snapshot: {
        state: "OPEN",
        isDraft: true,
        headSha: "fbb1dc8d8881b713ad41ef21bc2f64077276f959",
        baseRef: "main",
        checks: {
          state: "PENDING",
          checks: [
            { name: "Check (ubuntu-latest)", status: "COMPLETED", conclusion: "SUCCESS" },
            { name: "Check (windows-latest)", status: "IN_PROGRESS", conclusion: null },
            { name: "GitGuardian Security Checks", status: "COMPLETED", conclusion: "SUCCESS" },
            {
              name: "netlify/deploy-preview",
              status: "COMPLETED",
              conclusion: "SUCCESS",
              kind: "status",
            },
          ],
        },
        threads: [
          {
            id: "PRRT_kwDOQ1",
            isResolved: false,
            author: { login: "ZachMcM", association: "OWNER" },
          },
          {
            id: "PRRT_kwDOQ2",
            isResolved: false,
            author: { login: "copilot-pull-request-reviewer[bot]", association: "NONE" },
          },
          { id: "PRRT_kwDOQ3", isResolved: true, author: null },
        ],
        reviews: [
          {
            id: "PRR_kwDOR1",
            state: "COMMENTED",
            submittedAt: "2026-11-17T21:04:11Z",
            author: { login: "ZachMcM", association: "OWNER" },
          },
          {
            id: "PRR_kwDOR2",
            state: "PENDING",
            submittedAt: null,
            author: { login: "drive-by", association: "NONE" },
          },
        ],
      },
      more: [{ connection: "reviewThreads", after: "Y3Vyc29yOnYyOpHOThreads" }],
    });
  });

  it("appends later pages and reports whether more remain", () => {
    const snapshot = parseWatchResponse(fixture).prs.get(2)?.snapshot;
    const page = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: false, endCursor: "end" },
              nodes: [
                {
                  id: "PRRT_kwDOQ4",
                  isResolved: false,
                  comments: {
                    nodes: [
                      { author: { type: "User", login: "dev" }, authorAssociation: "MEMBER" },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };

    expect(snapshot && appendPage(snapshot, page)).toEqual([]);
    expect(snapshot?.threads.map((thread) => thread.id)).toEqual([
      "PRRT_kwDOQ1",
      "PRRT_kwDOQ2",
      "PRRT_kwDOQ3",
      "PRRT_kwDOQ4",
    ]);
  });
});

describe("parsePrUrl", () => {
  it("reads the host, repo, and number from a PR URL", () => {
    expect(parsePrUrl("https://github.com/ZachMcM/openmill/pull/2")).toEqual({
      host: "github.com",
      owner: "ZachMcM",
      name: "openmill",
      number: 2,
    });
    expect(parsePrUrl("https://github.com/ZachMcM/openmill/issues/2")).toBeUndefined();
  });
});
