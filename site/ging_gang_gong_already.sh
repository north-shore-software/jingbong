#!/bin/sh
# Installs jingbong from source and puts the `jingbong` command on your PATH.
#
#   curl -fsSL https://jingbong.dev/ging_gang_gong_already.sh | sh
#
# Set JINGBONG_DIR to install somewhere other than ~/jingbong.

set -eu

repo="https://github.com/north-shore-software/jingbong.git"
dir="${JINGBONG_DIR:-$HOME/jingbong}"
pnpm_version="10.33.1"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is required"
command -v node >/dev/null 2>&1 || die "Node.js 18 or newer is required: https://nodejs.org"
node_major=$(node -p 'process.versions.node.split(".")[0]')
[ "$node_major" -ge 18 ] || die "Node.js 18 or newer is required (found $(node --version))"

# Use pnpm if it's installed, otherwise run the pinned version without installing it globally.
if command -v pnpm >/dev/null 2>&1; then
	pnpm() { command pnpm "$@"; }
elif command -v corepack >/dev/null 2>&1; then
	pnpm() { corepack "pnpm@$pnpm_version" "$@"; }
else
	pnpm() { npx --yes "pnpm@$pnpm_version" "$@"; }
fi

if [ -d "$dir/.git" ]; then
	say "updating $dir"
	git -C "$dir" pull --ff-only
elif [ -e "$dir" ]; then
	die "$dir exists and is not a git checkout; set JINGBONG_DIR to install elsewhere"
else
	say "cloning into $dir"
	git clone --depth 1 "$repo" "$dir"
fi

cd "$dir"
say "installing dependencies"
pnpm install
say "building"
pnpm build

say "linking the jingbong command"
(cd apps/cli && npm link) || die "npm link failed; if npm's global folder needs root, see https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally"

say ""
say "jingbong is installed in $dir"
say "next: open your coding agent in $dir and run /jingbong-setup,"
say "or follow docs/SELF_HOSTING.md and docs/SETUP_COMMENT_MODE.md"
