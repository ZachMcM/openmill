# Contributing

Read [AGENTS.md](AGENTS.md) for the repo rules: commands, package boundaries, and code and test
conventions.

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

## Releasing

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
