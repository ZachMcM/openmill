# Usage

This page lists the `openmill` commands and how `openmill add` queues docs.

```sh
openmill add docs/login.md        # queue a doc (and the docs it depends on)
openmill ls                       # list jobs
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
