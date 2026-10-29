import type { ILogger } from "cyrus-core";
import type { LinearIssueTrackerService } from "cyrus-linear-event-transport";
import {
	isCheckpointWriteUp,
	isOpenQuestion,
	OPEN_QUESTION_MARKER,
} from "./issueThread.js";
import {
	fetchIssueComments,
	graphql,
	humanReactors,
	isCheckMark,
	isHumanComment,
	type LinearCommentNode,
	resolveComment,
} from "./linearApi.js";
import { mentionsHandle, stripMentions } from "./mentions.js";

/**
 * The title and description a cp write-up proposes: the suggested title, and
 * the write-up without its heading or open questions. Null if the comment
 * isn't a write-up.
 */
export function parseCheckpoint(
	body: string,
): { title: string; description: string } | null {
	const match = /^\*\*Suggested title:\*\*[ \t]*(.+)\n([\s\S]*)$/m.exec(body);
	const title = match?.[1]?.trim();
	const rest = match?.[2]?.trim();
	if (!title || !rest || !/^###\s+Write-up/m.test(rest)) return null;
	// older checkpoints have their open questions in the same reply
	const description = rest
		.replace(/^###\s+Write-up[ \t]*\n+/, "")
		.split(/^###\s+Open questions/m)[0]!
		.trim();
	return { title, description };
}

/**
 * A person's ✅ on a cp write-up copies it onto the issue. The previous title
 * and description go in a collapsed section of the confirmation reply, so
 * nothing is lost. Then the request thread and the answered open questions
 * are resolved (see checkpointThreadsToResolve).
 */
export async function applyCheckpoint({
	tracker,
	commentId,
	botId,
	logger,
}: {
	tracker: LinearIssueTrackerService;
	commentId: string;
	botId: string | undefined;
	logger: ILogger;
}): Promise<void> {
	const { comment: c } = await graphql<{
		comment:
			| (LinearCommentNode & {
					issue: {
						id: string;
						identifier: string;
						title: string;
						description: string | null;
					} | null;
			  })
			| null;
	}>(
		tracker,
		`query ($id: String!) {
			comment(id: $id) {
				id body createdAt
				parent { id }
				user { id name app }
				reactions { emoji user { name app } }
				issue { id identifier title description }
			}
		}`,
		{ id: commentId },
	);
	if (!c?.issue || !botId || c.user?.id !== botId) return;
	const tickers = humanReactors(c, isCheckMark);
	if (tickers.length === 0) return;
	const checkpoint = parseCheckpoint(c.body || "");
	if (!checkpoint) {
		logger.info(`✅ on comment ${c.id} ignored: not a checkpoint`);
		return;
	}
	const issue = c.issue;
	if (
		issue.title === checkpoint.title &&
		(issue.description || "").trim() === checkpoint.description
	) {
		logger.info(`✅ on comment ${c.id}: ${issue.identifier} already matches`);
	} else {
		await tracker.updateIssue(issue.id, {
			title: checkpoint.title,
			description: checkpoint.description,
		});
		logger.info(
			`Applied checkpoint ${c.id} to ${issue.identifier} (✅ by ${tickers.join(", ")})`,
		);
		const previous = (issue.description || "").trim() || "(empty)";
		await tracker.createComment(issue.id, {
			parentId: c.parent?.id || c.id,
			body: `✅ Applied this checkpoint to the issue title and description.\n\n+++ Previous title and description\n\n**Title:** ${issue.title}\n\n${previous}\n\n+++`,
		});
	}
	const { comments } = await fetchIssueComments(tracker, issue.id);
	const toResolve = checkpointThreadsToResolve(comments, c, botId);
	for (const id of toResolve) {
		await resolveComment(tracker, id);
	}
	logger.info(
		`✅ on ${c.id}: resolved ${toResolve.length} thread(s) on ${issue.identifier}`,
	);
}

/**
 * What a ✅ on `writeUp` resolves: the "@handle cp" request thread (only when
 * the request starts it), and the open questions from that same run (posted
 * after this write-up and before the next one) that a person answered
 * without mentioning the bot. Unanswered questions stay open until the next
 * cp.
 */
export function checkpointThreadsToResolve(
	comments: LinearCommentNode[],
	writeUp: Pick<LinearCommentNode, "id" | "createdAt" | "parent">,
	botId: string | undefined,
): string[] {
	const toResolve: string[] = [];
	const root = comments.find((c) => c.id === writeUp.parent?.id);
	if (
		root &&
		!root.resolvedAt &&
		isHumanComment(root) &&
		mentionsHandle(root.body || "") &&
		/^cp\b/i.test(stripMentions(root.body || ""))
	) {
		toResolve.push(root.id);
	}
	const next = comments
		.filter(
			(c) => isCheckpointWriteUp(c, botId) && c.createdAt > writeUp.createdAt,
		)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
	for (const q of comments) {
		if (
			q.parent ||
			q.resolvedAt ||
			!isOpenQuestion(q, botId) ||
			q.createdAt < writeUp.createdAt ||
			(next && q.createdAt > next.createdAt)
		) {
			continue;
		}
		const answered = comments.some(
			(r) =>
				r.parent?.id === q.id &&
				isHumanComment(r) &&
				!mentionsHandle(r.body || ""),
		);
		if (answered) toResolve.push(q.id);
	}
	return toResolve;
}

/**
 * Posts each open question as a new top-level thread, then resolves every
 * earlier unresolved open question, so the unresolved ones are always the
 * latest checkpoint's. Answers in resolved threads still count.
 */
export async function postOpenQuestions({
	tracker,
	issueId,
	questions,
	botId,
}: {
	tracker: LinearIssueTrackerService;
	issueId: string;
	questions: string[];
	botId: string | undefined;
}): Promise<{ posted: number; resolved: number }> {
	const posted = new Set<string>();
	for (const question of questions) {
		const c = await tracker.createComment(issueId, {
			body: `${OPEN_QUESTION_MARKER}\n\n${question}`,
		});
		posted.add(c.id);
	}
	const { comments } = await fetchIssueComments(tracker, issueId);
	const stale = comments.filter(
		(c) =>
			!c.parent &&
			!c.resolvedAt &&
			!posted.has(c.id) &&
			isOpenQuestion(c, botId),
	);
	for (const c of stale) {
		await resolveComment(tracker, c.id);
	}
	return { posted: posted.size, resolved: stale.length };
}
