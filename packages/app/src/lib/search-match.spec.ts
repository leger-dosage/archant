import { describe, expect, it } from "vitest";

import { filterByName, matchesSearch } from "./search-match.ts";

describe("matchesSearch", () => {
	it("ignores case and accents", () => {
		expect(matchesSearch("Opérations", "operations")).toBe(true);
		expect(matchesSearch("Livret A", "LIVRET")).toBe(true);
		expect(matchesSearch("Epargne", "épargne")).toBe(true);
	});

	it("needs every typed word, in any order", () => {
		expect(matchesSearch("Ajouter un compte", "compte ajou")).toBe(true);
		expect(matchesSearch("Ajouter un compte", "compte solde")).toBe(false);
	});

	it("matches everything on an empty query", () => {
		expect(matchesSearch("Comptes", "  ")).toBe(true);
	});
});

describe("filterByName", () => {
	const filter = filterByName(["create"]);

	it("keeps an option whose keywords match, case and accents aside", () => {
		expect(filter("id-1", "epicerie", ["Épicerie"])).toBe(1);
		expect(filter("id-1", "boulangerie", ["Épicerie"])).toBe(0);
		expect(filter("id-1", "epicerie")).toBe(0);
	});

	it("always keeps the options that name what was typed", () => {
		expect(filter("create", "nouveau nom", [])).toBe(1);
		expect(filterByName(["create", "create-child"])("create-child", "x")).toBe(1);
	});
});
