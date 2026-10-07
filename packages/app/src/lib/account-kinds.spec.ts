import { describe, expect, it } from "vitest";

import fr from "../locales/fr.json";
import { ACCOUNT_KINDS, kindOf } from "./account-kinds.ts";

describe("kindOf", () => {
	it("tells a loan's `other` from an investment's", () => {
		expect(kindOf("investment", "other")).toBe("other_investment");
		expect(kindOf("loan", "other")).toBe("other_loan");
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
	it("offers Sure's seven loans in Sure's order, with Sure's French where it has some", () => {
		const loans = ACCOUNT_KINDS.filter((kind) => kind.type === "loan");

		expect(loans.map((kind) => fr.accounts.subtypes[kind.id])).toEqual([
			"Hypothèque",
			"Prêt étudiant",
			"Prêt auto",
			"Prêt sur valeur domiciliaire",
			"Ligne de crédit",
			"Prêt professionnel",
			"Autre prêt",
		]);
	});
});
