import type { CashBalance, ForwardInput } from "./forward.ts";

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
	transactionsMoveBalance: true,
	holdings: [],
	until: "2026-09-03",
	classification: "asset",
};

const on = (rows: CashBalance[], date: string) => rows.find((row) => row.date === date);

const balances = (input: ForwardInput) => forwardBalances(input).map((row) => row.balance);

describe("forwardBalances", () => {
	it("carries the anchor to every day up to the end date when nothing moves", () => {
		expect(forwardBalances(opening)).toEqual([
			{ date: "2026-09-01", balance: 123456, cash: 123456 },
			{ date: "2026-09-02", balance: 123456, cash: 123456 },
			{ date: "2026-09-03", balance: 123456, cash: 123456 },
		]);
	});

	it("starts from zero before the anchor, which then sets its own day, as Sure", () => {
		// Sure's `opening_starting_balances`: a day before the opening anchor
		// starts from zero, and the anchor still fixes the end of its day.
		expect(
			forwardBalances({
				...opening,
				from: "2026-08-20",
				movements: [
					{ date: "2026-08-20", amount: m(-2000) },
					{ date: "2026-09-05", amount: m(-300) },
				],
				until: "2026-09-05",
			})
				.filter((row) =>
					["2026-08-20", "2026-08-31", "2026-09-01", "2026-09-05"].includes(row.date),
				)
				.map((row) => row.balance),
		).toEqual([-2000, -2000, 123456, 123156]);
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
				transactionsMoveBalance: true,
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
			transactionsMoveBalance: true,
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

	describe("on a property or a vehicle", () => {
		// A home opened at 300 000 € on 2026-05-01, a builder paid 5 000 € from
		// it on 05-10, as Sure's `derive_non_cash_balance`.
		const home: ForwardInput = {
			from: "2026-05-01",
			previousCash: m(0),
			valuations: [{ date: "2026-05-01", balance: m(30_000_000) }],
			movements: [{ date: "2026-05-10", amount: m(-500_000) }],
			transactionsMoveBalance: false,
			holdings: [],
			until: "2026-05-31",
			classification: "asset",
		};

		it("keeps the value every day a transaction is booked", () => {
			const rows = forwardBalances(home);

			expect(rows).toHaveLength(31);
			expect(rows.every((row) => row.balance === 30_000_000 && row.cash === 30_000_000)).toBe(true);
		});

		it("moves only on a valuation, from its own day", () => {
			const rows = forwardBalances({
				...home,
				valuations: [...home.valuations, { date: "2026-05-20", balance: m(32_000_000) }],
			});

			expect(on(rows, "2026-05-19")?.balance).toBe(30_000_000);
			expect(on(rows, "2026-05-20")).toEqual({
				date: "2026-05-20",
				balance: 32_000_000,
				cash: 32_000_000,
			});
			expect(rows.at(-1)?.balance).toBe(32_000_000);
		});

		it("stays at zero before the opening, a line there notwithstanding", () => {
			const rows = forwardBalances({
				...home,
				from: "2026-04-01",
				movements: [{ date: "2026-04-01", amount: m(-150_000) }],
			});

			expect(on(rows, "2026-04-01")?.balance).toBe(0);
			expect(on(rows, "2026-04-30")?.balance).toBe(0);
			expect(on(rows, "2026-05-01")?.balance).toBe(30_000_000);
		});

		it("runs to a future line without moving the value", () => {
			const rows = forwardBalances({
				...home,
				movements: [{ date: "2026-06-15", amount: m(-500_000) }],
				until: "2026-06-15",
			});

			expect(rows.at(-1)).toEqual({ date: "2026-06-15", balance: 30_000_000, cash: 30_000_000 });
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
