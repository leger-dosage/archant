import { describe, expect, it } from "vitest";

import { DATE_FORMATS } from "@archant/data/household-preferences";

import { formatHouseholdDate } from "@/lib/household-preferences";

describe("formatHouseholdDate", () => {
	it("renders every Sure format without changing the calendar day", () => {
		expect(DATE_FORMATS.map((format) => formatHouseholdDate("2026-12-05", format))).toEqual([
			"12-05-2026",
			"05.12.2026",
			"05-12-2026",
			"2026-12-05",
			"05/12/2026",
			"2026/12/05",
			"12/05/2026",
			" 5/12/2026",
			"2026.12.05",
			"20261205",
			"05 Dec 2026",
		]);
	});
});
