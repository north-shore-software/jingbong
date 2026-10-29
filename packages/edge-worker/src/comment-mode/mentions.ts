/**
 * The name people mention to talk to the bot ("@jingbong"). Set
 * CYRUS_COMMENT_HANDLE to use a different one.
 */
export function commentHandle(): string {
	return (process.env.CYRUS_COMMENT_HANDLE || "jingbong").toLowerCase();
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches a mention of the handle. Linear stores mentions either as plain
 * "@handle" text or as a markdown link to the handle's profile.
 */
export function mentionPattern(handle = commentHandle()): RegExp {
	const h = escapeRegExp(handle);
	return new RegExp(`(^|[^\\w.])@${h}\\b|/profiles/${h}\\b`, "i");
}

export function mentionsHandle(
	body: string,
	handle = commentHandle(),
): boolean {
	return mentionPattern(handle).test(body);
}

/** The comment text with every mention of the handle removed. */
export function stripMentions(body: string, handle = commentHandle()): string {
	const h = escapeRegExp(handle);
	const mention = new RegExp(
		`\\[[^\\]]*\\]\\([^)]*/profiles/${h}[^)]*\\)|https?://linear\\.app/\\S*/profiles/${h}\\b|@${h}\\b`,
		"gi",
	);
	return body
		.replace(mention, " ")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}
