import { describe, expect, it } from "vitest";

import { matchesSearch } from "./search-match.ts";

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
