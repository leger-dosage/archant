import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { forwardBalances } from "./forward.ts";

const anchor = { date: "2026-09-01", balance: toMinorUnits(123456) };

describe("forwardBalances", () => {
	it("carries the anchor balance to every day up to the end date", () => {
		const rows = forwardBalances(anchor, "2026-09-03");

		expect(rows).toEqual([
			{ date: "2026-09-01", balance: 123456 },
			{ date: "2026-09-02", balance: 123456 },
			{ date: "2026-09-03", balance: 123456 },
		]);
	});

	it("gives one row when the anchor is today", () => {
		expect(forwardBalances(anchor, "2026-09-01")).toEqual([
			{ date: "2026-09-01", balance: 123456 },
		]);
	});

	it("still gives the anchor row when the account opens after the end date", () => {
		expect(forwardBalances(anchor, "2026-08-15")).toEqual([
			{ date: "2026-09-01", balance: 123456 },
		]);
	});

	it("keeps a negative anchor, an overdrawn account or a card in credit", () => {
		const rows = forwardBalances(
			{ date: "2026-09-01", balance: toMinorUnits(-4290) },
			"2026-09-02",
		);

		expect(rows.map((row) => row.balance)).toEqual([-4290, -4290]);
	});

	it("spans a month boundary without skipping a day", () => {
		const rows = forwardBalances({ date: "2026-01-30", balance: toMinorUnits(0) }, "2026-02-02");

		expect(rows.map((row) => row.date)).toEqual([
			"2026-01-30",
			"2026-01-31",
			"2026-02-01",
			"2026-02-02",
		]);
	});
});
