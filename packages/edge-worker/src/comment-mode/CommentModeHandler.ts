import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import {
	type AgentSessionCreatedWebhook,
	type AgentSessionPromptedWebhook,
	type CyrusAgentSession,
	commentSessionId,
	type Issue,
	type RepositoryConfig,
} from "cyrus-core";
import { LinearIssueTrackerService } from "cyrus-linear-event-transport";
import { runBuildSkill } from "./buildSkill.js";
import { applyCheckpoint } from "./checkpoint.js";
import { OPEN_QUESTION_MARKER } from "./issueThread.js";
import {
	graphql,
	humanReactors,
	isCheckMark,
	isThinking,
	type LinearCommentNode,
} from "./linearApi.js";
import { commentHandle, mentionsHandle, stripMentions } from "./mentions.js";
import { openCodeSessionModel } from "./openCodeModel.js";
import { runReadonlySkill } from "./readonlySkill.js";
import { commentSkillDirs, loadCommentSkill, replyRules } from "./skills.js";
import {
	type CommentModeHost,
	errorMessage,
	type SkillRequest,
	type SkillRunContext,
	workspaceRepos,
} from "./types.js";

const run = promisify(execFile);

/** What comment mode needs from the EdgeWorker beyond CommentModeHost. */
export interface CommentModeSessions {
	getTracker(workspaceId: string): unknown;
	getSession(sessionId: string): CyrusAgentSession | undefined;
	/** True while the session waits for an answer to its own question. */
	awaitingAnswer(sessionId: string): boolean;
	startSession(
		webhook: AgentSessionCreatedWebhook,
		repos: RepositoryConfig[],
	): Promise<void>;
	promptSession(webhook: AgentSessionPromptedWebhook): Promise<void>;
	/** The issue's repositories by the routing rules, or null when none match. */
	routeRepositories(
		workspaceId: string,
		issue: Issue,
		repos: RepositoryConfig[],
	): Promise<RepositoryConfig[] | null>;
	/** Makes these the repositories later sessions on the issue use. */
	pinRepositories(issueId: string, repos: RepositoryConfig[]): Promise<void>;
}

interface CommentWebhookData {
	id?: string;
	issueId?: string;
	parentId?: string;
	body?: string;
	userId?: string;
	botActor?: unknown;
	createdAt?: string;
}

interface LinearWebhook {
	type?: string;
	action?: string;
	organizationId?: string;
	createdAt?: string;
	actor?: { id?: string; type?: string; name?: string; email?: string };
	data?: Record<string, unknown>;
	notification?: {
		type?: string;
		commentId?: string;
		reactionEmoji?: string;
	};
}

/**
 * Comment mode: the bot works like a plain Linear integration instead of a
 * Linear agent. "@handle" in an ordinary comment starts (or continues) work,
 * and answers are posted as replies in that comment's thread.
 *
 * - "@handle <text>" runs a Cyrus session with id `cmt_<issueId>_<rootId>`;
 *   LinearIssueTrackerService posts its responses as thread replies.
 * - "@handle <skill> [args]" runs a skill (see skills.ts).
 * - A person's ✅ on a cp write-up applies it to the issue; 🤔 on any
 *   comment runs opt with that comment as the question.
 * - Work goes to the repositories the routing rules pick for the issue
 *   (description tag, project, catch-all…). When none match, the bot says so
 *   and holds the request until "@handle repo <name…>" picks them.
 */
export class CommentModeHandler {
	private botIds = new Map<string, string>();
	/** 🤔 runs claimed in this process (Linear can deliver one reaction twice). */
	private optClaimed = new Set<string>();
	/** Requests per issue waiting for "@handle repo" (in memory: lost on restart). */
	private awaitingRepo = new Map<string, (() => Promise<void>)[]>();

	constructor(
		private readonly host: CommentModeHost,
		private readonly sessions: CommentModeSessions,
	) {}

	private get logger() {
		return this.host.logger;
	}

	private linearTracker(workspaceId: string | undefined) {
		if (!workspaceId) return null;
		const tracker = this.sessions.getTracker(workspaceId);
		return tracker instanceof LinearIssueTrackerService ? tracker : null;
	}

	private async botId(
		workspaceId: string,
		tracker: LinearIssueTrackerService,
	): Promise<string | undefined> {
		if (!this.botIds.has(workspaceId)) {
			try {
				const me = await tracker.fetchCurrentUser();
				if (me?.id) this.botIds.set(workspaceId, me.id);
			} catch (error) {
				this.logger.warn(`Could not look up bot user: ${errorMessage(error)}`);
			}
		}
		return this.botIds.get(workspaceId);
	}

	/**
	 * Handles comment-mode webhooks. Returns true when the webhook was a
	 * Comment, Reaction or comment-reaction notification (handled or
	 * deliberately ignored), false when the EdgeWorker should handle it.
	 */
	async handleWebhook(
		raw: unknown,
		repos: RepositoryConfig[],
	): Promise<boolean> {
		const webhook = raw as LinearWebhook;
		if (
			webhook?.type === "AppUserNotification" &&
			webhook.notification?.type === "issueCommentReaction"
		) {
			await this.handleReactionNotification(webhook, repos);
			return true;
		}
		// 🤔 on any comment (reactions on the bot's own comments also arrive as the notification above)
		if (webhook?.type === "Reaction") {
			this.handleReaction(webhook, repos);
			return true;
		}
		if (webhook?.type !== "Comment" || webhook.action !== "create") {
			return false;
		}
		await this.handleComment(webhook, repos);
		return true;
	}

	private async handleReactionNotification(
		webhook: LinearWebhook,
		repos: RepositoryConfig[],
	): Promise<void> {
		const workspaceId = webhook.organizationId!;
		const tracker = this.linearTracker(workspaceId);
		const { commentId, reactionEmoji: emoji = "" } = webhook.notification!;
		if (!tracker || !commentId) return;
		if (isCheckMark(emoji)) {
			await applyCheckpoint({
				tracker,
				commentId,
				botId: await this.botId(workspaceId, tracker),
				logger: this.logger,
			}).catch((error) => {
				this.logger.error(
					`Could not apply checkpoint ${commentId}: ${errorMessage(error)}`,
				);
			});
		} else if (isThinking(emoji)) {
			void this.optFromReaction(tracker, workspaceId, commentId, repos);
		}
	}

	private handleReaction(webhook: LinearWebhook, repos: RepositoryConfig[]) {
		const workspaceId = webhook.organizationId;
		const tracker = this.linearTracker(workspaceId);
		const data = (webhook.data ?? {}) as {
			emoji?: string;
			commentId?: string;
			comment?: { id?: string };
		};
		if (
			!tracker ||
			webhook.action !== "create" ||
			!isThinking(data.emoji ?? "")
		) {
			return;
		}
		const commentId = data.commentId || data.comment?.id;
		if (!commentId) {
			this.logger.warn(
				`🤔 Reaction webhook without a comment id (fields: ${Object.keys(data).join(", ")})`,
			);
			return;
		}
		void this.optFromReaction(tracker, workspaceId!, commentId, repos);
	}

	private async handleComment(
		webhook: LinearWebhook,
		repos: RepositoryConfig[],
	): Promise<void> {
		const data = (webhook.data ?? {}) as CommentWebhookData;
		const workspaceId = webhook.organizationId;
		const tracker = this.linearTracker(workspaceId);
		if (!tracker || !workspaceId || !data.id || !data.issueId) return;
		tracker.setCommentSessionHeader((sid) => this.commentHeader(sid));
		if (
			data.botActor ||
			(webhook.actor?.type && webhook.actor.type !== "user")
		) {
			return;
		}
		const botId = await this.botId(workspaceId, tracker);
		if (data.userId && data.userId === botId) return;

		const body = data.body || "";
		const rootId = data.parentId || data.id;
		const sessionId = commentSessionId(data.issueId, rootId);
		const awaitingAnswer = this.sessions.awaitingAnswer(sessionId);
		const mentioned = mentionsHandle(body);
		// every new request needs the mention; only an answer to the bot's own question doesn't
		if (!mentioned && !awaitingAnswer) return;

		let prompt = stripMentions(body);
		const repoCommand =
			mentioned && !awaitingAnswer
				? /^repos?(?:\s+([\s\S]*))?$/i.exec(prompt)
				: null;
		if (repoCommand) {
			await this.chooseRepositories(
				tracker,
				workspaceId,
				data.issueId,
				rootId,
				(repoCommand[1] ?? "").trim(),
				repos,
			);
			return;
		}
		// "@handle <skill> args": a first word naming a skill runs it; anything else is an ordinary prompt
		const skillMatch =
			mentioned && !awaitingAnswer
				? /^([a-z0-9][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i.exec(prompt)
				: null;
		const loaded = skillMatch
			? await loadCommentSkill(
					skillMatch[1]!,
					commentSkillDirs(this.host.cyrusHome),
				)
			: null;
		let skill: SkillRequest | null = null;
		if (loaded) {
			const args = (skillMatch?.[2] ?? "").trim();
			if (loaded.build || loaded.readonly) {
				// "thread-context: yes" skills asked from inside a thread: everything said in it so far is the discussion
				const discussion =
					loaded.readonly && loaded.threadContext && data.parentId
						? {
								rootId: data.parentId,
								until: data.createdAt || new Date().toISOString(),
							}
						: null;
				skill = { ...loaded, args, discussion };
			} else {
				prompt = `Run the "${loaded.name}" skill. Follow its instructions exactly.\n\n<skill name="${loaded.name}">\n${loaded.text}\n</skill>\n\nArguments: ${args || "(none)"}`;
			}
			this.logger.info(
				`Skill "${loaded.name}"${loaded.build ? " (build)" : loaded.readonly ? " (readonly)" : ""} requested in comment ${data.id}`,
			);
		}
		// language and no-status-change rules go with every prompt except an answer to the bot's own question
		if (!awaitingAnswer) {
			prompt = `${prompt}\n\n${replyRules({ session: true })}`;
		}

		const issue = await tracker.fetchIssue(data.issueId);
		this.logger.info(
			`${mentioned ? "Mention" : "Answer"} in comment ${data.id} on ${issue.identifier} -> ${skill ? `skill ${skill.name}` : `session ${sessionId}`}`,
		);
		tracker
			.getClient()
			.createReaction({ commentId: data.id, emoji: "eyes" })
			.catch((error) => {
				this.logger.debug(
					`Could not react to comment ${data.id}: ${errorMessage(error)}`,
				);
			});

		// a new piece of work needs its repositories; prompts to a running session keep the session's
		const continuing =
			awaitingAnswer || Boolean(this.sessions.getSession(sessionId));
		const routed = continuing
			? repos
			: await this.sessions.routeRepositories(workspaceId, issue, repos);
		if (!routed) {
			await this.holdForRepository(
				tracker,
				workspaceId,
				issue,
				rootId,
				repos,
				() => this.handleComment(webhook, repos),
			);
			return;
		}

		if (skill) {
			const ctx: SkillRunContext = {
				host: this.host,
				tracker,
				workspaceId,
				issue,
				commentId: data.id,
				rootId,
				skill,
				repos: routed,
				botId,
			};
			const runSkill = skill.build ? runBuildSkill : runReadonlySkill;
			runSkill(ctx).catch((error) => {
				this.logger.error(
					`Skill "${skill.name}" crashed: ${error instanceof Error ? error.stack : String(error)}`,
				);
			});
			return;
		}

		const team = await issue.team;
		const userId = data.userId || webhook.actor?.id;
		let creator: { id: string; name?: string; email?: string } | undefined =
			webhook.actor?.id
				? {
						id: webhook.actor.id,
						name: webhook.actor.name,
						email: webhook.actor.email,
					}
				: undefined;
		if (userId && !creator?.email) {
			try {
				const user = await tracker.fetchUser(userId);
				creator = { id: user.id, name: user.name, email: user.email };
			} catch {
				// keep whatever the webhook gave us
			}
		}
		const agentSession = {
			id: sessionId,
			issueId: issue.id,
			issue: {
				id: issue.id,
				identifier: issue.identifier,
				title: issue.title,
				description: issue.description,
				url: issue.url,
				teamId: team?.id,
				team: team
					? { id: team.id, key: team.key, name: team.name }
					: undefined,
			},
			commentId: data.id,
			comment: { id: data.id, body: prompt },
			creator,
		};
		if (continuing) {
			await this.sessions.promptSession({
				type: "AgentSessionEvent",
				action: "prompted",
				organizationId: workspaceId,
				createdAt: data.createdAt,
				agentSession,
				agentActivity: {
					id: `act_${data.id}`,
					content: { type: "prompt", body: prompt },
					sourceCommentId: data.id,
				},
			} as unknown as AgentSessionPromptedWebhook);
		} else {
			await this.sessions.startSession(
				{
					type: "AgentSessionEvent",
					action: "created",
					organizationId: workspaceId,
					createdAt: data.createdAt,
					agentSession,
					guidance: [],
				} as unknown as AgentSessionCreatedWebhook,
				repos,
			);
		}
	}

	/**
	 * A person's 🤔 on any comment runs the opt skill with that comment's text
	 * as the question, once per comment: `<cyrusHome>/state/opt-reactions.json`
	 * remembers which comments already ran (delete an entry to allow a rerun).
	 */
	private async optFromReaction(
		tracker: LinearIssueTrackerService,
		workspaceId: string,
		commentId: string,
		repos: RepositoryConfig[],
	): Promise<void> {
		// the bot's own comments arrive as both a Reaction webhook and a notification; claim before any await
		if (this.optClaimed.has(commentId)) return;
		this.optClaimed.add(commentId);
		try {
			const ledger = join(this.host.cyrusHome, "state", "opt-reactions.json");
			let done: Record<string, string> = {};
			try {
				done = JSON.parse(await readFile(ledger, "utf8"));
			} catch {
				// first run
			}
			if (done[commentId]) {
				this.logger.info(
					`🤔 on comment ${commentId}: opt already ran for it at ${done[commentId]}`,
				);
				return;
			}
			const { comment: c } = await graphql<{
				comment: (LinearCommentNode & { issue: { id: string } | null }) | null;
			}>(
				tracker,
				`query ($id: String!) {
					comment(id: $id) {
						id body createdAt
						parent { id }
						issue { id }
						reactions { emoji user { name app } }
					}
				}`,
				{ id: commentId },
			);
			const thinkers = c ? humanReactors(c, isThinking) : [];
			// a comment's first line may be a reply header or the open-question marker
			const question = (c?.body || "")
				.replace(/^commits? [^\n]*· session `[^\n]*\n+/, "")
				.replace(
					new RegExp(
						`^${OPEN_QUESTION_MARKER.replace(/\*/g, "\\*")}[^\\n]*\\n+`,
					),
					"",
				)
				.trim();
			if (!c?.issue || thinkers.length === 0 || !question) {
				this.optClaimed.delete(commentId);
				return;
			}
			const skill = await loadCommentSkill(
				"opt",
				commentSkillDirs(this.host.cyrusHome),
			);
			if (!skill?.readonly) {
				this.logger.warn("🤔 ignored: no readonly opt skill");
				this.optClaimed.delete(commentId);
				return;
			}
			const issue = await tracker.fetchIssue(c.issue.id);
			const routed = await this.sessions.routeRepositories(
				workspaceId,
				issue,
				repos,
			);
			if (!routed) {
				this.optClaimed.delete(commentId);
				await this.holdForRepository(
					tracker,
					workspaceId,
					issue,
					c.parent?.id ?? c.id,
					repos,
					() => this.optFromReaction(tracker, workspaceId, commentId, repos),
				);
				return;
			}
			done[commentId] = new Date().toISOString();
			await mkdir(dirname(ledger), { recursive: true });
			await writeFile(ledger, JSON.stringify(done, null, 2));
			this.logger.info(
				`🤔 by ${thinkers.join(", ")} on comment ${commentId} (${issue.identifier}): running opt`,
			);
			// a reply in a thread: the thread up to and including it is the discussion; the reply stays the focus
			const discussion =
				skill.threadContext && c.parent
					? { rootId: c.parent.id, until: c.createdAt }
					: null;
			await runReadonlySkill({
				host: this.host,
				tracker,
				workspaceId,
				issue,
				commentId,
				rootId: null,
				skill: { ...skill, args: question, fromReaction: true, discussion },
				repos: routed,
				botId: await this.botId(workspaceId, tracker),
			});
		} catch (error) {
			this.logger.error(
				`🤔 on comment ${commentId} failed: ${error instanceof Error ? error.stack : String(error)}`,
			);
		}
	}

	/**
	 * Nothing routes the issue to a repository: says so in the thread and keeps
	 * the request, which runs once "@handle repo <name…>" picks the repositories.
	 */
	private async holdForRepository(
		tracker: LinearIssueTrackerService,
		workspaceId: string,
		issue: Issue,
		rootId: string,
		repos: RepositoryConfig[],
		retry: () => Promise<void>,
	): Promise<void> {
		this.awaitingRepo.set(issue.id, [
			...(this.awaitingRepo.get(issue.id) ?? []),
			retry,
		]);
		const project = await issue.project;
		const why = project?.name
			? `its project **${project.name}** isn't mapped to a repository`
			: "it has no project that maps to a repository";
		this.logger.info(
			`No repository for ${issue.identifier} (project: ${project?.name ?? "none"}); holding the request`,
		);
		await tracker.createComment(issue.id, {
			parentId: rootId,
			body: [
				`🤷 I don't know which repository ${issue.identifier} belongs to: ${why}.`,
				"",
				`Reply \`@${commentHandle()} repo <name>\` (several: \`@${commentHandle()} repo <name> <name>\`) and I'll carry on with this request. Repositories: ${repoList(workspaceRepos(repos, workspaceId))}.`,
			].join("\n"),
		});
	}

	/**
	 * "@handle repo <name…>": tags the issue description with [repo=…] (the
	 * routing rule that beats every other), pins the repositories for later
	 * sessions and runs the requests that were waiting for them.
	 * "@handle repo" alone says which repositories the issue uses.
	 */
	private async chooseRepositories(
		tracker: LinearIssueTrackerService,
		workspaceId: string,
		issueId: string,
		rootId: string,
		args: string,
		repos: RepositoryConfig[],
	): Promise<void> {
		const reply = (body: string) =>
			tracker.createComment(issueId, { body, parentId: rootId });
		const available = workspaceRepos(repos, workspaceId);
		const issue = await tracker.fetchIssue(issueId);
		const names = args.split(/[\s,]+/).filter(Boolean);
		if (names.length === 0) {
			const current = await this.sessions.routeRepositories(
				workspaceId,
				issue,
				repos,
			);
			await reply(
				current
					? `${issue.identifier} uses ${repoList(current)}. To change it: \`@${commentHandle()} repo <name>\`. Repositories: ${repoList(available)}.`
					: `${issue.identifier} has no repository yet. Choose one with \`@${commentHandle()} repo <name>\`. Repositories: ${repoList(available)}.`,
			);
			return;
		}
		const chosen: RepositoryConfig[] = [];
		const unknown: string[] = [];
		for (const name of names) {
			const wanted = name.toLowerCase().replace(/\.git$/, "");
			const repo = available.find(
				(r) =>
					r.name.toLowerCase() === wanted ||
					r.githubUrl?.toLowerCase().endsWith(`/${wanted}`),
			);
			if (!repo) unknown.push(name);
			else if (!chosen.includes(repo)) chosen.push(repo);
		}
		if (unknown.length > 0) {
			await reply(
				`⚠️ No repository called ${unknown.map((n) => `\`${n}\``).join(", ")} in this workspace. Repositories: ${repoList(available)}.`,
			);
			return;
		}
		const description =
			`${stripRepoTags(issue.description || "")}\n\n${chosen.map((r) => `[repo=${r.name}]`).join(" ")}`.trim();
		await tracker.updateIssue(issueId, { description });
		await this.sessions.pinRepositories(issueId, chosen);
		this.logger.info(
			`${issue.identifier} routed to ${chosen.map((r) => r.name).join(", ")} by a repo command`,
		);
		const waiting = this.awaitingRepo.get(issueId) ?? [];
		this.awaitingRepo.delete(issueId);
		await reply(
			`📌 ${issue.identifier} now uses ${repoList(chosen)} (tagged in the description).${waiting.length > 0 ? ` Carrying on with ${waiting.length === 1 ? "the waiting request" : `the ${waiting.length} waiting requests`}.` : ""}`,
		);
		for (const retry of waiting) {
			await retry().catch((error) => {
				this.logger.error(
					`Waiting request on ${issue.identifier} failed: ${errorMessage(error)}`,
				);
			});
		}
	}

	/** "commit · session · model" line put at the top of every session reply. */
	async commentHeader(sessionId: string): Promise<string> {
		const session = this.sessions.getSession(sessionId);
		const cwd = session?.workspace?.path;
		// multi-repo sessions: cwd is a plain parent folder with one worktree per repo
		const repoPaths = Object.values(session?.workspace?.repoPaths ?? {});
		const commitOf = async (dir: string) => {
			try {
				let commit = (
					await run("git", ["-C", dir, "rev-parse", "--short", "HEAD"])
				).stdout.trim();
				const dirty = (
					await run("git", ["-C", dir, "status", "--porcelain"])
				).stdout.trim();
				if (dirty) commit += "-dirty";
				return commit;
			} catch {
				return "unknown";
			}
		};
		let commits = "commit `unknown`";
		if (repoPaths.length > 1) {
			const each = await Promise.all(
				repoPaths.map(
					async (dir) => `${basename(dir)} \`${await commitOf(dir)}\``,
				),
			);
			commits = `commits ${each.join(", ")}`;
		} else if (repoPaths[0] || cwd) {
			commits = `commit \`${await commitOf((repoPaths[0] || cwd)!)}\``;
		}
		const runnerSessionId =
			session?.opencodeSessionId ||
			session?.claudeSessionId ||
			session?.geminiSessionId ||
			session?.codexSessionId ||
			session?.cursorSessionId ||
			sessionId;
		const model =
			(await openCodeSessionModel(session?.opencodeSessionId, cwd).catch(
				(error) => {
					this.logger.warn(
						`Could not read model from OpenCode session ${session?.opencodeSessionId}: ${errorMessage(error)}`,
					);
					return null;
				},
			)) ||
			(session?.metadata as { model?: string } | undefined)?.model ||
			"unknown";
		return `${commits} · session \`${runnerSessionId}\` · model \`${model}\``;
	}
}

function repoList(repos: RepositoryConfig[]): string {
	return repos.map((r) => `\`${r.name}\``).join(", ") || "(none configured)";
}

/** The description without [repo=…] / repo=… routing tags (see RepositoryRouter.parseRepoTagsFromDescription). */
export function stripRepoTags(description: string): string {
	return description
		.replace(/\\?\[repo=[a-zA-Z0-9_\-/.#]+\\?\]/g, "")
		.replace(/(^|[ \t])repos?=[a-zA-Z0-9_\-/.#,]+/gm, "$1")
		.replace(/[ \t]+$/gm, "")
		.trim();
}
