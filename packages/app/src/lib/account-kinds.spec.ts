import { describe, expect, it } from "vitest";

import fr from "../locales/fr.json";
import { ACCOUNT_KINDS, kindOf } from "./account-kinds.ts";

describe("kindOf", () => {
	it("tells a loan's `other` from an investment's", () => {
		expect(kindOf("investment", "other")).toBe("other_investment");
		expect(kindOf("loan", "other")).toBe("other_loan");
	});

	it("names a depository by its subtype, and one without as the type itself", () => {
		expect(kindOf("depository", "cash")).toBe("cash");
		expect(kindOf("depository", "money_market")).toBe("money_market");
		expect(kindOf("depository", null)).toBe("depository");
	});

	it("names an investment by its subtype", () => {
		expect(kindOf("investment", "pea")).toBe("pea");
	});

	it("names a property by its subtype, and a vehicle by its type", () => {
		expect(kindOf("property", "single_family_home")).toBe("single_family_home");
		expect(kindOf("vehicle", null)).toBe("vehicle");
	});
});

describe("ACCOUNT_KINDS", () => {
	it("offers the blank depository, then Sure's depository subtypes in Sure's order, without hsa", () => {
		const depositories = ACCOUNT_KINDS.filter((kind) => kind.type === "depository");

		expect(depositories.map((kind) => fr.accounts.subtypes[kind.id])).toEqual([
			"Liquidités",
			"Espèces",
			"Compte courant",
			"Épargne",
			"Certificat de dépôt",
			"Marché monétaire",
		]);
	});

	it("offers Sure's seven loans in Sure's order, named as a bank in France names them", () => {
		const loans = ACCOUNT_KINDS.filter((kind) => kind.type === "loan");

		expect(loans.map((kind) => fr.accounts.subtypes[kind.id])).toEqual([
			"Prêt immobilier",
			"Prêt étudiant",
			"Prêt auto",
			"Prêt hypothécaire",
			"Crédit renouvelable",
			"Prêt professionnel",
			"Autre prêt",
		]);
	});
});
