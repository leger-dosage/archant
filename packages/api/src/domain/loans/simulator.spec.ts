import type { SimulatorInput } from "./simulator.ts";

import { describe, expect, it } from "vitest";

import { addMonths } from "../dates.ts";
import { periodInterest } from "./amortization-math.ts";
import { simulate } from "./simulator.ts";

// Sure's Loan::SimulatorTest, read at 14638a701. Amounts in cents, rates in
// millionths: Sure's 12_000 at 6 is 1_200_000 at 60_000.

const months = (from: string, count: number) =>
	Array.from({ length: count }, (_, index) => addMonths(from, index + 1));

/** Twelve monthly payments through 2026. */
const SCHEDULE = months("2026-01-01", 12);

const run = (overrides: Partial<SimulatorInput> & Pick<SimulatorInput, "accrualRateFor">) =>
	simulate({
		startingBalance: 1_200_000n,
		accrualStartDate: "2026-01-01",
		paymentSchedule: SCHEDULE,
		...overrides,
	});

const flat = (rate: number) => () => rate;

const principalOf = (result: ReturnType<typeof simulate>) =>
	result.payments.reduce((sum, row) => sum + row.principal, 0n);

const paymentOn = (result: ReturnType<typeof simulate>, date: string) => {
	const row = result.payments.find((payment) => payment.date === date);

	if (row === undefined) {
		throw new Error(`No payment on ${date}`);
	}

	return row;
};

describe("simulate with reamortize", () => {
	it("runs one payment per scheduled date and amortises to zero", () => {
		const result = run({ accrualRateFor: flat(60_000) });

		expect(result.payments).toHaveLength(12);
		expect(result.payments.at(-1)).toMatchObject({ date: "2027-01-01", endingBalance: 0n });
		expect(result).toMatchObject({ converged: true, balloonAmount: 0n });
		expect(principalOf(result)).toBe(1_200_000n);
		expect(result.totalInterest).toBe(result.payments.reduce((sum, row) => sum + row.interest, 0n));
	});

	it("settles the final period exactly, whatever the rounding", () => {
		for (const [balance, rate] of [
			[1_200_000n, 60_000],
			[1_000n, 0],
			[99_999_900n, 172_500],
			[100n, 35_000],
		] as const) {
			const result = run({ startingBalance: balance, accrualRateFor: flat(rate) });

			expect(result.payments.at(-1)?.endingBalance, `${balance} at ${rate}`).toBe(0n);
			expect(principalOf(result), `${balance} at ${rate}`).toBe(balance);
		}
	});

	it("settles principal and interest together on a one-period loan", () => {
		const result = run({
			startingBalance: 100_000n,
			paymentSchedule: ["2026-02-01"],
			accrualRateFor: flat(120_000),
		});

		expect(result.payments).toEqual([
			expect.objectContaining({ payment: 101_000n, endingBalance: 0n }),
		]);
	});

	it("keeps a 360-period zero-rate loan outstanding until its final payment", () => {
		const result = run({
			startingBalance: 36_000_000n,
			paymentSchedule: months("2026-01-01", 360),
			accrualRateFor: flat(0),
		});

		expect(result.payments[179]?.endingBalance).toBe(18_000_000n);
		expect(result.payments).toHaveLength(360);
		expect(result.payments.at(-1)?.endingBalance).toBe(0n);
	});

	it("charges a period at the rate in force when it opened, not when it closed", () => {
		const result = run({ accrualRateFor: (date) => (date < "2026-04-01" ? 60_000 : 240_000) });

		// The period closing on the change, 1 March to 1 April, ran at 6 %.
		const closing = paymentOn(result, "2026-04-01");
		expect(closing.interest).toBe(periodInterest(closing.beginningBalance, 60_000));
		expect(closing.interestRate).toBe(60_000);
		// The one opening on it is charged at 24 %.
		const following = paymentOn(result, "2026-05-01");
		expect(following.interest).toBe(periodInterest(following.beginningBalance, 240_000));
	});

	it("re-sizes the payment when the rate moves", () => {
		const result = run({ accrualRateFor: (date) => (date < "2026-04-01" ? 60_000 : 240_000) });

		expect(paymentOn(result, "2026-04-01").payment).toBeGreaterThan(
			result.payments[0]?.payment ?? 0n,
		);
		expect(paymentOn(result, "2026-03-01").payment).toBe(result.payments[0]?.payment);
	});

	it("sizes the payment from a re-amortisation event's own date", () => {
		const result = run({
			accrualRateFor: flat(60_000),
			reAmortisationEvents: () => [{ date: "2026-07-01", rate: 240_000 }],
		});

		const before = paymentOn(result, "2026-06-01");
		const on = paymentOn(result, "2026-07-01");
		expect(on.payment).toBeGreaterThan(before.payment);
		expect(on).toMatchObject({ sizingRate: 240_000, interestRate: 60_000 });
		expect(on.interest).toBe(periodInterest(on.beginningBalance, 60_000));
		expect(before.interestRate).toBe(60_000);
		// The accrual curve stays flat; only the sizing moves.
		expect(paymentOn(result, "2026-08-01")).toMatchObject({
			interestRate: 60_000,
			sizingRate: 240_000,
		});
	});

	it("asks for the events within its first and last payment, and sorts them", () => {
		const asked: [string, string][] = [];
		const result = run({
			accrualRateFor: flat(60_000),
			reAmortisationEvents: (from, to) => {
				asked.push([from, to]);

				return [
					{ date: "2026-10-01", rate: 90_000 },
					{ date: "2026-07-01", rate: 240_000 },
				];
			},
		});

		expect(asked).toEqual([["2026-02-01", "2027-01-01"]]);
		expect(paymentOn(result, "2026-09-01").sizingRate).toBe(240_000);
		expect(paymentOn(result, "2026-10-01").sizingRate).toBe(90_000);
	});

	// Codex's example on we-promise/sure#3473: 500 000 over 24 months, 6 % to
	// 18 % at month six.
	it("keeps a re-sized payment level through the final settlement", () => {
		for (const effective of ["2026-07-01", "2026-06-20"]) {
			const result = simulate({
				startingBalance: 50_000_000n,
				accrualStartDate: "2026-01-01",
				paymentSchedule: months("2026-01-01", 24),
				accrualRateFor: (date) => (date < effective ? 60_000 : 180_000),
				reAmortisationEvents: () => [{ date: effective, rate: 180_000 }],
			});

			const resized = result.payments.find((row) => row.date >= effective)?.payment ?? 0n;
			const last = result.payments.at(-1)?.payment ?? 0n;
			expect(resized, effective).toBeGreaterThan(result.payments[0]?.payment ?? 0n);
			expect(resized - last <= 100n && last - resized <= 100n, effective).toBe(true);
			expect(principalOf(result), effective).toBe(50_000_000n);
		}
	});

	it("walks nothing for a balance already cleared", () => {
		expect(run({ startingBalance: 0n, accrualRateFor: flat(60_000) })).toEqual({
			payments: [],
			converged: true,
			balloonAmount: 0n,
			totalInterest: 0n,
		});
	});

	it("refuses an empty payment schedule rather than inventing a run", () => {
		expect(() => run({ paymentSchedule: [], accrualRateFor: flat(50_000) })).toThrow(
			/must not be empty/u,
		);
	});

	it("refuses a schedule longer than it will walk rather than truncating it", () => {
		expect(() =>
			run({ paymentSchedule: months("2026-01-01", 1_201), accrualRateFor: flat(50_000) }),
		).toThrow(/has 1201 periods \(2026-02-01 to 2126-02-01\), more than the 1200 allowed/u);
		expect(
			run({ paymentSchedule: months("2026-01-01", 1_200), accrualRateFor: flat(50_000) }).payments,
		).toHaveLength(1_200);
	});
});

describe("simulate with scheduled", () => {
	it("asks the callable every period and keeps its answer whatever the balance", () => {
		const asked: [number, bigint][] = [];
		const result = run({
			accrualRateFor: flat(60_000),
			strategy: {
				kind: "scheduled",
				payment: ({ index, balance }) => {
					asked.push([index, balance]);

					return 200_000n;
				},
			},
			settleAtScheduleEnd: false,
		});

		expect(result.payments.length).toBeLessThan(SCHEDULE.length);
		expect(result.converged).toBe(true);
		expect(asked.map(([index]) => index)).toEqual(result.payments.map((_, index) => index));
		expect(asked[1]?.[1]).toBe(result.payments[0]?.endingBalance);
		for (const row of result.payments.slice(0, -1)) {
			expect(row.payment).toBe(200_000n);
		}
	});

	it("tells the callable the sizing rate and the periods left", () => {
		const asked: [number, number][] = [];
		run({
			paymentSchedule: SCHEDULE.slice(0, 2),
			accrualRateFor: flat(60_000),
			reAmortisationEvents: () => [{ date: "2026-03-01", rate: 90_000 }],
			strategy: {
				kind: "scheduled",
				payment: ({ sizingRate, remainingPayments }) => {
					asked.push([sizingRate, remainingPayments]);

					return 1_000n;
				},
			},
		});

		expect(asked).toEqual([
			[60_000, 2],
			[90_000, 1],
		]);
	});

	it("leaves a balloon when the payment does not clear the balance", () => {
		const result = run({
			accrualRateFor: flat(60_000),
			strategy: { kind: "scheduled", payment: () => 10_000n },
			settleAtScheduleEnd: false,
		});

		expect(result.payments).toHaveLength(12);
		expect(result.converged).toBe(false);
		expect(result.balloonAmount).toBe(result.payments.at(-1)?.endingBalance);
		expect(result.balloonAmount).toBeGreaterThan(0n);
	});

	it("settles at the schedule's end unless told otherwise", () => {
		const result = run({
			accrualRateFor: flat(60_000),
			strategy: { kind: "scheduled", payment: () => 10_000n },
		});

		expect(result).toMatchObject({ converged: true, balloonAmount: 0n });
		expect(result.payments.at(-1)?.payment).toBeGreaterThan(10_000n);
	});
});
