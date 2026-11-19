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
`gh auth login`, [Rex](https://www.superlogical.com/rex), and at least one signed-in agent CLI:
Claude Code (`claude`) or Codex (`codex`).

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
   `concurrency`, `model`, and `effort`. For Codex, the model and effort lists come from
   `codex debug models`

Pass `--yes` to skip the prompts and keep the defaults.

To upgrade, run `openmill update`. It installs the latest release, refreshes the agent plugins, and
stops a server from the old version. It keeps your config and asks no questions. Config keys added
in a new release get their defaults, which you can change with `openmill config set`.

To remove openmill, run `openmill uninstall`. It stops the server and removes the plugins, the
Codex review agents, and the global package. It keeps `~/.openmill` unless you pass `--purge`.

> [!CAUTION]
> openmill starts Claude in auto mode by default, where Claude's own classifier approves or blocks
> each action. With `permission_mode` set to `bypass`, sessions start with
> `--dangerously-skip-permissions`, so an agent can run any command and edit any file your user
> can. In both modes a hook denies `gh pr ready` and `gh pr merge`, but an agent that sets out to
> get around it can.

Auto mode needs a model Claude's classifier supports. Claude 2.1.328 silently drops to manual mode
for other models, so openmill fails the run with a message that says to pick a supported model or
set `permission_mode` to `bypass`. In bypass mode, the first job shows Claude Code's Bypass
Permissions warning in the job's window. Run `openmill open <id>` and accept it once. openmill
never accepts it for you. openmill also marks each repo you queue as trusted in `~/.claude.json`,
so Claude doesn't ask to trust every new worktree.

## Usage

```sh
openmill add docs/login.md        # queue a doc (and the docs it depends on)
openmill ls                       # list jobs
openmill open login               # focus the job's Rex window
openmill show login               # worktree, window, session, and transcript
openmill cancel login             # close the window and cancel the job
openmill requeue login            # resume a failed job's session in a new window
openmill clean                    # close the windows of finished jobs
openmill config set concurrency 3
openmill config unset model       # back to the default
openmill config set notify_command "curl -s -d @- ntfy.sh/my-topic"  # JSON payload on stdin
openmill config set trusted_bots "coderabbitai[bot],copilot-pull-request-reviewer[bot]"
openmill config list
openmill server status
openmill server stop
```

`openmill add` takes files or directories. For a directory, it queues every `.md` file under it
that has an `id`, skips files without one, and pulls in each doc's dependencies even when they live
elsewhere. Queuing a doc that is still `queued` or `blocked` updates it. A doc that already started
is rejected unless you pass `--force`, which cancels its session and queues it from scratch.
`--base`, `--agent`, `--permission-mode`, `--model`, and `--effort` override the config for the
docs in that call. A job keeps the agent and permission mode it was queued with, so changing the
config later doesn't change jobs already queued or running.

The first command that needs the server starts it in the background. State lives in
`~/.openmill`, or in `OPENMILL_HOME` when it's set.

Every job runs as an interactive agent session in its own window in the `openmill` Rex
session. New windows open in the background, so a new job never takes your screen. Run
`openmill open <id>` to watch a job, and type into its window to take it over.

A job is done when its branch has a draft PR. When the agent stops without one, openmill asks it
once to open the PR or ask its question. If it stops again, the job moves to `needs_input` and
you get a notification. Answer in the window and the job is `running` again. A `needs_input` job
doesn't count against `concurrency`. If the session ends without a PR, the job fails, and
`openmill requeue <id>` resumes that session in a new window.

When the agent waits on a permission prompt for a few seconds, you get one notification and the
job stays `running`. `openmill ls` and `openmill show` print it as
`running, waiting for permission (4m)` until the agent moves on.

Windows stay open after a job ends and keep running when the server restarts. When a run ends,
openmill saves the window's text to the job's `runs` folder.

Once a job has a draft PR, the server polls GitHub every `watch_interval` seconds (120 by
default). It notifies you when the PR's checks all pass, and moves the job to `merged` or `closed`
when the PR does. Merging removes the job's worktree and local branch. Reviews and threads only
count when they come from the repo's owners, members, or collaborators, or from a login in
`trusted_bots`. Set `OPENMILL_DEBUG=1` before the server starts to log the ones it ignores.

### Follow-ups

When a trusted review leaves new unresolved threads on a job's PR, or its CI finishes with a
failing check, the job goes back in the queue as a follow-up. The follow-up starts a fresh
agent session in the job's window with the `address-pr-feedback` skill, which fixes the code,
replies to each thread, and pushes. The skill works by hand on any PR too.

Pushes from follow-ups are gated by `review_push` and `ci_push`. With `wait`, the session commits
and stops, and the job moves to `awaiting_push` with a notification. Read the diff in the window,
then reply there or run `openmill requeue <id>` to let it push and post its replies. With `auto`,
it pushes as soon as it's done. By default review follow-ups wait and CI follow-ups push.

If `followup_attempts` runs in a row (3 by default) fail to fix the same threads and checks, the
job moves to `needs_input` and you get a notification. `openmill requeue <id>` tries again.

### Stacks

A job whose dependencies all have PRs branches from its parent's branch and opens its PR against
it, so a chain of docs becomes a stack of PRs. It doesn't wait for the parent to merge. When a
dependency is `failed`, `needs_input`, `cancelled`, or `closed`, the jobs that depend on it are
`blocked` until it recovers.

When a parent PR merges, openmill rebases each child onto the parent's base, force-pushes with a
lease, and retargets the child's PR. It works one level of the stack at a time. A rebase that
conflicts starts a restack run, where the agent resolves the conflicts and follows the same push
gate as review follow-ups.

### Job states

| State           | Meaning                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `queued`        | Waiting for a free slot or for its dependencies to open PRs              |
| `blocked`       | A dependency failed, needs input, was cancelled, or had its PR closed    |
| `running`       | An agent session is working                                              |
| `needs_input`   | The agent stopped to ask something. Answer in the window                 |
| `awaiting_push` | A gated follow-up committed changes. Reply or `requeue` to push them     |
| `done`          | The draft PR is open and the server is watching it                       |
| `failed`        | The session ended without a PR. `requeue` resumes it                     |
| `merged`        | The PR merged                                                            |
| `closed`        | The PR closed without merging. Reopening it moves the job back to `done` |
| `cancelled`     | You ran `openmill cancel`                                                |

### Notifications

openmill sends a notification when a job needs input, waits on a permission prompt, fails, has a follow-up ready to push, runs
out of follow-up attempts, or has a PR whose checks all passed. Desktop notifications use
`osascript` on macOS and `notify-send` on Linux. Turn them off with
`openmill config set notify_desktop false`.

`notify_command` runs through the shell with a JSON payload on stdin and a 10 second timeout:

```json
{
  "event": "needs_input",
  "job": "login",
  "repo": "/Users/me/src/app",
  "state": "needs_input",
  "reason": "Should sessions expire after 30 days or 90?",
  "pr_url": null,
  "open": "openmill open login"
}
```

`event` is one of `needs_input`, `needs_permission`, `failed`, `ready_for_review`,
`followup_ready`, `followups_exhausted`, or `session_closed`.

## Design doc format

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
  a dependency without an `id` fails the whole `add`.
- `project` is a folder, relative to this doc, with a `README.md` or `index.md` that gives the
  agent background shared across several docs.

openmill snapshots each doc when you queue it. Editing the file afterward changes nothing until
you run `openmill add` again.

## Configuration

Config lives in `~/.openmill/config.json`. Read and change it with `openmill config get`, `set`,
`unset`, and `list`, which work while jobs run.

| Key                 | Default  | Meaning                                                       |
| ------------------- | -------- | ------------------------------------------------------------- |
| `concurrency`       | `2`      | Jobs that can run at once. `needs_input` jobs don't count     |
| `agent`             | `claude` | The coding agent                                              |
| `permission_mode`   | `auto`   | `auto` for the agent's auto mode, or `bypass` to skip prompts |
| `model`             | unset    | Model passed to the agent. Unset uses the agent's default     |
| `effort`            | `medium` | A level the agent and model support (see below)               |
| `notify_desktop`    | `true`   | Send desktop notifications                                    |
| `notify_command`    | unset    | Shell command that gets each notification as JSON on stdin    |
| `watch_interval`    | `120`    | Seconds between GitHub polls for open PRs. At least 30        |
| `trusted_bots`      | empty    | Comma-separated bot logins whose reviews count                |
| `review_push`       | `wait`   | `wait` or `auto` for pushes from review follow-ups            |
| `ci_push`           | `auto`   | `wait` or `auto` for pushes from CI follow-ups                |
| `followup_attempts` | `3`      | Follow-up runs on the same problem before the job needs you   |

## Supported agents

Pick one with `openmill config set agent claude` or `openmill config set agent codex`, or per call
with `openmill add --agent`.

- **Claude Code.** Effort is `low`, `medium`, `high`, `xhigh`, or `max`.
- **Codex.** Every job runs as an interactive `codex` session in a Rex window with the same hooks
  and gates as Claude. Effort must be a level the model lists in `codex debug models`, and
  `openmill add` rejects one it doesn't support. When `config set agent` or `config set model`
  leaves the stored effort unsupported, openmill resets it to the model's default and says so.
  In `auto` mode Codex runs sandboxed with on-request approvals that its auto-reviewer decides,
  network access, and write access to the worktree's git metadata so it can commit and push. On
  Linux that sandbox needs `bubblewrap`. `bypass` runs with
  `--dangerously-bypass-approvals-and-sandbox`. openmill passes hooks and folder trust on the
  command line and never edits `~/.codex/config.toml`.

## Development

Requires Node 24 or later and pnpm.

```sh
pnpm install
pnpm check   # format, lint, typecheck, and test
pnpm build
```

| Path              | Package            | Purpose                                                              |
| ----------------- | ------------------ | -------------------------------------------------------------------- |
| `apps/cli`        | `openmill`         | The published CLI                                                    |
| `apps/server`     | `@openmill/server` | The background daemon                                                |
| `packages/core`   | `@openmill/core`   | Design doc parsing, the dependency graph, and the task state machine |
| `packages/db`     | `@openmill/db`     | SQLite schema and queries                                            |
| `packages/assets` | `@openmill/assets` | The workflow skills and verifier agents that sessions run            |

### Releasing

The `openmill` package is published from `apps/cli`. The build bundles the workspace packages and
copies the plugin files and migrations into `dist/`.

To cut a release:

```sh
cd apps/cli && npm version 0.2.0 --no-git-tag-version && cd ../..
git commit -am "chore: release 0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

The tag runs `.github/workflows/release.yml`, which checks that the tag matches the package
version, runs `pnpm check`, and publishes with npm trusted publishing. No npm token is stored.

The first release has to be published by hand, because npm only lets you set up a trusted
publisher for a package that exists:

```sh
pnpm build
cd apps/cli
pnpm pack
npm publish openmill-0.1.0.tgz --access public
```

Then, on npmjs.com, open the package settings and add a trusted publisher. Use the GitHub
repository `ZachMcM/openmill` and the workflow file `release.yml`.

## License

[MIT](LICENSE)
