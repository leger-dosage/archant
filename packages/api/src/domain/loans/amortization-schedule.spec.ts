import type { AmortizationSchedule, ScheduleTerms } from "./amortization-schedule.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { levelPayment } from "./amortization-math.ts";
import { amortizationSchedule } from "./amortization-schedule.ts";

/** The owner's ING mortgage: 130 000,00 € at 1,82 % over 300 months from 5 December 2020. */
const ing: ScheduleTerms = {
	originalAmount: toMinorUnits(13_000_000),
	termMonths: 300,
	rateType: "fixed",
	interestRate: 18_200,
	rateChanges: [],
	originationDate: "2020-12-05",
};

/** Sure's VariableRateScheduleTest loan: 500 000,00 at 6 % over 24 months from 1 January 2026. */
const variable: ScheduleTerms = {
	originalAmount: toMinorUnits(50_000_000),
	termMonths: 24,
	rateType: "variable",
	interestRate: 60_000,
	rateChanges: [],
	originationDate: "2026-01-01",
};

function scheduleOf(terms: ScheduleTerms): AmortizationSchedule {
	const schedule = amortizationSchedule(terms);

	if (schedule === null) {
		throw new Error("Expected a schedule");
	}

	return schedule;
}

function payment(schedule: AmortizationSchedule, number: number) {
	const row = schedule.payments[number - 1];

	if (row === undefined) {
		throw new Error(`No payment ${number}`);
	}

	return row;
}

describe("amortizationSchedule", () => {
	it("reproduces the owner's ING table", () => {
		const schedule = scheduleOf(ing);

		expect(schedule).toMatchObject({
			originationDate: "2020-12-05",
			reAmortising: false,
			periodicPayment: 53_969n,
			totalInterest: 3_190_696n,
			totalPaid: 16_190_696n,
		});
		expect(schedule.payments).toHaveLength(300);
		expect(payment(schedule, 1)).toMatchObject({ number: 1, date: "2021-01-05" });
		expect(payment(schedule, 69)).toMatchObject({ date: "2026-09-05", endingBalance: 10_510_482n });
		expect(payment(schedule, 70)).toEqual({
			number: 70,
			date: "2026-10-05",
			payment: 53_969n,
			principal: 38_028n,
			interest: 15_941n,
			endingBalance: 10_472_454n,
		});
		expect(payment(schedule, 300)).toMatchObject({
			date: "2045-12-05",
			payment: 53_965n,
			endingBalance: 0n,
		});
		expect(schedule.payments.reduce((sum, row) => sum + row.principal, 0n)).toBe(13_000_000n);
	});

	it("matches Sure's 500 000 at 3,5 % over 360 months", () => {
		const schedule = scheduleOf({
			...ing,
			originalAmount: toMinorUnits(50_000_000),
			interestRate: 35_000,
			termMonths: 360,
		});

		expect(schedule.periodicPayment).toBe(224_522n);
		expect(payment(schedule, 1)).toMatchObject({ interest: 145_833n, principal: 78_689n });
		expect(schedule.totalInterest).toBe(30_828_136n);
	});

	it("steps payment dates monthly from origination, clamped to the month's end", () => {
		const schedule = scheduleOf({ ...ing, originationDate: "2026-01-31", termMonths: 12 });

		expect(schedule.payments.slice(0, 2).map((row) => row.date)).toEqual([
			"2026-02-28",
			"2026-03-31",
		]);
	});

	it("repays a zero-rate loan in equal parts, without interest", () => {
		const schedule = scheduleOf({
			...ing,
			originalAmount: toMinorUnits(100_000),
			interestRate: 0,
			termMonths: 10,
		});

		expect(schedule.payments.map((row) => row.payment)).toEqual(Array(10).fill(10_000n));
		expect(schedule.payments.every((row) => row.interest === 0n)).toBe(true);
		expect(schedule.totalInterest).toBe(0n);
	});

	it("keeps the periods it walked when rounding clears the balance early", () => {
		const schedule = scheduleOf({
			...ing,
			originalAmount: toMinorUnits(1_000),
			interestRate: 0,
			termMonths: 51,
		});

		expect(schedule.payments).toHaveLength(50);
		expect(schedule.payments.at(-1)?.endingBalance).toBe(0n);
		expect(schedule.totalPaid).toBe(1_000n);
	});

	it("covers a period that straddles a rate change, then stays level to maturity", () => {
		const schedule = scheduleOf({
			...variable,
			rateChanges: [{ effectiveDate: "2026-06-20", rate: 180_000 }],
		});

		// The payment of 1 July closes a period opened on 1 June at 6 % and is
		// sized at 18 %, with that period's interest.
		const straddling = payment(schedule, 6);
		const before = payment(schedule, 5);
		expect(straddling.date).toBe("2026-07-01");
		expect(straddling.interest).toBe(
			(before.endingBalance * 60_000n * 2n + 12_000_000n) / (12_000_000n * 2n),
		);
		expect(straddling.payment).toBe(
			levelPayment({
				balance: before.endingBalance,
				rate: 180_000,
				remainingPayments: 19,
				firstPeriodInterest: straddling.interest,
			}),
		);
		expect(straddling.payment).toBeGreaterThan(schedule.periodicPayment);
		const last = payment(schedule, 24).payment;
		expect(last - straddling.payment <= 100n && straddling.payment - last <= 100n).toBe(true);
		expect(schedule.reAmortising).toBe(true);
	});

	it("sizes the first payment at a change effective on it, without re-amortising", () => {
		const base = scheduleOf(variable);
		const changed = scheduleOf({
			...variable,
			rateChanges: [{ effectiveDate: "2026-02-01", rate: 180_000 }],
		});

		expect(changed.periodicPayment).toBe(payment(changed, 1).payment);
		expect(changed.periodicPayment).toBeGreaterThan(base.periodicPayment);
		expect(changed.reAmortising).toBe(false);
	});

	it("does not re-amortise for a change to the same rate, and does for another", () => {
		const same = scheduleOf({
			...variable,
			rateChanges: [{ effectiveDate: "2026-07-01", rate: 60_000 }],
		});
		const moved = scheduleOf({
			...variable,
			rateChanges: [{ effectiveDate: "2026-07-01", rate: 70_000 }],
		});

		expect(same.reAmortising).toBe(false);
		expect(same.totalInterest).toBe(scheduleOf(variable).totalInterest);
		expect(moved.reAmortising).toBe(true);
	});

	it("ignores the changes a fixed loan keeps", () => {
		const fixed = scheduleOf({
			...variable,
			rateType: "fixed",
			rateChanges: [{ effectiveDate: "2026-04-01", rate: 180_000 }],
		});

		expect(fixed.reAmortising).toBe(false);
		expect(fixed.totalInterest).toBe(scheduleOf({ ...variable, rateType: "fixed" }).totalInterest);
	});

	it("charges a rate spike confined to one month", () => {
		const spiked = scheduleOf({
			...variable,
			rateChanges: [
				{ effectiveDate: "2026-04-01", rate: 180_000 },
				{ effectiveDate: "2026-05-01", rate: 60_000 },
			],
		});

		expect(spiked.totalInterest).toBeGreaterThan(scheduleOf(variable).totalInterest);
	});

	it("is null for a loan that cannot be amortised", () => {
		for (const terms of [
			{ originalAmount: null },
			{ originalAmount: toMinorUnits(0) },
			{ originalAmount: toMinorUnits(-100) },
			{ termMonths: null },
			{ termMonths: 0 },
			{ termMonths: 1_201 },
			{ rateType: null },
			{ interestRate: null },
			{ originationDate: null },
		] satisfies Partial<ScheduleTerms>[]) {
			expect(amortizationSchedule({ ...ing, ...terms }), JSON.stringify(terms)).toBeNull();
		}
		expect(scheduleOf({ ...ing, termMonths: 1_200 }).payments).toHaveLength(1_200);
	});
});
