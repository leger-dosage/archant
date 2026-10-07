import type { ScheduleTerms } from "./amortization-schedule.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { amortizationSchedule } from "./amortization-schedule.ts";
import { insurance } from "./insurance.ts";

function scheduleOf(terms: ScheduleTerms) {
	const schedule = amortizationSchedule(terms);

	if (schedule === null) {
		throw new Error("Expected a schedule");
	}

	return schedule;
}

const ing = scheduleOf({
	originalAmount: toMinorUnits(13_000_000),
	termMonths: 300,
	rateType: "fixed",
	interestRate: 18_200,
	rateChanges: [],
	originationDate: "2020-12-05",
});

// Sure's LoanInsuranceTest: 12 000 over 12 months at 0 % repays 1 000 a
// month, and 1,2 % a year is 0,1 % a month.
const round = scheduleOf({
	originalAmount: toMinorUnits(1_200_000),
	termMonths: 12,
	rateType: "fixed",
	interestRate: 0,
	rateChanges: [],
	originationDate: "2026-01-01",
});

describe("insurance", () => {
	it("charges a level premium on the amount borrowed every month: ING's 31,60 €", () => {
		const policy = insurance(ing, {
			insuranceRate: 2_917,
			insuranceRateType: "level_term",
			principal: 13_000_000n,
		});

		expect(policy?.premiums).toHaveLength(300);
		expect(policy?.premiums.every((premium) => premium.amount === 3_160n)).toBe(true);
		expect(policy?.premiums[69]).toEqual({ number: 70, date: "2026-10-05", amount: 3_160n });
		expect(policy?.total).toBe(948_000n);
	});

	it("charges a decreasing premium on the balance owed when the period opened", () => {
		const policy = insurance(round, {
			insuranceRate: 12_000,
			insuranceRateType: "decreasing_life",
			principal: 1_200_000n,
		});

		expect(policy?.premiums.map((premium) => premium.amount)).toEqual(
			Array.from({ length: 12 }, (_, index) => BigInt(1_200 - index * 100)),
		);
		expect(policy?.total).toBe(7_800n);
	});

	it("rounds each decreasing premium of the ING schedule to the cent", () => {
		const policy = insurance(ing, {
			insuranceRate: 2_917,
			insuranceRateType: "decreasing_life",
			principal: 13_000_000n,
		});
		const opening = [13_000_000n, ...ing.payments.map((payment) => payment.endingBalance)];

		expect(policy?.premiums.map((premium) => premium.amount)).toEqual(
			ing.payments.map((_, index) => {
				const exact = (opening[index] ?? 0n) * 2_917n;

				return (exact * 2n + 12_000_000n) / 24_000_000n;
			}),
		);
	});

	it("reads a premium with no type as decreasing", () => {
		expect(
			insurance(round, { insuranceRate: 12_000, insuranceRateType: null, principal: 1_200_000n })
				?.total,
		).toBe(7_800n);
	});

	it("has no premium without a rate above zero", () => {
		expect(
			insurance(round, { insuranceRate: null, insuranceRateType: "level_term", principal: 1n }),
		).toBeNull();
		expect(
			insurance(round, { insuranceRate: 0, insuranceRateType: "level_term", principal: 1n }),
		).toBeNull();
	});
});
