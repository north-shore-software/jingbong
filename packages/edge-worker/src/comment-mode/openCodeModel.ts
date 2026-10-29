import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The provider/model OpenCode actually used in a session. Cyrus only knows
 * "OpenCode default model", but OpenCode records the model per message.
 */
export async function openCodeSessionModel(
	sessionId: string | undefined,
	cwd: string | undefined,
): Promise<string | null> {
	if (!sessionId || sessionId === "unknown") return null;
	const { stdout } = await run("opencode", ["session", "export", sessionId], {
		cwd: cwd || process.env.HOME,
		maxBuffer: 64 * 1024 * 1024,
		timeout: 30_000,
	});
	const exported = JSON.parse(stdout) as {
		messages?: { model?: { id?: string; providerID?: string } }[];
	};
	const last = (exported.messages ?? []).filter((m) => m.model?.id).pop();
	return last ? `${last.model!.providerID}/${last.model!.id}` : null;
}
