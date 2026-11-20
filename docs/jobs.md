# Jobs

This page covers how a queued doc runs: its window, when it's done, how the server watches its PR,
follow-ups, stacks, and the job states.

Every job runs as an interactive agent session in its own window: a window in the `openmill`
Rex session, a tab in the `openmill` workspace of your default herdr server, which must
already be running, or a window in the `openmill` session of your default tmux server. openmill
creates the tmux session when it's missing, so tmux jobs run with no client attached; run
`tmux attach -t openmill` to watch them. New windows open in the background, so a new job never
takes your screen. Run `openmill open <id>` to watch a job, and type into its window to take it
over. With tmux, `openmill open` switches your attached tmux client to the job's window.

With [`terminal`](./configuration.md) set to `t3code`, Claude jobs run as threads in T3 Code instead, and you watch and
answer them in the T3 app. T3 Code must be running, and the repo must be a project in it.
`openmill install` writes `~/.openmill/t3-hooks.json` and prints the launch args for a Claude
provider named `openmill`, which you add in T3 Code under Settings > Providers. The server signs
in to T3 Code by minting a pairing code with the `t3` CLI and keeps the token in
`~/.openmill/t3-token.json`. `openmill open` opens the thread in the T3 web app and prints its
link. Codex jobs can't run in T3 Code yet.

A job is done when its branch has a draft PR. When the agent stops without one, openmill asks it
once to open the PR or ask its question. If it stops again, the job moves to `needs_input` and
you get a [notification](./notifications.md). Answer in the window and the job is `running` again. A `needs_input` job
doesn't count against [`concurrency`](./configuration.md). If the session ends without a PR, the job fails, and
`openmill requeue <id>` resumes that session in a new window.

When the agent waits on a permission prompt for a few seconds, you get one notification and the
job stays `running`. `openmill ls` and `openmill show` print it as
`running, waiting for permission (4m)` until the agent moves on.

Windows stay open after a job ends and keep running when the server restarts. When a run ends,
openmill saves the window's text to the job's `runs` folder.

To change a `done` job's PR, type a new prompt into its window. The job moves to `running`, and
the server holds follow-ups and restacks until the turn ends. When the agent stops with a clean
worktree and every commit pushed, the job goes back to `done` and any held follow-ups start.
If edits are uncommitted or unpushed, openmill asks the agent once to commit and push them. If
it stops again, the job moves to `needs_input` with a notification, and your reply resumes the
turn. If the session ends with unpushed edits, the job stays in `needs_input`, and
`openmill requeue <id>` moves it back to `done`.

Once a job has a draft PR, the server checks it with conditional GitHub REST requests as often as
once a second. Those return `304 Not Modified` until something changes and don't count against
your rate limit. When the PR, its check runs, or its commit statuses change, the server fetches
the PR right away, so merges, reviews, and CI results show up within a couple of seconds. The
requests stay under 600 a minute, so with many PRs open each one is checked less often. A full
poll every 120 seconds catches anything the cheap checks miss, such as a resolved thread. If
GitHub rate limits the fast checks, they pause and the 120-second poll keeps running.

The server notifies you when the PR's checks all pass, and moves the job to `merged` or `closed`
when the PR does. When the PR conflicts with its base branch, the job moves to `needs_input`
with a notification, and back to `done` once the conflict is fixed. Merging removes the job's
worktree and local branch. Reviews and threads only count when they come from the repo's owners,
members, or collaborators, or from a login in [`trusted_bots`](./configuration.md). Set `OPENMILL_DEBUG=1` before the
server starts to log the ones it ignores.

## Follow-ups

When a trusted review leaves new unresolved threads on a job's PR, or its CI finishes with a
failing check, the job goes back in the queue as a follow-up. The follow-up starts a fresh
agent session in the job's window with the `address-pr-feedback` skill, which fixes the code,
replies to each thread, and pushes. The skill works by hand on any PR too.

Pushes from follow-ups are gated by [`review_push` and `ci_push`](./configuration.md). With `wait`, the session commits
and stops, and the job moves to `awaiting_push` with a notification. Read the diff in the window,
then reply there or run `openmill requeue <id>` to let it push and post its replies. With `auto`,
it pushes as soon as it's done. By default review follow-ups wait and CI follow-ups push.

If [`followup_attempts`](./configuration.md) runs in a row (3 by default) fail to fix the same threads and checks, the
job moves to `needs_input` and you get a notification. `openmill requeue <id>` tries again.

## Stacks

A job whose dependencies all have PRs branches from its parent's branch and opens its PR against
it, so a chain of docs becomes a stack of PRs. It doesn't wait for the parent to merge. When a
dependency is `failed`, `needs_input`, `cancelled`, or `closed`, the jobs that depend on it are
`blocked` until it recovers.

When a parent PR merges, openmill rebases each child onto the parent's base, force-pushes with a
lease, and retargets the child's PR. It works one level of the stack at a time. A rebase that
conflicts starts a restack run, where the agent resolves the conflicts and follows the same push
gate as review follow-ups.

## Job states

| State           | Meaning                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `queued`        | Waiting for a free slot or for its dependencies to open PRs              |
| `blocked`       | A dependency failed, needs input, was cancelled, or had its PR closed    |
| `running`       | An agent session is working                                              |
| `needs_input`   | The agent stopped to ask something. Answer in the window                 |
| `awaiting_push` | A gated follow-up committed changes. Reply or `requeue` to push them     |
| `done`          | The draft PR is open and the server is watching it                       |
| `failed`        | The session ended without a PR. `requeue` resumes it                     |
| `merged`        | The PR merged                                                            |
| `closed`        | The PR closed without merging. Reopening it moves the job back to `done` |
| `cancelled`     | You ran `openmill cancel`                                                |
