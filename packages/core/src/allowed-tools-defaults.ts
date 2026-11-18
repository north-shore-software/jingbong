/**
 * Per-platform default allowed-tool lists.
 *
 * These are the single source of truth for "what tools does Cyrus have access
 * to when a session is triggered by platform X". cyrus-hosted and any
 * self-host configuration imports these constants verbatim; the database
 * stores per-team overrides only, and falls back to these lists when a team
 * has not customized its allowed-tool set.
 *
 * Resolution is **additive only** — there is no implicit appending of
 * workspace MCP tools at runtime. Anything Cyrus needs (including
 * `mcp__linear`, `mcp__cyrus-tools`, and
 * read access to repository paths) is listed here explicitly. If you remove
 * a tool from this list, Cyrus loses access to it. If you add a tool here,
 * existing teams whose column equals the previous verbatim default will be
 * migrated forward; teams who have customized their list are left alone.
 *
 * The lists are intentionally maintained independently — sharing tools
 * between platforms is fine and expected, but the lists do not derive from
 * each other.
 */

/**
 * Default allowed tools for Linear-triggered agent sessions.
 *
 * Linear sessions are full engineering sessions — Cyrus opens worktrees,
 * runs builds, edits files, and opens PRs. This list mirrors the full
 * Claude Agent SDK toolset plus the workspace MCP prefixes Cyrus needs
 * to read and write Linear state.
 */
export const LINEAR_DEFAULT_ALLOWED_TOOLS = [
	// File system
	"Read",
	"Edit",
	"Write",
	"NotebookEdit",

	// Execution
	"Bash",
	"Task",
	"ListAgents",

	// Web
	"WebFetch",
	"WebSearch",

	// Worktree management
	"EnterWorktree",
	"ExitWorktree",

	// User interaction
	"SendMessage",
	"PushNotification",

	// Task lifecycle
	"TaskCreate",
	"TaskUpdate",
	"TaskGet",
	"TaskList",
	"TaskStop",

	// Scheduling
	"CronCreate",
	"CronDelete",
	"CronList",
	"ScheduleWakeup",

	// Monitoring + discovery
	"Monitor",
	"LSP",
	"RemoteTrigger",
	"ToolSearch",
	"Skill",

	// Design sync
	"DesignSync",

	// Workflow orchestration
	"Workflow",

	// Findings reporting
	"ReportFindings",

	// Workspace MCP servers — explicit, no implicit appending.
	"mcp__linear",
	"mcp__cyrus-tools",
] as const;

/**
 * Read-only tool set, used by the `readOnly` tool preset.
 *
 * Grants read-only access to repository sources plus the standard
 * planning/task tools, but no Edit/Write/general Bash. The single Bash
 * pattern allowed is `git -C * pull` so a session can refresh a repo
 * before grepping it.
 */
export const READ_ONLY_ALLOWED_TOOLS = [
	// Read access to configured repository paths
	"Read",
	"Bash(git -C * pull)",

	// Web
	"WebFetch",
	"WebSearch",

	// User interaction
	"SendMessage",
	"ScheduleWakeup",

	// Planning + task lifecycle
	"Task",
	"TaskCreate",
	"TaskUpdate",
	"TaskGet",
	"TaskList",
	"TaskStop",

	// Discovery
	"Monitor",
	"Skill",
	"ToolSearch",

	// Workspace MCP servers
	"mcp__linear",
	"mcp__cyrus-tools",
] as const;

/**
 * Default allowed tools for GitHub-triggered agent sessions.
 *
 * GitHub sessions are full engineering sessions like Linear (Cyrus opens
 * PRs, edits files, runs builds), so the toolset mirrors the Linear
 * default.
 *
 * Maintained as an independent list (NOT derived from
 * `LINEAR_DEFAULT_ALLOWED_TOOLS`) so the two can diverge without one of
 * them silently inheriting the other's changes.
 */
export const GITHUB_DEFAULT_ALLOWED_TOOLS = [
	// File system
	"Read",
	"Edit",
	"Write",
	"NotebookEdit",

	// Execution
	"Bash",
	"Task",
	"ListAgents",

	// Web
	"WebFetch",
	"WebSearch",

	// Worktree management
	"EnterWorktree",
	"ExitWorktree",

	// User interaction
	"SendMessage",
	"PushNotification",

	// Task lifecycle
	"TaskCreate",
	"TaskUpdate",
	"TaskGet",
	"TaskList",
	"TaskStop",

	// Scheduling
	"CronCreate",
	"CronDelete",
	"CronList",
	"ScheduleWakeup",

	// Monitoring + discovery
	"Monitor",
	"LSP",
	"RemoteTrigger",
	"ToolSearch",
	"Skill",

	// Design sync
	"DesignSync",

	// Workflow orchestration
	"Workflow",

	// Findings reporting
	"ReportFindings",

	// Workspace MCP servers GitHub sessions need
	"mcp__linear",
	"mcp__cyrus-tools",
] as const;

/**
 * Platform identifier used by callers that want to resolve a default list
 * dynamically. Keeps platform-string typos out of the call sites.
 */
export type AllowedToolsPlatform = "linear" | "github";

/**
 * Resolve the default allowed-tool list for a platform.
 */
export function getDefaultAllowedTools(
	platform: AllowedToolsPlatform,
): readonly string[] {
	switch (platform) {
		case "linear":
			return LINEAR_DEFAULT_ALLOWED_TOOLS;
		case "github":
			return GITHUB_DEFAULT_ALLOWED_TOOLS;
	}
}
