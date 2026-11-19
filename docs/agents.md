# Supported agents

Pick one with `openmill config set agent claude` or `openmill config set agent codex`, or per call
with `openmill add --agent`.

- **Claude Code.** Effort is `low`, `medium`, `high`, `xhigh`, or `max`.
- **Codex.** Every job runs as an interactive `codex` session in a terminal window with the same
  hooks and gates as Claude. Effort must be a level the model lists in `codex debug models`, and
  `openmill add` rejects one it doesn't support. When `config set agent` or `config set model`
  leaves the stored effort unsupported, openmill resets it to the model's default and says so.
  In `auto` mode Codex runs sandboxed with on-request approvals that its auto-reviewer decides,
  network access, and write access to the worktree's git metadata so it can commit and push. On
  Linux that sandbox needs `bubblewrap`. `bypass` runs with
  `--dangerously-bypass-approvals-and-sandbox`. openmill passes hooks and folder trust on the
  command line and never edits `~/.codex/config.toml`.

See [Permission modes](./installation.md#permission-modes) for how Claude runs in `auto` and
`bypass`.
