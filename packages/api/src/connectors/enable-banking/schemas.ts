import { z } from "zod";

import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode } from "@archant/data/money";

// Every response is parsed, as any input crossing a boundary: a provider is
// not trusted because it is a bank. Objects drop the keys they do not name,
// so nothing unread travels further than this file.

const httpUrl = z.url({ protocol: /^https?$/u });

export const aspspSchema = z.object({
	name: z.string().min(1),
	country: z.string().length(2),
	// A missing or odd logo costs a picture, not the whole list.
	logo: httpUrl.nullish().catch(null),
	bic: z.string().min(1).nullish().catch(null),
	// Seconds.
	maximum_consent_validity: z.number().int().positive().nullish().catch(null),
});

export const aspspsResponseSchema = z.object({ aspsps: z.array(aspspSchema) });

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
 * does.
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
	currency,
	cash_account_type: z.string().trim().min(1).max(10).nullish().catch(null),
});

export const sessionResponseSchema = z.object({
	session_id: z.string().min(1),
	access: z.object({
		valid_until: z.iso.datetime({ offset: true }).transform((value) => Date.parse(value)),
	}),
	// An account the schema cannot read is dropped, not the session: the
	// callback's code is single use, so failing here would lose every account.
	accounts: z
		.array(sessionAccountSchema.nullable().catch(null))
		.default([])
		.transform((accounts) => accounts.filter((account) => account !== null)),
});

/**
 * `BalanceResource`. The amount stays a string: `parseAmount` reads it into
 * minor units, so no float ever holds it. A balance of a type the client
 * does not read is kept here and dropped there.
 */
export const balanceSchema = z.object({
	balance_amount: z.object({ amount: z.string().min(1), currency }),
	balance_type: z.string().min(1),
	credit_debit_indicator: z.enum(["CRDT", "DBIT"]).nullish().catch(null),
});

export const balancesResponseSchema = z.object({ balances: z.array(balanceSchema) });

/**
 * The provider's error code, kept only when it looks like one: a free-text
 * message could carry anything, and the code is all a log line may hold.
 */
export const errorResponseSchema = z.object({ error: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u) });
