# Changelog

All notable changes to Jingbong are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- A splash page in `site/`, deployed to GitHub Pages when it changes on `main`.
- Comment mode: mention `@jingbong` in an ordinary Linear comment and it replies in that thread, with no Linear agent session. Sessions started this way never change the issue's status.
- `@jingbong cp` (checkpoint), `@jingbong opt` (options) and `@jingbong build` (implement and open PRs), plus the ✅, 🤔 and 👍 reactions. See the [user guide](./docs/USER_GUIDE.md).
- Skills can be added or overridden in `~/.cyrus/skills/<name>/SKILL.md`.
- An issue now uses every catch-all repository, not just the first, so one issue can span several repos.
- User guide for the `@jingbong` comment commands (`cp`, `opt`, `build`) and reactions ([docs/USER_GUIDE.md](./docs/USER_GUIDE.md)).
- Forked from [Cyrus](https://github.com/ceedaragents/cyrus) v0.2.74 (commit `5207ab4`, tag `cyrus-v0.2.74`). For history before the fork, see the [Cyrus changelog](https://github.com/ceedaragents/cyrus/blob/main/CHANGELOG.md).

### Changed
- The command is now `jingbong`; `cyrus` still works as an alias.
- The setup skills are now `jingbong-setup*` (was `cyrus-setup*`) and install Jingbong from source instead of the `cyrus-ai` npm package.
- Comments, prompts and messages that Jingbong posts or shows now say "Jingbong" instead of "Cyrus", and no longer point to Cyrus support or the Cyrus dashboard.
- The OpenCode runner targets OpenCode v2 (no `--dir`, lowercase log levels). It can run standalone and inside a bubblewrap sandbox.
- `jingbong self-auth-linear` asks Linear only for `read,write` as an app actor, so Linear no longer opens agent sessions for Jingbong.

### Removed
- Calls to Cyrus's hosted services:
  - the `cyrus-docs` MCP server (atcyrus.com) in agent sessions;
  - the `log_failure_mode` tool and the failure-reporting text added to every system prompt;
  - the default OAuth proxy (`refresh-token` now needs `PROXY_URL`; use `self-auth-linear` instead);
  - the built-in Sentry DSN (set `CYRUS_SENTRY_DSN` to report to your own project).

### Fixed
- Refreshing GitHub's webhook IP ranges now reaches the GitHub webhook listener. Before, webhooks from GitHub's newer ranges were rejected with 403.
