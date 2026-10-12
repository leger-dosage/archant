import { describe, expect, it } from "vitest";

import { rejectionFor } from "./statement.ts";

const context = { currency: "EUR", today: "2026-09-21" };

describe("rejectionFor", () => {
	it("accepts a line dated any day up to 366 days ahead, as Sure has no opening bound", () => {
		expect(rejectionFor({ date: "2026-09-02", currency: "EUR" }, context)).toBeNull();
		expect(rejectionFor({ date: "2027-09-22", currency: "EUR" }, context)).toBeNull();
		expect(rejectionFor({ date: "2026-09-01", currency: "EUR" }, context)).toBeNull();
		expect(rejectionFor({ date: "2026-08-20", currency: "EUR" }, context)).toBeNull();
		expect(rejectionFor({ date: "1990-01-01", currency: "EUR" }, context)).toBeNull();
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
