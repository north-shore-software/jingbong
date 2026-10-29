import { describe, expect, it } from "vitest";
import {
	buildBranchStem,
	parseBuildReport,
	scrubPrivateMentions,
} from "../../src/comment-mode/buildSkill.js";
import { splitReplies } from "../../src/comment-mode/readonlySkill.js";

describe("build skill helpers", () => {
	it("swaps Linear's user prefix for jingbong/", () => {
		expect(buildBranchStem("alice/def-1-add-export", "DEF-1")).toBe(
			"jingbong/def-1-add-export",
		);
		expect(buildBranchStem(null, "DEF-1")).toBe("jingbong/DEF-1");
	});

	it("finds the JSON report in the final message", () => {
		expect(parseBuildReport('Done!\n{"summary": "ok", "repos": {}}')).toEqual({
			summary: "ok",
			repos: {},
		});
		expect(parseBuildReport("no json here")).toBeNull();
		expect(parseBuildReport("{broken")).toBeNull();
	});

	it("drops lines naming a private repository", () => {
		expect(
			scrubPrivateMentions(
				"Adds export\nSee acme/secret-repo for the server side\nTests pass",
				["secret-repo", "acme/secret-repo"],
			),
		).toEqual({ text: "Adds export\nTests pass", scrubbed: 1 });
	});
});

describe("readonly skill output", () => {
	it("splits replies on <<<reply>>> lines", () => {
		expect(
			splitReplies("First\n<<<reply>>>\nSecond\n<<<reply>>>  \n\n"),
		).toEqual(["First", "Second"]);
	});
});
