import type { MinorUnits } from "@archant/data/money";
import { isCurrencyCode, minorUnitsOf } from "@archant/data/money";

/** Dépense or Revenu, the toggle next to an amount whose sign matters. */
export type Nature = "expense" | "income";

export type SignedAmount = { nature: Nature; magnitude: string };

/**
 * Reads what was typed in the amount field. A leading minus, hyphen or
 * U+2212, switches the toggle to Dépense and leaves the field; a leading plus
 * switches it to Revenu. Without a sign, the toggle stays as it was.
 */
export function splitAmount(text: string, current: Nature): SignedAmount {
	const match = /^\s*([-−+])?\s*(.*)$/su.exec(text);
	const sign = match?.[1];
	const magnitude = match?.[2] ?? text;

	if (sign === undefined) {
		return { nature: current, magnitude };
	}

	return { nature: sign === "+" ? "income" : "expense", magnitude };
}

/**
 * The toggle's position for a field opened with `text`: Dépense for a new,
 * empty field, otherwise the stored amount's own sign, so an income being
 * edited never flips to an expense.
 */
export function initialNature(text: string): Nature {
	return text.trim() === "" ? "expense" : splitAmount(text, "income").nature;
}

/**
 * The signed text the form sends and `parseAmount` reads: an expense is
 * negative, as the ledger stores it (AD-5). An empty field stays empty, so the
 * schema reports it rather than reading a lone minus.
 */
export function joinAmount({ nature, magnitude }: SignedAmount): string {
	const trimmed = magnitude.trim();

	return nature === "expense" && trimmed !== "" ? `-${trimmed}` : trimmed;
}

/** A stored amount as the field shows it for editing: `-4290` in euros is `-42,90`. */
export function amountToText(amount: MinorUnits, currency: string): string {
	const decimals = isCurrencyCode(currency) ? minorUnitsOf(currency) : 2;
	const digits = String(Math.abs(amount)).padStart(decimals + 1, "0");
	const text = decimals === 0 ? digits : `${digits.slice(0, -decimals)},${digits.slice(-decimals)}`;

	return amount < 0 ? `-${text}` : text;
}
