import type { LinearIssueTrackerService } from "cyrus-linear-event-transport";

/** A comment as comment mode reads it from Linear's GraphQL API. */
export interface LinearCommentNode {
	id: string;
	body: string | null;
	createdAt: string;
	resolvedAt?: string | null;
	parent?: { id: string } | null;
	user?: { id: string; name: string; app?: boolean | null } | null;
	externalUser?: { name: string } | null;
	botActor?: { name: string } | null;
	reactions?: {
		emoji: string;
		user?: { name: string; app?: boolean | null } | null;
	}[];
}

export async function graphql<T>(
	tracker: LinearIssueTrackerService,
	query: string,
	variables: Record<string, unknown>,
): Promise<T> {
	const res = await tracker
		.getClient()
		.client.rawRequest<T, typeof variables>(query, variables);
	if (!res.data) throw new Error("Linear returned no data");
	return res.data;
}

/** The issue's creator and every comment on it, all pages. */
export async function fetchIssueComments(
	tracker: LinearIssueTrackerService,
	issueId: string,
): Promise<{ creatorName: string | null; comments: LinearCommentNode[] }> {
	const comments: LinearCommentNode[] = [];
	let creatorName: string | null = null;
	let after: string | null = null;
	do {
		const data: {
			issue: {
				creator?: { name: string } | null;
				comments: {
					pageInfo: { hasNextPage: boolean; endCursor: string | null };
					nodes: LinearCommentNode[];
				};
			};
		} = await graphql(
			tracker,
			`query ($id: String!, $after: String) {
				issue(id: $id) {
					creator { name }
					comments(first: 100, after: $after) {
						pageInfo { hasNextPage endCursor }
						nodes {
							id body createdAt resolvedAt
							parent { id }
							user { id name app }
							externalUser { name }
							botActor { name }
							reactions { emoji user { name app } }
						}
					}
				}
			}`,
			{ id: issueId, after },
		);
		creatorName = data.issue.creator?.name ?? null;
		comments.push(...data.issue.comments.nodes);
		after = data.issue.comments.pageInfo.hasNextPage
			? data.issue.comments.pageInfo.endCursor
			: null;
	} while (after);
	return { creatorName, comments };
}

export async function resolveComment(
	tracker: LinearIssueTrackerService,
	commentId: string,
): Promise<void> {
	await graphql(
		tracker,
		"mutation ($id: String!) { commentResolve(id: $id) { success } }",
		{ id: commentId },
	);
}

const THUMBS_UP = new Set(["+1", "thumbsup", "thumbs_up", "👍"]);
const CHECK_MARK = new Set(["white_check_mark", "✅"]);
const THINKING = new Set(["thinking_face", "🤔"]);

export const isThumbsUp = (emoji: string) => THUMBS_UP.has(emoji);
export const isCheckMark = (emoji: string) => CHECK_MARK.has(emoji);
export const isThinking = (emoji: string) => THINKING.has(emoji);

/** Names of the people (not apps) who reacted with a matching emoji. */
export function humanReactors(
	comment: Pick<LinearCommentNode, "reactions">,
	matches: (emoji: string) => boolean,
): string[] {
	return [
		...new Set(
			(comment.reactions ?? [])
				.filter((r) => matches(r.emoji) && r.user && !r.user.app)
				.map((r) => r.user!.name),
		),
	];
}

/** Written by a person: not an app, and not an integration's bot actor. */
export function isHumanComment(c: LinearCommentNode): boolean {
	return (
		!c.botActor && (Boolean(c.externalUser) || Boolean(c.user && !c.user.app))
	);
}

export function authorName(c: LinearCommentNode): string {
	return c.user?.name || c.externalUser?.name || c.botActor?.name || "unknown";
}
