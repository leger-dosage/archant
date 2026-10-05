import { describe, expect, it } from "vitest";

import { firstDueFrom } from "./bills.ts";

describe("firstDueFrom", () => {
	it("takes the transaction's day this month while it is still ahead", () => {
		expect(firstDueFrom("2026-08-25", "2026-09-21")).toBe("2026-09-25");
	});

	it("takes next month's once the day has passed, or is today", () => {
		expect(firstDueFrom("2026-09-05", "2026-09-21")).toBe("2026-10-05");
		expect(firstDueFrom("2026-08-21", "2026-09-21")).toBe("2026-10-21");
	});

	it("skips a short month the 31st is missing from, as Sure's shim", () => {
		expect(firstDueFrom("2026-08-31", "2026-09-21")).toBe("2026-10-31");
		expect(firstDueFrom("2027-01-31", "2027-02-10")).toBe("2027-03-31");
	});
});
