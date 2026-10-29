# Jingbong

Jingbong is a self-hosted coding agent for Linear and GitHub. It watches for
requests on issues, creates isolated Git worktrees, runs an agent CLI (OpenCode,
Claude Code, Codex, Gemini or Cursor) against them, and replies with its results.

## Based on Cyrus

Jingbong is a fork of [Cyrus](https://github.com/ceedaragents/cyrus) by
[Ceedar](https://github.com/ceedaragents), and nearly all of the code here is
their work. Thank you to the Cyrus team and contributors.

Jingbong is developed independently and will diverge from Cyrus over time.
It is not affiliated with or endorsed by the Cyrus project, and changes here
are not intended for upstream. If you are looking for a supported product,
use Cyrus.

- Forked from Cyrus v0.2.74 (commit `5207ab4`, tagged `cyrus-v0.2.74` here).
- `git diff cyrus-v0.2.74` shows everything that has changed since the fork.
- See [NOTICE](./NOTICE) for attribution.

## Development

```bash
pnpm install
pnpm build
pnpm test:packages:run
```

Package names, the `cyrus` command and the `~/.cyrus` config directory are
still inherited from Cyrus. The setup and configuration guides in
[`docs/`](./docs) still apply:

- [Self-hosting guide](./docs/SELF_HOSTING.md)
- [Git & GitHub setup](./docs/GIT_GITHUB.md)
- [Configuration reference](./docs/CONFIG_FILE.md)
- [Setup scripts](./docs/SETUP_SCRIPTS.md)

## License

Apache License 2.0, the same license as Cyrus. See [LICENSE](./LICENSE) and
[NOTICE](./NOTICE).
