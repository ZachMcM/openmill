# Design docs

A design doc is a markdown file with YAML frontmatter. openmill only reads the frontmatter. The
agent reads the whole file.

```markdown
---
id: login
depends_on:
  - ./sessions.md
project: ../auth
---

# Login

Add email and password login on top of the session store from sessions.md.
```

- `id` is required. It names the job, the branch, and the worktree, so it can only use letters,
  digits, `.`, `_`, and `-`, and can't end in `.lock`. Ids are unique per repo.
- `depends_on` is a path or a list of paths to other design docs, relative to this one. A cycle or
  a dependency without an `id` fails the whole `add`. See [Stacks](./jobs.md#stacks) for how
  dependent docs become a stack of PRs.
- `project` is a folder, relative to this doc, with a `README.md` or `index.md` that gives the
  agent background shared across several docs.

openmill snapshots each doc when you queue it. Editing the file afterward changes nothing until
you run [`openmill add`](./usage.md) again.
