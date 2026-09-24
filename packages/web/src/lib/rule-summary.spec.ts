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
	accounts: new Map([
		["a1", "Compte joint"],
		["a2", "Livret A"],
	]),
	categories: new Map([["c1", "Courses"]]),
	merchants: new Map([["m1", "Amazon"]]),
	tags: new Map([["t1", "Achats"]]),
	reportingCurrency: "EUR",
};

const leaf = (
	conditionType: SummaryCondition["conditionType"],
	operator: SummaryCondition["operator"],
	value: string,
): SummaryCondition => ({ conditionType, operator, value, conditions: [] });

const summary = (conditions: SummaryCondition[], category = "c1") =>
	ruleSummary(
		{ conditions, actions: [{ actionType: "set_transaction_category", value: category }] },
		names,
		i18n.t,
	);

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

describe("ruleSummary with Story 8.2's conditions and actions", () => {
	it("names a merchant, a category, a tag, notes and a type", () => {
		expect(summary([leaf("transaction_merchant", "=", "m1")])).toBe(
			"Si Marchand est Amazon, alors Catégorie Courses",
		);
		expect(summary([leaf("transaction_category", "=", "c1")])).toBe(
			"Si Catégorie est Courses, alors Catégorie Courses",
		);
		expect(summary([leaf("transaction_tag", "=", "t1")])).toBe(
			"Si Étiquette est Achats, alors Catégorie Courses",
		);
		expect(summary([leaf("transaction_notes", "like", "cadeau")])).toBe(
			"Si Notes contient cadeau, alors Catégorie Courses",
		);
		expect(summary([leaf("transaction_type", "=", "expense")])).toBe(
			"Si Type est Dépense, alors Catégorie Courses",
		);
		expect(summary([leaf("transaction_type", "=", "refund")])).toBe(
			"Si Type est refund, alors Catégorie Courses",
		);
	});

	it("reads « est vide » without a value", () => {
		expect(
			summary([
				{ conditionType: "transaction_tag", operator: "is_null", value: null, conditions: [] },
			]),
		).toBe("Si Étiquette est vide, alors Catégorie Courses");
	});

	it("names the first action, then counts the others", () => {
		const label = leaf("transaction_name", "like", "amzn");

		expect(
			ruleSummary(
				{
					conditions: [label],
					actions: [
						{ actionType: "set_transaction_merchant", value: "m1" },
						{ actionType: "set_transaction_tags", value: "t1" },
						{ actionType: "set_transaction_name", value: "Amazon" },
						{ actionType: "exclude_transaction", value: null },
					],
				},
				names,
				i18n.t,
			),
		).toBe("Si Libellé contient amzn, alors Marchand Amazon, et 3 autres actions");
		expect(
			ruleSummary(
				{
					conditions: [label, label],
					actions: [
						{ actionType: "exclude_transaction", value: null },
						{ actionType: "set_transaction_name", value: "Amazon" },
					],
				},
				names,
				i18n.t,
			),
		).toBe("Si Libellé contient amzn, alors Exclure, et 1 autre action, et 1 autre condition");
	});

	it.each([
		["set_transaction_tags", "t1", "Ajouter l'étiquette Achats"],
		["set_transaction_name", "Amazon", "Renommer en « Amazon »"],
		["exclude_transaction", null, "Exclure"],
		["set_as_transfer_or_payment", "a2", "Virement avec Livret A"],
		["set_transaction_merchant", "gone", "Marchand supprimé"],
		["set_transaction_tags", "gone", "Étiquette supprimée"],
		["set_as_transfer_or_payment", "gone", "Compte supprimé"],
	] as const)("reads %s %s as « %s »", (actionType, value, text) => {
		expect(ruleSummary({ conditions: [], actions: [{ actionType, value }] }, names, i18n.t)).toBe(
			`Toutes les opérations, alors ${text}`,
		);
	});

	it("says so when a merchant, a category or a tag of a condition was deleted", () => {
		expect(summary([leaf("transaction_merchant", "=", "gone")])).toBe(
			"Si Marchand est Marchand supprimé, alors Catégorie Courses",
		);
		expect(summary([leaf("transaction_category", "=", "gone")])).toBe(
			"Si Catégorie est Catégorie supprimée, alors Catégorie Courses",
		);
		expect(summary([leaf("transaction_tag", "=", "gone")])).toBe(
			"Si Étiquette est Étiquette supprimée, alors Catégorie Courses",
		);
	});
});

describe("operatorKey", () => {
	it("reads each operator in its type's words, and refuses one of another type", () => {
		expect(operatorKey("transaction_name", "=")).toBe("rules.operators.equals");
		expect(operatorKey("transaction_amount", "!=")).toBe("rules.operators.ne");
		expect(operatorKey("transaction_account", "!=")).toBeNull();
		expect(operatorKey("compound", "or")).toBe("rules.operators.any");
		expect(operatorKey("transaction_notes", "is_null")).toBe("rules.operators.isNull");
		expect(operatorKey("transaction_name", "is_null")).toBeNull();
	});
});
