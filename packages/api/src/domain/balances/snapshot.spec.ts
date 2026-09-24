import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { snapshotGap, snapshotGapBackward, snapshotRejectionFor } from "./snapshot.ts";

const m = toMinorUnits;
const context = { openingDate: "2026-01-10", today: "2026-09-21" };

describe("snapshotRejectionFor", () => {
	it("accepts the day after the opening date and today", () => {
		expect(snapshotRejectionFor("2026-01-11", context)).toBeNull();
		expect(snapshotRejectionFor("2026-09-21", context)).toBeNull();
	});

	it("refuses the opening date and any day before it", () => {
		expect(snapshotRejectionFor("2026-01-10", context)).toBe("BEFORE_OPENING_DATE");
		expect(snapshotRejectionFor("2025-12-31", context)).toBe("BEFORE_OPENING_DATE");
	});

	it("refuses tomorrow", () => {
		expect(snapshotRejectionFor("2026-09-22", context)).toBe("DATE_IN_FUTURE");
	});
});

describe("snapshotGap", () => {
	it("adds the day's movements to the previous balance of an asset", () => {
		// Checking at 1 500,00 with a -120,00 on 2026-03-02, snapshot 2 000,00 on 03-05.
		expect(
			snapshotGap({
				previous: m(138000),
				movements: m(0),
				recorded: m(200000),
				classification: "asset",
			}),
		).toEqual({ computed: 138000, gap: 62000 });
	});

	it("counts a transaction of the snapshot day in the computed balance only", () => {
		expect(
			snapshotGap({
				previous: m(138000),
				movements: m(-3000),
				recorded: m(200000),
				classification: "asset",
			}),
		).toEqual({ computed: 135000, gap: 65000 });
	});

	it("subtracts the day's movements from a liability's amount owed", () => {
		// A card owing 490,30 with a -30,00 purchase on the day owes 520,30.
		expect(
			snapshotGap({
				previous: m(49030),
				movements: m(-3000),
				recorded: m(52000),
				classification: "liability",
			}),
		).toEqual({ computed: 52030, gap: -30 });
	});

	it("is zero when the recorded balance matches", () => {
		expect(
			snapshotGap({
				previous: m(-8000),
				movements: m(0),
				recorded: m(-8000),
				classification: "asset",
			}),
		).toEqual({ computed: -8000, gap: 0 });
	});
});

describe("snapshotGapBackward", () => {
	it("takes the next day's balance less its movements on an asset", () => {
		expect(
			snapshotGapBackward({
				next: m(100000),
				nextMovements: m(-2000),
				recorded: m(50000),
				classification: "asset",
			}),
		).toEqual({ computed: 102000, gap: -52000 });
	});

	it("adds the next day's movements back on a liability", () => {
		// A card owing 300,00 after a -30,00 purchase owed 270,00 the day before.
		expect(
			snapshotGapBackward({
				next: m(30000),
				nextMovements: m(-3000),
				recorded: m(27000),
				classification: "liability",
			}),
		).toEqual({ computed: 27000, gap: 0 });
	});
});
