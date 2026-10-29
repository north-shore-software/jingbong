import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { RepositoryConfig } from "cyrus-core";
import { runOpenCode } from "./agentRun.js";
import { openCodeSessionModel } from "./openCodeModel.js";
import { replyRules } from "./skills.js";
import { errorMessage, type SkillRunContext, workspaceRepos } from "./types.js";

const execFileP = promisify(execFile);
const run = (
	cmd: string,
	args: string[],
	opts: { env?: NodeJS.ProcessEnv; timeout?: number } = {},
) => execFileP(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts });
const git = async (
	dir: string,
	args: string[],
	opts?: { env?: NodeJS.ProcessEnv; timeout?: number },
) => (await run("git", ["-C", dir, ...args], opts)).stdout.trim();

/** The agent's final message: what it did, for the Linear reply and each PR. */
export interface BuildReport {
	summary?: string;
	assumptions?: string[];
	repos?: Record<
		string,
		{
			title?: string;
			summary?: string;
			assumptions?: string[];
			testing?: string;
			checksPassed?: boolean;
			failures?: string;
		}
	>;
}

/** The JSON object in the agent's final message, or null if there isn't one. */
export function parseBuildReport(text: string | null): BuildReport | null {
	const raw = String(text || "");
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		const report = JSON.parse(raw.slice(start, end + 1));
		return report && typeof report === "object"
			? (report as BuildReport)
			: null;
	} catch {
		return null;
	}
}

/**
 * The branch stem for an issue: Linear's suggested branch name with its user
 * prefix swapped for "jingbong/" (falling back to the identifier).
 */
export function buildBranchStem(
	branchName: string | null | undefined,
	identifier: string,
): string {
	const linearName = String(branchName || "")
		.split("/")
		.pop()!
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `jingbong/${linearName || identifier}`;
}

/**
 * Text for a public repository with every line that names a private
 * repository removed.
 */
export function scrubPrivateMentions(
	text: string,
	privateNames: string[],
): { text: string; scrubbed: number } {
	const lines = String(text || "").split("\n");
	const kept = lines.filter((l) => !mentionsAny(l, privateNames));
	return { text: kept.join("\n"), scrubbed: lines.length - kept.length };
}

function mentionsAny(line: string, names: string[]): boolean {
	const lower = line.toLowerCase();
	return names.some((n) => lower.includes(n.toLowerCase()));
}

interface Checkout {
	repo: RepositoryConfig;
	baseBranch: string;
	sha: string;
	slug: string;
	isPublic: boolean;
	dir: string;
	worktree?: boolean;
	commit?: string;
	pushed?: boolean;
	entry?: NonNullable<BuildReport["repos"]>[string];
}

const branchesInUse = new Set<string>();

/**
 * Runs a "mode: build" skill: implements the issue on a fresh branch from each
 * repository's base branch and opens a PR per changed repository. The agent
 * only edits and tests, in a bubblewrap sandbox with no git push, gh or
 * secrets. Cyrus then commits, pushes and opens the PRs as the GitHub App's
 * bot. Public repositories never mention private ones: the agent is told,
 * and Cyrus strips such lines from their commit messages and PRs.
 */
export async function runBuildSkill(ctx: SkillRunContext): Promise<void> {
	const { host, tracker, issue, skill, rootId } = ctx;
	const { logger } = host;
	const reply = (body: string) =>
		tracker.createComment(issue.id, { body, parentId: rootId ?? undefined });
	const repos = workspaceRepos(ctx.repos, ctx.workspaceId);
	if (repos.length === 0) {
		await reply(`⚠️ \`${skill.name}\` found no repository for this workspace.`);
		return;
	}
	const checkoutDir = join(
		host.cyrusHome,
		"builds",
		`${issue.identifier}-${ctx.commentId.slice(0, 8)}`,
	);
	const stateDir = join(
		host.cyrusHome,
		"opencode-state",
		basename(checkoutDir).replace(/[^a-zA-Z0-9._-]+/g, "-"),
	);
	const checkouts: Checkout[] = [];
	let branch: string | null = null;
	try {
		// GitHub calls go out as the GitHub App (installation token), never as the gh user; no token, no build
		const tokenProvider = host.gitHubAppTokenProvider();
		if (!tokenProvider) {
			throw new Error(
				"couldn't get a GitHub App token: GITHUB_APP_ID / GITHUB_APP_INSTALLATION_ID are not set",
			);
		}
		const botUsername = process.env.GITHUB_BOT_USERNAME;
		if (!botUsername) {
			throw new Error("GITHUB_BOT_USERNAME is not set");
		}
		const appEnv = async (): Promise<NodeJS.ProcessEnv> => {
			let token: string;
			try {
				token = await tokenProvider.getToken();
			} catch (error) {
				throw new Error(
					`couldn't get a GitHub App token: ${errorMessage(error)}`,
				);
			}
			// the token goes through the environment, not argv or git config; the empty value drops the gh helper
			return {
				...process.env,
				GH_TOKEN: token,
				CYRUS_GH_APP_TOKEN: token,
				GIT_TERMINAL_PROMPT: "0",
				GIT_CONFIG_COUNT: "2",
				GIT_CONFIG_KEY_0: "credential.https://github.com.helper",
				GIT_CONFIG_VALUE_0: "",
				GIT_CONFIG_KEY_1: "credential.https://github.com.helper",
				GIT_CONFIG_VALUE_1:
					'!f() { echo username=x-access-token; echo "password=$CYRUS_GH_APP_TOKEN"; }; f',
			};
		};
		const botLogin = `${botUsername}[bot]`;
		const bot = JSON.parse(
			(
				await run("gh", ["api", `/users/${encodeURIComponent(botLogin)}`], {
					env: await appEnv(),
				})
			).stdout,
		) as { login: string; id: number };
		const author = {
			name: bot.login,
			email: `${bot.id}+${bot.login}@users.noreply.github.com`,
		};
		for (const repo of repos) {
			const baseBranch = repo.baseBranch || "main";
			await git(
				repo.repositoryPath,
				["fetch", "--quiet", "origin", baseBranch],
				{
					timeout: 120_000,
				},
			);
			const sha = await git(repo.repositoryPath, ["rev-parse", "FETCH_HEAD"]);
			const remote = await git(repo.repositoryPath, [
				"remote",
				"get-url",
				"origin",
			]);
			const slug = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(
				remote,
			)?.[1];
			if (!slug) {
				throw new Error(
					`${repo.name}: origin ${remote} is not a GitHub repository`,
				);
			}
			const { visibility } = JSON.parse(
				(await run("gh", ["repo", "view", slug, "--json", "visibility"]))
					.stdout,
			) as { visibility: string };
			checkouts.push({
				repo,
				baseBranch,
				sha,
				slug,
				isPublic: visibility === "PUBLIC",
				dir: join(checkoutDir, repo.name),
			});
		}
		// -2, -3… when the name is taken in any repo
		const stem = buildBranchStem(issue.branchName, issue.identifier);
		for (let n = 1; !branch; n++) {
			const name = n === 1 ? stem : `${stem}-${n}`;
			let taken = branchesInUse.has(name);
			for (const c of checkouts) {
				if (taken) break;
				const onRemote = await git(
					c.repo.repositoryPath,
					["ls-remote", "--heads", "origin", name],
					{ timeout: 60_000, env: await appEnv() },
				);
				const local = await git(c.repo.repositoryPath, [
					"branch",
					"--list",
					name,
				]);
				taken = Boolean(onRemote || local);
			}
			if (!taken) {
				branch = name;
				branchesInUse.add(name);
			}
		}
		await mkdir(checkoutDir, { recursive: true });
		for (const c of checkouts) {
			await git(c.repo.repositoryPath, [
				"worktree",
				"add",
				"-b",
				branch,
				c.dir,
				c.sha,
			]);
			c.worktree = true;
		}
		const commits = checkouts
			.map((c) => `${c.repo.name} \`${c.sha.slice(0, 7)}\` (${c.baseBranch})`)
			.join(", ");
		logger.info(
			`Build on ${issue.identifier}: branch ${branch} at ${commits.replaceAll("`", "")} in ${checkoutDir}`,
		);
		await reply(`🔨 Building on \`${branch}\` from ${commits}.`);
		const publicRepos = checkouts.filter((c) => c.isPublic);
		const privateRepos = checkouts.filter((c) => !c.isPublic);
		const prompt = [
			`You are Jingbong, implementing Linear issue ${issue.identifier}.`,
			"",
			`The current directory holds a checkout of each of the issue's repositories, one subfolder each, all on a new branch \`${branch}\`:`,
			...checkouts.map(
				(c) =>
					`- ${c.repo.name}/: github.com/${c.slug} (${c.isPublic ? "PUBLIC" : "private"}), at ${c.baseBranch} commit ${c.sha}`,
			),
			"",
			"<task>",
			"- Implement the issue as its description says, using the requester's guidance below. Decide which repositories need changes; leave the others untouched.",
			"- Follow each repository's own conventions and instructions (AGENTS.md, CLAUDE.md, CONTRIBUTING.md, README).",
			"- Where the description is unclear or leaves something open, make a reasonable choice, carry on, and list it as an assumption. Don't stop to ask.",
			"- In each repository you changed, run its tests, lint/typecheck and build (whatever it has). Install dependencies first if they are needed, with the lockfile's tool (for example `pnpm install --frozen-lockfile`, `npm ci`). Fix what fails. If something still fails, or could not be run, report it.",
			"- Do not commit, push, create or switch branches, or change git config. Leave your changes in the working tree; Cyrus commits them and opens one pull request per changed repository.",
			...(publicRepos.length > 0 && privateRepos.length > 0
				? [
						`- PUBLIC repositories (${publicRepos.map((c) => c.repo.name).join(", ")}) are visible to anyone. Nothing written into them — code, comments, docs, tests — and nothing you write for their entries below may mention the private repositories (${privateRepos.map((c) => c.repo.name).join(", ")}): not their names, URLs, paths or contents.`,
					]
				: []),
			"</task>",
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
			`# ${issue.identifier}: ${issue.title}`,
			"",
			(issue.description || "").trim() || "(no description)",
			"</issue>",
			"",
			"<final_message>",
			"When you are done, your final message must be only this JSON object (no other text, no code fence):",
			"{",
			'  "summary": "markdown: what you did overall, for the reply on the Linear issue",',
			'  "assumptions": ["each choice you made where the issue was unclear"],',
			'  "repos": {',
			'    "<repository folder name, only for repositories you changed>": {',
			'      "title": "commit subject line, imperative, under 72 characters",',
			'      "summary": "markdown: the changes in this repository, for its pull request",',
			'      "assumptions": ["the assumptions that concern this repository"],',
			'      "testing": "markdown: what you ran (tests, lint, build) and the results",',
			'      "checksPassed": true,',
			'      "failures": "markdown: what still fails or could not be run, and why; empty when checksPassed"',
			"    }",
			"  }",
			"}",
			"If you changed nothing, use an empty repos object and explain why in summary.",
			"</final_message>",
		].join("\n");
		// the agent's shell must not see Cyrus's secrets (it runs in a sandbox, but environment variables pass through)
		const hiddenEnv: Record<string, string> = {};
		const envNames = await readFile(join(host.cyrusHome, ".env"), "utf8")
			.then((t) =>
				[...t.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/gm)].map(
					(m) => m[1]!,
				),
			)
			.catch(() => [] as string[]);
		for (const name of [...envNames, ...Object.keys(process.env)]) {
			if (
				envNames.includes(name) ||
				/TOKEN|SECRET|PASSWORD|PRIVATE|API_KEY|CREDENTIAL/i.test(name)
			) {
				hiddenEnv[name] = "";
			}
		}
		const runOnce = (input: string, resumeSessionId?: string) =>
			runOpenCode(
				{
					workingDirectory: checkoutDir,
					allowedTools: [
						"Read",
						"Glob",
						"Grep",
						"Edit",
						"Write",
						"Bash",
						"TodoWrite",
						"WebFetch",
						"WebSearch",
					],
					disallowedTools: ["Bash(git push:*)", "Bash(gh:*)"],
					cyrusHome: host.cyrusHome,
					model: host.opencodeDefaultModel(),
					title: `Jingbong ${skill.name} ${issue.identifier}`,
					inactivityTimeoutMs: 20 * 60 * 1000,
					resumeSessionId,
					env: hiddenEnv,
					standalone: true,
					sandbox: {
						readWritePaths: [
							checkoutDir,
							stateDir,
							...checkouts.map((c) => join(c.repo.repositoryPath, ".git")),
						],
					},
				},
				input,
			);
		let attempt = await runOnce(prompt);
		let report = attempt.ok ? parseBuildReport(attempt.text) : null;
		// Gemini sometimes ends with an empty or malformed final message; ask for the report again
		for (
			let nudge = 1;
			attempt.ok && !report && attempt.sessionId && nudge <= 2;
			nudge++
		) {
			logger.warn(
				`Build on ${issue.identifier}: no JSON report in the final message, asking again (${nudge}/2)`,
			);
			attempt = await runOnce(
				"Your final message was not the required JSON object. Reply now with only that JSON object, exactly as <final_message> specifies, and nothing else.",
				attempt.sessionId,
			);
			report = attempt.ok ? parseBuildReport(attempt.text) : null;
		}
		if (!attempt.ok) {
			throw new Error(
				attempt.errors.join("; ") ||
					attempt.detail ||
					"the agent did not finish",
			);
		}
		report ??= {
			summary: "(the agent's final report could not be read)",
			assumptions: [],
			repos: {},
		};
		const sessionId = attempt.sessionId || "unknown";
		const model =
			(await openCodeSessionModel(sessionId, checkoutDir).catch(() => null)) ||
			host.opencodeDefaultModel() ||
			"unknown";
		// commit whatever is in each working tree as one commit on the base commit, authored by the app's bot
		const privateNames = privateRepos.flatMap((c) => [c.repo.name, c.slug]);
		const scrub = (c: Checkout, text: string) =>
			c.isPublic
				? scrubPrivateMentions(text, privateNames)
				: { text, scrubbed: 0 };
		const list = (items: unknown) =>
			(Array.isArray(items) ? items : [])
				.filter(Boolean)
				.map((a) => `- ${a}`)
				.join("\n");
		const warnings: string[] = [];
		const changed: Checkout[] = [];
		for (const c of checkouts) {
			await git(c.dir, ["add", "-A"]);
			const tree = await git(c.dir, ["write-tree"]);
			if (tree === (await git(c.dir, ["rev-parse", `${c.sha}^{tree}`]))) {
				continue;
			}
			c.entry = report.repos?.[c.repo.name] ?? {};
			const title = scrub(
				c,
				String(c.entry.title || `Implement ${issue.identifier}: ${issue.title}`)
					.split("\n")[0]!
					.trim()
					.slice(0, 100),
			);
			const message = `${title.text || `Implement ${issue.identifier}`}\n\nLinear: ${issue.identifier}\n`;
			const env = {
				...process.env,
				GIT_AUTHOR_NAME: author.name,
				GIT_AUTHOR_EMAIL: author.email,
				GIT_COMMITTER_NAME: author.name,
				GIT_COMMITTER_EMAIL: author.email,
			};
			c.commit = (
				await run(
					"git",
					["-C", c.dir, "commit-tree", tree, "-p", c.sha, "-m", message],
					{ env },
				)
			).stdout.trim();
			await git(c.dir, ["update-ref", `refs/heads/${branch}`, c.commit]);
			if (c.isPublic) {
				const diff = await git(c.dir, ["diff", c.sha, c.commit]);
				const leaks = diff
					.split("\n")
					.filter(
						(l) => l.startsWith("+") && mentionsAny(l, privateNames),
					).length;
				if (leaks > 0) {
					warnings.push(
						`⚠️ The ${c.repo.name} changes add ${leaks} line(s) that mention a private repository. Check the PR before merging.`,
					);
				}
			}
			changed.push(c);
		}
		// public PRs first, so the private ones can link to them; public PRs never link to private ones
		changed.sort((a, b) => Number(b.isPublic) - Number(a.isPublic));
		const prs: {
			url: string;
			isPublic: boolean;
			draft: boolean;
			repo: string;
			failures: string;
		}[] = [];
		for (const c of changed) {
			await git(
				c.repo.repositoryPath,
				["push", "origin", `${c.commit}:refs/heads/${branch}`],
				{ timeout: 180_000, env: await appEnv() },
			);
			c.pushed = true;
			const e = c.entry ?? {};
			const draft = e.checksPassed !== true;
			const related = prs
				.filter((p) => p.isPublic || !c.isPublic)
				.map((p) => `- ${p.url}`);
			const sections = [
				`## Summary\n\n${String(e.summary || "").trim() || `Implements ${issue.identifier}.`}`,
				list(e.assumptions) && `## Assumptions\n\n${list(e.assumptions)}`,
				`## Testing\n\n${String(e.testing || "").trim() || "(not reported)"}`,
				draft &&
					`## ⚠️ Checks not passing\n\n${String(e.failures || "").trim() || "The agent did not report its checks as passing."}`,
				related.length > 0 &&
					`## Related pull requests\n\n${related.join("\n")}`,
				`Linear: [${issue.identifier}](${issue.url})`,
			]
				.filter(Boolean)
				.join("\n\n");
			const body = scrub(c, sections);
			const title = scrub(c, issue.title);
			if (body.scrubbed + title.scrubbed > 0) {
				warnings.push(
					`Removed ${body.scrubbed + title.scrubbed} line(s) mentioning a private repository from the ${c.repo.name} PR.`,
				);
			}
			const args = [
				"pr",
				"create",
				"--repo",
				c.slug,
				"--base",
				c.baseBranch,
				"--head",
				branch,
				"--title",
				title.text.trim() || issue.identifier,
				"--body-file",
				"-",
			];
			if (draft) args.push("--draft");
			const prEnv = await appEnv();
			const url = await new Promise<string>((resolve, reject) => {
				const child = execFile(
					"gh",
					args,
					{ env: prEnv },
					(error, stdout, stderr) =>
						error
							? reject(new Error(stderr || error.message))
							: resolve(stdout.trim().split("\n").pop() ?? ""),
				);
				child.stdin?.end(body.text);
			});
			prs.push({
				url,
				isPublic: c.isPublic,
				draft,
				repo: c.repo.name,
				failures: draft ? String(e.failures || "").trim() : "",
			});
		}
		const header = `${checkouts.length > 1 ? "commits" : "commit"} ${commits} · session \`${sessionId}\` · model \`${model}\``;
		const unchanged = checkouts
			.filter((c) => !changed.includes(c))
			.map((c) => c.repo.name);
		const out = [
			header,
			prs.length > 0
				? `**Branch:** \`${branch}\`\n\n${prs.map((p) => `- ${p.repo}: ${p.url}${p.draft ? " (draft: checks not passing)" : ""}`).join("\n")}`
				: "**No changes made**, so no branch was pushed and no PR opened.",
			String(report.summary || "").trim(),
			list(report.assumptions) &&
				`**Assumptions**\n${list(report.assumptions)}`,
			...prs
				.filter((p) => p.draft)
				.map(
					(p) =>
						`**${p.repo} checks not passing**\n${p.failures || "(not reported)"}`,
				),
			prs.length > 0 &&
				unchanged.length > 0 &&
				`Unchanged: ${unchanged.join(", ")}.`,
			...warnings,
		].filter(Boolean);
		await reply(out.join("\n\n"));
		logger.info(
			`Build on ${issue.identifier} done: ${prs.map((p) => p.url).join(", ") || "no changes"} (session ${sessionId})`,
		);
	} catch (error) {
		const message = errorMessage(error);
		logger.error(`Build on ${issue.identifier} failed: ${message}`);
		const kept = checkouts
			.filter((c) => c.commit && !c.pushed)
			.map((c) => c.repo.name);
		await reply(
			`⚠️ \`${skill.name}\` failed: ${message.slice(0, 1000)}${kept.length > 0 ? `\n\nThe unpushed commit is kept on the local branch \`${branch}\` in ${kept.join(", ")}.` : ""}`,
		).catch(() => {});
	} finally {
		for (const c of checkouts.filter((c) => c.worktree)) {
			await git(c.repo.repositoryPath, [
				"worktree",
				"remove",
				"--force",
				c.dir,
			]).catch((error) => {
				logger.warn(
					`Could not remove checkout ${c.dir}: ${errorMessage(error)}`,
				);
			});
			// the remote has the branch now; an unpushed commit stays on the local branch
			if (branch && (!c.commit || c.pushed)) {
				await git(c.repo.repositoryPath, ["branch", "-D", branch]).catch(
					() => {},
				);
			}
		}
		await rm(checkoutDir, { recursive: true, force: true }).catch(() => {});
		await rm(stateDir, { recursive: true, force: true }).catch(() => {});
		if (branch) branchesInUse.delete(branch);
	}
}
