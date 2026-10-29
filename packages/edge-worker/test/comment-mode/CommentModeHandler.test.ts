import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, type RepositoryConfig } from "cyrus-core";
import { LinearIssueTrackerService } from "cyrus-linear-event-transport";
import { describe, expect, it, vi } from "vitest";
import {
	CommentModeHandler,
	stripRepoTags,
} from "../../src/comment-mode/CommentModeHandler.js";

const BOT = "bot-1";

const repo = (name: string, workspace = "ws-1") =>
	({
		id: `id-${name}`,
		name,
		linearWorkspaceId: workspace,
		githubUrl: `https://github.com/acme/${name}`,
	}) as RepositoryConfig;
const REPOS = [repo("spock"), repo("mountaineer"), repo("kalaido", "ws-2")];

function setup({
	awaitingAnswer = false,
	routed = [REPOS[0]!] as RepositoryConfig[] | null,
} = {}) {
	const tracker = Object.create(
		LinearIssueTrackerService.prototype,
	) as LinearIssueTrackerService;
	const createReaction = vi.fn().mockResolvedValue({});
	const createComment = vi.fn().mockResolvedValue({ id: "reply-1" });
	const updateIssue = vi.fn().mockResolvedValue({});
	Object.assign(tracker, {
		fetchCurrentUser: vi.fn().mockResolvedValue({ id: BOT }),
		fetchIssue: vi.fn().mockResolvedValue({
			id: "issue-1",
			identifier: "DEF-1",
			title: "Add export",
			description: "",
			url: "https://linear.app/acme/issue/DEF-1",
			team: Promise.resolve({ id: "t1", key: "DEF", name: "Default" }),
			project: Promise.resolve({ name: "Into the Matrix" }),
		}),
		createComment,
		updateIssue,
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
		routeRepositories: vi.fn().mockResolvedValue(routed),
		pinRepositories: vi.fn().mockResolvedValue(undefined),
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
	return {
		handler,
		sessions,
		tracker,
		createReaction,
		createComment,
		updateIssue,
	};
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

	it("says it doesn't know the repository, then carries on after @jingbong repo", async () => {
		const { handler, sessions, tracker, createComment, updateIssue } = setup({
			routed: null,
		});

		await handler.handleWebhook(commentWebhook("@jingbong fix the bug"), REPOS);

		expect(sessions.startSession).not.toHaveBeenCalled();
		const [, held] = createComment.mock.calls[0]!;
		expect(held.parentId).toBe("c1");
		expect(held.body).toContain("**Into the Matrix** isn't mapped");
		expect(held.body).toContain("`spock`, `mountaineer`");
		expect(held.body).not.toContain("kalaido");

		vi.mocked(tracker.fetchIssue).mockResolvedValue({
			id: "issue-1",
			identifier: "DEF-1",
			description: "Some text [repo=old]",
			team: Promise.resolve({ id: "t1", key: "DEF", name: "Default" }),
			project: Promise.resolve(undefined),
		} as never);
		sessions.routeRepositories.mockResolvedValue([REPOS[1]!]);
		await handler.handleWebhook(
			commentWebhook("@jingbong repo Mountaineer", {
				id: "c2",
				parentId: "c1",
			}),
			REPOS,
		);

		expect(updateIssue).toHaveBeenCalledWith("issue-1", {
			description: "Some text\n\n[repo=mountaineer]",
		});
		expect(sessions.pinRepositories).toHaveBeenCalledWith("issue-1", [
			REPOS[1],
		]);
		expect(createComment.mock.calls[1]![1].body).toContain(
			"now uses `mountaineer`",
		);
		const [webhook, repos] = sessions.startSession.mock.calls[0]!;
		expect(webhook.agentSession.id).toBe("cmt_issue-1_c1");
		expect(repos).toBe(REPOS);
	});

	it("refuses a repo command naming another workspace's repository", async () => {
		const { handler, sessions, createComment, updateIssue } = setup();

		await handler.handleWebhook(
			commentWebhook("@jingbong repo kalaido"),
			REPOS,
		);

		expect(updateIssue).not.toHaveBeenCalled();
		expect(sessions.pinRepositories).not.toHaveBeenCalled();
		expect(createComment.mock.calls[0]![1].body).toContain(
			"No repository called `kalaido`",
		);
	});

	it("leaves other webhooks to the EdgeWorker", async () => {
		const { handler } = setup();
		expect(
			await handler.handleWebhook({ type: "Issue", action: "update" }, []),
		).toBe(false);
	});
});

describe("stripRepoTags", () => {
	it("removes bracketed, escaped and bare routing tags", () => {
		expect(
			stripRepoTags(
				"Intro \\[repo=a\\] text\n[repo=b#dev]\nrepos=c,d\nKeep repo/path",
			),
		).toBe("Intro  text\n\n\nKeep repo/path");
	});
});
