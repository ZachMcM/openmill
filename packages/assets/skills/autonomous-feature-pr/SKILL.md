---
name: autonomous-feature-pr
description: Implement a small feature from a request, a markdown design doc, or a Notion page, have correctness and simplicity verifiers confirm it, commit it, and open a draft pull request.
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

Before every commit, have two independent reviewers check the same diff. Give each one the diff, the request, the design doc if there is one, and the acceptance criteria, along with any evidence you have. Each reports `CONFIRMED`, `REFUTED`, or `INCONCLUSIVE` with concrete findings.

- A `verify-correctness` agent checks the changed behavior for bugs: behavior that misses the acceptance criteria or breaks something that worked before.
- A `verify-simplicity` agent checks the changed code for complexity the change doesn't need, slop, and anti-patterns.

Then act on the results:

- If a reviewer reports `REFUTED` and fixing its valid findings changes code, make the fixes, run the repository checks, and rerun both reviewers on the updated diff. A simplicity fix can break behavior, and a correctness fix can add complexity, so any code change goes back through both.
- If a reviewer reports `REFUTED` but its valid findings need no code change, such as missing evidence or a misread requirement, address them and rerun only that reviewer.
- If a reviewer reports `INCONCLUSIVE`, gather the missing evidence and rerun only that reviewer.
- If you think a finding is wrong, don't skip it. Give the reviewer your reasoning and evidence in the recheck. If the same finding comes back twice after that, stop and ask the user.

Commit only when the checks pass and the latest result from both reviewers is `CONFIRMED` for the exact diff you're committing. If either agent role is unavailable, do not claim its review happened. Use an available mechanism to obtain that review. If none exists, stop before committing and tell the user which required review is unavailable.

Use the repository's commit conventions. For multiple commits, repeat both reviews before each commit.

## Publish

Before you write the PR, find the repository's rules for PR titles and descriptions. Look for a pull request template, such as `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/PULL_REQUEST_TEMPLATE/`, `docs/pull_request_template.md`, or `pull_request_template.md` at the root, and for PR guidance in `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, and similar files. Also check CI workflows for jobs that lint PR titles or bodies.

Write the title and description to follow those rules, including required sections, checklists, title formats such as Conventional Commits, and linked issues. Fill in every section a template asks for instead of deleting it. If a section doesn't apply, say so in it. Before you open the PR, check the title and body against each rule you found. If the repository has no rules, write a concise title and a description that states the behavior, implementation, and checks run.

Push the feature branch and open a draft PR against the same default branch used as the base, for example with `gh pr create --draft`. Do not mark the PR ready for review, merge, deploy, or change repository settings.

Confirm the PR exists, is a draft, and capture its URL. Report the work as done only after the branch is pushed, the draft PR is open, and you have its URL. If permissions, credentials, CI requirements, or remote state prevent publication, keep the local work and commits, and report the exact blocker and next action.
