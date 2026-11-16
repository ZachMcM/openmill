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

## Usage

<!-- TODO: writing a design doc, `openmill add`, `openmill inbox`, `openmill attach` -->

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

| Path          | Package            | Purpose                   |
| ------------- | ------------------ | ------------------------- |
| `apps/cli`    | `openmill`         | The published CLI         |
| `apps/server` | `@openmill/server` | The background daemon     |
| `packages/db` | `@openmill/db`     | SQLite schema and queries |

## License

[MIT](LICENSE)
