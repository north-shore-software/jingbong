/**
 * Sessions started from an "@handle" mention in an ordinary Linear comment
 * (comment mode) have no Linear agent session. Their IDs encode the issue and
 * the comment thread to reply in: `cmt_<issueId>_<rootCommentId>`.
 */
const COMMENT_SESSION_PREFIX = "cmt_";

export function commentSessionId(
	issueId: string,
	rootCommentId: string,
): string {
	return `${COMMENT_SESSION_PREFIX}${issueId}_${rootCommentId}`;
}

export function isCommentSessionId(sessionId: string): boolean {
	return sessionId.startsWith(COMMENT_SESSION_PREFIX);
}

export function parseCommentSessionId(
	sessionId: string,
): { issueId: string; rootCommentId: string } | null {
	const match = /^cmt_([^_]+)_([^_]+)$/.exec(sessionId);
	return match ? { issueId: match[1]!, rootCommentId: match[2]! } : null;
}
