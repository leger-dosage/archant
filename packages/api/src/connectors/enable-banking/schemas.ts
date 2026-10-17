import { z } from "zod";

import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode } from "@archant/data/money";

import { providerDate, providerIsoDate } from "../../domain/provider-date.ts";

// Every response is parsed, as any input crossing a boundary: a provider is
// not trusted because it is a bank. Objects drop the keys they do not name,
// so nothing unread travels further than this file.

const httpUrl = z.url({ protocol: /^https?$/u });

const aspspSchema = z.object({
	name: z.string().min(1),
	country: z.string().length(2),
	// A missing or odd logo costs a picture, not the whole list.
	logo: httpUrl.nullish().catch(null),
	bic: z.string().min(1).nullish().catch(null),
	// Seconds.
	maximum_consent_validity: z.number().int().positive().nullish().catch(null),
	// Header names only. Unreadable, the bank asks for none Archant can tell,
	// so none is sent, as Sure's `blank?` list.
	required_psu_headers: z.array(z.string().trim().min(1).max(100)).max(20).catch([]),
});

export const aspspsResponseSchema = z.object({ aspsps: z.array(aspspSchema) });

// A revoked session's answer says nothing the service uses, and nothing of it
// travels further: any body, or none, is a success.
export const revokeResponseSchema = z.unknown();

// `GET /application`, read only to check a pair before it is saved: the
// addresses the bank may send the browser back to. The rest, the name and
// the environment included, stays here.
export const applicationResponseSchema = z.object({ redirect_urls: z.array(z.string()) });

// The browser is sent there: anything but http(s) would be a script URL.
export const authResponseSchema = z.object({ url: httpUrl });

// A label the bank gave, kept only when it says something and fits an
// account name (`ACCOUNT_NAME_MAX_LENGTH`): a longer one would create an
// account its edit form refuses, so the next name choice is used instead.
const label = z
	.string()
	.trim()
	.max(100)
	.nullish()
	.catch(null)
	.transform((value) => (value === null || value === undefined || value === "" ? null : value));

const currency = z.custom<CurrencyCode>(
	(value) => typeof value === "string" && isCurrencyCode(value),
);

/**
 * `AccountResource`, as `POST /sessions` returns it. The IBAN is read here
 * only to be cut to its last four characters by the client; `account_id`'s
 * other identifiers and the servicer are dropped. `name`, often the
 * holder's name, is kept as the last name choice before the IBAN, as Sure
 * does. A currency the client cannot read, such as Boursorama's `XXX`
 * (ISO 4217's « no currency »), is `null` rather than a dropped account: the
 * service, which sees the stored rows, picks one.
 */
export const sessionAccountSchema = z.object({
	uid: z.string().min(1),
	// Sure falls back to the uid when a bank leaves the hash out.
	identification_hash: z.string().min(1).nullish().catch(null),
	account_id: z
		.object({ iban: z.string().trim().min(4).nullish().catch(null) })
		.nullish()
		.catch(null),
	details: label,
	product: label,
	name: label,
	// Nullable rather than nullish: `catch` turns an absent currency into
	// `null` too, so the port has one empty value.
	currency: currency.nullable().catch(null),
	cash_account_type: z.string().trim().min(1).max(10).nullish().catch(null),
	// A card's limit, as Sure's `credit_limit`: an unreadable one is no limit,
	// never a dropped account. The amount stays a string for `parseAmount`.
	credit_limit: z
		.object({ amount: z.string().trim().min(1), currency })
		.nullish()
		.catch(null),
});

export const sessionResponseSchema = z.object({
	session_id: z.string().min(1),
	access: z.object({
		valid_until: z.iso.datetime({ offset: true }).transform((value) => Date.parse(value)),
	}),
	// Accounts stay unknown here and are parsed one by one by the client, so
	// an unreadable one is dropped alone, and said so, never the session: the
	// callback's code is single use, so failing here would lose every account.
	accounts: z.array(z.unknown()).default([]),
});

/**
 * `GET /sessions/{id}`, read at the start of each sync for the consent's end
 * alone: its accounts, bare uids unlike `POST /sessions`'s, and its status
 * are not read, as Sure decides on neither. A consent end missing or
 * unreadable is `null`, as Sure's `reconcile_session_expiry!` skips it: the
 * stored one stays and the sync goes on.
 */
export const sessionReadSchema = z.object({
	access: z
		.object({
			valid_until: z.iso
				.datetime({ offset: true })
				.transform((value) => Date.parse(value))
				.nullish()
				.catch(null),
		})
		.nullish()
		.catch(null),
});

/**
 * `BalanceResource`. The amount stays a string: `parseAmount` reads it into
 * minor units, so no float ever holds it. A balance of a type the client
 * does not rank is kept here: the client falls back to the first one listed.
 */
export const balanceSchema = z.object({
	balance_amount: z.object({ amount: z.string().min(1), currency }),
	balance_type: z.string().min(1),
	credit_debit_indicator: z.enum(["CRDT", "DBIT"]).nullish().catch(null),
	// The day the balance describes, which only chooses among the balances,
	// as Sure's `select_current_balance`. Unread, the balance still counts.
	reference_date: z.string().nullable().catch(null),
});

export const balancesResponseSchema = z.object({ balances: z.array(balanceSchema) });

// A free-text field of a line, kept only when it says something. Nullable
// rather than nullish: `catch` turns an absent field into `null` too, so the
// client has one empty value to test.
const text = z
	.string()
	.trim()
	.nullable()
	.catch(null)
	.transform((value) => (value === "" ? null : value));

/**
 * `Transaction`, as `GET /accounts/{uid}/transactions` returns it. Every
 * field forgives a wrong type, so the client, not this schema, decides which
 * gaps refuse a line: one odd line never fails its page. Account numbers of
 * either side are dropped here.
 */
export const transactionSchema = z.object({
	entry_reference: text,
	// Never a key (AD-18), only part of what tells two copies of a line apart.
	transaction_id: text,
	transaction_amount: z.object({ amount: z.string(), currency: z.string() }).nullable().catch(null),
	// A string as the bank sent it, anything else `null`: only `CRDT` is money
	// in (AD-18), and `contentKey` hashes it raw, as Sure's
	// `build_transaction_content_key` and `compute_external_id`.
	credit_debit_indicator: z.string().nullable().catch(null),
	status: z.string().nullable().catch(null),
	booking_date: z.string().nullable().catch(null),
	value_date: z.string().nullable().catch(null),
	transaction_date: z.string().nullable().catch(null),
	creditor: z.object({ name: text }).nullable().catch(null),
	debtor: z.object({ name: text }).nullable().catch(null),
	bank_transaction_code: z.object({ description: text }).nullable().catch(null),
	remittance_information: z
		.array(z.unknown())
		.catch([])
		.transform((lines) =>
			lines.flatMap((line) =>
				typeof line === "string" && line.trim() !== "" ? [line.trim()] : [],
			),
		),
});

/**
 * One page of a statement. Lines stay unknown here and are parsed one by
 * one, so an unreadable line is refused alone.
 */
export const transactionsPageSchema = z.object({
	transactions: z.array(z.unknown()),
	continuation_key: z.string().min(1).nullable().catch(null),
});

const providerCode = z
	.string()
	.regex(/^[A-Z][A-Z0-9_]{0,63}$/u)
	.optional()
	.catch(undefined);

/**
 * The provider's error code, kept only when it looks like one: a free-text
 * message could carry anything, and the code is all a log line may hold.
 * Most refusals name it in `error`, N26's in `code`; a refused period is
 * either's, as Sure's `wrong_transactions_period?` reads them. The message
 * only says whether it names the consent validity, as Sure's
 * `wrong_consent_validity?` reads it, and `detail` only gives the start a
 * bank suggests after refusing a period, Sure's `corrected_date_from`,
 * `null` unless it reads as an ISO date; neither text leaves this schema
 * (AD-14).
 */
export const errorResponseSchema = z
	.object({
		error: providerCode,
		code: providerCode,
		message: z.string().optional().catch(undefined),
		detail: z
			.object({ date_from: z.string().optional().catch(undefined) })
			.optional()
			.catch(undefined),
	})
	.transform(({ error, code, message, detail }) => ({
		error: error ?? code ?? null,
		consentValidity: /consent validity/iu.test(message ?? ""),
		periodRefused: error === "WRONG_TRANSACTIONS_PERIOD" || code === "PERIOD_INVALID",
		// `Date.iso8601` reads the basic form, `20260710`, too.
		suggestedFrom:
			detail?.date_from === undefined
				? null
				: (providerIsoDate(detail.date_from) ??
					(/^\d{8}$/u.test(detail.date_from) ? providerDate(detail.date_from) : null)),
	}));
