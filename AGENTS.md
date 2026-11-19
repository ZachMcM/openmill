# AGENTS.md

openmill is a local software factory. `openmill add` queues markdown design docs, and a background
server runs each one through a coding agent until it ends as a draft PR.

## Commands

Use pnpm for everything. Never use npm or yarn, and never edit `pnpm-lock.yaml` by hand.

- `pnpm install` installs the workspace.
- `pnpm check` runs format check, lint, typecheck, and tests. It must pass before every commit, and it is what CI runs on Ubuntu along with `pnpm build`.
- `pnpm format` and `pnpm lint:fix` fix what they can.
- `pnpm build`, `pnpm typecheck`, and `pnpm test` run through Turbo across all packages. To target one package, use `pnpm --filter <name> <script>`, for example `pnpm --filter @openmill/core test`.
- Add dependencies with `pnpm --filter <name> add <dep>`. Put shared tool versions in the `catalog` in `pnpm-workspace.yaml` and reference them as `catalog:`. Workspace packages depend on each other with `workspace:*`.
- After changing `packages/db/src/schema.ts`, run `pnpm --filter @openmill/db db:generate` and commit the generated migration. Never edit files under `packages/db/drizzle/`.
- Run the CLI from source with `node apps/cli/src/index.ts <command>`. Set `OPENMILL_HOME` to a temp directory so you don't touch `~/.openmill`.
- Turbo caches task results. If a result looks stale, rerun with `--force`, and don't delete `.turbo` directories to work around it.

## Boundaries

| Package                                | Owns                                                                                           | May depend on            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------ |
| `@openmill/core` (`packages/core`)     | Design doc parsing, dependency graph, state transitions, scheduling decisions, config rules    | nothing in the workspace |
| `@openmill/db` (`packages/db`)         | Drizzle schema, migrations, queries                                                            | nothing in the workspace |
| `@openmill/assets` (`packages/assets`) | The workflow skill and review agents, laid out as a Claude Code plugin                         | nothing in the workspace |
| `@openmill/server` (`apps/server`)     | Hono routes, scheduler, runs, git, `gh`, `rex`, and `herdr` calls, terminal and agent adapters | core, db, assets         |
| `openmill` (`apps/cli`)                | Commander commands, the typed client, server auto-start, `install`, `update`, and `uninstall`  | core, server, assets     |

- `core` does no I/O: no filesystem, network, processes, or clock. Keep it pure so it stays easy to unit test.
- The server is the only process that opens SQLite. The CLI never imports `@openmill/db` and talks to the server only through the typed client from `@openmill/server/client`.
- Request and response shapes come from the server's Hono routes. Don't redeclare them in the CLI.
- Only the server runs `git`, `gh`, `rex`, `herdr`, and agents. Only the server sends
  notifications, including Discord and Slack webhook requests. The exceptions are in the CLI.
  `openmill install`, `update`, and `uninstall` run before a server exists. They may check that
  `git` and `gh` are installed, check `rex` or `herdr`, run each agent's readiness check, run `npm`,
  `claude plugin`, `codex plugin`, and `codex debug models`, and copy the Codex review agents,
  and nothing else. `openmill install` may start the server through the typed client to set up
  notifiers. The hidden `openmill hook` command runs inside agent sessions and only forwards hook
  JSON to the server.
- Every terminal implements the `Terminal` interface in `apps/server/src/terminal/types.ts`, and
  every agent implements the `Agent` interface in `apps/server/src/agent/types.ts`. Code specific
  to one terminal or agent stays in its adapter.
- Keep the workflow skill usable by hand. Pass run-specific facts in the prompt instead of editing the skill for openmill.

## Design and infra

- Design docs in `.design-docs/` are the spec for a change. They are gitignored. Don't edit or commit them.
- When a design doc and this file disagree, follow this file and note the conflict in the PR.
- State lives under `~/.openmill/`, or `OPENMILL_HOME` when it's set. Resolve paths through `resolvePaths()` and don't hardcode them.
- The server listens on a unix socket with mode `0600`. It never listens on a TCP port.
- The scheduler is event-driven. Don't add polling or timers to it. The PR watcher is the only
  part of the server with a timer, and its output is one more event that triggers a scheduling
  pass.
- Agents run in auto mode by default, where the agent's own reviewer approves each action, or with full local permissions when `permission_mode` is `bypass`. Never weaken the draft-only, no-merge rules in the workflow skill, and keep the `PreToolUse` draft gate on every run.
- Runs need macOS or Linux and a terminal adapter (Rex or herdr). Every agent runs as an interactive session in a terminal window.
- Target Node 24 or later and ES modules. Workspace packages export TypeScript source directly. Only the CLI is bundled, with tsdown.
- The CLI bundle inlines `@openmill/*` packages, so any third-party package they import at runtime must also be in `apps/cli` `dependencies`. Files found through `import.meta.url` must be copied into `dist/` in `apps/cli/tsdown.config.ts`.

## Comments

- Avoid comments and doc strings. If code seems to need one, first rewrite the code so it doesn't.
- Don't use comments to send messages to users or reviewers.
- Write a comment only when it gives context that someone can't reliably find by reading the codebase, such as an outside constraint or a non-obvious reason.

## Code and tests

- Use strict TypeScript. Prefer `unknown` plus narrowing over `any`.
- Add tests sparingly and thoughtfully where business logic needs protection against realistic failures or regressions. Avoid test bloat, tests that merely mirror the implementation, and unreachable edge cases. Do not add production code or abstractions solely to support those cases.
- Co-locate unit tests as `*.test.ts` beside pure functions, parsers, envelopes, payload validation, and other atomic logic without integrations.
- Use Vitest by default. Use Jest only for a Node-specific reason.
- CI runs on Ubuntu only. Use `node:path` (`join`, `resolve`) to build paths and `os.tmpdir()` instead of hardcoded `/tmp`.
- Avoid adding function parameters or overrides solely for tests. Use module mocks, global stubs, or fake timers instead.
- Do not add integration or end-to-end tests yet.
