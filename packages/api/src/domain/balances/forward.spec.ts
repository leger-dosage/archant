import type { ForwardInput } from "./forward.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { forwardBalances } from "./forward.ts";

const m = toMinorUnits;

// Checking opened on 2026-09-01 at 1 234,56, computed from its opening day.
const opening: ForwardInput = {
	from: "2026-09-01",
	previousCash: m(0),
	valuations: [{ date: "2026-09-01", balance: m(123456) }],
	movements: [],
	holdings: [],
	until: "2026-09-03",
	classification: "asset",
};

const balances = (input: ForwardInput) => forwardBalances(input).map((row) => row.balance);

describe("forwardBalances", () => {
	it("carries the anchor to every day up to the end date when nothing moves", () => {
		expect(forwardBalances(opening)).toEqual([
			{ date: "2026-09-01", balance: 123456, cash: 123456 },
			{ date: "2026-09-02", balance: 123456, cash: 123456 },
			{ date: "2026-09-03", balance: 123456, cash: 123456 },
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

	it("starts after the anchor from a given previous cash", () => {
		expect(
			forwardBalances({
				from: "2026-09-10",
				previousCash: m(123456),
				valuations: [],
				movements: [{ date: "2026-09-10", amount: m(-4290) }],
				holdings: [],
				until: "2026-09-11",
				classification: "asset",
			}),
		).toEqual([
			{ date: "2026-09-10", balance: 119166, cash: 119166 },
			{ date: "2026-09-11", balance: 119166, cash: 119166 },
		]);
	});

	describe("with holdings", () => {
		// The PEA of Story 22.3's matrix: 25 000 € opened on 2026-09-01, a buy of
		// 10 at 612.40 with 2.50 of fees on 2026-09-10, LVMH at 650 the next day.
		const pea: ForwardInput = {
			from: "2026-09-09",
			previousCash: m(2_500_000),
			valuations: [],
			movements: [{ date: "2026-09-10", amount: m(-612_650) }],
			holdings: [
				{ date: "2026-09-10", value: m(612_400) },
				{ date: "2026-09-11", value: m(650_000) },
			],
			until: "2026-09-11",
			classification: "asset",
		};

		it("adds the day's holdings to the cash the movements leave", () => {
			expect(forwardBalances(pea)).toEqual([
				{ date: "2026-09-09", balance: 2_500_000, cash: 2_500_000 },
				{ date: "2026-09-10", balance: 2_499_750, cash: 1_887_350 },
				{ date: "2026-09-11", balance: 2_537_350, cash: 1_887_350 },
			]);
		});

		it("sums every holding of a day", () => {
			expect(
				balances({
					...pea,
					holdings: [...pea.holdings, { date: "2026-09-11", value: m(36_000) }],
				}),
			).toEqual([2_500_000, 2_499_750, 2_573_350]);
		});

		it("lets a valuation set the total, the cash becoming the total less the holdings", () => {
			expect(
				forwardBalances({
					...pea,
					valuations: [{ date: "2026-09-11", balance: m(3_000_000) }],
					until: "2026-09-12",
					holdings: [...pea.holdings, { date: "2026-09-12", value: m(660_000) }],
				}).slice(2),
			).toEqual([
				{ date: "2026-09-11", balance: 3_000_000, cash: 2_350_000 },
				{ date: "2026-09-12", balance: 3_010_000, cash: 2_350_000 },
			]);
		});
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
