---
name: design-doc
description: Write a settled plan as an openmill design doc, saved where the user says, with id and depends_on frontmatter, ready for openmill add or a by-hand build. Use after a plan is agreed, for example at the end of /grill-me.
---

# Design doc

Turn a plan that's already settled into a design doc that openmill, or a person running the `autonomous-feature-pr` skill by hand, can build into one draft PR.

## Before you write

1. Collect the decisions. They usually come from the conversation, often from a finished `/grill-me` session. If a decision that changes the implementation is still open, ask the user, or suggest running `/grill-me` first. Don't write a guess into the doc.
2. Get the location from the user. See "Where it goes" below.
3. Read the repository's guidance, such as `AGENTS.md`, and any existing design docs in the folder the user chose. Match their structure and voice.
4. Look up the facts the doc names, such as file paths, interfaces, commands, and config keys, in the codebase. A doc that names a file that doesn't exist sends the builder looking for it.

## Size

One doc is one draft PR. If the plan won't fit in one reviewable PR, split it into docs that each leave the repository working, and chain them with `depends_on`. Tell the user how you split it.

## Where it goes

Save the doc only where the user tells you. If they haven't said, ask before you write anything, and don't suggest or fall back to a default folder, even one the repository already uses.

- If they give a folder, name the file `<id>.md` inside it, and create the folder if it's missing.
- If they give a file path, use it as given.
- For a chain of docs, confirm that they all go in the same folder, unless the user said otherwise.

Don't commit the doc unless the user asks.

## Frontmatter

```markdown
---
id: login
depends_on: ./sessions.md
project: ../auth
---
```

- `id` is required. It names the job, its branch, and its worktree, so use lowercase letters, digits, and `-`, and keep it short. It must not end in `.lock`. It must be unique among the repository's design docs, since openmill keys jobs by id per repo.
- `project` is optional. It's a folder, relative to the doc, with a `README.md` or `index.md` of background shared across several docs. Add it only when the user has such a folder.

### depends_on

Add `depends_on` only when this change needs code from another doc that isn't merged yet. openmill then waits for that doc's draft PR and stacks this branch on top of it.

- Point at the doc itself, as a path relative to this doc, such as `./sessions.md`.
- Name the nearest parent only. If C needs B and B needs A, C depends on `./b.md`, not on both.
- A doc can't stack on two parents that don't depend on each other, because there's no single branch to build on. Merge one first, or combine the work into one doc.
- Leave `depends_on` out when the parent is already merged. Build from the default branch.
- If this doc will be built by hand with the `autonomous-feature-pr` skill, keep `depends_on`. The skill stacks on the parent's open PR however the parent was built.
- If this doc will run through openmill, the parent must run through openmill too, either already queued or added in the same `openmill add` batch. A doc someone builds by hand never becomes a job, and `openmill add` rejects a dependency on it with "depends on unknown job". Run `openmill ls` to see what's queued. If the parent will be built by hand, leave `depends_on` out and tell the user to queue this doc after the parent merges, or to build this one by hand too.
- If you can't tell how either doc will be built, ask.

## Body

Follow the existing docs if there are any. Otherwise use these sections, and skip one only when it would be empty:

- A title, then a short opening that says what's wrong or missing today and what this change does about it.
- `## Goals`: the outcomes the PR must deliver, as bullets a reviewer can check.
- `## Non-goals`: what's deliberately left out, so the builder doesn't add it.
- One section per area of the change, such as a command, a state, a file, or an interface. Name real files, functions, commands, and config keys. Give exact strings when a message, flag, or output format matters.
- `## Testing`: the tests that protect the behavior, following the repository's test rules.
- `## Open items to verify during implementation`: facts you couldn't confirm, such as how an outside tool behaves. The builder checks each one and reports the result in the PR.

Write each decision once, as a decision. Don't list the alternatives you rejected unless the reason stops someone from reopening the question. Leave out code the builder can write from the description.

## After you write

Tell the user the path to each doc, then the command that builds them. For openmill, queue a chain in one batch, as in `openmill add <folder>/sessions.md <folder>/login.md`. To build one by hand, they run `/openmill:autonomous-feature-pr <path to the doc>`. Use the real paths in both.
