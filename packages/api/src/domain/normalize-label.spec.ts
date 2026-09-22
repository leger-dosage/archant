import { describe, expect, it } from "vitest";

import { normalizeLabel } from "./normalize-label.ts";

describe("normalizeLabel", () => {
	it("lower-cases, strips accents and collapses spaces", () => {
		expect(normalizeLabel("  CB  Électricité   de\tFrance ")).toBe("cb electricite de france");
	});

	it("keeps digits and punctuation", () => {
		expect(normalizeLabel("PRLV SEPA N°123-456")).toBe("prlv sepa n°123-456");
	});

	it("gives the same text for a label typed with composed or decomposed accents", () => {
		expect(normalizeLabel("Café")).toBe(normalizeLabel("Café"));
	});
});
