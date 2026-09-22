import { describe, expect, it } from "vitest";

import { safeRedirect } from "./safe-redirect";

describe("safeRedirect", () => {
	it.each([
		["/comptes", "/comptes"],
		["/comptes/abc?tab=imports", "/comptes/abc?tab=imports"],
		["/", "/"],
		[undefined, "/"],
		["", "/"],
		["//attacker.example", "/"],
		["/\\attacker.example", "/"],
		["https://attacker.example", "/"],
		["javascript:alert(1)", "/"],
		["comptes", "/"],
		["/\t/attacker.example", "/"],
		["/\n/attacker.example", "/"],
		["/\r/attacker.example", "/"],
		["/\u0000/attacker.example", "/"],
		["/\u001f/attacker.example", "/"],
		["/\u007f/attacker.example", "/"],
		["/comptes\\x", "/"],
	])("follows %j to %j", (target, expected) => {
		expect(safeRedirect(target)).toBe(expected);
	});
});
