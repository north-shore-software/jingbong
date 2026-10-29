import type { ILogger, Issue, RepositoryConfig } from "cyrus-core";
import type { LinearIssueTrackerService } from "cyrus-linear-event-transport";
import type { CommentSkill } from "./skills.js";

/** What comment mode needs from the EdgeWorker. */
export interface CommentModeHost {
	logger: ILogger;
	cyrusHome: string;
	opencodeDefaultModel(): string | undefined;
	/** Mints GitHub App installation tokens; null when no App is configured. */
	gitHubAppTokenProvider(): { getToken(): Promise<string> } | null;
}

/** A skill invocation: the skill plus what the requester gave it. */
export interface SkillRequest extends CommentSkill {
	args: string;
	/** Run from a 🤔 reaction: the reacted-to comment is the question. */
	fromReaction?: boolean;
	/** The thread this was asked from, up to `until`, for thread-context skills. */
	discussion: { rootId: string; until: string } | null;
}

export interface SkillRunContext {
	host: CommentModeHost;
	tracker: LinearIssueTrackerService;
	workspaceId: string;
	issue: Issue;
	/** The comment that asked for the skill (or that was reacted to). */
	commentId: string;
	/** Thread to reply in; null for a new top-level comment. */
	rootId: string | null;
	skill: SkillRequest;
	repos: RepositoryConfig[];
	botId: string | undefined;
}

/** The workspace's active repositories, which skills always check out. */
export function workspaceRepos(
	repos: RepositoryConfig[],
	workspaceId: string,
): RepositoryConfig[] {
	return repos.filter(
		(r) => r.linearWorkspaceId === workspaceId && r.isActive !== false,
	);
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
