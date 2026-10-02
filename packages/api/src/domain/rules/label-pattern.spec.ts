import { describe, expect, it } from "vitest";

import { compileLabelPattern, replaceInLabel } from "./label-pattern.ts";

function replace(pattern: string, replacement: string, label: string): string {
	const compiled = compileLabelPattern(pattern);

	if (compiled === null) {
		throw new Error(`${pattern} does not compile`);
	}

	return replaceInLabel(compiled, replacement, label);
}

describe("compileLabelPattern", () => {
	it.each(["\\\\", "^CARTE \\d{2}/\\d{2}/\\d{2} ", "\\s*CB\\*\\d{4}$", "(a+)+$"])(
		"accepts %s",
		(pattern) => {
			expect(compileLabelPattern(pattern)).not.toBeNull();
		},
	);

	// RE2 has no backtracking, so it has no back reference and no lookaround,
	// and it caps nested repeats, which would otherwise cost memory to compile.
	it.each(["(", "[", "(?=x)", "(a)\\1", "((a{100}){100}){100}"])("refuses %s", (pattern) => {
		expect(compileLabelPattern(pattern)).toBeNull();
	});
});

describe("replaceInLabel", () => {
	it("turns the backslashes of a card terminal label into spaces", () => {
		expect(replace("\\\\", " ", "LECLERC SANS CONTAC\\ANCENIS-SAINT\\ FR")).toBe(
			"LECLERC SANS CONTAC ANCENIS-SAINT FR",
		);
	});

	it("removes a prefix", () => {
		expect(
			replace("^CARTE \\d{2}/\\d{2}/\\d{2} ", "", "CARTE 29/09/26 PICARD SA 788 4 CB*2769"),
		).toBe("PICARD SA 788 4 CB*2769");
	});

	it("removes a suffix with its leading spaces", () => {
		expect(replace("\\s*CB\\*\\d{4}$", "", "PICARD SA 788 4 CB*2769")).toBe("PICARD SA 788 4");
	});

	it("ignores case, accents included", () => {
		expect(replace("^carte \\d{2}/\\d{2}/\\d{2} ", "", "Carte 29/09/26 X")).toBe("X");
		expect(replace("é", "e", "ÉTÉ")).toBe("eTe");
	});

	it("replaces every occurrence", () => {
		expect(replace("-", " ", "A--B--C")).toBe("A B C");
	});

	it("takes the replacement literally", () => {
		expect(replace(" ", "$1\\n", "A B")).toBe("A$1\\nB");
		expect(replace("USD", "US$", "PAY USD")).toBe("PAY US$");
	});

	it("leaves a label the pattern does not match untouched, spaces included", () => {
		expect(replace("CARTE", "", "IKEA  CSC")).toBe("IKEA  CSC");
	});

	it("leaves a label whose result would be empty", () => {
		expect(replace("CARTE", "", "CARTE")).toBe("CARTE");
		expect(replace("\\s+", "", "   ")).toBe("   ");
	});

	it("returns at once on a pattern that makes the built-in engine backtrack for ever", () => {
		const label = `${"a".repeat(199)}!`;
		const started = performance.now();

		expect(replace("(a+)+$", "x", label)).toBe(label);
		expect(performance.now() - started).toBeLessThan(1_000);
	});
});
