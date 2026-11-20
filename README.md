# openmill

A local software factory that turns markdown design docs into pull requests.

> [!WARNING]
> openmill is in early development. Commands, config keys, and job states can change between
> minor versions.

Each design doc becomes one PR. Docs declare their dependencies in frontmatter, so openmill can
run independent docs in parallel and hold dependent ones until their predecessors land. Agents
open every PR as a draft, then respond to review comments and CI failures while you stay in
control of what gets pushed and posted.

openmill runs on your machine, needs no hosting, and works with whichever coding agent you
already use.

## Install

Requires macOS or Linux, Node 24 or later, `git`, the GitHub CLI (`gh`) signed in with
`gh auth login`, a terminal ([Rex](https://www.superlogical.com/rex),
[herdr](https://herdr.dev), tmux 3.0 or later, or [T3 Code](https://t3.codes) for Claude jobs), and at least one signed-in agent CLI: Claude Code (`claude`) or
Codex (`codex`).

```sh
npx openmill install
```

It checks the prerequisites, installs the CLI and agent plugins, and asks a few setup questions.
`openmill update` upgrades to the latest release, and `openmill uninstall` removes openmill. See
[Installation](https://github.com/ZachMcM/openmill/blob/main/docs/installation.md) for all three.

> [!CAUTION]
> openmill starts Claude in auto mode by default, where Claude's own classifier approves or blocks
> each action. With `permission_mode` set to `bypass`, sessions start with
> `--dangerously-skip-permissions`, so an agent can run any command and edit any file your user
> can. In both modes a hook denies `gh pr ready` and `gh pr merge`, but an agent that sets out to
> get around it can. See
> [Permission modes](https://github.com/ZachMcM/openmill/blob/main/docs/installation.md#permission-modes).

## First job

Write a design doc, `login.md`, in your repo. openmill only needs an `id` in the frontmatter
([format](https://github.com/ZachMcM/openmill/blob/main/docs/design-docs.md)).

```markdown
---
id: login
---

Add email and password login.
```

Queue it, list jobs, and open the job's window
([all commands](https://github.com/ZachMcM/openmill/blob/main/docs/usage.md)).

```sh
openmill add login.md
openmill ls
openmill open login
```

The agent works in its own worktree and opens a draft PR. openmill then watches the PR and brings
the job back when a trusted reviewer leaves comments or CI fails. Add `depends_on` to chain docs
into a stack of PRs. See [Jobs](https://github.com/ZachMcM/openmill/blob/main/docs/jobs.md) for
the details.

## Documentation

- [Installation](https://github.com/ZachMcM/openmill/blob/main/docs/installation.md): what `install` does, updating, uninstalling, and permission modes
- [Usage](https://github.com/ZachMcM/openmill/blob/main/docs/usage.md): the commands and how `openmill add` queues docs
- [Jobs](https://github.com/ZachMcM/openmill/blob/main/docs/jobs.md): job windows, the PR watcher, follow-ups, stacks, and job states
- [Design docs](https://github.com/ZachMcM/openmill/blob/main/docs/design-docs.md): the frontmatter format
- [Configuration](https://github.com/ZachMcM/openmill/blob/main/docs/configuration.md): every config key and its default
- [Supported agents](https://github.com/ZachMcM/openmill/blob/main/docs/agents.md): Claude Code and Codex
- [Notifications](https://github.com/ZachMcM/openmill/blob/main/docs/notifications.md): desktop, `notify_command`, Discord, and Slack
- [Contributing](https://github.com/ZachMcM/openmill/blob/main/CONTRIBUTING.md): development setup and releasing

## License

[MIT](LICENSE)
