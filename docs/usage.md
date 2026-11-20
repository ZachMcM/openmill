# Usage

This page lists the `openmill` commands and how `openmill add` queues docs.

```sh
openmill add docs/login.md        # queue a doc (and the docs it depends on)
openmill ls                       # list unfinished jobs
openmill ls --all                 # include merged, cancelled, and closed jobs
openmill ls --since 2d --state failed   # failed jobs updated in the last two days
openmill ls --repo .              # jobs in the current repo
openmill open login               # focus the job's window
openmill show login               # worktree, window, session, and transcript
openmill cancel login             # close the window and cancel the job
openmill requeue login            # resume a failed job's session in a new window
openmill clean                    # close the windows of finished jobs
openmill config set concurrency 3
openmill config unset model       # back to the default
openmill config set notify_command "curl -s -d @- ntfy.sh/my-topic"  # JSON payload on stdin
openmill notify add               # set up Discord or Slack notifications
openmill config set trusted_bots "coderabbitai[bot],copilot-pull-request-reviewer[bot]"
openmill config list
openmill server status
openmill server stop
```

Plain `openmill ls` hides `merged`, `cancelled`, and `closed` jobs and says how many it hid. `-a`
or `--all` shows them. `--since` takes a duration (`30m`, `2h`, `3d`, `1w`), a date
(`2026-11-01`, from local midnight), or a timestamp, and keeps jobs whose last change is that
recent. `--state` takes states separated by commas or repeated, and shows exactly those states,
finished ones included. `--repo` keeps jobs from the git repo that holds the path. The `UPDATED`
column shows how long ago each job last changed.

`openmill add` takes files or directories. For a directory, it queues every `.md` file under it
that has an `id`, skips files without one, and pulls in each doc's dependencies even when they live
elsewhere. Queuing a doc that is still `queued` or `blocked` updates it. A doc that already started
is rejected unless you pass `--force`, which cancels its session and queues it from scratch.
`--base`, `--agent`, `--permission-mode`, `--terminal`, `--model`, and `--effort` override the
[config](./configuration.md) for the docs in that call. A job keeps the agent, permission mode, and terminal it was
queued with, so changing the config later doesn't change jobs already queued or running.

The first command that needs the server starts it in the background. State lives in
`~/.openmill`, or in `OPENMILL_HOME` when it's set.

See [Jobs](./jobs.md) for what happens after a doc is queued, [Design docs](./design-docs.md) for
the doc format, and [Notifications](./notifications.md) for `notify_command` and `openmill notify`.
