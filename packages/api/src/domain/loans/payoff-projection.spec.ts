import type { ScheduleTerms } from "./amortization-schedule.ts";
import type { RateTerms } from "./rate-resolver.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { amortizationSchedule } from "./amortization-schedule.ts";
import { payoffProjection } from "./payoff-projection.ts";
import { rateResolver } from "./rate-resolver.ts";

/** Terms with a schedule: every field it needs is recorded. */
type Terms = ScheduleTerms & RateTerms;

/** The owner's ING mortgage, as Story 24.2 records it. */
const ing: Terms = {
	originalAmount: toMinorUnits(13_000_000),
	termMonths: 300,
	rateType: "fixed",
	interestRate: 18_200,
	rateChanges: [],
	originationDate: "2020-12-05",
};

function projectionOf(terms: Terms, balance: bigint, asOf: string) {
	const schedule = amortizationSchedule(terms);

	if (schedule === null) {
		throw new Error("The terms have no schedule.");
	}

	return {
		schedule,
		projection: payoffProjection({ schedule, rates: rateResolver(terms), balance, asOf }),
	};
}

describe("payoffProjection", () => {
	it("ends on the contract's maturity for a balance on contract", () => {
		const { schedule, projection } = projectionOf(ing, 10_472_454n, "2026-10-06");

		expect(projection).toMatchObject({
			converged: true,
			payoffDate: "2045-12-05",
			monthsSaved: 0,
			interestSaved: 0n,
		});
		expect(projection?.payments).toHaveLength(230);
		// Payment 71 of the contract, which payment 70 left at 104 724,54 €.
		expect(projection?.payments[0]).toEqual({
			date: "2026-11-05",
			endingBalance: schedule.payments[70]?.endingBalance,
		});
	});

	it("finishes 25 months early and saves 3 906,00 € after 10 000,00 € repaid early", () => {
		const { projection } = projectionOf(ing, 9_472_454n, "2026-10-06");

		expect(projection).toMatchObject({
			converged: true,
			payoffDate: "2043-11-05",
			monthsSaved: 25,
			interestSaved: 390_600n,
		});
		expect(projection?.payments.at(-1)?.endingBalance).toBe(0n);
	});

	it("names what the contract's payments leave owed at maturity, with no payoff date", () => {
		const { projection } = projectionOf(ing, 10_572_454n, "2026-10-06");

		expect(projection).toMatchObject({ converged: false, balloon: 141_701n });
		expect(projection).not.toHaveProperty("payoffDate");
		expect(projection?.payments).toHaveLength(230);
		expect(projection?.payments.at(-1)?.date).toBe("2045-12-05");
	});

	it("never settles a balance a cent behind the contract", () => {
		expect(projectionOf(ing, 10_472_455n, "2026-10-06").projection).toMatchObject({
			converged: false,
			balloon: 1n,
		});
	});

	it("opens its first period at origination before the first payment", () => {
		const { schedule, projection } = projectionOf(ing, 13_000_000n, "2020-12-20");

		expect(projection).toMatchObject({ converged: true, monthsSaved: 0, interestSaved: 0n });
		expect(projection?.payments.map((payment) => payment.endingBalance)).toEqual(
			schedule.payments.map((payment) => payment.endingBalance),
		);
	});

	it("charges the period open on a rate change at the rate the schedule charges it", () => {
		const variable: Terms = {
			...ing,
			rateType: "variable",
			rateChanges: [{ effectiveDate: "2026-10-20", rate: 30_000 }],
		};
		const asOf = "2026-10-25";
		const { schedule, projection } = projectionOf(variable, 10_472_454n, asOf);
		const remaining = schedule.payments.filter((payment) => payment.date > asOf);

		expect(schedule.payments[69]?.endingBalance).toBe(10_472_454n);
		expect(projection).toMatchObject({ converged: true, monthsSaved: 0, interestSaved: 0n });
		expect(projection?.payments.map((payment) => payment.endingBalance)).toEqual(
			remaining.map((payment) => payment.endingBalance),
		);
	});

	it("has nothing to project when nothing is owed", () => {
		expect(projectionOf(ing, 0n, "2026-10-06").projection).toBeNull();
		expect(projectionOf(ing, -100n, "2026-10-06").projection).toBeNull();
	});

	it("has nothing to project once the last payment has fallen", () => {
		expect(projectionOf(ing, 10_000n, "2045-12-05").projection).toBeNull();
	});

	it("has nothing to project when the contract's payment rounds to zero", () => {
		const cent: Terms = {
			...ing,
			originalAmount: toMinorUnits(1),
			termMonths: 1_200,
			interestRate: 0,
		};

		expect(projectionOf(cent, 1n, "2020-12-06").projection).toBeNull();
	});
});
