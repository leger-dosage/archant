import type { ForwardInput } from "./forward.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { forwardBalances } from "./forward.ts";

const m = toMinorUnits;

// Checking opened on 2026-09-01 at 1 234,56, computed from its opening day.
const opening: ForwardInput = {
	from: "2026-09-01",
	previous: m(0),
	valuations: [{ date: "2026-09-01", balance: m(123456) }],
	movements: [],
	until: "2026-09-03",
	classification: "asset",
};

const balances = (input: ForwardInput) => forwardBalances(input).map((row) => row.balance);

describe("forwardBalances", () => {
	it("carries the anchor to every day up to the end date when nothing moves", () => {
		expect(forwardBalances(opening)).toEqual([
			{ date: "2026-09-01", balance: 123456 },
			{ date: "2026-09-02", balance: 123456 },
			{ date: "2026-09-03", balance: 123456 },
		]);
	});

	it("adds several movements of one day together on an asset", () => {
		expect(
			balances({
				...opening,
				movements: [
					{ date: "2026-09-02", amount: m(-4290) },
					{ date: "2026-09-02", amount: m(1000) },
				],
			}),
		).toEqual([123456, 120166, 120166]);
	});

	it("keeps the anchor day at exactly the anchor, whatever moved that day", () => {
		// The opening balance is an end-of-day balance, as in Sure: a valuation
		// overrides the flows of its own day.
		expect(balances({ ...opening, movements: [{ date: "2026-09-01", amount: m(-5000) }] })).toEqual(
			[123456, 123456, 123456],
		);
	});

	it("carries the previous balance over a day without movement", () => {
		expect(
			balances({
				...opening,
				until: "2026-09-04",
				movements: [
					{ date: "2026-09-02", amount: m(-100) },
					{ date: "2026-09-04", amount: m(-200) },
				],
			}),
		).toEqual([123456, 123356, 123356, 123156]);
	});

	it("raises a liability's amount owed when money leaves it", () => {
		expect(
			balances({
				...opening,
				classification: "liability",
				valuations: [{ date: "2026-09-01", balance: m(49030) }],
				movements: [
					{ date: "2026-09-02", amount: m(-3000) },
					{ date: "2026-09-03", amount: m(10000) },
				],
			}),
		).toEqual([49030, 52030, 42030]);
	});

	it("starts after the anchor from a given previous balance", () => {
		expect(
			forwardBalances({
				from: "2026-09-10",
				previous: m(123456),
				valuations: [],
				movements: [{ date: "2026-09-10", amount: m(-4290) }],
				until: "2026-09-11",
				classification: "asset",
			}),
		).toEqual([
			{ date: "2026-09-10", balance: 119166 },
			{ date: "2026-09-11", balance: 119166 },
		]);
	});

	it("gives nothing when the start is past the end, after the latest entry was removed", () => {
		expect(forwardBalances({ ...opening, from: "2026-09-04" })).toEqual([]);
	});

	it("spans a month boundary without skipping a day", () => {
		const rows = forwardBalances({
			...opening,
			from: "2026-01-30",
			valuations: [{ date: "2026-01-30", balance: m(0) }],
			until: "2026-02-02",
		});

		expect(rows.map((row) => row.date)).toEqual([
			"2026-01-30",
			"2026-01-31",
			"2026-02-01",
			"2026-02-02",
		]);
	});
});
