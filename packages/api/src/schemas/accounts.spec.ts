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
