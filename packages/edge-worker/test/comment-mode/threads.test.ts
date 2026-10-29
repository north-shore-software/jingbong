import { describe, expect, it } from "vitest";
import {
	checkpointThreadsToResolve,
	parseCheckpoint,
} from "../../src/comment-mode/checkpoint.js";
import {
	formatDiscussion,
	formatIssueThread,
	OPEN_QUESTION_MARKER,
} from "../../src/comment-mode/issueThread.js";
import type { LinearCommentNode } from "../../src/comment-mode/linearApi.js";

const BOT = "bot-1";
const alice = { id: "u-alice", name: "Alice", app: false };
const bot = { id: BOT, name: "Jingbong", app: true };
const thumbs = [{ emoji: "+1", user: { name: "Alice", app: false } }];

let clock = 0;
function comment(
	id: string,
	body: string,
	user: LinearCommentNode["user"],
	extra: Partial<LinearCommentNode> = {},
): LinearCommentNode {
	clock += 1;
	return {
		id,
		body,
		user,
		createdAt: `2026-10-29T00:00:${String(clock).padStart(2, "0")}.000Z`,
		parent: null,
		resolvedAt: null,
		reactions: [],
		...extra,
	};
}

const issue = {
	identifier: "DEF-1",
	title: "Add export",
	description: "Export to CSV",
	createdAt: "2026-10-28T00:00:00.000Z",
};

describe("formatIssueThread", () => {
	it("keeps people's comments and only the bot comments people agreed with", () => {
		clock = 0;
		const comments = [
			comment("c1", "Should it be CSV or XLSX?", alice),
			comment("c2", "Unapproved bot musing", bot, { parent: { id: "c1" } }),
			comment("c3", "Approved bot answer", bot, {
				parent: { id: "c1" },
				reactions: thumbs,
			}),
			comment("req", "@jingbong cp", alice),
		];
		const text = formatIssueThread({
			issue,
			creatorName: "Alice",
			comments,
			botId: BOT,
			excludeCommentId: "req",
		});
		expect(text).toContain("Should it be CSV or XLSX?");
		expect(text).toContain("Approved bot answer");
		expect(text).toContain("approved with 👍 by Alice");
		expect(text).not.toContain("Unapproved bot musing");
		expect(text).not.toContain("@jingbong cp");
	});

	it("keeps answered and still-open questions, and drops resolved unanswered ones", () => {
		clock = 0;
		const comments = [
			comment("q1", `${OPEN_QUESTION_MARKER}\n\nCSV or XLSX?`, bot),
			comment("a1", "CSV", alice, { parent: { id: "q1" } }),
			comment("q2", `${OPEN_QUESTION_MARKER}\n\nWhich columns?`, bot),
			comment("q3", `${OPEN_QUESTION_MARKER}\n\nOld question`, bot, {
				resolvedAt: "2026-10-29T01:00:00.000Z",
			}),
		];
		const text = formatIssueThread({
			issue,
			creatorName: null,
			comments,
			botId: BOT,
			excludeCommentId: null,
		});
		expect(text).toContain("answered in the replies below");
		expect(text).toContain("Which columns?");
		expect(text).toContain("not yet answered");
		expect(text).not.toContain("Old question");
	});

	it("shows a discussion thread in full up to the request", () => {
		clock = 0;
		const comments = [
			comment("root", "Postgres or SQLite?", alice),
			comment("r1", "Unapproved bot reply", bot, { parent: { id: "root" } }),
			comment("req", "@jingbong opt", alice, { parent: { id: "root" } }),
		];
		const text = formatDiscussion(
			comments,
			{ rootId: "root", until: comments[2]!.createdAt },
			"req",
		);
		expect(text).toContain("Postgres or SQLite?");
		expect(text).toContain("Unapproved bot reply");
		expect(text).toContain("(bot)");
		expect(text).not.toContain("@jingbong opt");
	});
});

describe("checkpoints", () => {
	it("takes the title and write-up, without open questions", () => {
		expect(
			parseCheckpoint(
				"commit `abc` · session `s`\n\n**Suggested title:** Export to CSV\n\n### Write-up\n\nWhat it is.\n\n### Open questions\n\n- Which columns?",
			),
		).toEqual({ title: "Export to CSV", description: "What it is." });
		expect(parseCheckpoint("**Suggested title:** X\n\nno write-up")).toBeNull();
	});

	it("resolves the request thread and that run's answered questions", () => {
		clock = 0;
		const request = comment("req", "@jingbong cp", alice);
		const writeUp = comment(
			"w1",
			"**Suggested title:** T\n\n### Write-up\n\nW",
			bot,
			{ parent: { id: "req" } },
		);
		const answered = comment("q1", `${OPEN_QUESTION_MARKER}\n\nA?`, bot);
		const answer = comment("a1", "Yes", alice, { parent: { id: "q1" } });
		const unanswered = comment("q2", `${OPEN_QUESTION_MARKER}\n\nB?`, bot);
		const mentionOnly = comment("q3", `${OPEN_QUESTION_MARKER}\n\nC?`, bot);
		const followUp = comment("m1", "@jingbong opt", alice, {
			parent: { id: "q3" },
		});
		const nextWriteUp = comment(
			"w2",
			"**Suggested title:** T2\n\n### Write-up\n\nW2",
			bot,
		);
		const laterQuestion = comment("q4", `${OPEN_QUESTION_MARKER}\n\nD?`, bot);
		const laterAnswer = comment("a4", "No", alice, { parent: { id: "q4" } });

		expect(
			checkpointThreadsToResolve(
				[
					request,
					writeUp,
					answered,
					answer,
					unanswered,
					mentionOnly,
					followUp,
					nextWriteUp,
					laterQuestion,
					laterAnswer,
				],
				writeUp,
				BOT,
			),
		).toEqual(["req", "q1"]);
	});
});
