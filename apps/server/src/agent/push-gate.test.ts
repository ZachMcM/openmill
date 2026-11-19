import { describe, expect, it } from "vitest";
import {
  DRAFT_GATE_REASON,
  GATE_CLOSED_REASON,
  draftGateDenial,
  pushGateDenial,
} from "./push-gate.ts";

const closed = { open: false, branch: "openmill/login" };
const open = { open: true, branch: "openmill/login" };

describe("pushGateDenial while the gate is closed", () => {
  it.each([
    "git push",
    "git push origin HEAD",
    "git -C /wt/login push origin openmill/login",
    "pnpm check && git push -u origin openmill/login",
    "GIT_TRACE=1 /usr/bin/git push",
    'gh pr comment 12 --body "done"',
    "gh pr review 12 --comment -b ok",
    "gh -R o/r pr comment 12 -b hi",
    "gh api -X POST repos/o/r/pulls/12/comments -f body=hi",
    "gh api --method=PATCH repos/o/r/pulls/comments/3",
    "gh api repos/o/r/issues/12/comments -f body=hi",
    "gh api graphql -f query='mutation { addPullRequestReviewThreadReply(input: {}) { clientMutationId } }'",
  ])("denies %s", (command) => {
    expect(pushGateDenial(command, closed)).toBe(GATE_CLOSED_REASON);
  });

  it.each([
    "git status",
    "git log --grep push",
    'git commit -m "fix lint; then git push"',
    'echo "git push"',
    "git pushx",
    "gh pr view 12 --comments",
    "gh pr checks 12",
    "gh run view 9 --log-failed",
    "gh api repos/o/r/pulls/12/comments",
    "gh api -X GET repos/o/r/pulls/12/comments -f per_page=100",
    "gh api graphql -f query='query { viewer { login } }'",
  ])("allows %s", (command) => {
    expect(pushGateDenial(command, closed)).toBeUndefined();
  });
});

describe("pushGateDenial once the gate is open", () => {
  it("allows pushes and a lease force-push to the job's own branch", () => {
    expect(pushGateDenial("git push origin HEAD", open)).toBeUndefined();
    expect(pushGateDenial('gh pr comment 12 --body "done"', open)).toBeUndefined();
    expect(
      pushGateDenial("git push --force-with-lease origin openmill/login", open),
    ).toBeUndefined();
    expect(
      pushGateDenial("git push --force-with-lease origin HEAD:refs/heads/openmill/login", open),
    ).toBeUndefined();
  });

  it.each([
    "git push --force origin openmill/login",
    "git push -f origin openmill/login",
    "git push origin +HEAD:openmill/login",
    "git push --force-with-lease origin main",
    "git push origin :openmill/login",
  ])("denies the force-push %s", (command) => {
    expect(pushGateDenial(command, open)).toMatch(/--force-with-lease origin openmill\/login/);
  });
});

describe("draftGateDenial", () => {
  it.each([
    "gh pr ready",
    "gh pr ready 12 --undo",
    "gh pr merge 12 --squash",
    "env GH_TOKEN=x gh pr ready 12",
    "pnpm check && gh pr merge --auto",
    "gh -R owner/repo pr ready 12",
    "gh pr -R owner/repo merge 12",
  ])("denies %s", (command) => {
    expect(draftGateDenial(command)).toBe(DRAFT_GATE_REASON);
  });

  it.each([
    "gh pr view 12",
    "gh pr create --draft --base main",
    "gh pr edit 12 --title fix",
    'echo "gh pr merge"',
  ])("allows %s", (command) => {
    expect(draftGateDenial(command)).toBeUndefined();
  });
});
