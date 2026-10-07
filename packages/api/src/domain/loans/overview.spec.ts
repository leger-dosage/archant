import { describe, expect, it } from "vitest";

import type { LoanDetails } from "@archant/data/account-types";
import { toMinorUnits } from "@archant/data/money";

import { amortizationSchedule } from "./amortization-schedule.ts";
import { insurance } from "./insurance.ts";
import {
	leverage,
	loanOverview,
	monthsElapsed,
	paymentBreakdown,
	repaidPercent,
} from "./overview.ts";

/** The owner's ING mortgage, as Story 24.2 records it. */
const ing: LoanDetails = {
	originalAmount: toMinorUnits(13_000_000),
	downPayment: toMinorUnits(0),
	startDate: "2020-12-05",
	termMonths: 300,
	rateType: "fixed",
	interestRate: 18_200,
	insuranceRate: 2_917,
	insuranceRateType: "level_term",
	rateChanges: [],
	endDate: null,
};

const overviewOf = (details: LoanDetails | null, asOf = "2026-10-04", balance = 10_510_482n) =>
	loanOverview({ details, balance, openingDate: "2026-09-01", asOf });

describe("monthsElapsed", () => {
	it("counts a month once it is served in full", () => {
		expect(monthsElapsed("2020-12-05", "2026-10-04", 300)).toBe(69);
		expect(monthsElapsed("2020-12-05", "2026-10-05", 300)).toBe(70);
	});

	it("is zero before origination and on its day", () => {
		expect(monthsElapsed("2020-12-05", "2020-11-30", 300)).toBe(0);
		expect(monthsElapsed("2020-12-05", "2020-12-05", 300)).toBe(0);
		expect(monthsElapsed("2020-12-05", "2020-12-31", 300)).toBe(0);
	});

	it("serves a month-end origination on the month's last day, as Ruby's `>>`", () => {
		expect(monthsElapsed("2026-01-31", "2026-02-27", 12)).toBe(0);
		expect(monthsElapsed("2026-01-31", "2026-02-28", 12)).toBe(1);
	});

	it("never runs past the term", () => {
		expect(monthsElapsed("2020-12-05", "2050-01-01", 300)).toBe(300);
	});
});

describe("leverage", () => {
	it("bands the amount over the down payment as Sure's inclusive LEVERAGE_BANDS", () => {
		expect(leverage(40_000_000n, 10_000_000n)).toEqual({ tenths: 40, band: "conservative" });
		expect(leverage(40_000_100n, 10_000_000n)).toEqual({ tenths: 40, band: "moderate" });
		expect(leverage(80_000_000n, 10_000_000n)).toEqual({ tenths: 80, band: "moderate" });
		expect(leverage(80_000_100n, 10_000_000n)).toEqual({ tenths: 80, band: "high" });
	});

	it("rounds the tenths half up", () => {
		expect(leverage(125n, 100n)).toEqual({ tenths: 13, band: "conservative" });
		expect(leverage(124n, 100n)).toEqual({ tenths: 12, band: "conservative" });
	});

	it("has none without a down payment or an amount borrowed above zero", () => {
		expect(leverage(40_000_000n, null)).toBeNull();
		expect(leverage(40_000_000n, 0n)).toBeNull();
		expect(leverage(null, 10_000_000n)).toBeNull();
		expect(leverage(-1n, 10_000_000n)).toBeNull();
		expect(leverage(0n, 10_000_000n)).toBeNull();
	});
});

describe("repaidPercent", () => {
	it("measures the balance against the amount borrowed, rounded half up", () => {
		expect(repaidPercent(13_000_000n, 10_510_482n)).toBe(19);
		expect(repaidPercent(200n, 101n)).toBe(50);
		expect(repaidPercent(200n, 99n)).toBe(51);
	});

	it("clamps a balance above the amount to 0, and reads a negative one as nothing owed", () => {
		expect(repaidPercent(13_000_000n, 14_000_000n)).toBe(0);
		expect(repaidPercent(13_000_000n, 0n)).toBe(100);
		expect(repaidPercent(13_000_000n, -1n)).toBe(100);
		expect(repaidPercent(13_000_000n, -3_250_000n)).toBe(100);
	});

	it("cannot be measured without an amount borrowed above zero", () => {
		expect(repaidPercent(null, 100n)).toBeNull();
		expect(repaidPercent(0n, 100n)).toBeNull();
	});
});

describe("paymentBreakdown", () => {
	const payment = { payment: 0n, principal: 0n, interest: 0n, endingBalance: 0n };

	it("gives zero shares for a zero instalment", () => {
		const schedule = {
			originationDate: "2026-01-01",
			payments: [{ ...payment, number: 1, date: "2026-02-01" }],
		};

		expect(paymentBreakdown(schedule, null, 1, "2026-01-15")).toEqual({
			number: 1,
			date: "2026-02-01",
			principal: 0n,
			interest: 0n,
			insurance: 0n,
			total: 0n,
			shares: { principal: 0, interest: 0, insurance: 0 },
		});
	});

	it("is on none once a schedule that rounding cleared early has run out", () => {
		const schedule = {
			originationDate: "2026-01-01",
			payments: [{ ...payment, principal: 100n, number: 1, date: "2026-02-01" }],
		};

		expect(paymentBreakdown(schedule, null, 3, "2026-02-01")).toBeNull();
		expect(paymentBreakdown(schedule, null, 3, "2026-01-31")).toMatchObject({ number: 1 });
	});
});

describe("loanOverview", () => {
	it("reads the owner's ING mortgage on 4 October 2026", () => {
		expect(overviewOf(ing)).toEqual({
			originalAmount: 13_000_000n,
			remainingBalance: 10_510_482n,
			interestRate: 18_200,
			monthlyPayment: 53_969n,
			termMonths: 300,
			rateType: "fixed",
			payoffDate: "2045-12-05",
			insured: true,
			totalCost: 17_138_696n,
			insurance: { total: 948_000n },
			leverage: null,
			repaidPercent: 19,
			instalment: {
				number: 70,
				date: "2026-10-05",
				principal: 38_028n,
				interest: 15_941n,
				insurance: 3_160n,
				total: 57_129n,
				shares: { principal: 67, interest: 28, insurance: 6 },
			},
		});
	});

	it("moves to the next instalment on its day", () => {
		expect(overviewOf(ing, "2026-10-05").instalment).toMatchObject({
			number: 71,
			date: "2026-11-05",
		});
	});

	it("is on the first instalment before origination", () => {
		expect(overviewOf(ing, "2020-11-01").instalment).toMatchObject({
			number: 1,
			date: "2021-01-05",
		});
	});

	it("is on no instalment once the loan is finished", () => {
		const finished = overviewOf(ing, "2046-01-01", 0n);

		expect(finished.instalment).toBeNull();
		expect(finished.repaidPercent).toBe(100);
	});

	it("starts at the opening date without a start date", () => {
		expect(overviewOf({ ...ing, startDate: null }).instalment).toMatchObject({
			number: 2,
			date: "2026-11-01",
		});
	});

	it("charges a decreasing instalment the premium of its own payment", () => {
		const decreasing: LoanDetails = { ...ing, insuranceRateType: "decreasing_life" };
		const schedule = amortizationSchedule({ ...decreasing, originationDate: "2020-12-05" });
		const policy =
			schedule === null ? null : insurance(schedule, { ...decreasing, principal: 13_000_000n });
		const [first] = policy?.premiums ?? [];
		const seventieth = policy?.premiums[69];

		const instalment = overviewOf(decreasing).instalment;

		expect(seventieth?.number).toBe(70);
		expect(instalment?.insurance).toBe(seventieth?.amount);
		expect(instalment?.total).toBe(
			(instalment?.principal ?? 0n) + (instalment?.interest ?? 0n) + (seventieth?.amount ?? 0n),
		);
		expect(instalment?.insurance).not.toBe(first?.amount);
	});

	it("leaves the premium out of an uninsured instalment", () => {
		const uninsured = overviewOf({ ...ing, insuranceRate: null, insuranceRateType: null });

		expect(uninsured).toMatchObject({
			insured: false,
			insurance: null,
			totalCost: 16_190_696n,
		});
		expect(uninsured.instalment).toMatchObject({
			insurance: 0n,
			total: 53_969n,
			shares: { principal: 70, interest: 30, insurance: 0 },
		});
		expect(overviewOf({ ...ing, insuranceRate: 0 })).toMatchObject({
			insured: false,
			insurance: null,
		});
	});

	describe("a variable loan", () => {
		const variable: LoanDetails = {
			...ing,
			rateType: "variable",
			rateChanges: [{ effectiveDate: "2023-06-05", rate: 30_000 }],
		};

		it("quotes the rate and the payment in force", () => {
			const overview = overviewOf(variable);
			const repriced = overviewOf(variable, "2026-10-05");

			expect(overview.interestRate).toBe(30_000);
			const instalment = overview.instalment;

			expect(instalment?.number).toBe(70);
			expect(overview.monthlyPayment).toBe(
				(instalment?.principal ?? 0n) + (instalment?.interest ?? 0n),
			);
			expect(overview.monthlyPayment).not.toBe(53_969n);
			expect(repriced.monthlyPayment).toBe(overview.monthlyPayment);
			expect(overviewOf(variable, "2023-06-04").interestRate).toBe(18_200);
		});

		it("answers N/A once its schedule has run out, and without one", () => {
			expect(overviewOf(variable, "2046-01-01").monthlyPayment).toBe("not_applicable");
			expect(overviewOf({ ...variable, originalAmount: null }).monthlyPayment).toBe(
				"not_applicable",
			);
			expect(overviewOf({ ...variable, rateType: "adjustable" }).monthlyPayment).not.toBe(
				"not_applicable",
			);
		});
	});

	it("reads a rate without a rate type as fixed, with no payment to quote", () => {
		expect(
			overviewOf({
				...ing,
				rateType: null,
				rateChanges: [{ effectiveDate: "2023-06-05", rate: 1 }],
			}),
		).toMatchObject({
			interestRate: 18_200,
			monthlyPayment: null,
			rateType: null,
			payoffDate: null,
		});
	});

	it("quotes no payment for a fixed loan without a schedule", () => {
		expect(overviewOf({ ...ing, originalAmount: null }).monthlyPayment).toBeNull();
	});

	it("names an insurance rate it has no schedule to apply to", () => {
		expect(overviewOf({ ...ing, originalAmount: null })).toMatchObject({
			originalAmount: null,
			insured: false,
			insurance: { rate: 2_917 },
			totalCost: null,
			payoffDate: null,
			repaidPercent: null,
			instalment: null,
			termMonths: 300,
		});
	});

	it("bands its leverage once a down payment is recorded", () => {
		expect(overviewOf({ ...ing, downPayment: toMinorUnits(3_250_000) }).leverage).toEqual({
			tenths: 40,
			band: "conservative",
		});
		expect(overviewOf({ ...ing, downPayment: null }).leverage).toBeNull();
	});

	it("knows no figure of a loan without details but its balance", () => {
		expect(overviewOf(null)).toEqual({
			originalAmount: null,
			remainingBalance: 10_510_482n,
			interestRate: null,
			monthlyPayment: null,
			termMonths: null,
			rateType: null,
			payoffDate: null,
			insured: false,
			totalCost: null,
			insurance: null,
			leverage: null,
			repaidPercent: null,
			instalment: null,
		});
		expect(overviewOf({ ...ing, interestRate: null }).interestRate).toBeNull();
	});
});
