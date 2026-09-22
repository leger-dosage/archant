import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./reset-password.ts", import.meta.url));

/** Runs the script with a piped stdin, which is what a terminal-less shell gives it. */
async function runWithoutTerminal(): Promise<{ code: number | null; stderr: string }> {
	const child = spawn(process.execPath, [SCRIPT, "admin@example.test"], {
		stdio: ["pipe", "pipe", "pipe"],
		// The terminal check runs before the environment is read, so the script
		// refuses before it could miss a variable.
		env: {},
	});
	let stderr = "";
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => (stderr += chunk));
	child.stdin.end();

	const code = await new Promise<number | null>((resolve) => {
		child.on("exit", resolve);
	});

	return { code, stderr };
}

describe("reset-password", () => {
	it("refuses to run without a terminal and names `docker exec -it`", async () => {
		const { code, stderr } = await runWithoutTerminal();

		expect(code).toBe(1);
		expect(stderr).toContain("Aucun terminal");
		expect(stderr).toContain("docker exec -it");
	});
});
