import type { transactionSchema } from "./schemas.ts";
import type { z } from "zod";

import { MERCHANT_NAME_MAX_LENGTH } from "@archant/data/name-limits";

import { LABEL_MAX_LENGTH } from "../../schemas/transactions.ts";

type Line = z.output<typeof transactionSchema>;

/** By code points, so an emoji at the limit is never cut in half. */
export const capped = (value: string, length: number) =>
	Array.from(value).slice(0, length).join("");

/** Rails' `truncate(100)`: 97 code points and `...` when longer. */
function truncated(value: string): string {
	return Array.from(value).length > 100 ? `${capped(value, 97)}...` : value;
}

/**
 * Sure's `PAYMENT_PROCESSOR_PREFIX`: small-merchant card terminals that put
 * their own name before the payee's.
 */
const PAYMENT_PROCESSOR_PREFIX = /^(?:SUMUP|SQ|IZETTLE|ZETTLE|PAYPAL)\s*\*\s*/i;

/**
 * Sure's `WALLET_PREFIX`: how the card was presented, not who was paid. Left
 * in, a household that once bought from Apple would see every Apple Pay
 * payment named and filed after Apple.
 */
const WALLET_PREFIX = /^(?:apple|google|samsung)\s+pay\s*:\s*/i;

/**
 * Sure's `technical_remittance_line?`: a terminal booking line such as
 * « POS 45,13 AT D6 31.07. 10:27 ». The keyword and amount and the trailing
 * date and time must both be there: either alone matches real descriptors.
 */
const TECHNICAL_LINE = /^(?:POS|ATM)\s+\d+[.,]\d{2}\b.*\d{1,2}[./]\d{1,2}\.?\s+\d{2}:\d{2}$/i;

/** Sure's `technical_card_counterparty?`: Wise's `CARD-<digits>` placeholder. */
const CARD_PLACEHOLDER = /^CARD-\d+$/i;

/**
 * Sure's `MIN_KNOWN_MERCHANT_MATCH_LENGTH`: a two-letter name such as « IT »
 * would otherwise match inside « NAME IT ».
 */
const MIN_KNOWN_MERCHANT_LENGTH = 3;

const isCardPlaceholder = (value: string | null) =>
	value !== null && CARD_PLACEHOLDER.test(value.trim());

const escaped = (value: string) => value.replaceAll(/[\\^$.*+?()[\]{}|/]/g, String.raw`\$&`);

/**
 * Sure's `matched_known_merchant_name`: the longest known name found in
 * `line` as a whole word, case aside, as stored. Lookarounds rather than
 * `\b`, which never fires after a name ending in punctuation.
 */
function knownMerchantIn(line: string, knownMerchants: readonly string[]): string | null {
	let best: string | null = null;

	for (const name of knownMerchants) {
		const length = Array.from(name).length;

		if (
			length < MIN_KNOWN_MERCHANT_LENGTH ||
			(best !== null && length <= Array.from(best).length)
		) {
			continue;
		}

		const word = new RegExp(
			`(?<![\\p{L}\\p{M}\\p{Nd}_])${escaped(name)}(?![\\p{L}\\p{M}\\p{Nd}_])`,
			"iu",
		);

		if (word.test(line)) {
			best = name;
		}
	}

	return best;
}

/**
 * Sure's `primary_remittance_information`: the first remittance line that is
 * no terminal booking line, its wallet prefix gone; then the known merchant
 * it names, else the line without its card-terminal prefix. `null` without
 * remittance.
 */
export function primaryRemittance(line: Line, knownMerchants: readonly string[]): string | null {
	const lines = line.remittance_information
		.map((value) => value.trim().replace(WALLET_PREFIX, "").trim())
		.filter((value) => value !== "");
	const descriptive = lines.find((value) => !TECHNICAL_LINE.test(value)) ?? lines[0];

	if (descriptive === undefined) {
		return null;
	}

	return (
		knownMerchantIn(descriptive, knownMerchants) ??
		(descriptive.replace(PAYMENT_PROCESSOR_PREFIX, "").trim() || descriptive)
	);
}

/** The other side of the line: the creditor of a debit, the debtor of a credit. */
const counterpartyOf = (line: Line, debit: boolean) =>
	(debit ? line.creditor : line.debtor)?.name ?? null;

/**
 * Sure's `EnableBankingEntry::Processor#name`: the readable counterparty;
 * for a `CARD-` placeholder, the remittance; the bank's code description;
 * the remittance; else the direction.
 */
export function labelOf(line: Line, debit: boolean, knownMerchants: readonly string[]): string {
	const counterparty = counterpartyOf(line, debit);
	const card = isCardPlaceholder(counterparty);
	const remittance = primaryRemittance(line, knownMerchants);
	const label =
		(card ? null : counterparty) ??
		(card && remittance !== null ? truncated(remittance) : null) ??
		line.bank_transaction_code?.description ??
		(remittance === null ? null : truncated(remittance)) ??
		(debit ? "Virement sortant" : "Virement entrant");

	return capped(label, LABEL_MAX_LENGTH);
}

/**
 * The label as Archant read it before Sure's clean-ups: the counterparty, the
 * bank's code description, the first remittance line, else the direction.
 * Only the fingerprint hashes it (AD-7): a label that now changes with the
 * household's merchants must not change the key of a line already synced.
 */
export function keyLabelOf(line: Line, debit: boolean): string {
	return capped(
		counterpartyOf(line, debit) ??
			line.bank_transaction_code?.description ??
			line.remittance_information[0] ??
			(debit ? "Virement sortant" : "Virement entrant"),
		LABEL_MAX_LENGTH,
	);
}

/**
 * Sure's `merchant_name_candidate`: the readable counterparty; for a `CARD-`
 * placeholder, the remittance; the remittance when it is a known merchant's
 * name; else none. Cut to a merchant name's length, shorter than the 100
 * code points Sure keeps of a remittance.
 */
export function merchantNameOf(
	line: Line,
	debit: boolean,
	knownMerchants: readonly string[],
): string | null {
	const counterparty = counterpartyOf(line, debit);
	const card = isCardPlaceholder(counterparty);
	const remittance = primaryRemittance(line, knownMerchants);
	const candidate =
		(card ? null : counterparty) ??
		(remittance === null
			? null
			: card
				? remittance
				: knownMerchants.includes(remittance)
					? remittance
					: null);

	// Never empty: every source of a candidate is trimmed and non-blank.
	return candidate === null ? null : merchantName(candidate);
}

/**
 * A name the merchant form would accept: composed as `merchantSchema` stores
 * it, within `MERCHANT_NAME_MAX_LENGTH` UTF-16 units, which its `max` counts,
 * never cutting an emoji in half.
 */
function merchantName(candidate: string): string {
	let name = "";

	for (const character of candidate.normalize("NFC")) {
		if (name.length + character.length > MERCHANT_NAME_MAX_LENGTH) {
			break;
		}

		name += character;
	}

	return name.trim();
}
