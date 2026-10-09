import type { Schedule } from "./schedule.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import {
	changePercent,
	derivedState,
	effectiveDueOn,
	horizonOf,
	isCloseWorthy,
	learnedTolerance,
	occurrenceState,
	priceChangeOf,
	remainingOf,
	resolvedExpected,
	roundHalfUp,
} from "./occurrences.ts";
import { monthlyOn } from "./schedule.ts";

const minor = (...amounts: number[]) => amounts.map(toMinorUnits);

const open = (dueOn: string, snoozedUntil: string | null = null) => ({
	status: "scheduled" as const,
	dueOn,
	snoozedUntil,
});

describe("roundHalfUp", () => {
	it("rounds a half up and anything below it down", () => {
		expect(roundHalfUp(5, 2)).toBe(3);
		expect(roundHalfUp(7, 3)).toBe(2);
		expect(roundHalfUp(8, 3)).toBe(3);
		expect(roundHalfUp(0, 9)).toBe(0);
	});
});

describe("resolvedExpected", () => {
	it("reads the frozen amount, else the series' magnitude", () => {
		expect(resolvedExpected({ expectedAmount: toMinorUnits(1599) }, toMinorUnits(-1399))).toBe(
			1599,
		);
		expect(resolvedExpected({ expectedAmount: null }, toMinorUnits(-1399))).toBe(1399);
		expect(resolvedExpected({ expectedAmount: null }, toMinorUnits(250_000))).toBe(250_000);
	});
});

describe("effectiveDueOn", () => {
	it("is the due date, or a later snooze", () => {
		expect(effectiveDueOn(open("2026-10-05"))).toBe("2026-10-05");
		expect(effectiveDueOn(open("2026-10-05", "2026-10-12"))).toBe("2026-10-12");
		expect(effectiveDueOn(open("2026-10-05", "2026-10-01"))).toBe("2026-10-05");
	});
});

describe("derivedState", () => {
	it("is upcoming until 3 days before, due through 3 days after, then overdue", () => {
		expect(derivedState(open("2026-10-05"), "2026-10-01")).toBe("upcoming");
		expect(derivedState(open("2026-10-05"), "2026-10-02")).toBe("due");
		expect(derivedState(open("2026-10-05"), "2026-10-08")).toBe("due");
		expect(derivedState(open("2026-10-05"), "2026-10-09")).toBe("overdue");
	});

	it("counts from a snooze, and reads a closed occurrence's status", () => {
		expect(derivedState(open("2026-10-05", "2026-10-20"), "2026-10-09")).toBe("upcoming");
		expect(derivedState({ ...open("2026-10-05"), status: "paid" }, "2026-12-01")).toBe("paid");
		expect(derivedState({ ...open("2026-10-05"), status: "skipped" }, "2026-12-01")).toBe(
			"skipped",
		);
	});
});

describe("occurrenceState", () => {
	it("is the schedule state for an active series", () => {
		expect(occurrenceState(open("2026-10-05"), "active", "2026-10-09")).toBe("overdue");
		expect(occurrenceState(open("2026-10-05"), "active", "2026-10-02")).toBe("due");
		expect(occurrenceState(open("2026-10-05"), "active", "2026-10-01")).toBe("upcoming");
	});

	it("is the series' status for an open occurrence of any other, as Sure's display_status", () => {
		for (const today of ["2026-10-01", "2026-10-02", "2026-10-15"]) {
			expect(occurrenceState(open("2026-10-05"), "inactive", today)).toBe("paused");
			expect(occurrenceState(open("2026-10-05"), "ended", today)).toBe("ended");
			expect(occurrenceState(open("2026-10-05"), "suggested", today)).toBe("suggested");
		}
	});

	it("reads a closed occurrence's status whatever the series'", () => {
		expect(
			occurrenceState({ ...open("2026-10-05"), status: "paid" }, "inactive", "2026-12-01"),
		).toBe("paid");
		expect(
			occurrenceState({ ...open("2026-10-05"), status: "missed" }, "ended", "2026-12-01"),
		).toBe("missed");
	});
});

describe("isCloseWorthy", () => {
	const expected = toMinorUnits(57_129);

	it("closes on a single payment within 7.5 % of the expected amount, either side", () => {
		expect(isCloseWorthy(expected, minor(57_136))).toBe(true);
		expect(isCloseWorthy(toMinorUnits(10_000), minor(9250))).toBe(true);
		expect(isCloseWorthy(toMinorUnits(10_000), minor(9249))).toBe(false);
		expect(isCloseWorthy(toMinorUnits(10_000), minor(12_000))).toBe(true);
	});

	it("closes on payments summing to the expected amount, within one minor unit", () => {
		expect(isCloseWorthy(toMinorUnits(10_000), minor(5000, 4999))).toBe(true);
		expect(isCloseWorthy(toMinorUnits(10_000), minor(5000, 4998))).toBe(false);
		expect(isCloseWorthy(toMinorUnits(10_000), minor(9000, 500))).toBe(false);
	});

	it("never closes without a payment, nor when nothing is expected", () => {
		expect(isCloseWorthy(expected, [])).toBe(false);
		expect(isCloseWorthy(toMinorUnits(0), minor(100))).toBe(false);
	});
});

describe("remainingOf", () => {
	it("is what the confirmed payments leave, never below zero", () => {
		expect(remainingOf(toMinorUnits(10_000), minor(4000))).toBe(6000);
		expect(remainingOf(toMinorUnits(10_000), minor(4000, 7000))).toBe(0);
		expect(remainingOf(toMinorUnits(10_000), [])).toBe(10_000);
	});
});

describe("learnedTolerance", () => {
	const expected = toMinorUnits(10_000);

	it("learns 80 ‰ from a payment 8 % above that settles the occurrence", () => {
		expect(learnedTolerance(toMinorUnits(10_800), expected, null, true)).toBe(80);
		expect(learnedTolerance(toMinorUnits(10_801), expected, null, true)).toBe(80);
		expect(learnedTolerance(toMinorUnits(10_805), expected, null, true)).toBe(81);
	});

	it("learns nothing within 7.5 %, below what it knows, past 25 %, or from a partial payment", () => {
		expect(learnedTolerance(toMinorUnits(10_750), expected, null, true)).toBeNull();
		expect(learnedTolerance(toMinorUnits(10_800), expected, 90, true)).toBeNull();
		expect(learnedTolerance(toMinorUnits(10_800), expected, 80, true)).toBeNull();
		expect(learnedTolerance(toMinorUnits(12_500), expected, null, true)).toBe(250);
		expect(learnedTolerance(toMinorUnits(12_501), expected, null, true)).toBeNull();
		expect(learnedTolerance(toMinorUnits(10_800), expected, null, false)).toBeNull();
		expect(learnedTolerance(toMinorUnits(10_800), toMinorUnits(0), null, true)).toBeNull();
	});
});

const paid = (dueOn: string, confirmed: number[], entryId: string | null = "e1") => ({
	dueOn,
	confirmed: minor(...confirmed),
	entryId,
});

describe("priceChangeOf", () => {
	const series = toMinorUnits(-1399);

	it("records two single payments agreeing on a new price, on the latest due date", () => {
		expect(
			priceChangeOf(series, [paid("2026-10-05", [1599], "e2"), paid("2026-09-05", [1600])], []),
		).toEqual({ effectiveOn: "2026-10-05", previousAmount: 1399, newAmount: 1599, entryId: "e2" });
	});

	it("needs two paid occurrences, each with a single payment", () => {
		expect(priceChangeOf(series, [], [])).toBeNull();
		expect(priceChangeOf(series, [paid("2026-10-05", [1599])], [])).toBeNull();
		expect(
			priceChangeOf(series, [paid("2026-10-05", [800, 799]), paid("2026-09-05", [1599])], []),
		).toBeNull();
		expect(
			priceChangeOf(series, [paid("2026-10-05", [1599]), paid("2026-09-05", [800, 799])], []),
		).toBeNull();
	});

	it("needs the two to agree, and to differ from the series' price", () => {
		expect(
			priceChangeOf(series, [paid("2026-10-05", [1599]), paid("2026-09-05", [1602])], []),
		).toBeNull();
		expect(
			priceChangeOf(series, [paid("2026-10-05", [1400]), paid("2026-09-05", [1400])], []),
		).toBeNull();
	});

	it("records nothing on a date or at an amount already recorded", () => {
		const recent = [paid("2026-10-05", [1599]), paid("2026-09-05", [1599])];

		expect(
			priceChangeOf(series, recent, [{ effectiveOn: "2026-10-05", newAmount: toMinorUnits(1700) }]),
		).toBeNull();
		expect(
			priceChangeOf(series, recent, [
				{ effectiveOn: "2026-09-05", newAmount: toMinorUnits(1599) },
				{ effectiveOn: "2026-01-05", newAmount: toMinorUnits(1499) },
			]),
		).toBeNull();
		expect(
			priceChangeOf(series, recent, [
				{ effectiveOn: "2026-09-05", newAmount: toMinorUnits(1499) },
				{ effectiveOn: "2026-01-05", newAmount: toMinorUnits(1599) },
			]),
		).toMatchObject({ effectiveOn: "2026-10-05" });
	});
});

describe("changePercent", () => {
	it("counts a rise and a fall in tenths of a percent, half away from zero", () => {
		const [low, high] = minor(1349, 1599);

		expect(changePercent(low!, high!)).toBe(185);
		expect(changePercent(high!, low!)).toBe(-156);
		// 1/8 is 125 tenths exactly; 1/16 is 62,5, which rounds to 63 either way.
		expect(changePercent(toMinorUnits(800), toMinorUnits(900))).toBe(125);
		expect(changePercent(toMinorUnits(1600), toMinorUnits(1700))).toBe(63);
		expect(changePercent(toMinorUnits(1600), toMinorUnits(1500))).toBe(-63);
	});

	it("is 0 from nothing", () => {
		expect(changePercent(toMinorUnits(0), toMinorUnits(999))).toBe(0);
	});
});

describe("horizonOf", () => {
	const monthly: Schedule = {
		rules: [monthlyOn(5)],
		anchorDate: "2026-10-05",
		endAfterCount: null,
		expectedDayOfMonth: 5,
	};
	const none = { anchorDate: null, endAfterCount: null };

	it("reaches 90 days ahead", () => {
		expect(horizonOf(monthly, none, "2026-10-06")).toBe("2027-01-04");
	});

	it("stretches to a yearly bill's next due date", () => {
		const yearly: Schedule = {
			...monthly,
			rules: [{ frequency: "yearly", interval: 1, dayOfMonth: 15, monthOfYear: 6 }],
		};

		expect(horizonOf(yearly, none, "2026-10-06")).toBe("2027-06-15");
	});

	it("stretches to an installment's last payment, and stops at 90 days once it ended", () => {
		const installment = { anchorDate: "2026-10-05", endAfterCount: 6 };

		// 31 days a cycle, seven of them, from the anchor or else from today.
		expect(horizonOf({ ...monthly, endAfterCount: 6 }, installment, "2026-10-06")).toBe(
			"2027-05-10",
		);
		expect(
			horizonOf(
				{ ...monthly, endAfterCount: 6 },
				{ anchorDate: null, endAfterCount: 6 },
				"2026-10-06",
			),
		).toBe("2027-05-11");
		expect(
			horizonOf(
				{ ...monthly, anchorDate: "2025-01-05", endAfterCount: 2 },
				{ anchorDate: "2025-01-05", endAfterCount: 2 },
				"2026-10-06",
			),
		).toBe("2027-01-04");
	});
});
