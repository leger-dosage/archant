import { describe, expect, it } from "vitest";

import { listedLocks, protectedFromSync } from "@/lib/locked-fields";

// Noon UTC, the same local day in every zone from UTC-11 to UTC+11.
const LOCKED_AT = Date.parse("2026-09-13T12:00:00Z");

describe("protectedFromSync", () => {
	it("is false for an imported line, which holds no lock", () => {
		expect(protectedFromSync({ lockedFields: {}, excluded: false })).toBe(false);
	});

	it("is true for a line holding a lock", () => {
		expect(protectedFromSync({ lockedFields: { category: LOCKED_AT }, excluded: false })).toBe(
			true,
		);
	});

	it("is false for a locked line left out of reports, as Sure's `!excluded?`", () => {
		expect(protectedFromSync({ lockedFields: { excluded: LOCKED_AT }, excluded: true })).toBe(
			false,
		);
	});
});

describe("listedLocks", () => {
	it("lists nothing for a line without a lock", () => {
		expect(listedLocks({})).toEqual([]);
	});

	it("lists each lock in stored order, with its day, and a migrated lock without one", () => {
		expect(listedLocks({ label: LOCKED_AT, category: null })).toEqual([
			{ field: "label", name: "transactions.protection.fields.label", day: "2026-09-13" },
			{ field: "category", name: "transactions.protection.fields.category", day: null },
		]);
	});
});
