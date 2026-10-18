import { describe, expect, it } from "vitest";

import { contentDisposition } from "./content-disposition.ts";

describe("contentDisposition", () => {
	it("names an ASCII file in both parameters", () => {
		expect(contentDisposition("inline", "ticket.png")).toBe(
			"inline; filename=\"ticket.png\"; filename*=UTF-8''ticket.png",
		);
	});

	it("gives an old client an ASCII name, and the exact one percent-encoded", () => {
		expect(contentDisposition("inline", "Reçu café (1)'s*.pdf")).toBe(
			"inline; filename=\"Re_u caf_ (1)'s*.pdf\"; filename*=UTF-8''Re%C3%A7u%20caf%C3%A9%20%281%29%27s%2A.pdf",
		);
	});

	it("never lets a quote or a backslash close the ASCII name", () => {
		expect(contentDisposition("inline", 'a"b\\c.pdf')).toBe(
			"inline; filename=\"a_b_c.pdf\"; filename*=UTF-8''a%22b%5Cc.pdf",
		);
	});

	it("asks the browser to save the file under the same pair of names", () => {
		expect(contentDisposition("attachment", "l'été -2026-.pdf")).toBe(
			"attachment; filename=\"l'_t_ -2026-.pdf\"; filename*=UTF-8''l%27%C3%A9t%C3%A9%20-2026-.pdf",
		);
	});
});
