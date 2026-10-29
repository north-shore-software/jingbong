import {
	authorName,
	humanReactors,
	isHumanComment,
	isThumbsUp,
	type LinearCommentNode,
} from "./linearApi.js";
import { mentionsHandle } from "./mentions.js";

/**
 * Open questions from "open-questions: threads" skills (cp) are top-level bot
 * comments starting with this line. Later runs recognise them by it.
 */
export const OPEN_QUESTION_MARKER = "**Open question** · from checkpoint";

export function isOpenQuestion(
	c: LinearCommentNode,
	botId: string | undefined,
): boolean {
	return Boolean(
		c.user &&
			c.user.id === botId &&
			(c.body || "").startsWith(OPEN_QUESTION_MARKER),
	);
}

/** The first comment of an opt thread, which states "What decides it". */
export function isOptRoot(
	c: LinearCommentNode,
	botId: string | undefined,
): boolean {
	return Boolean(
		c.user &&
			c.user.id === botId &&
			/^\*\*What decides it:\*\*/m.test(c.body || ""),
	);
}

/** A cp reply: a suggested title followed by a write-up. */
export function isCheckpointWriteUp(
	c: LinearCommentNode,
	botId: string | undefined,
): boolean {
	const body = c.body || "";
	return (
		c.user?.id === botId &&
		/^\*\*Suggested title:\*\*/m.test(body) &&
		/^###\s+Write-up/m.test(body)
	);
}

export interface IssueSummary {
	identifier: string;
	title: string;
	description?: string | null;
	createdAt: Date | string;
}

const byDate = (a: LinearCommentNode, b: LinearCommentNode) =>
	a.createdAt.localeCompare(b.createdAt);

function describe(c: LinearCommentNode, kind: string, note: string | null) {
	return `--- ${kind} by ${authorName(c)}${note ? ` (${note})` : ""} at ${c.createdAt} ---\n${(c.body || "").trim()}`;
}

/**
 * Title, description and the comment threads a skill should read, oldest
 * first. Resolution is ignored (the bot resolves old open questions, so it
 * carries no meaning). `excludeCommentId` is the request itself.
 *
 * Included: people's comments; bot comments a person 👍'd; open-question
 * threads a person answered (a reply not mentioning the bot) or that are
 * still unresolved (the latest checkpoint's); whole opt threads a person
 * replied in.
 */
export function formatIssueThread({
	issue,
	creatorName,
	comments,
	botId,
	excludeCommentId,
}: {
	issue: IssueSummary;
	creatorName: string | null;
	comments: LinearCommentNode[];
	botId: string | undefined;
	excludeCommentId: string | null;
}): string {
	const isOwn = (c: LinearCommentNode) =>
		Boolean(c.user && c.user.id === botId);
	const isAnswer = (c: LinearCommentNode) =>
		c.id !== excludeCommentId &&
		isHumanComment(c) &&
		!mentionsHandle(c.body || "");
	const approvedNote = (c: LinearCommentNode) => {
		const names = humanReactors(c, isThumbsUp);
		return names.length > 0 ? `approved with 👍 by ${names.join(", ")}` : null;
	};
	const out = [
		`# ${issue.identifier}: ${issue.title}`,
		`Created by ${creatorName || "unknown"} at ${new Date(issue.createdAt).toISOString()}`,
		"",
		"## Description",
		(issue.description || "").trim() || "(no description)",
		"",
		"## Comment threads (oldest first; replies follow the comment that started the thread)",
	];
	const roots = comments.filter((c) => !c.parent).sort(byDate);
	let count = 0;
	for (const root of roots) {
		const replies = comments
			.filter((c) => c.parent?.id === root.id)
			.sort(byDate);
		const answered = replies.some(isAnswer);
		const optThread = answered && isOptRoot(root, botId);
		const entry = (c: LinearCommentNode, kind: "comment" | "reply") => {
			if (c.id === excludeCommentId) return null;
			if (isHumanComment(c)) {
				return describe(
					c,
					kind,
					mentionsHandle(c.body || "") ? "request to Jingbong" : null,
				);
			}
			if (!isOwn(c)) return null;
			if (kind === "comment" && isOpenQuestion(c, botId)) {
				if (answered) {
					return describe(
						c,
						kind,
						"bot; open question from a checkpoint, answered in the replies below",
					);
				}
				if (!c.resolvedAt) {
					return describe(
						c,
						kind,
						"bot; open question from the latest checkpoint, asked and not yet answered",
					);
				}
				return null;
			}
			const approved = approvedNote(c);
			if (optThread) {
				const what =
					kind === "comment"
						? "options proposed for a question, not decisions"
						: "option proposed, not a decision";
				const chosen = kind === "comment" ? what : "the option chosen";
				return describe(
					c,
					kind,
					approved ? `bot; ${chosen}, ${approved}` : `bot; ${what}`,
				);
			}
			return approved ? describe(c, kind, `bot; ${approved}`) : null;
		};
		const rootText = entry(root, "comment");
		const replyTexts = replies
			.map((r) => entry(r, "reply"))
			.filter((t): t is string => Boolean(t));
		if (!rootText && replyTexts.length === 0) continue;
		count += 1;
		out.push("", `### Thread ${count}`);
		out.push(rootText || "--- (first comment of this thread not included) ---");
		out.push(...replyTexts);
	}
	if (count === 0) out.push("", "(no comments)");
	return out.join("\n");
}

/**
 * One thread in full: its first comment and every reply up to `until`
 * (inclusive), whoever wrote them, without the request comment.
 */
export function formatDiscussion(
	comments: LinearCommentNode[],
	{ rootId, until }: { rootId: string; until: string },
	excludeCommentId: string | null,
): string {
	const nodes = comments
		.filter(
			(c) =>
				(c.id === rootId || c.parent?.id === rootId) &&
				c.id !== excludeCommentId &&
				c.createdAt <= until,
		)
		.sort(byDate);
	return (
		nodes
			.map((c) => {
				const bot = c.user?.app || c.botActor ? " (bot)" : "";
				return `--- ${c.id === rootId ? "comment" : "reply"} by ${authorName(c)}${bot} at ${c.createdAt} ---\n${(c.body || "").trim()}`;
			})
			.join("\n") || "(the thread is empty)"
	);
}
