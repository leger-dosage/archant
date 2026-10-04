import { z } from "zod";

import type { Micros } from "@archant/data/micros";
import { readMicros } from "@archant/data/micros";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { parseAmount } from "@archant/data/money";
import type { PriceProviderId } from "@archant/data/schema/securities";

import { TRADE_SIDES, isValidIsin, tradeAmount } from "../domain/trades.ts";
import { pageQuerySchema } from "./transactions.ts";

// The form's « Achat » and « Vente », and its ISIN check, from the domain the
// API checks them with.
export { TRADE_SIDES, isValidIsin } from "../domain/trades.ts";

/** A security's name, as the provider or the owner gives it. */
export const SECURITY_NAME_MAX_LENGTH = 200;

/** Far above any Yahoo symbol, such as `MC.PA` or `^FCHI`. */
const TICKER_MAX_LENGTH = 32;

// Spelled out rather than imported from the schema, which would pull Drizzle
// into the interface's bundle; `satisfies` keeps the two in step.
const PROVIDERS = ["yahoo"] as const satisfies readonly PriceProviderId[];

const securityName = z.string().trim().min(1).max(SECURITY_NAME_MAX_LENGTH);

/** An ISIN as typed: spaces dropped and upper-cased, empty when none. */
export function normalizeIsin(text: string): string {
	return text.replaceAll(/\s/gu, "").toUpperCase();
}

/**
 * Which security a new trade is in: one already known, a listing the search
 * found, or one typed by hand, its ISIN optional since a fonds euros has none.
 */
const securityChoiceSchema = z.discriminatedUnion("source", [
	z.object({ source: z.literal("known"), id: z.string().min(1) }),
	z.object({
		source: z.literal("listing"),
		ticker: z.string().trim().min(1).max(TICKER_MAX_LENGTH),
		// ISO 10383 operating MIC.
		mic: z
			.string()
			.regex(/^[A-Z0-9]{4}$/u)
			.nullable(),
		name: securityName,
		currency: z
			.string()
			.regex(/^[A-Z]{3}$/u)
			.nullable(),
		provider: z.enum(PROVIDERS),
	}),
	z
		.object({ source: z.literal("manual"), isin: z.string().optional(), name: securityName })
		.superRefine(({ isin = "" }, context) => {
			const normalized = normalizeIsin(isin);

			if (normalized !== "" && !isValidIsin(normalized)) {
				context.addIssue({ code: "custom", path: ["isin"], message: "invalid_isin" });
			}
		}),
]);

// What the route checks before it knows the account: the security's shape,
// and every number as text, so the typed client knows the body. Quantity,
// price and fee are parsed afterwards, with the account's currency, by the
// schemas below.
export const tradeBodySchema = z.object({
	side: z.enum(TRADE_SIDES),
	security: securityChoiceSchema,
	date: z.string(),
	// Unsigned text, typed the French or English way: the side gives the sign,
	// and a JavaScript number would already have rounded the input.
	quantity: z.string(),
	price: z.string(),
	fee: z.string(),
});

/** An edit never changes the security, as Sure's drawer. */
export const tradePatchBodySchema = tradeBodySchema.omit({ security: true }).partial();

export type TradeInput = z.input<typeof tradeBodySchema>;
export type TradePatchInput = z.input<typeof tradePatchBodySchema>;
export type SecurityChoiceInput = TradeInput["security"];

type Numbers = {
	quantity?: string | undefined;
	price?: string | undefined;
	fee?: string | undefined;
};

/** The quantity, price and fee read, each `null` when absent or invalid. */
function numbersOf(value: Numbers, currency: CurrencyCode) {
	const quantity = value.quantity === undefined ? null : readMicros(value.quantity);
	const price = value.price === undefined ? null : readMicros(value.price);
	const fee = value.fee === undefined ? null : parseAmount(value.fee, currency);

	return {
		quantity: quantity !== null && quantity > 0 ? quantity : null,
		price: price !== null && price >= 0 ? price : null,
		fee: fee !== null && fee >= 0 ? fee : null,
	};
}

/**
 * Each number present checked, and the cash amount once all three are: a
 * trade no balance could hold is refused on its quantity, as the ledger
 * refuses it.
 */
function numbersIn(currency: CurrencyCode) {
	return (value: Numbers, context: z.core.$RefinementCtx) => {
		const read = numbersOf(value, currency);

		if (value.quantity !== undefined && read.quantity === null) {
			context.addIssue({ code: "custom", path: ["quantity"], message: "invalid_quantity" });
		}

		if (value.price !== undefined && read.price === null) {
			context.addIssue({ code: "custom", path: ["price"], message: "invalid_price" });
		}

		if (value.fee !== undefined && read.fee === null) {
			const fee = parseAmount(value.fee, currency);
			context.addIssue({
				code: "custom",
				path: ["fee"],
				message: fee === null ? "invalid_amount" : "negative_amount",
			});
		}

		if (
			read.quantity !== null &&
			read.price !== null &&
			read.fee !== null &&
			tradeAmount({ quantity: read.quantity, price: read.price, fee: read.fee }, currency) === null
		) {
			context.addIssue({ code: "custom", path: ["quantity"], message: "too_big" });
		}
	};
}

const fieldsShape = {
	side: z.enum(TRADE_SIDES),
	date: z.iso.date(),
	quantity: z.string(),
	price: z.string(),
	fee: z.string(),
};

/** The checked numbers, for a transform that runs only once every refinement passed. */
function checkedNumbers(
	value: Numbers,
	currency: CurrencyCode,
): { quantity: Micros; price: Micros; fee: MinorUnits } {
	const read = numbersOf(value, currency);

	// Already reported by the refinement; kept so the output type never has to pretend.
	if (read.quantity === null || read.price === null || read.fee === null) {
		throw new Error("A trade's numbers were not checked.");
	}

	return { quantity: read.quantity, price: read.price, fee: read.fee };
}

/** The security as the ledger takes it: an ISIN normalised, a ticker upper-cased. */
function securityOf(choice: z.output<typeof securityChoiceSchema>) {
	if (choice.source === "known") {
		return choice;
	}

	if (choice.source === "listing") {
		return { ...choice, ticker: choice.ticker.toUpperCase() };
	}

	const isin = normalizeIsin(choice.isin ?? "");

	return { source: choice.source, name: choice.name, isin: isin === "" ? null : isin };
}

/**
 * The full check of a new trade, shared with the interface's form resolver
 * so both report the same field codes. Built per currency: the fee is an
 * amount in the account's. `security` is `null` in the form until one is
 * picked, which this refuses.
 */
export function createTradeSchema(currency: CurrencyCode) {
	return z
		.object({ ...fieldsShape, security: securityChoiceSchema.nullable() })
		.superRefine((value, context) => {
			if (value.security === null) {
				context.addIssue({ code: "custom", path: ["security"], message: "too_small" });
			}

			numbersIn(currency)(value, context);
		})
		.transform(({ security, ...value }) => {
			if (security === null) {
				throw new Error("A trade's security was not checked.");
			}

			return {
				side: value.side,
				date: value.date,
				security: securityOf(security),
				...checkedNumbers(value, currency),
			};
		});
}

/** The edit counterpart for the API: every field optional, an absent one left as it is. */
export function updateTradeSchema(currency: CurrencyCode) {
	return z
		.object({
			side: z.enum(TRADE_SIDES).optional(),
			date: z.iso.date().optional(),
			quantity: z.string().optional(),
			price: z.string().optional(),
			fee: z.string().optional(),
		})
		.superRefine(numbersIn(currency))
		.transform((value) => {
			const read = numbersOf(value, currency);

			return {
				...(value.side === undefined ? {} : { side: value.side }),
				...(value.date === undefined ? {} : { date: value.date }),
				...(read.quantity === null ? {} : { quantity: read.quantity }),
				...(read.price === null ? {} : { price: read.price }),
				...(read.fee === null ? {} : { fee: read.fee }),
			};
		});
}

/** What the interface's trade form holds: the text typed, before the schema parses it. */
export type TradeFormInput = z.input<ReturnType<typeof createTradeSchema>>;

/** A page of an account's trades, narrowed to one security for a position's sheet. */
export const tradePageQuerySchema = pageQuerySchema.extend({
	securityId: z.string().min(1).optional(),
});
