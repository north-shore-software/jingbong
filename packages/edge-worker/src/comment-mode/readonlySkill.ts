import { execFile } from "node:child_process";
import { mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RepositoryConfig } from "cyrus-core";
import { runOpenCode } from "./agentRun.js";
import { postOpenQuestions } from "./checkpoint.js";
import { formatDiscussion, formatIssueThread } from "./issueThread.js";
import { fetchIssueComments } from "./linearApi.js";
import { openCodeSessionModel } from "./openCodeModel.js";
import { replyRules } from "./skills.js";
import { errorMessage, type SkillRunContext } from "./types.js";

const run = promisify(execFile);

/** Output lines of exactly this split the agent's answer into separate replies. */
export const REPLY_SEPARATOR = /^<<<reply>>>[ \t]*$/m;

/** The agent's output split on REPLY_SEPARATOR, without empty parts. */
export function splitReplies(text: string): string[] {
	return text
		.split(REPLY_SEPARATOR)
		.map((part) => part.trim())
		.filter(Boolean);
}

interface Checkout {
	repo: RepositoryConfig;
	baseBranch: string;
	sha: string;
	dir: string;
}

/**
 * Runs a "mode: readonly" skill outside Cyrus sessions: no issue state
 * change, branch or implementer prompt. The agent gets the issue thread plus
 * fresh detached checkouts of the issue's repositories, runs in OpenCode
 * with read-only tools, and its output is posted on the issue.
 */
export async function runReadonlySkill(ctx: SkillRunContext): Promise<void> {
	const { host, tracker, issue, skill, rootId } = ctx;
	const { logger } = host;
	const reply = (body: string) =>
		tracker.createComment(issue.id, { body, parentId: rootId ?? undefined });
	if (skill.argsRequired && !skill.args && !skill.discussion) {
		await reply(
			`⚠️ \`${skill.name}\` needs something to work on: add it after the skill name.`,
		);
		return;
	}
	// the issue's repositories, as routed when the request came in
	const repos = ctx.repos;
	const checkoutDir = join(
		host.cyrusHome,
		"checkpoints",
		`${issue.identifier}-${ctx.commentId.slice(0, 8)}`,
	);
	const checkouts: Checkout[] = [];
	try {
		await mkdir(checkoutDir, { recursive: true });
		for (const repo of repos) {
			const baseBranch = repo.baseBranch || "main";
			await run(
				"git",
				["-C", repo.repositoryPath, "fetch", "--quiet", "origin", baseBranch],
				{ timeout: 120_000 },
			);
			const sha = (
				await run("git", ["-C", repo.repositoryPath, "rev-parse", "FETCH_HEAD"])
			).stdout.trim();
			const dir = join(checkoutDir, repo.name);
			await run("git", [
				"-C",
				repo.repositoryPath,
				"worktree",
				"add",
				"--detach",
				dir,
				sha,
			]);
			checkouts.push({ repo, baseBranch, sha, dir });
		}
		const { creatorName, comments } = await fetchIssueComments(
			tracker,
			issue.id,
		);
		const thread = formatIssueThread({
			issue,
			creatorName,
			comments,
			botId: ctx.botId,
			excludeCommentId: skill.fromReaction ? null : ctx.commentId,
		});
		const prompt = [
			`You are Jingbong, running the "${skill.name}" skill on Linear issue ${issue.identifier}.`,
			"",
			"The current directory holds read-only checkouts of the issue's repositories, one subfolder each:",
			...checkouts.map(
				(c) =>
					`- ${c.repo.name}/: ${c.repo.name} at ${c.baseBranch} (commit ${c.sha})`,
			),
			"You can read and search files to understand the code. You cannot change anything, so don't try. When you name a file, start its path with the repository folder.",
			"",
			"Your final message is posted verbatim as a reply on the issue, so it must contain only the skill's output.",
			"",
			replyRules(),
			"",
			`<skill name="${skill.name}">`,
			skill.text,
			"</skill>",
			"",
			"<requester_guidance>",
			skill.args || "(none)",
			"</requester_guidance>",
			"",
			"<issue>",
			thread,
			"</issue>",
			...(skill.discussion
				? [
						"",
						"<discussion>",
						skill.fromReaction
							? "The requester asked for this by reacting to the last comment below, which is a reply in this comment thread. That comment is the focus; the earlier comments in the thread are its context, whoever wrote them."
							: "The requester asked for this from inside the comment thread below. It is the discussion this is about: work out what it is trying to decide. Every comment is context, whoever wrote it; the requester's own request is not shown.",
						"",
						formatDiscussion(comments, skill.discussion, ctx.commentId),
						"</discussion>",
					]
				: []),
		].join("\n");
		const commits = checkouts
			.map((c) => `${c.repo.name} \`${c.sha.slice(0, 7)}\` (${c.baseBranch})`)
			.join(", ");
		logger.info(
			`Running readonly skill "${skill.name}" on ${issue.identifier} at ${commits.replaceAll("`", "")} in ${checkoutDir}`,
		);
		const runOnce = (input: string, resumeSessionId?: string) =>
			runOpenCode(
				{
					workingDirectory: checkoutDir,
					allowedTools: ["Read", "Glob", "Grep"],
					cyrusHome: host.cyrusHome,
					model: host.opencodeDefaultModel(),
					title: `Jingbong ${skill.name} ${issue.identifier}`,
					inactivityTimeoutMs: 10 * 60 * 1000,
					resumeSessionId,
					// OpenCode's background service ignores per-run permissions
					standalone: true,
				},
				input,
			);
		let attempt = await runOnce(prompt);
		// Gemini sometimes ends a successful session with an empty final message; ask for the output again
		for (
			let nudge = 1;
			attempt.ok && !attempt.text?.trim() && attempt.sessionId && nudge <= 2;
			nudge++
		) {
			logger.warn(
				`Readonly skill "${skill.name}" on ${issue.identifier}: empty final message, asking again (${nudge}/2)`,
			);
			attempt = await runOnce(
				"Your last message was empty. Reply now with the skill's complete final output, exactly as the skill specifies, and nothing else.",
				attempt.sessionId,
			);
		}
		const text = attempt.ok ? attempt.text?.trim() : null;
		if (!text) {
			throw new Error(
				attempt.errors.join("; ") ||
					(attempt.ok
						? "the agent's final message was empty"
						: attempt.detail) ||
					"the agent produced no output",
			);
		}
		const sessionId = attempt.sessionId || "unknown";
		const model =
			(await openCodeSessionModel(sessionId, checkoutDir).catch((error) => {
				logger.warn(
					`Could not read model from OpenCode session ${sessionId}: ${errorMessage(error)}`,
				);
				return null;
			})) ||
			host.opencodeDefaultModel() ||
			"unknown";
		const parts = splitReplies(text);
		if (parts.length === 0) throw new Error("the agent produced no output");
		const header = `${checkouts.length > 1 ? "commits" : "commit"} ${commits} · session \`${sessionId}\` · model \`${model}\``;
		const quoted = skill.fromReaction
			? `${skill.args
					.split("\n")
					.map((l) => `> ${l}`)
					.join("\n")}\n\n`
			: "";
		const first = await tracker.createComment(issue.id, {
			body: `${header}\n\n${quoted}${parts[0]}`,
			parentId: skill.newThread ? undefined : (rootId ?? undefined),
		});
		if (skill.openQuestionThreads) {
			const { posted, resolved } = await postOpenQuestions({
				tracker,
				issueId: issue.id,
				questions: parts.slice(1),
				botId: ctx.botId,
			});
			logger.info(
				`Posted ${posted} open question(s) on ${issue.identifier}, resolved ${resolved} earlier one(s)`,
			);
		} else {
			const parentId = skill.newThread ? first.id : (rootId ?? undefined);
			// one at a time so the replies keep their order in the thread
			for (const part of parts.slice(1)) {
				await tracker.createComment(issue.id, { body: part, parentId });
			}
		}
		logger.info(
			`Readonly skill "${skill.name}" replied on ${issue.identifier} (session ${sessionId})`,
		);
	} catch (error) {
		const message = errorMessage(error);
		logger.error(
			`Readonly skill "${skill.name}" failed on ${issue.identifier}: ${message}`,
		);
		await reply(`⚠️ \`${skill.name}\` failed: ${message.slice(0, 1000)}`).catch(
			() => {},
		);
	} finally {
		for (const c of checkouts) {
			await run("git", [
				"-C",
				c.repo.repositoryPath,
				"worktree",
				"remove",
				"--force",
				c.dir,
			]).catch((error) => {
				logger.warn(
					`Could not remove checkout ${c.dir}: ${errorMessage(error)}`,
				);
			});
		}
		await rmdir(checkoutDir).catch(() => {});
	}
}
