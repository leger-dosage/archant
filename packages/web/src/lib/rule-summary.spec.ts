import type { SummaryCondition, SummaryNames } from "./rule-summary.ts";

import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

import fr from "../locales/fr.json";
import { operatorKey, ruleSummary } from "./rule-summary.ts";

const i18n = createInstance();

beforeAll(async () => {
	await i18n.init({
		lng: "fr",
		resources: { fr: { translation: fr } },
		interpolation: { escapeValue: false },
	});
});

const names: SummaryNames = {
	accounts: new Map([["a1", "Compte joint"]]),
	categories: new Map([["c1", "Courses"]]),
	reportingCurrency: "EUR",
};

const leaf = (
	conditionType: SummaryCondition["conditionType"],
	operator: SummaryCondition["operator"],
	value: string,
): SummaryCondition => ({ conditionType, operator, value, conditions: [] });

const summary = (conditions: SummaryCondition[], category = "c1") =>
	ruleSummary({ conditions, actions: [{ value: category }] }, names, i18n.t);

describe("ruleSummary", () => {
	it("names the first condition and the action", () => {
		expect(summary([leaf("transaction_name", "like", "CARREFOUR")])).toBe(
			"Si Libellé contient CARREFOUR, alors Catégorie Courses",
		);
	});

	it("formats an amount in the reporting currency and names an account", () => {
		expect(summary([leaf("transaction_amount", ">", "5000")])).toBe(
			"Si Montant > 50,00 €, alors Catégorie Courses",
		);
		expect(summary([leaf("transaction_amount", "!=", "5000")])).toBe(
			"Si Montant ≠ 50,00\u00a0€, alors Catégorie Courses",
		);
		expect(summary([leaf("transaction_account", "=", "a1")])).toBe(
			"Si Compte est Compte joint, alors Catégorie Courses",
		);
	});

	it("reads « Toutes les opérations » without a condition", () => {
		expect(summary([])).toBe("Toutes les opérations, alors Catégorie Courses");
	});

	it("counts the other top-level conditions", () => {
		const label = leaf("transaction_name", "=", "Loyer");

		expect(summary([label, label])).toBe(
			"Si Libellé est égal à Loyer, alors Catégorie Courses, et 1 autre condition",
		);
		expect(summary([label, label, label])).toBe(
			"Si Libellé est égal à Loyer, alors Catégorie Courses, et 2 autres conditions",
		);
	});

	it("names the first condition of a group the rule starts with", () => {
		const group: SummaryCondition = {
			conditionType: "compound",
			operator: "or",
			value: null,
			conditions: [leaf("transaction_name", "like", "boulangerie")],
		};

		expect(summary([group])).toBe("Si Libellé contient boulangerie, alors Catégorie Courses");
		expect(summary([{ ...group, conditions: [] }])).toBe(
			"Toutes les opérations, alors Catégorie Courses",
		);
	});

	it("says so when the account or the category was deleted", () => {
		expect(summary([leaf("transaction_account", "=", "gone")], "gone")).toBe(
			"Si Compte est Compte supprimé, alors Catégorie supprimée",
		);
		expect(ruleSummary({ conditions: [], actions: [] }, names, i18n.t)).toBe(
			"Toutes les opérations, alors Catégorie supprimée",
		);
	});
});

describe("operatorKey", () => {
	it("reads each operator in its type's words, and refuses one of another type", () => {
		expect(operatorKey("transaction_name", "=")).toBe("rules.operators.equals");
		expect(operatorKey("transaction_amount", "!=")).toBe("rules.operators.ne");
		expect(operatorKey("transaction_account", "!=")).toBeNull();
		expect(operatorKey("compound", "or")).toBe("rules.operators.any");
	});
});
