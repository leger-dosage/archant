import { describe, expect, it } from "vitest";

import fr from "../locales/fr.json";
import { ACCOUNT_KINDS, INVESTMENT_REGIONS, kindOf } from "./account-kinds.ts";

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

	it("names an investment by its subtype, and one without as the type itself", () => {
		expect(kindOf("investment", "pea")).toBe("pea");
		expect(kindOf("investment", "pillar_3a")).toBe("pillar_3a");
		expect(kindOf("investment", null)).toBe("investment");
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

	it("offers the blank investment, then Sure's European, generic and brokerage subtypes, each named by Sure's short label", () => {
		const investments = ACCOUNT_KINDS.filter((kind) => kind.type === "investment");

		expect(investments.map((kind) => fr.accounts.subtypes[kind.id])).toEqual([
			"Investissement",
			"Assurance-vie",
			"PEA",
			"Pilier 3a",
			"Riester",
			"Retraite",
			"Retraite",
			"Fonds commun",
			"Or",
			"Business angel",
			"Fiducie",
			"Autre",
			"Compte-titres",
		]);
	});
});

describe("INVESTMENT_REGIONS", () => {
	it("groups the investment subtypes as Sure's select for EUR, by Sure's region names and long labels", () => {
		expect(
			INVESTMENT_REGIONS.map((region) => ({
				region: fr.accounts.subtypeRegions[region.id],
				kinds: region.kinds.map((kind) => fr.accounts.subtypeLongs[kind]),
			})),
		).toEqual([
			{
				region: "Europe",
				kinds: [
					"Assurance-vie",
					"Plan d'Épargne en Actions",
					"Prévoyance privée (Pilier 3a)",
					"Riester-Rente",
				],
			},
			{
				region: "Général",
				kinds: [
					"Retraite",
					"Compte de retraite",
					"Fonds commun de placement",
					"Or (physique ou numérique)",
					"Investissement providentiel",
					"Fiducie",
					"Autre investissement",
				],
			},
			{ region: "États-Unis", kinds: ["Compte-titres"] },
		]);
	});

	it("holds every investment kind but the blank one, once, in the kinds' order", () => {
		const grouped: readonly string[] = INVESTMENT_REGIONS.flatMap((region) => region.kinds);
		const kinds = ACCOUNT_KINDS.filter(
			(kind) => kind.type === "investment" && kind.subtype !== null,
		).map((kind) => kind.id);

		expect(grouped).toEqual(kinds);
	});
});
