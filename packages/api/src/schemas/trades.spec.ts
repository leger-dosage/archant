import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { conversionFeeOf, convertTradeSchema, createTradeSchema } from "./trades.ts";

const known = { source: "known", id: "s1" } as const;

/** The codes a parse reports, by path. */
function issuesOf(result: {
	success: boolean;
	error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
	return (result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]);
}

describe("convertTradeSchema", () => {
	// −6 126,50 €: 10 at 612,40 leaves 2,50 € of fees.
	const schema = convertTradeSchema("EUR", toMinorUnits(-612_650));

	it("parses a buy the amount covers, and an income", () => {
		expect(schema.parse({ side: "buy", security: known, quantity: "10", price: "612,40" })).toEqual(
			{ side: "buy", security: known, quantity: 10_000_000, price: 612_400_000 },
		);
		expect(
			convertTradeSchema("EUR", toMinorUnits(300)).parse({ side: "interest", security: null }),
		).toEqual({ side: "interest", security: null });
	});

	it("refuses a sign the amount does not have, without a fee to repeat it", () => {
		expect(
			issuesOf(
				schema.safeParse({ side: "sell", security: known, quantity: "10", price: "612,40" }),
			),
		).toEqual([["side", "sign_mismatch"]]);
		expect(issuesOf(schema.safeParse({ side: "dividend", security: known }))).toEqual([
			["side", "sign_mismatch"],
		]);
	});

	it("refuses a fee below zero on the price, and what a buy lacks", () => {
		expect(
			issuesOf(schema.safeParse({ side: "buy", security: known, quantity: "10", price: "700" })),
		).toEqual([["price", "amount_mismatch"]]);
		expect(issuesOf(schema.safeParse({ side: "buy", security: null }))).toEqual([
			["security", "too_small"],
			["quantity", "invalid_quantity"],
			["price", "invalid_price"],
		]);
	});

	it("leaves the sign and the fee to the ledger without an amount", () => {
		expect(
			convertTradeSchema("EUR", null).safeParse({
				side: "sell",
				security: known,
				quantity: "10",
				price: "700",
			}).success,
		).toBe(true);
	});
});

describe("conversionFeeOf", () => {
	it("reads the fee as the dialog shows it, null until both numbers read", () => {
		const amount = toMinorUnits(-612_650);

		expect(conversionFeeOf("buy", { quantity: "10", price: "612,40" }, amount, "EUR")).toBe(250);
		expect(conversionFeeOf("buy", { quantity: "", price: "612,40" }, amount, "EUR")).toBeNull();
		expect(conversionFeeOf("buy", { quantity: "10", price: "x" }, amount, "EUR")).toBeNull();
	});
});

describe("createTradeSchema", () => {
	const schema = createTradeSchema("EUR");

	it("parses an income, ignoring a buy's fields the form keeps", () => {
		expect(
			schema.parse({
				side: "dividend",
				security: known,
				date: "2026-09-15",
				quantity: "",
				price: "",
				fee: "0",
				amount: "12,34",
			}),
		).toEqual({ side: "dividend", security: known, date: "2026-09-15", amount: 1234 });
	});

	it("refuses an income on a security that is not one already known", () => {
		expect(
			issuesOf(
				schema.safeParse({
					side: "interest",
					security: { source: "manual", name: "Fonds" },
					date: "2026-09-15",
					amount: "1",
				}),
			),
		).toEqual([["security", "invalid_value"]]);
		expect(
			issuesOf(schema.safeParse({ side: "interest", security: null, date: "2026-09-15" })),
		).toEqual([["amount", "invalid_amount"]]);
	});
});
