import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { OpenCodeSandboxConfig } from "./types.js";

/** Credential directories under $HOME that the sandboxed agent must not see. */
const HIDDEN_HOME_DIRS = [
	".config/gh",
	".claude",
	".ssh",
	".cloudflared",
	".config/gcloud",
];

/** Credential and history files under $HOME that the sandboxed agent must not see. */
const HIDDEN_HOME_FILES = [
	".claude.json",
	".config/opencode/service.json",
	".bash_history",
	".node_repl_history",
];

/**
 * bubblewrap arguments that run OpenCode with the host filesystem, except:
 * - `cyrusHome` is an empty tmpfs apart from `readWritePaths`, so the agent
 *   can't read Cyrus's config, tokens or other issues' workspaces;
 * - credential directories and files in `home` are hidden;
 * - a private /proc keeps other processes' environments (Cyrus's secrets) out
 *   of reach.
 * The OpenCode command and its arguments follow these.
 */
export function buildSandboxArgs(
	sandbox: OpenCodeSandboxConfig,
	cyrusHome: string,
	home: string,
): string[] {
	const args = [
		"--dev-bind",
		"/",
		"/",
		"--unshare-pid",
		"--proc",
		"/proc",
		"--die-with-parent",
		"--tmpfs",
		cyrusHome,
	];
	for (const dir of sandbox.readWritePaths) {
		if (!dir) continue;
		mkdirSync(dir, { recursive: true });
		args.push("--bind", dir, dir);
	}
	for (const dir of HIDDEN_HOME_DIRS.map((d) => join(home, d))) {
		if (existsSync(dir)) args.push("--tmpfs", dir);
	}
	for (const file of HIDDEN_HOME_FILES.map((f) => join(home, f))) {
		if (existsSync(file)) args.push("--ro-bind", "/dev/null", file);
	}
	return args;
}
