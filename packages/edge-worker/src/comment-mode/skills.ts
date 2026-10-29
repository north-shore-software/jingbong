import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A skill run by "@handle <name> [args]": `<skills dir>/<name>/SKILL.md`.
 * Frontmatter flags:
 * - `mode: readonly` runs outside Cyrus sessions with read-only tools
 *   (see runReadonlySkill); `mode: build` implements the issue and opens PRs
 *   (see runBuildSkill); otherwise the skill becomes an ordinary session prompt.
 * - `args: required` replies asking for arguments instead of running.
 * - `thread: new` posts the first part as a new top-level comment.
 * - `open-questions: threads` posts each later part as an open-question thread.
 * - `thread-context: yes` reads the surrounding thread when asked from a reply.
 */
export interface CommentSkill {
	name: string;
	text: string;
	readonly: boolean;
	build: boolean;
	argsRequired: boolean;
	newThread: boolean;
	openQuestionThreads: boolean;
	threadContext: boolean;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

export function parseCommentSkill(name: string, raw: string): CommentSkill {
	const frontmatter = FRONTMATTER.exec(raw)?.[1] ?? "";
	const flag = (pattern: RegExp) => pattern.test(frontmatter);
	return {
		name,
		text: raw.replace(FRONTMATTER, "").trim(),
		readonly: flag(/^mode:\s*readonly\s*$/m),
		build: flag(/^mode:\s*build\s*$/m),
		argsRequired: flag(/^args:\s*required\s*$/m),
		newThread: flag(/^thread:\s*new\s*$/m),
		openQuestionThreads: flag(/^open-questions:\s*threads\s*$/m),
		threadContext: flag(/^thread-context:\s*yes\s*$/m),
	};
}

/** The skills shipped with Jingbong (cp, opt, build). */
export const BUNDLED_SKILLS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"comment-skills",
);

/**
 * Where skills are looked up, in order: CYRUS_SKILLS_DIR (or
 * `<cyrusHome>/skills`), so a local skill can override a bundled one, then
 * the bundled skills.
 */
export function commentSkillDirs(cyrusHome: string): string[] {
	return [
		process.env.CYRUS_SKILLS_DIR || join(cyrusHome, "skills"),
		BUNDLED_SKILLS_DIR,
	];
}

/** The named skill from the first directory that has it, or null. */
export async function loadCommentSkill(
	name: string,
	dirs: string[],
): Promise<CommentSkill | null> {
	const skillName = name.toLowerCase();
	if (!/^[a-z0-9][a-z0-9_-]*$/.test(skillName)) return null;
	for (const dir of dirs) {
		try {
			const raw = await readFile(join(dir, skillName, "SKILL.md"), "utf8");
			return parseCommentSkill(skillName, raw);
		} catch {
			// not in this directory
		}
	}
	return null;
}

/**
 * Rules appended to every prompt whose output can end up as a comment on
 * Linear. Sessions also must not change the issue's status.
 */
export function replyRules({ session = false } = {}): string {
	return [
		"<reply_rules>",
		"- Write everything you post to Linear in English, whatever language the issue or comments use.",
		'- When you quote or refer to text in another language (such as Chinese), give the English translation followed by the original in parentheses, for example: the "Restore backup" button (恢复备份). Code, file paths and identifiers stay as they are; after a user-facing string in code, add its translation, for example: `"恢复备份"` ("Restore backup").',
		...(session
			? ["- Do not change the issue's status (workflow state)."]
			: []),
		"</reply_rules>",
	].join("\n");
}
