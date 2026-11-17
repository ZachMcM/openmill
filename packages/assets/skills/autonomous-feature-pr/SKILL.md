---
name: autonomous-feature-pr
description: Implement a small feature from a request, a markdown design doc, or a Notion page, review it with verifier and code-simplifier agents, commit it, and open a draft pull request.
disable-model-invocation: true
---

# Autonomous feature PR

## Set up

1. Read repository guidance such as `AGENTS.md`, and inspect Git status, remotes, and available tooling.
2. If the user passed a design doc, read it before planning. See "Design docs" below.
3. Write acceptance criteria for the requested outcome. Include the required reviews and a draft pull request as the final deliverable. Keep working until the draft PR is open or a human decision or missing access blocks the work.
4. Follow repository conventions for implementation, validation, branch naming, and commit messages. Do not add scope that the requested feature doesn't need.

## Design docs

The user may pass a design doc with the request, either as a path to a markdown file or as a Notion page link.

- For a markdown file, read the whole file. If it links to other files the spec depends on, read those too.
- For a Notion page, fetch it with the Notion MCP tools such as `notion-fetch`, including child or linked pages the spec depends on. If the Notion tools are unavailable or the page can't be opened, stop and tell the user. Do not guess at its contents.

The doc is the spec. Derive acceptance criteria from its requirements and build only what it scopes for this change. If the user's message disagrees with the doc, follow the message. If repository guidance disagrees with the doc, follow the repository guidance and note the conflict in the PR description. If the doc leaves open a decision that changes the implementation, ask the user instead of building on a guess.

Do not edit the design doc, and do not commit it unless it was already tracked or the user asks. Reference it in the PR description.

## Implement and review

Work through the acceptance criteria in small, coherent changes. Run the repository's required checks and any focused checks that cover the changed behavior. Review the diff for accidental files, secrets, unrelated edits, and compatibility with local instructions.

Before every commit, run both independent reviews on the same diff:

- Have a `verifier` agent independently check the changed behavior against the request, the design doc if there is one, and the acceptance criteria. Give it the relevant diff and evidence, and ask it to report `CONFIRMED`, `REFUTED`, or `INCONCLUSIVE` with concrete findings.
- Have a `code-simplifier` agent inspect the changed code for unnecessary complexity and safe simplifications.

Then act on the results:

- If the verifier reports `REFUTED` and fixing its valid findings changes logic, make the fixes, run the repository checks, and repeat both reviews on the updated diff.
- If the verifier reports `REFUTED` but the valid findings need no logic change, such as missing evidence or a misread requirement, address them and rerun only the verifier.
- If the verifier reports `INCONCLUSIVE`, gather the missing evidence and rerun only the verifier.
- Once the verifier reports `CONFIRMED`, apply the useful simplifier suggestions and run the repository checks. Do not rerun either review for simplifier edits. Skip any suggestion that would change behavior. If the checks fail after a simplifier edit, revert that edit instead of reworking it.

Do not commit while the latest verifier result is `REFUTED` or `INCONCLUSIVE`.

If either agent role is unavailable, do not claim its review happened. Use an available mechanism to obtain that review. If none exists, stop before committing and tell the user which required review is unavailable.

Commit only after checks pass, the verifier has confirmed the logic being committed, and the simplifier has reviewed it. Use the repository's commit conventions. For multiple commits, repeat both reviews before each commit.

## Publish

Push the feature branch and open a draft PR against the same default branch used as the base, for example with `gh pr create --draft`. Write a concise title and a description that states the behavior, implementation, and checks run. Do not mark the PR ready for review, merge, deploy, or change repository settings.

Confirm the PR exists, is a draft, and capture its URL. Report the work as done only after the branch is pushed, the draft PR is open, and you have its URL. If permissions, credentials, CI requirements, or remote state prevent publication, keep the local work and commits, and report the exact blocker and next action.
