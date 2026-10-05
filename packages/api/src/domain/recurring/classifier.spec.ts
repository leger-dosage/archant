import type { ClassifiedRow } from "./classifier.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { classify } from "./classifier.ts";

const row = (amount: number, categoryId: string | null = null): ClassifiedRow => ({
	amount: toMinorUnits(amount),
	categoryId,
});

const three = (amount: number) => [row(amount), row(amount), row(amount)];

const typeOf = (name: string, rows = [row(-4512), row(-6233)], creditCard = false) =>
	classify({ name, rows, currency: "EUR", creditCard }).billType;

const category = (rows: ClassifiedRow[]) =>
	classify({ name: "EDF", rows, currency: "EUR", creditCard: false }).categoryId;

describe("classify", () => {
	it("reads NETFLIX.COM as a subscription, paid automatically", () => {
		expect(
			classify({ name: "NETFLIX.COM", rows: three(-1399), currency: "EUR", creditCard: false }),
		).toEqual({ billType: "subscription", categoryId: null, autopay: true });
	});

	it("reads an installment keyword first, paid automatically", () => {
		expect(
			classify({ name: "Klarna Netflix", rows: three(-2500), currency: "EUR", creditCard: false }),
		).toEqual({ billType: "installment", categoryId: null, autopay: true });
		expect(typeOf("ZIP PAY 4")).toBe("installment");
		expect(typeOf("Afterpay")).toBe("installment");
	});

	it("reads each subscription keyword as a whole word, case aside", () => {
		expect(typeOf("Spotify AB")).toBe("subscription");
		expect(typeOf("HBO MAX")).toBe("subscription");
		expect(typeOf("APPLE.COM/BILL ITUNES")).toBe("subscription");
		expect(typeOf("Microsoft 365 Famille")).toBe("subscription");
		expect(typeOf("1PASSWORD")).toBe("subscription");
		expect(typeOf("X.AI GROK")).toBe("subscription");
		// Not inside another word.
		expect(typeOf("SPOTIFYX")).toBe("bill");
		expect(typeOf("primeur du marché")).toBe("bill");
	});

	it("lets a bill keyword or an ACH marker win over a subscription keyword", () => {
		expect(typeOf("Netflix power")).toBe("bill");
		expect(typeOf("AT&T wireless")).toBe("bill");
		expect(typeOf("T-Mobile")).toBe("bill");
		expect(typeOf("Mint Mobile")).toBe("bill");
		expect(typeOf("Spotify ACH")).toBe("bill");
		expect(typeOf("Disney WEB PMT")).toBe("bill");
		expect(typeOf("Zoom e-pay")).toBe("bill");
	});

	it("reads a stem with any suffix, never the bare word inside another", () => {
		expect(typeOf("CITY UTILITIES", three(-1000), true)).toBe("bill");
		expect(typeOf("Insurers mutual", three(-1000), true)).toBe("bill");
		expect(typeOf("finance charge", three(-1000), true)).toBe("bill");
		// « gas » claims no gastropub.
		expect(typeOf("gastropub", three(-1000), true)).toBe("subscription");
	});

	it("reads a flat modest charge on a credit card as a subscription, with no word to go by", () => {
		expect(typeOf("SOME SERVICE", three(-15000), true)).toBe("subscription");
		expect(typeOf("SOME SERVICE", three(-15001), true)).toBe("bill");
		expect(typeOf("SOME SERVICE", [row(-999), row(-1099)], true)).toBe("bill");
		expect(typeOf("SOME SERVICE", three(-999), false)).toBe("bill");
		// Outside ISO 4217, two decimals.
		expect(
			classify({ name: "SERVICE", rows: three(-15000), currency: "XYZ", creditCard: true })
				.billType,
		).toBe("subscription");
		// Yen have none: 150 yen is 150 minor units.
		expect(
			classify({ name: "SERVICE", rows: three(-151), currency: "JPY", creditCard: true }).billType,
		).toBe("bill");
	});

	it("sets no autopay on a bill", () => {
		expect(
			classify({ name: "EDF", rows: three(-6500), currency: "EUR", creditCard: false }).autopay,
		).toBe(false);
	});

	it("takes the most frequent category, the first seen on a tie, never none", () => {
		expect(category([row(-1, "a"), row(-1, "b"), row(-1, "b")])).toBe("b");
		expect(category([row(-1, null), row(-1, null), row(-1, "a")])).toBe("a");
		expect(category([row(-1, "b"), row(-1, "a"), row(-1, "a"), row(-1, "b")])).toBe("b");
		expect(category([row(-1), row(-1)])).toBeNull();
	});
});
