import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSandboxArgs } from "../src/sandbox.js";

describe("buildSandboxArgs", () => {
	it("empties cyrusHome except the read-write paths and hides credentials", () => {
		const home = mkdtempSync(join(tmpdir(), "cyrus-sandbox-"));
		const cyrusHome = join(home, ".cyrus");
		mkdirSync(join(home, ".ssh"));
		writeFileSync(join(home, ".claude.json"), "{}");
		const build = join(cyrusHome, "builds", "DEF-1");

		const args = buildSandboxArgs({ readWritePaths: [build] }, cyrusHome, home);

		expect(args.slice(0, 9)).toEqual([
			"--dev-bind",
			"/",
			"/",
			"--unshare-pid",
			"--proc",
			"/proc",
			"--die-with-parent",
			"--tmpfs",
			cyrusHome,
		]);
		expect(args).toContain("--bind");
		expect(
			args.slice(args.indexOf("--bind"), args.indexOf("--bind") + 3),
		).toEqual(["--bind", build, build]);
		expect(existsSync(build)).toBe(true);
		expect(args.join(" ")).toContain(`--tmpfs ${join(home, ".ssh")}`);
		expect(args.join(" ")).toContain(
			`--ro-bind /dev/null ${join(home, ".claude.json")}`,
		);
		// credentials that don't exist aren't mounted over
		expect(args.join(" ")).not.toContain(".config/gh");
	});
});
