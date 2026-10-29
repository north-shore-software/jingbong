import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "cyrus-core";
import { LinearIssueTrackerService } from "cyrus-linear-event-transport";
import { describe, expect, it, vi } from "vitest";
import { CommentModeHandler } from "../../src/comment-mode/CommentModeHandler.js";

const BOT = "bot-1";

function setup({ awaitingAnswer = false } = {}) {
	const tracker = Object.create(
		LinearIssueTrackerService.prototype,
	) as LinearIssueTrackerService;
	const createReaction = vi.fn().mockResolvedValue({});
	Object.assign(tracker, {
		fetchCurrentUser: vi.fn().mockResolvedValue({ id: BOT }),
		fetchIssue: vi.fn().mockResolvedValue({
			id: "issue-1",
			identifier: "DEF-1",
			title: "Add export",
			description: "",
			url: "https://linear.app/acme/issue/DEF-1",
			team: Promise.resolve({ id: "t1", key: "DEF", name: "Default" }),
		}),
		fetchUser: vi
			.fn()
			.mockResolvedValue({ id: "u1", name: "Alice", email: "a@example.com" }),
		getClient: () => ({ createReaction }),
		setCommentSessionHeader: vi.fn(),
	});
	const sessions = {
		getTracker: () => tracker,
		getSession: vi.fn().mockReturnValue(undefined),
		awaitingAnswer: vi.fn().mockReturnValue(awaitingAnswer),
		startSession: vi.fn().mockResolvedValue(undefined),
		promptSession: vi.fn().mockResolvedValue(undefined),
	};
	const cyrusHome = mkdtempSync(join(tmpdir(), "comment-mode-"));
	const handler = new CommentModeHandler(
		{
			logger: createLogger({ component: "test" }),
			cyrusHome,
			opencodeDefaultModel: () => undefined,
			gitHubAppTokenProvider: () => null,
		},
		sessions,
	);
	return { handler, sessions, createReaction };
}

const commentWebhook = (body: string, extra: Record<string, unknown> = {}) => ({
	type: "Comment",
	action: "create",
	organizationId: "ws-1",
	actor: { id: "u1", type: "user", name: "Alice" },
	data: {
		id: "c1",
		issueId: "issue-1",
		body,
		userId: "u1",
		createdAt: "2026-10-29T00:00:00.000Z",
		...extra,
	},
});

describe("CommentModeHandler", () => {
	it("starts a comment session for a mention and reacts 👀", async () => {
		const { handler, sessions, createReaction } = setup();

		expect(
			await handler.handleWebhook(commentWebhook("@jingbong fix the bug"), []),
		).toBe(true);

		expect(createReaction).toHaveBeenCalledWith({
			commentId: "c1",
			emoji: "eyes",
		});
		const [webhook] = sessions.startSession.mock.calls[0]!;
		expect(webhook.agentSession.id).toBe("cmt_issue-1_c1");
		expect(webhook.agentSession.comment.body).toMatch(
			/^fix the bug\n\n<reply_rules>/,
		);
		expect(webhook.agentSession.comment.body).toContain(
			"Do not change the issue's status",
		);
	});

	it("continues the thread's session for a mention in a reply", async () => {
		const { handler, sessions } = setup();
		sessions.getSession.mockReturnValue({ id: "cmt_issue-1_root" });

		await handler.handleWebhook(
			commentWebhook("@jingbong also add tests", {
				id: "c2",
				parentId: "root",
			}),
			[],
		);

		const [webhook] = sessions.promptSession.mock.calls[0]!;
		expect(webhook.agentSession.id).toBe("cmt_issue-1_root");
		expect(webhook.agentActivity.content.body).toMatch(/^also add tests/);
	});

	it("ignores comments without the mention, and the bot's own comments", async () => {
		const { handler, sessions } = setup();

		await handler.handleWebhook(commentWebhook("just chatting"), []);
		await handler.handleWebhook(
			commentWebhook("@jingbong hi", { userId: BOT }),
			[],
		);

		expect(sessions.startSession).not.toHaveBeenCalled();
		expect(sessions.promptSession).not.toHaveBeenCalled();
	});

	it("takes an answer to the bot's own question without a mention", async () => {
		const { handler, sessions } = setup({ awaitingAnswer: true });

		await handler.handleWebhook(commentWebhook("Option B"), []);

		const [webhook] = sessions.promptSession.mock.calls[0]!;
		expect(webhook.agentActivity.content.body).toBe("Option B");
	});

	it("leaves other webhooks to the EdgeWorker", async () => {
		const { handler } = setup();
		expect(
			await handler.handleWebhook({ type: "Issue", action: "update" }, []),
		).toBe(false);
	});
});
