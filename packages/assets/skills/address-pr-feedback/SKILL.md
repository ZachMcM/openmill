---
name: address-pr-feedback
description: Fix what a pull request's unresolved review threads and failing checks ask for, review the fixes with verifier and code-simplifier agents, commit them, and push and reply once approved.
disable-model-invocation: true
---

# Address PR feedback

## Set up

1. The user passes a PR URL, and optionally a design doc path. Read repository guidance such as `AGENTS.md`, and inspect Git status, remotes, and available tooling.
2. Work on the PR's head branch. If you aren't on it, check it out without discarding local changes.
3. Read the PR with `gh pr view <url>`. Read its unresolved review threads with `gh api graphql`, including each thread's id, path, line, and comments. Read its failing checks with `gh pr checks <url>`, and read each failed run's log with `gh run view <run id> --log-failed`.
4. If the user passed a design doc, read the whole file. It's the spec the PR implements, so use it to judge what a thread is asking for. Don't edit it or commit it.
5. Write acceptance criteria from the threads and checks. If the user named specific threads or checks, cover those. Otherwise cover every unresolved thread and failing check.

## Fix

Fix what the threads and checks ask for, and nothing else. Don't refactor or add scope the feedback didn't request.

When a thread asks for something you disagree with or can't do, don't guess. Leave the code alone and explain why in your reply to that thread.

When a check fails for a reason the PR didn't cause, such as a flaky test or a broken runner, say so instead of changing code to hide it.

## Review and commit

Run the repository's required checks and any focused checks that cover the fixes.

Before every commit, run both independent reviews on the same diff:

- Have a `verifier` agent independently check the fixes against the threads, the check failures, the design doc if there is one, and the acceptance criteria. Give it the relevant diff and evidence, and ask it to report `CONFIRMED`, `REFUTED`, or `INCONCLUSIVE` with concrete findings.
- Have a `code-simplifier` agent inspect the changed code for unnecessary complexity and safe simplifications.

Then act on the results:

- If the verifier reports `REFUTED` and fixing its valid findings changes logic, make the fixes, run the repository checks, and repeat both reviews on the updated diff.
- If the verifier reports `REFUTED` but the valid findings need no logic change, such as missing evidence or a misread request, address them and rerun only the verifier.
- If the verifier reports `INCONCLUSIVE`, gather the missing evidence and rerun only the verifier.
- Once the verifier reports `CONFIRMED`, apply the useful simplifier suggestions and run the repository checks. Do not rerun either review for simplifier edits. Skip any suggestion that would change behavior. If the checks fail after a simplifier edit, revert that edit instead of reworking it.

Do not commit while the latest verifier result is `REFUTED` or `INCONCLUSIVE`. If either agent role is unavailable, do not claim its review happened. Use an available mechanism to obtain that review. If none exists, stop before committing and tell the user which required review is unavailable.

Add new commits with the repository's commit conventions. Never amend, rebase, or force-push.

## Push and reply

Draft one reply for each thread you addressed, saying what changed, or why you left it alone.

Unless the user said to push, stop before pushing: show the new commits and the drafted replies, and ask the user to approve. Once they approve, or if they said to push:

1. Push the new commits to the PR's head branch.
2. Post each drafted reply on its thread, for example with the `addPullRequestReviewThreadReply` GraphQL mutation.

Don't resolve threads. The reviewer decides that.

Never mark the PR ready for review, merge it, or change repository settings. Report the work as done only after the commits are pushed and the replies are posted, or, when waiting for approval, once the commits are in place and the replies are drafted.
