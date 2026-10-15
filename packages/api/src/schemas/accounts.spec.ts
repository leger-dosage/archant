import { describe, expect, it } from "vitest";

import {
	accountSettingsFormSchema,
	createAccountFormSchema,
	createAccountSchema,
} from "./accounts.ts";

const loan = {
	name: "Prêt",
	type: "loan",
	subtype: "auto",
	currency: "EUR",
	openingBalance: "8 000",
	openingDate: "2026-09-01",
} as const;

const issuesOf = (result: { success: boolean; error?: { issues: unknown[] } }) =>
	result.error?.issues ?? [];

describe("the term bound of Sure's loan form", () => {
	it.each(["0", "1201"])(
		"refuses the term %j in the dialogs, and the API saves it",
		(termMonths) => {
			const input = { ...loan, details: { termMonths } };
			const settings = accountSettingsFormSchema(loan);

			expect(createAccountSchema.safeParse(input).success).toBe(true);
			expect(issuesOf(createAccountFormSchema.safeParse(input))).toMatchObject([
				{ path: ["details", "termMonths"], message: "invalid_term" },
			]);
			expect(
				issuesOf(
					settings.safeParse({
						name: "Prêt",
						subtype: "auto",
						excludedFromReports: false,
						details: { termMonths },
					}),
				),
			).toMatchObject([{ path: ["details", "termMonths"], message: "invalid_term" }]);
		},
	);

	it.each(["1", "1200"])("accepts the term %j in the dialogs", (termMonths) => {
		expect(
			createAccountFormSchema.safeParse({ ...loan, details: { termMonths, interestRate: "150" } })
				.success,
		).toBe(true);
	});
});

const property = { ...loan, name: "Maison", type: "property", subtype: "apartment" } as const;
const vehicle = { ...loan, name: "Voiture", type: "vehicle", subtype: null } as const;

describe("the bounds of Sure's property and vehicle forms", () => {
	const year = new Date().getFullYear();

	it("refuses a year built before 1500 or after this year and a negative area in the dialogs, and the API saves them", () => {
		const input = { ...property, details: { yearBuilt: "1200", areaValue: "-1" } };
		const settings = accountSettingsFormSchema(property);

		expect(createAccountSchema.safeParse(input).success).toBe(true);
		expect(issuesOf(createAccountFormSchema.safeParse(input))).toMatchObject([
			{ path: ["details", "yearBuilt"], message: "invalid_year" },
			{ path: ["details", "areaValue"], message: "invalid_area" },
		]);
		expect(
			issuesOf(
				settings.safeParse({
					name: "Maison",
					subtype: "apartment",
					excludedFromReports: false,
					details: { yearBuilt: String(year + 1) },
				}),
			),
		).toMatchObject([{ path: ["details", "yearBuilt"], message: "invalid_year" }]);
	});

	it("refuses a vehicle year before 1900 or after next year and a negative mileage in the dialogs", () => {
		const input = { ...vehicle, details: { year: String(year + 2), mileageValue: "-1" } };

		expect(createAccountSchema.safeParse(input).success).toBe(true);
		expect(issuesOf(createAccountFormSchema.safeParse(input))).toMatchObject([
			{ path: ["details", "year"], message: "invalid_year" },
			{ path: ["details", "mileageValue"], message: "invalid_mileage" },
		]);
		expect(
			issuesOf(createAccountFormSchema.safeParse({ ...vehicle, details: { year: "1899" } })),
		).toMatchObject([{ path: ["details", "year"], message: "invalid_year" }]);
	});

	it("accepts the bounds themselves in the dialogs", () => {
		expect(
			createAccountFormSchema.safeParse({
				...property,
				details: { yearBuilt: "1500", areaValue: "0" },
			}).success,
		).toBe(true);
		expect(
			createAccountFormSchema.safeParse({
				...property,
				details: { yearBuilt: String(year) },
			}).success,
		).toBe(true);
		expect(
			createAccountFormSchema.safeParse({
				...vehicle,
				details: { year: String(year + 1), mileageValue: "0" },
			}).success,
		).toBe(true);
		expect(
			createAccountFormSchema.safeParse({ ...vehicle, details: { year: "1900" } }).success,
		).toBe(true);
	});
});
