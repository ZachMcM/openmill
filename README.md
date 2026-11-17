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

```sh
npx openmill install
```

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

## License

[MIT](LICENSE)
