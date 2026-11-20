# Configuration

Config lives in `~/.openmill/config.json`. Read and change it with `openmill config get`, `set`,
`unset`, and `list`, which work while jobs run.

| Key                 | Default  | Meaning                                                       |
| ------------------- | -------- | ------------------------------------------------------------- |
| `concurrency`       | `2`      | Jobs that can run at once. `needs_input` jobs don't count     |
| `agent`             | `claude` | The coding agent                                              |
| `permission_mode`   | `auto`   | `auto` for the agent's auto mode, or `bypass` to skip prompts |
| `terminal`          | `rex`    | `rex`, `herdr`, or `tmux`, where job windows open             |
| `model`             | unset    | Model passed to the agent. Unset uses the agent's default     |
| `effort`            | `medium` | A level the agent and model support (see below)               |
| `notify_desktop`    | `true`   | Send desktop notifications                                    |
| `notify_command`    | unset    | Shell command that gets each notification as JSON on stdin    |
| `trusted_bots`      | empty    | Comma-separated bot logins whose reviews count                |
| `review_push`       | `wait`   | `wait` or `auto` for pushes from review follow-ups            |
| `ci_push`           | `auto`   | `wait` or `auto` for pushes from CI follow-ups                |
| `followup_attempts` | `3`      | Follow-up runs on the same problem before the job needs you   |

See [Supported agents](./agents.md) for the `effort` levels each agent accepts,
[Permission modes](./installation.md#permission-modes) for `permission_mode`, and
[Notifications](./notifications.md) for `notify_desktop` and `notify_command`.
