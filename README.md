# openmill

A local software factory that turns markdown design docs into pull requests.

> [!WARNING]
> openmill is in early development. Nothing below works yet.

Each design doc becomes one PR. Docs declare their dependencies in frontmatter, so openmill can
run independent docs in parallel and hold dependent ones until their predecessors land. Agents
open every PR as a draft, then respond to review comments and CI failures while you stay in
control of what gets pushed and posted.

openmill runs on your machine, needs no hosting, and works with whichever coding agent you
already use.

## Install

Requires macOS or Linux, Node 24 or later, `git`, the GitHub CLI (`gh`) signed in with
`gh auth login`, [Rex](https://www.superlogical.com/rex), and the Claude Code CLI (`claude`).

```sh
npx openmill install
```

It:

1. checks the prerequisites above
2. installs `openmill` globally with `npm install -g`, at the version you ran
3. creates `~/.openmill`
4. installs the openmill Claude plugin, which has the workflow skill and review agents, from a
   local marketplace in `~/.openmill/plugin`
5. stops a running server from an older version, so the next command starts the new one
6. asks for `concurrency`, `model`, and `effort`

Pass `--yes` to skip the prompts and keep the defaults. To upgrade, run
`npx openmill@latest install`.

To remove openmill, run `openmill uninstall`. It stops the server and removes the plugin and the
global package. It keeps `~/.openmill` unless you pass `--purge`.

> [!CAUTION]
> openmill runs agents with full local permissions. Every session starts with
> `--dangerously-skip-permissions`, so an agent can run any command and edit any file your user can.
> The workflow skill only opens draft PRs and never merges, but nothing else stops it.

The first time a job starts, Claude Code shows its Bypass Permissions warning in the job's window.
Run `openmill open <id>` and accept it once. openmill never accepts it for you. openmill also
marks each repo you queue as trusted in `~/.claude.json`, so Claude doesn't ask to trust every
new worktree.

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
openmill server status
```

The first command that needs the server starts it in the background. State lives in
`~/.openmill`, or in `OPENMILL_HOME` when it's set.

Every job runs as an interactive `claude` session in its own window in the `openmill` Rex
session. New windows open in the background, so a new job never takes your screen. Run
`openmill open <id>` to watch a job, and type into its window to take it over.

A job is done when its branch has a draft PR. When the agent stops without one, openmill asks it
once to open the PR or ask its question. If it stops again, the job moves to `needs_input` and
you get a notification. Answer in the window and the job is `running` again. A `needs_input` job
doesn't count against `concurrency`. If the session ends without a PR, the job fails, and
`openmill requeue <id>` resumes that session in a new window.

Windows stay open after a job ends and keep running when the server restarts. When a run ends,
openmill saves the window's text to the job's `runs` folder.

Once a job has a draft PR, the server polls GitHub every `watch_interval` seconds (120 by
default). It notifies you when the PR's checks all pass, and moves the job to `merged` or `closed`
when the PR does. Merging removes the job's worktree and local branch. Reviews and threads only
count when they come from the repo's owners, members, or collaborators, or from a login in
`trusted_bots`. Set `OPENMILL_DEBUG=1` before the server starts to log the ones it ignores.

## Design doc format

<!-- TODO: frontmatter fields, the project doc, how dependencies are resolved -->

## Configuration

<!-- TODO: policies, profiles, phases, and config layering -->

## Supported agents

Claude Code is the only agent so far. Set it with `openmill config set agent claude`.

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
| `packages/assets` | `@openmill/assets` | The workflow skill and review subagents that workers run             |

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
