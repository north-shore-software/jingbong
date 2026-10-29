import {
	OpenCodeRunner,
	type OpenCodeRunnerConfig,
} from "cyrus-opencode-runner";
import { errorMessage } from "./types.js";

export interface AgentRunResult {
	ok: boolean;
	text: string | null;
	sessionId: string | undefined;
	detail: string | undefined;
	errors: string[];
}

/** One OpenCode run (or a resumed session when resumeSessionId is set). */
export async function runOpenCode(
	config: Omit<OpenCodeRunnerConfig, "onError">,
	input: string,
): Promise<AgentRunResult> {
	const errors: string[] = [];
	const runner = new OpenCodeRunner({
		...config,
		onError: (error) => {
			errors.push(errorMessage(error));
		},
	});
	const session = await runner.start(input);
	const result = runner
		.getMessages()
		.filter((m) => m.type === "result")
		.pop() as
		| { is_error?: boolean; subtype?: string; result?: string }
		| undefined;
	return {
		ok: Boolean(result && !result.is_error && result.subtype === "success"),
		text: runner.getLastAssistantText(),
		sessionId: session?.sessionId ?? config.resumeSessionId,
		detail: result?.result,
		errors,
	};
}
