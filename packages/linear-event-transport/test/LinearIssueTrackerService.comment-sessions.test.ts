import { describe, expect, it, vi } from "vitest";
import { LinearIssueTrackerService } from "../src/LinearIssueTrackerService.js";

function setup() {
	const linearClient = { createAgentActivity: vi.fn() };
	const service = new LinearIssueTrackerService(linearClient as never);
	const createComment = vi
		.spyOn(service, "createComment")
		.mockResolvedValue({ id: "reply" } as never);
	return { service, linearClient, createComment };
}

describe("LinearIssueTrackerService comment sessions", () => {
	it("posts responses as thread replies with the header", async () => {
		const { service, linearClient, createComment } = setup();
		service.setCommentSessionHeader(async () => "commit `abc`");

		const result = await service.createAgentActivity({
			agentSessionId: "cmt_issue-1_root-1",
			content: { type: "response", body: "Done." },
		});

		expect(result.success).toBe(true);
		expect(linearClient.createAgentActivity).not.toHaveBeenCalled();
		expect(createComment).toHaveBeenCalledWith("issue-1", {
			body: "commit `abc`\n\nDone.",
			parentId: "root-1",
		});
	});

	it("drops thoughts and tool calls", async () => {
		const { service, createComment } = setup();

		await service.createAgentActivity({
			agentSessionId: "cmt_issue-1_root-1",
			content: { type: "thought", body: "Thinking…" },
		});

		expect(createComment).not.toHaveBeenCalled();
	});

	it("sends other sessions' activities to Linear", async () => {
		const { service, linearClient } = setup();
		linearClient.createAgentActivity.mockResolvedValue({ success: true });

		await service.createAgentActivity({
			agentSessionId: "session-1",
			content: { type: "thought", body: "Thinking…" },
		});

		expect(linearClient.createAgentActivity).toHaveBeenCalled();
	});
});
