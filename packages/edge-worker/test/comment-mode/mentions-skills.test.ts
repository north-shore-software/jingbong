import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	mentionsHandle,
	stripMentions,
} from "../../src/comment-mode/mentions.js";
import {
	BUNDLED_SKILLS_DIR,
	loadCommentSkill,
	parseCommentSkill,
} from "../../src/comment-mode/skills.js";

describe("comment mode mentions", () => {
	it("recognises plain and profile-link mentions", () => {
		expect(mentionsHandle("hey @jingbong cp", "jingbong")).toBe(true);
		expect(
			mentionsHandle(
				"[Jingbong](https://linear.app/acme/profiles/jingbong) cp",
				"jingbong",
			),
		).toBe(true);
		expect(mentionsHandle("mail me at x@jingbong.com", "jingbong")).toBe(false);
		expect(mentionsHandle("jingbong is a bot", "jingbong")).toBe(false);
	});

	it("strips every form of the mention", () => {
		expect(stripMentions("@jingbong   opt  which db?", "jingbong")).toBe(
			"opt which db?",
		);
		expect(
			stripMentions(
				"[Jingbong](https://linear.app/acme/profiles/jingbong) cp focus",
				"jingbong",
			),
		).toBe("cp focus");
	});
});

describe("comment mode skills", () => {
	it("reads the frontmatter flags", () => {
		const skill = parseCommentSkill(
			"opt",
			"---\nname: opt\nmode: readonly\nargs: required\nthread: new\nthread-context: yes\n---\n\n# Options\n",
		);
		expect(skill).toMatchObject({
			name: "opt",
			text: "# Options",
			readonly: true,
			build: false,
			argsRequired: true,
			newThread: true,
			openQuestionThreads: false,
			threadContext: true,
		});
	});

	it("ships cp, opt and build", async () => {
		const [cp, opt, build] = await Promise.all(
			["cp", "opt", "build"].map((n) =>
				loadCommentSkill(n, [BUNDLED_SKILLS_DIR]),
			),
		);
		expect(cp).toMatchObject({ readonly: true, openQuestionThreads: true });
		expect(opt).toMatchObject({ readonly: true, newThread: true });
		expect(build).toMatchObject({ build: true });
	});

	it("prefers a local skill over the bundled one and rejects odd names", async () => {
		const local = mkdtempSync(join(tmpdir(), "comment-skills-"));
		mkdirSync(join(local, "cp"));
		writeFileSync(join(local, "cp", "SKILL.md"), "Local checkpoint");
		const cp = await loadCommentSkill("CP", [local, BUNDLED_SKILLS_DIR]);
		expect(cp?.text).toBe("Local checkpoint");
		expect(await loadCommentSkill("../cp", [local])).toBeNull();
		expect(
			await loadCommentSkill("nope", [local, BUNDLED_SKILLS_DIR]),
		).toBeNull();
	});
});
