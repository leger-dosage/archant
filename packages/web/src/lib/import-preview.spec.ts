import { describe, expect, it } from "vitest";

import { countsOf, firstTab, importedCount, isNothingNew } from "./import-preview.ts";

const empty = { created: [], present: [], matched: [], duplicates: [], rejected: [] };

describe("countsOf", () => {
	it("counts each group", () => {
		expect(countsOf({ ...empty, created: [1, 2], rejected: [3] })).toEqual({
			created: 2,
			present: 0,
			matched: 0,
			duplicates: 0,
			rejected: 1,
		});
	});
});

describe("importedCount", () => {
	it("counts the created, the possible duplicates and the matched, not the present nor the rejected", () => {
		expect(importedCount({ created: 3, present: 4, matched: 2, duplicates: 1, rejected: 5 })).toBe(
			6,
		);
	});
});

describe("firstTab", () => {
	it("opens on the first group holding a line", () => {
		expect(firstTab(countsOf({ ...empty, present: [1] }))).toBe("present");
		expect(firstTab(countsOf({ ...empty, created: [1], rejected: [1] }))).toBe("created");
	});

	it("opens on « À créer » for an empty file", () => {
		expect(firstTab(countsOf(empty))).toBe("created");
	});
});

describe("isNothingNew", () => {
	it("holds when every readable line is already present", () => {
		expect(isNothingNew(countsOf({ ...empty, present: [1, 2], rejected: [3] }))).toBe(true);
	});

	it("does not hold when every line is rejected, the file is empty, or a line would be written", () => {
		expect(isNothingNew(countsOf({ ...empty, rejected: [1] }))).toBe(false);
		expect(isNothingNew(countsOf(empty))).toBe(false);
		expect(isNothingNew(countsOf({ ...empty, present: [1], matched: [2] }))).toBe(false);
	});
});
