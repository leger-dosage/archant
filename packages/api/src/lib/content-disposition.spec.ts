import { describe, expect, it } from "vitest";

import { inlineDisposition } from "./content-disposition.ts";

describe("inlineDisposition", () => {
	it("names an ASCII file in both parameters", () => {
		expect(inlineDisposition("ticket.png")).toBe(
			"inline; filename=\"ticket.png\"; filename*=UTF-8''ticket.png",
		);
	});

	it("gives an old client an ASCII name, and the exact one percent-encoded", () => {
		expect(inlineDisposition("Reçu café (1)'s*.pdf")).toBe(
			"inline; filename=\"Re_u caf_ (1)'s*.pdf\"; filename*=UTF-8''Re%C3%A7u%20caf%C3%A9%20%281%29%27s%2A.pdf",
		);
	});

	it("never lets a quote or a backslash close the ASCII name", () => {
		expect(inlineDisposition('a"b\\c.pdf')).toBe(
			"inline; filename=\"a_b_c.pdf\"; filename*=UTF-8''a%22b%5Cc.pdf",
		);
	});
});
