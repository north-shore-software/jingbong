# Setting up comment mode

Comment mode makes Jingbong behave like a plain Linear integration: it replies
in ordinary comment threads instead of opening Linear agent sessions. The
[user guide](./USER_GUIDE.md) describes what people can do with it. This page
covers what the host running Jingbong needs.

## Linear

- Authorize the Linear OAuth app with `scope=read,write&actor=app` and no
  `app:mentionable` or `app:assignable` scope (`jingbong self-auth-linear` does this).
  With those scopes Linear opens an agent session on every mention.
  Without them, Jingbong can no longer be assigned issues or picked from the
  @-mention menu, so people type `@jingbong` themselves.
- Enable the **Comment** and **Reaction** webhooks on the OAuth app.
  Reactions on Jingbong's own comments also arrive as `AppUserNotification`
  webhooks.

## Runner

- Install OpenCode **v2** and put it on the service's `PATH`. Readonly skills
  run it with `--standalone`, because OpenCode's background service ignores
  Cyrus's per-run permission rules.
- `build` runs OpenCode under [bubblewrap](https://github.com/containers/bubblewrap)
  (`apt install bubblewrap`). Inside the sandbox `~/.cyrus` is empty apart
  from the build's own folders, credential files in `$HOME` are hidden, and
  secrets from `~/.cyrus/.env` are removed from the environment.

## GitHub

`build` commits, pushes and opens pull requests as the GitHub App, never as
the `gh` user. It needs:

- `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID` and the App's private key
  (the same settings Cyrus uses to mint installation tokens);
- `GITHUB_BOT_USERNAME`: the App's bot login without `[bot]`. Commits are
  authored as `<name>[bot]`.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `CYRUS_COMMENT_HANDLE` | `jingbong` | The name people mention. |
| `CYRUS_SKILLS_DIR` | `~/.cyrus/skills` | Local skills. A skill here overrides the bundled one with the same name. |

The bundled skills (`cp`, `opt`, `build`) live in
`packages/edge-worker/comment-skills/`.

## Files Jingbong writes

| Path | What it is |
| --- | --- |
| `~/.cyrus/checkpoints/<ISSUE>-<id>/` | Read-only checkouts for `cp`/`opt`, removed after each run. |
| `~/.cyrus/builds/<ISSUE>-<id>/` | Worktrees for `build`, removed after each run. |
| `~/.cyrus/state/opt-reactions.json` | Comments that 🤔 already ran `opt` for. Delete an entry to allow a rerun. |
