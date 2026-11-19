# Installation

This page covers what `openmill install` does, how to update and remove openmill, and the
permission modes agents run in.

Requires macOS or Linux, Node 24 or later, `git`, the GitHub CLI (`gh`) signed in with
`gh auth login`, a terminal ([Rex](https://www.superlogical.com/rex),
[herdr](https://herdr.dev), or [T3 Code](https://t3.codes) for Claude jobs), and at least one signed-in agent CLI: Claude Code (`claude`) or
Codex (`codex`).

```sh
npx openmill install
```

It:

1. checks the prerequisites above, including whether each agent CLI can launch and is signed in
2. installs `openmill` globally with `npm install -g`, at the version you ran
3. creates `~/.openmill`
4. installs the openmill plugin, which has the workflow skill and review agents, from a local
   marketplace in `~/.openmill/plugin`, for each agent that's ready. For Codex it also copies the
   review agents into `~/.codex/agents`
5. stops a running server from an older version, so the next command starts the new one
6. asks which agent runs jobs by default when more than one is ready, then asks for
   [`concurrency`, `model`, and `effort`](./configuration.md). For Codex, the model and effort lists come from
   `codex debug models`

Pass `--yes` to skip the prompts and keep the defaults.

To upgrade, run `openmill update`. It installs the latest release, refreshes the agent plugins, and
stops a server from the old version. It keeps your config and asks no questions. Config keys added
in a new release get their defaults, which you can change with [`openmill config set`](./configuration.md).

To remove openmill, run `openmill uninstall`. It stops the server and removes the plugins, the
Codex review agents, and the global package. It keeps `~/.openmill` unless you pass `--purge`.

## Permission modes

> [!CAUTION]
> openmill starts Claude in auto mode by default, where Claude's own classifier approves or blocks
> each action. With `permission_mode` set to `bypass`, sessions start with
> `--dangerously-skip-permissions`, so an agent can run any command and edit any file your user
> can. In both modes a hook denies `gh pr ready` and `gh pr merge`, but an agent that sets out to
> get around it can.

Auto mode needs a model Claude's classifier supports. Claude 2.1.328 silently drops to manual mode
for other models, so openmill fails the run with a message that says to pick a supported model or
set [`permission_mode`](./configuration.md) to `bypass`. In bypass mode, the first job shows Claude Code's Bypass
Permissions warning in the job's window. Run `openmill open <id>` and accept it once. openmill
never accepts it for you. openmill also marks each repo you queue as trusted in `~/.claude.json`,
so Claude doesn't ask to trust every new worktree.

For how Codex runs in each mode, see [Supported agents](./agents.md).
