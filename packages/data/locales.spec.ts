import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, pickLocale } from "./locales.ts";

describe("pickLocale", () => {
	it("takes the first language the browser lists that Archant has", () => {
		expect(pickLocale(["de-DE", "fr-CA", "en"])).toBe("fr");
	});

	it("reads the primary subtag, whatever the region or the case", () => {
		expect(pickLocale(["EN-gb"])).toBe("en");
		expect(pickLocale(["fr_FR"])).toBe("fr");
	});

	it("falls back to the default when none matches or the list is empty", () => {
		expect(pickLocale(["de", "ja"])).toBe(DEFAULT_LOCALE);
		expect(pickLocale([])).toBe(DEFAULT_LOCALE);
	});
});
