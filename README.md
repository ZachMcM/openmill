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

Requires Node 24 or later, `git`, and the GitHub CLI (`gh`), signed in with `gh auth login`. The
Claude Code CLI is optional, but without it you can't resume sessions or use the plugin
interactively.

```sh
npx openmill install
```

This works the same on macOS, Linux, and Windows. It:

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
> openmill runs agents with full local permissions. Headless runs use Claude Code's
> `bypassPermissions` mode, so an agent can run any command and edit any file your user can.
> The workflow skill only opens draft PRs and never merges, but nothing else stops it.

## Usage

```sh
openmill add docs/login.md        # queue a doc (and the docs it depends on)
openmill ls                       # list jobs
openmill show login               # worktree, session, and a resume command
openmill stop login               # abort the headless run so you can take over
openmill requeue login            # hand the job back to the queue
openmill config set concurrency 3
openmill server status
```

The first command that needs the server starts it in the background. State lives in
`~/.openmill`, or in `OPENMILL_HOME` when it's set.

To take over a job, run `openmill stop <id>`, then paste the command `openmill show <id>` prints.
When you're done, `openmill requeue <id>` resumes the same session headlessly, or marks the job
done if you already opened the draft PR.

## Design doc format

<!-- TODO: frontmatter fields, the project doc, how dependencies are resolved -->

## Configuration

<!-- TODO: policies, profiles, phases, and config layering -->

## Supported agents

<!-- TODO: SDK and CLI adapters -->

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
