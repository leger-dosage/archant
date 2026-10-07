import { describe, expect, it } from "vitest";

import { levelPayment, periodInterest, roundHalfUp, step } from "./amortization-math.ts";

describe("roundHalfUp", () => {
	it("rounds a half away from zero, as BigDecimal#round", () => {
		expect(roundHalfUp(5n, 2n)).toBe(3n);
		expect(roundHalfUp(-5n, 2n)).toBe(-3n);
		expect(roundHalfUp(7n, 2n)).toBe(4n);
		expect(roundHalfUp(14n, 10n)).toBe(1n);
		expect(roundHalfUp(-14n, 10n)).toBe(-1n);
		expect(roundHalfUp(0n, 3n)).toBe(0n);
	});
});

describe("periodInterest", () => {
	it("charges a twelfth of the annual rate, rounded to the minor unit", () => {
		// ING: 130 000,00 € at 1,82 %.
		expect(periodInterest(13_000_000n, 18_200)).toBe(19_717n);
		// 600 000 cents at 6 %: exactly 3 000,00.
		expect(periodInterest(60_000_000n, 60_000)).toBe(300_000n);
	});
});

describe("levelPayment", () => {
	it("is the annuity a lender quotes", () => {
		expect(levelPayment({ balance: 13_000_000n, rate: 18_200, remainingPayments: 300 })).toBe(
			53_969n,
		);
		// Sure's AmortizationScheduleTest: 500 000 at 3,5 % over 360 months.
		expect(levelPayment({ balance: 50_000_000n, rate: 35_000, remainingPayments: 360 })).toBe(
			224_522n,
		);
	});

	it("divides the balance by the periods left at a zero rate", () => {
		expect(levelPayment({ balance: 10_000_000n, rate: 0, remainingPayments: 10 })).toBe(1_000_000n);
	});

	it("is zero with no period left or nothing owed", () => {
		expect(levelPayment({ balance: 1_000n, rate: 60_000, remainingPayments: 0 })).toBe(0n);
		expect(levelPayment({ balance: 0n, rate: 60_000, remainingPayments: 12 })).toBe(0n);
		expect(levelPayment({ balance: -10n, rate: 60_000, remainingPayments: 12 })).toBe(0n);
	});

	it("agrees with the plain annuity when the first period accrued at the same rate", () => {
		const balance = 1_200_000n;
		const plain = levelPayment({ balance, rate: 60_000, remainingPayments: 12 });

		expect(
			levelPayment({
				balance,
				rate: 60_000,
				remainingPayments: 12,
				firstPeriodInterest: periodInterest(balance, 60_000),
			}),
		).toBe(plain);
	});

	it("covers a first period that accrued at another rate, level after it", () => {
		// 1 000,00 at 18 % over two periods, the first having charged 5,00 at 6 %:
		// x + x / 1,015 = 1 005,00, so x = 1 005 × 1,015 / 2,015 = 506,24.
		expect(
			levelPayment({
				balance: 100_000n,
				rate: 180_000,
				remainingPayments: 2,
				firstPeriodInterest: 500n,
			}),
		).toBe(50_624n);
	});

	it("settles a last period with its own interest, and spreads a zero rate evenly", () => {
		expect(
			levelPayment({
				balance: 100_000n,
				rate: 180_000,
				remainingPayments: 1,
				firstPeriodInterest: 500n,
			}),
		).toBe(100_500n);
		expect(
			levelPayment({ balance: 100_000n, rate: 0, remainingPayments: 4, firstPeriodInterest: 400n }),
		).toBe(25_100n);
	});
});

describe("step", () => {
	it("charges the interest and repays the rest of the payment", () => {
		expect(step({ balance: 13_000_000n, payment: 53_969n, rate: 18_200, final: false })).toEqual({
			payment: 53_969n,
			principal: 34_252n,
			interest: 19_717n,
			beginningBalance: 13_000_000n,
			endingBalance: 12_965_748n,
		});
	});

	it("takes the interest already charged", () => {
		expect(
			step({ balance: 100_000n, payment: 10_000n, rate: 180_000, final: false, interest: 500n }),
		).toMatchObject({ principal: 9_500n, interest: 500n, endingBalance: 90_500n });
	});

	it("settles the balance on the final payment and re-derives the payment", () => {
		expect(step({ balance: 53_884n, payment: 53_969n, rate: 18_200, final: true })).toEqual({
			payment: 53_966n,
			principal: 53_884n,
			interest: 82n,
			beginningBalance: 53_884n,
			endingBalance: 0n,
		});
	});

	it("never leaves a negative balance", () => {
		expect(step({ balance: 1_000n, payment: 5_000n, rate: 0, final: false }).endingBalance).toBe(
			0n,
		);
	});
});
