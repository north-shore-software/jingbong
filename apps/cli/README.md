# jingbong (CLI)

The Jingbong command-line app: the edge worker plus setup commands. `cyrus` is
kept as an alias of `jingbong`.

## Installation

Jingbong isn't published to npm. Build it from the repository root, then link
the CLI:

```bash
pnpm install
pnpm build
cd apps/cli && npm link
```

## Usage

### Start the agent
```bash
jingbong
```

### Available Commands

- **`jingbong`** - Start the edge worker (default)
- **`jingbong self-auth-linear`** - Authorize a Linear workspace with your own OAuth app
- **`jingbong self-add-repo [url] [workspace]`** - Clone a repository and add it to the configuration
- **`jingbong check-tokens`** - Check the status of all Linear tokens
- **`jingbong refresh-token`** - Refresh a Linear token (needs `PROXY_URL`)

You can add repositories while Jingbong is running; it watches
`~/.cyrus/config.json` and picks up the change.

## Configuration

### Environment Variables

- `CYRUS_HOST_EXTERNAL` - Set to `true` to allow external connections (listens on `0.0.0.0` instead of `localhost`). Default: `false`
  - Use this when running in Docker containers or when you need external access to the webhook server
  - When `true`: Server listens on `0.0.0.0` (all interfaces)
  - When `false` or unset: Server listens on `localhost` (local access only)
- `LINEAR_ALLOWED_TOOLS` - Comma-separated list of tools allowed for Linear-triggered sessions. Overrides `linearAllowedTools` in `~/.cyrus/config.json` when set.
- `DISALLOWED_TOOLS` - Comma-separated list of tools disallowed across all sessions. Overrides `defaultDisallowedTools` in `~/.cyrus/config.json` when set.