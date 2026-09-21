import { describe, expect, it } from "vitest";

import { rejectionFor } from "./statement.ts";

const context = { openingDate: "2026-09-01", currency: "EUR", today: "2026-09-21" };

describe("rejectionFor", () => {
	it("accepts a line dated after the opening date, up to 366 days ahead", () => {
		expect(rejectionFor({ date: "2026-09-02", currency: "EUR" }, context)).toBeNull();
		expect(rejectionFor({ date: "2027-09-22", currency: "EUR" }, context)).toBeNull();
	});

	it("refuses the opening day itself and any day before", () => {
		expect(rejectionFor({ date: "2026-09-01", currency: "EUR" }, context)).toBe(
			"BEFORE_OPENING_DATE",
		);
		expect(rejectionFor({ date: "2026-08-31", currency: "EUR" }, context)).toBe(
			"BEFORE_OPENING_DATE",
		);
	});

	it("refuses a line more than 366 days after today", () => {
		expect(rejectionFor({ date: "2027-09-23", currency: "EUR" }, context)).toBe("DATE_TOO_LATE");
	});

	it("refuses a line in another currency than the account's", () => {
		expect(rejectionFor({ date: "2026-09-10", currency: "USD" }, context)).toBe(
			"CURRENCY_MISMATCH",
		);
	});
});
