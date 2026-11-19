# Notifications

openmill sends a notification when a job needs input, waits on a permission prompt, fails, opens
its first draft PR, has a follow-up ready to push, runs out of follow-up attempts, or has a PR
whose checks all passed. It notifies only when you need to act, plus `pr_opened` once per job.
Every notification goes to the desktop, `notify_command`, and each
Discord or Slack connector. Desktop notifications use
`osascript` on macOS and `notify-send` on Linux. Turn them off with
`openmill config set notify_desktop false`.

`notify_command` runs through the shell with a JSON payload on stdin and a 10 second timeout:

```json
{
  "event": "needs_input",
  "job": "login",
  "repo": "/Users/me/src/app",
  "state": "needs_input",
  "reason": "Should sessions expire after 30 days or 90?",
  "pr_url": null,
  "open": "openmill open login"
}
```

`event` is one of `needs_input`, `needs_permission`, `failed`, `ready_for_review`,
`followup_ready`, `followups_exhausted`, or `pr_opened`. See [Jobs](./jobs.md) for when each one
happens and [Job states](./jobs.md#job-states) for the `state` values.

## Discord and Slack

openmill can post to Discord and Slack incoming webhooks, so notifications reach your phone.
`openmill install` offers to set them up, and `openmill notify add` runs the same steps later. It
shows where to create the webhook, checks the URL, and sends a test message.

```sh
openmill notify add                                      # interactive setup
openmill notify add discord <webhook-url> --name phone   # no prompts
openmill notify ls                                       # names, types, and masked URLs
openmill notify test [name]                              # send a test message
openmill notify rm phone
```

You can add several connectors, including two of the same type. Each one gets every event.
Connectors live in `~/.openmill/notifiers.json` with mode `0600`, and the server never shows a
full webhook URL after you add one. A failed send is logged to `server.log` and not retried.
