import { describe, expect, it } from "vitest";

import { atMidnight, nearestDate, payoffStops, splitDay } from "./payoff-cursor";

const end = atMidnight("2025-12-31");
const payments = ["2025-01-05", "2025-02-05", "2025-03-05", "2025-04-05"];

describe("nearestDate", () => {
	it("picks the closest date, the first on a tie", () => {
		expect(nearestDate(payments, "2025-02-19")).toBe("2025-02-05");
		expect(nearestDate(payments, "2025-02-21")).toBe("2025-03-05");
	});

	it("keeps the date itself when there is nothing to snap to", () => {
		expect(nearestDate([], "2025-02-19")).toBe("2025-02-19");
	});
});

describe("payoffStops", () => {
	const window = { from: "2025-02-01", to: "2025-02-28" };

	it("stops at the payments inside the window", () => {
		expect(payoffStops(payments, ["2025-02-10", "2025-02-17"], window)).toEqual(["2025-02-05"]);
	});

	it("falls back to the plotted dates when no payment falls inside", () => {
		expect(
			payoffStops(["2025-01-05", "2025-03-05"], ["2025-01-27", "2025-02-10", "2025-02-17"], window),
		).toEqual(["2025-02-10", "2025-02-17"]);
	});
});

describe("splitDay", () => {
	it("snaps the hovered day to the nearest stop", () => {
		expect(splitDay(atMidnight("2025-02-12"), payments, end)).toBe(atMidnight("2025-02-05"));
	});

	it("sits at the window's end at rest", () => {
		expect(splitDay(undefined, payments, end)).toBe(end);
		expect(splitDay("2025-02-12", payments, end)).toBe(end);
	});

	it("snaps to plotted dates when the window has no payment", () => {
		const stops = payoffStops(payments, ["2025-06-01", "2025-06-15"], {
			from: "2025-05-15",
			to: "2025-06-30",
		});

		expect(splitDay(atMidnight("2025-06-10"), stops, end)).toBe(atMidnight("2025-06-15"));
	});
});
