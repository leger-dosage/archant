import { describe, expect, it } from "vitest";

import { isNewName, nameKey } from "./name-key";

describe("nameKey", () => {
	it("ignores case", () => {
		expect(nameKey("Vacances")).toBe(nameKey("VACANCES"));
	});

	it("keeps accents, as the API tells « Été » from « Ete »", () => {
		expect(nameKey("Été")).not.toBe(nameKey("Ete"));
		expect(nameKey("ÉTÉ")).toBe(nameKey("été"));
	});

	it("compares a decomposed accent with its composed form", () => {
		expect(nameKey("Cafe\u0301")).toBe(nameKey("Café"));
	});

	it("drops surrounding spaces", () => {
		expect(nameKey("  Loisirs \t")).toBe(nameKey("Loisirs"));
	});
});

describe("isNewName", () => {
	const names = ["Loisirs", "Café"];

	it("accepts a name no row holds", () => {
		expect(isNewName("Voyage", names, 10)).toBe(true);
	});

	it("refuses a name held in another case", () => {
		expect(isNewName(" loisirs ", names, 10)).toBe(false);
		expect(isNewName("CAFE\u0301", names, 10)).toBe(false);
	});

	it("refuses an empty name", () => {
		expect(isNewName("   ", names, 10)).toBe(false);
	});

	it("refuses a name the API would find too long, counted once composed", () => {
		const decomposed = "Cafe\u0301 noir";
		// Ten code units as typed, nine once composed: only the composed count fits.
		expect(decomposed).toHaveLength(10);
		expect(isNewName(decomposed, names, 9)).toBe(true);
		expect(isNewName("Cafés noirs", names, 9)).toBe(false);
	});
});
