import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { THEME_SCRIPT_HASH } from "./content-security-policy.ts";

describe("THEME_SCRIPT_HASH", () => {
	it("matches the inline script of the interface's index.html", async () => {
		const html = await readFile(new URL("../../../app/index.html", import.meta.url), "utf8");
		const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gu)];

		expect(inline).toHaveLength(1);
		// The HTML parser turns CRLF into LF before a browser hashes the script,
		// so a Windows checkout with autocrlf hashes the same text.
		const text = (inline[0]?.[1] ?? "").replace(/\r\n?/gu, "\n");
		const actual = `sha256-${createHash("sha256").update(text).digest("base64")}`;
		expect(
			actual,
			`The theme script changed: set THEME_SCRIPT_HASH to "${actual}", and the header expected in packages/api/src/app.spec.ts and packages/app/e2e/serving.spec.ts.`,
		).toBe(THEME_SCRIPT_HASH);
	});
});
