import { describe, expect, it } from "vitest";

import {
	canConfirm,
	countsOf,
	firstTab,
	importedCount,
	isBalanceOnly,
	isNothingNew,
} from "./import-preview.ts";

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

describe("canConfirm and isBalanceOnly", () => {
	it("confirms when a line would be written, whatever the balance", () => {
		const counts = countsOf({ ...empty, created: [1] });

		expect(canConfirm(counts, null)).toBe(true);
		expect(canConfirm(counts, "present")).toBe(true);
		expect(isBalanceOnly(counts, "recorded")).toBe(false);
	});

	it("confirms a recorded balance alone, and only a recorded one", () => {
		const counts = countsOf({ ...empty, present: [1, 2] });

		expect(canConfirm(counts, "recorded")).toBe(true);
		expect(isBalanceOnly(counts, "recorded")).toBe(true);
		for (const status of ["present", "kept", "skipped", null] as const) {
			expect(canConfirm(counts, status)).toBe(false);
			expect(isBalanceOnly(counts, status)).toBe(false);
		}
	});
});

describe("isNothingNew", () => {
	it("holds when every readable line is already present and the balance writes nothing", () => {
		expect(isNothingNew(countsOf({ ...empty, present: [1, 2], rejected: [3] }), null)).toBe(true);
		expect(isNothingNew(countsOf({ ...empty, present: [1] }), "present")).toBe(true);
	});

	it("does not hold when a balance would be recorded", () => {
		expect(isNothingNew(countsOf({ ...empty, present: [1] }), "recorded")).toBe(false);
	});

	it("does not hold when every line is rejected, the file is empty, or a line would be written", () => {
		expect(isNothingNew(countsOf({ ...empty, rejected: [1] }), null)).toBe(false);
		expect(isNothingNew(countsOf(empty), null)).toBe(false);
		expect(isNothingNew(countsOf({ ...empty, present: [1], matched: [2] }), null)).toBe(false);
	});
});
