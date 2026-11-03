import { describe, expect, it } from "vitest";

import { englishName, englishSample } from "./sample-data-english.ts";
import { SAMPLE_DATA_SEED, samplePlan } from "./sample-data-plan.ts";

const sample = samplePlan({ seed: SAMPLE_DATA_SEED, today: "2026-11-03", currency: "EUR" });
const english = englishSample(sample);

describe("englishSample", () => {
	it("keeps every row and every amount, and renames only", () => {
		expect(english.plan.transactions.map(({ label: _, ...row }) => row)).toEqual(
			sample.plan.transactions.map(({ label: _, ...row }) => row),
		);
		expect(english.goals.map((goal) => goal.targetAmount)).toEqual(
			sample.goals.map((goal) => goal.targetAmount),
		);
	});

	it("leaves no French accent or article in a name Archant wrote", () => {
		const names = [
			...english.plan.accounts.map((row) => row.name),
			...english.plan.categories.map((row) => row.name),
			...english.plan.transactions.map((row) => row.label),
			...english.goals.map((goal) => goal.name),
		];

		expect(names.filter((name) => /[À-ÿ]|\b(du|de|des|pour|et)\b/u.test(name))).toEqual([]);
	});

	it("keeps the year of an old line", () => {
		expect(englishName("Vieux restaurant (il y a 4 ans)")).toBe("Old restaurant (4 years ago)");
	});

	it("keeps a brand as it is", () => {
		expect(englishName("Netflix")).toBe("Netflix");
	});
});
