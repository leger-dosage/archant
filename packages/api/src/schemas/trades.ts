import { z } from "zod";

import { INCOME_KINDS } from "@archant/data/income-kinds";
import type { Micros } from "@archant/data/micros";
import { readMicros } from "@archant/data/micros";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { parseAmount } from "@archant/data/money";
import type { PriceProviderId } from "@archant/data/schema/securities";

import {
	TRADE_SIDES,
	TRADE_TYPES,
	conversionFee,
	isIncomeSide,
	isValidIsin,
	signFits,
	tradeAmount,
} from "../domain/trades.ts";
import { pageQuerySchema } from "./transactions.ts";

// The form's four types, its ISIN check and its sign check, from the domain
// the API checks them with.
export { TRADE_SIDES, TRADE_TYPES, isIncomeSide, isValidIsin, signFits } from "../domain/trades.ts";
export type { TradeType } from "../domain/trades.ts";

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

const knownSecuritySchema = z.object({ source: z.literal("known"), id: z.string().min(1) });

/**
 * Which security a new trade is in: one already known, a listing the search
 * found, or one typed by hand, its ISIN optional since a fonds euros has none.
 */
const securityChoiceSchema = z.discriminatedUnion("source", [
	knownSecuritySchema,
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

/**
 * An income's security: one the account holds, as Sure's form offers its
 * holdings only, or `null` for interest on the account's cash.
 */
const incomeSecuritySchema = knownSecuritySchema.nullable();

// What the route checks before it knows the account: the side, the
// security's shape, and every number as text, so the typed client knows the
// body. Quantity, price, fee and amount are parsed afterwards, with the
// account's currency, by the schemas below.
export const tradeBodySchema = z.discriminatedUnion("side", [
	z.object({
		side: z.enum(TRADE_SIDES),
		security: securityChoiceSchema,
		date: z.string(),
		// Unsigned text, typed the French or English way: the side gives the
		// sign, and a JavaScript number would already have rounded the input.
		quantity: z.string(),
		price: z.string(),
		fee: z.string(),
	}),
	z.object({
		side: z.enum(INCOME_KINDS),
		security: incomeSecuritySchema,
		date: z.string(),
		amount: z.string(),
	}),
]);

/**
 * An edit never changes the security or the kind, as Sure's drawer: a buy
 * and a sale take `side`, `quantity`, `price` and `fee`, an income `amount`.
 */
export const tradePatchBodySchema = z
	.object({
		side: z.enum(TRADE_SIDES),
		date: z.string(),
		quantity: z.string(),
		price: z.string(),
		fee: z.string(),
		amount: z.string(),
	})
	.partial();

/**
 * A conversion into a trade: a buy or a sale's security, quantity and price,
 * the fee being what the transaction's amount leaves; an income's security.
 */
export const convertTradeBodySchema = z.discriminatedUnion("side", [
	z.object({
		side: z.enum(TRADE_SIDES),
		security: securityChoiceSchema,
		quantity: z.string(),
		price: z.string(),
	}),
	z.object({ side: z.enum(INCOME_KINDS), security: incomeSecuritySchema }),
]);

export type TradeInput = z.input<typeof tradeBodySchema>;
export type TradePatchInput = z.input<typeof tradePatchBodySchema>;
export type ConvertTradeInput = z.input<typeof convertTradeBodySchema>;
export type SecurityChoiceInput = z.input<typeof securityChoiceSchema>;

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

type FormSecurity = z.output<typeof securityChoiceSchema> | null;

/**
 * An income's security checked: a dividend needs one, interest takes the
 * account's cash without; either names a security already known, one the
 * account holds, never a listing or one typed by hand.
 */
function checkIncomeSecurity(
	side: "dividend" | "interest",
	security: FormSecurity,
	context: z.core.$RefinementCtx,
): void {
	if (security === null && side === "dividend") {
		context.addIssue({ code: "custom", path: ["security"], message: "too_small" });
	}

	if (security !== null && security.source !== "known") {
		context.addIssue({ code: "custom", path: ["security"], message: "invalid_value" });
	}
}

/** The income's security as the ledger takes it, once `checkIncomeSecurity` passed. */
function incomeSecurityOf(security: FormSecurity) {
	if (security !== null && security.source !== "known") {
		throw new Error("An income's security was not checked.");
	}

	return security;
}

/** An income's amount read, `null` when absent, unreadable or not above zero. */
function incomeAmountOf(text: string | undefined, currency: CurrencyCode): MinorUnits | null {
	const amount = text === undefined ? null : parseAmount(text, currency);

	return amount !== null && amount > 0 ? amount : null;
}

function checkIncomeAmount(
	text: string | undefined,
	currency: CurrencyCode,
	context: z.core.$RefinementCtx,
): void {
	if (incomeAmountOf(text, currency) === null) {
		context.addIssue({
			code: "custom",
			path: ["amount"],
			message:
				text === undefined || parseAmount(text, currency) === null
					? "invalid_amount"
					: "not_positive",
		});
	}
}

function checkedIncomeAmount(text: string | undefined, currency: CurrencyCode): MinorUnits {
	const amount = incomeAmountOf(text, currency);

	if (amount === null) {
		throw new Error("An income's amount was not checked.");
	}

	return amount;
}

/**
 * The full check of a new trade, shared with the interface's form resolver
 * so both report the same field codes. Built per currency: the fee and an
 * income's amount are amounts in the account's. A buy or a sale takes a
 * security, a quantity, a price and a fee; a dividend or interest, as Sure's
 * `Trade::CreateForm`, an amount above zero and a held security, interest on
 * cash none. `security` is `null` in the form until one is picked, and for
 * interest on cash; the fields of the other kind are ignored, as the form
 * keeps them while its type changes.
 */
export function createTradeSchema(currency: CurrencyCode) {
	return z
		.object({
			side: z.enum(TRADE_TYPES),
			security: securityChoiceSchema.nullable(),
			date: z.iso.date(),
			quantity: z.string().optional(),
			price: z.string().optional(),
			fee: z.string().optional(),
			amount: z.string().optional(),
		})
		.superRefine(({ side, security, ...value }, context) => {
			if (isIncomeSide(side)) {
				checkIncomeSecurity(side, security, context);
				checkIncomeAmount(value.amount, currency, context);

				return;
			}

			if (security === null) {
				context.addIssue({ code: "custom", path: ["security"], message: "too_small" });
			}

			numbersIn(currency)(
				{ quantity: value.quantity ?? "", price: value.price ?? "", fee: value.fee ?? "" },
				context,
			);
		})
		.transform(({ side, security, date, ...value }) => {
			if (isIncomeSide(side)) {
				return {
					side,
					date,
					security: incomeSecurityOf(security),
					amount: checkedIncomeAmount(value.amount, currency),
				};
			}

			if (security === null) {
				throw new Error("A trade's security was not checked.");
			}

			return { side, date, security: securityOf(security), ...checkedNumbers(value, currency) };
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
			amount: z.string().optional(),
		})
		.superRefine((value, context) => {
			numbersIn(currency)(value, context);

			if (value.amount !== undefined) {
				checkIncomeAmount(value.amount, currency, context);
			}
		})
		.transform((value) => {
			const read = numbersOf(value, currency);
			const amount = incomeAmountOf(value.amount, currency);

			return {
				...(value.side === undefined ? {} : { side: value.side }),
				...(value.date === undefined ? {} : { date: value.date }),
				...(read.quantity === null ? {} : { quantity: read.quantity }),
				...(read.price === null ? {} : { price: read.price }),
				...(read.fee === null ? {} : { fee: read.fee }),
				...(amount === null ? {} : { amount }),
			};
		});
}

/**
 * The fee a conversion leaves, as the dialog shows it while the owner types:
 * `null` until the quantity and the price read, or when the amount does not
 * cover them.
 */
export function conversionFeeOf(
	side: "buy" | "sell",
	text: { quantity: string; price: string },
	amount: MinorUnits,
	currency: CurrencyCode,
): MinorUnits | null {
	const read = numbersOf({ quantity: text.quantity, price: text.price }, currency);

	return read.quantity === null || read.price === null
		? null
		: conversionFee(side, { quantity: read.quantity, price: read.price }, amount, currency);
}

/**
 * The full check of a conversion of a transaction of `amount` into a trade,
 * shared with the interface's dialog: the type must move money the way the
 * transaction did, on `side`; a buy or a sale needs a security, a quantity
 * and a price whose product the amount covers, the fee being the rest, on
 * `price`; an income, a security as a new one does. With `amount` `null`,
 * as the API parses a body, the sign and the fee are left to the ledger,
 * which checks them once it has refused a line it cannot convert.
 */
export function convertTradeSchema(currency: CurrencyCode, amount: MinorUnits | null) {
	return z
		.object({
			side: z.enum(TRADE_TYPES),
			security: securityChoiceSchema.nullable(),
			quantity: z.string().optional(),
			price: z.string().optional(),
		})
		.superRefine(({ side, security, ...value }, context) => {
			const signed = amount === null || signFits(side, amount);

			if (!signed) {
				context.addIssue({ code: "custom", path: ["side"], message: "sign_mismatch" });
			}

			if (isIncomeSide(side)) {
				checkIncomeSecurity(side, security, context);

				return;
			}

			if (security === null) {
				context.addIssue({ code: "custom", path: ["security"], message: "too_small" });
			}

			const text = { quantity: value.quantity ?? "", price: value.price ?? "" };
			const read = numbersOf(text, currency);

			if (read.quantity === null) {
				context.addIssue({ code: "custom", path: ["quantity"], message: "invalid_quantity" });
			}

			if (read.price === null) {
				context.addIssue({ code: "custom", path: ["price"], message: "invalid_price" });
			}

			// A fee read against an amount of the wrong sign would only repeat it.
			if (
				amount !== null &&
				signed &&
				read.quantity !== null &&
				read.price !== null &&
				conversionFeeOf(side, text, amount, currency) === null
			) {
				context.addIssue({ code: "custom", path: ["price"], message: "amount_mismatch" });
			}
		})
		.transform(({ side, security, ...value }) => {
			if (isIncomeSide(side)) {
				return { side, security: incomeSecurityOf(security) };
			}

			const read = numbersOf(
				{ quantity: value.quantity ?? "", price: value.price ?? "" },
				currency,
			);

			if (security === null || read.quantity === null || read.price === null) {
				throw new Error("A conversion was not checked.");
			}

			return { side, security: securityOf(security), quantity: read.quantity, price: read.price };
		});
}

/** What the interface's trade form holds: the text typed, before the schema parses it. */
export type TradeFormInput = z.input<ReturnType<typeof createTradeSchema>>;

/** What the interface's conversion dialog holds. */
export type ConvertTradeFormInput = z.input<ReturnType<typeof convertTradeSchema>>;

/** A page of an account's trades, narrowed to one security for a position's sheet. */
export const tradePageQuerySchema = pageQuerySchema.extend({
	securityId: z.string().min(1).optional(),
});
