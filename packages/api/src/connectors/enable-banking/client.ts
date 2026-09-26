import type { IsoDate } from "../../domain/dates.ts";
import type { NormalizedTransaction, RejectionCode } from "../../domain/statement.ts";
import type {
	BankAccountRef,
	BankBalance,
	BankConnector,
	BankStatement,
	Institution,
} from "../bank-connector.ts";
import type { balanceSchema, sessionAccountSchema } from "./schemas.ts";
import type { KeyObject } from "node:crypto";
import type { z } from "zod";

import { parseAmount, toMinorUnits } from "@archant/data/money";

import { addDays } from "../../domain/dates.ts";
import { providerIsoDate } from "../../domain/provider-date.ts";
import { LABEL_MAX_LENGTH, NOTES_MAX_LENGTH } from "../../schemas/transactions.ts";
import { BankProviderError } from "../bank-connector.ts";
import { signJwt } from "./jwt.ts";
import {
	applicationResponseSchema,
	aspspsResponseSchema,
	authResponseSchema,
	balancesResponseSchema,
	errorResponseSchema,
	revokeResponseSchema,
	sessionResponseSchema,
	transactionSchema,
	transactionsPageSchema,
} from "./schemas.ts";

export type EnableBankingConfig = {
	applicationId: string;
	privateKey: KeyObject;
	/** `ENABLE_BANKING_API_URL`. */
	apiUrl: string;
};

/** 90 days at most, even from a bank that allows 180; Sure asks for 180 by default. */
const MAX_CONSENT_SECONDS = 90 * 86_400;

// Sure's `Provider::EnableBanking`: a consent asked for to the second of the
// bank's maximum is refused by some banks once the request has travelled.
const CONSENT_MARGIN_SECONDS = 60;

// A bank's listing can be slow; a request stuck longer is not coming back.
const TIMEOUT_MS = 30_000;

/**
 * When the consent asked for ends: the bank's own maximum, capped at 90 days,
 * a minute short of it.
 */
export function consentValidUntil(now: number, maximumConsentValidity: number | null): Date {
	const seconds =
		Math.min(maximumConsentValidity ?? MAX_CONSENT_SECONDS, MAX_CONSENT_SECONDS) -
		CONSENT_MARGIN_SECONDS;

	return new Date(now + seconds * 1000);
}

const failed = (status: number | null, providerCode: string | null = null) =>
	new BankProviderError("BANK_PROVIDER_ERROR", "The bank provider request failed.", {
		status,
		providerCode,
	});

/** AD-18: the interim booked balance, else the closing booked one. */
const BALANCE_TYPES = ["ITBD", "CLBD"] as const;

/**
 * A session account as the port hands it on. The name is Sure's choice
 * order, `details` then `product` then `name`, and only the IBAN's last four
 * characters survive this function.
 */
export function toBankAccount(account: z.output<typeof sessionAccountSchema>): BankAccountRef {
	const iban = account.account_id?.iban?.replaceAll(/\s/gu, "") ?? null;
	const ibanLast4 = iban === null ? null : iban.slice(-4);

	return {
		uid: account.uid,
		identificationHash: account.identification_hash ?? account.uid,
		name:
			account.details ??
			account.product ??
			account.name ??
			(ibanLast4 === null ? "Compte" : `Compte •••• ${ibanLast4}`),
		ibanLast4,
		currency: account.currency,
		cashAccountType: account.cash_account_type?.toUpperCase() ?? null,
	};
}

/** Sure's `EnableBankingItem::Importer`: a bank looping on its own key stops here. */
export const MAX_PAGES = 100;

/**
 * Sure's `EnableBankingItem::Importer`: the windows, in days before today,
 * asked for when a bank refuses the period with `WRONG_TRANSACTIONS_PERIOD`.
 */
export const FALLBACK_WINDOW_DAYS = [89, 60, 30] as const;

/**
 * The starts to try after `since` is refused, in order: each fallback window
 * ending `today`, but only those that start later than `since`, since a
 * longer window than the refused one would be refused too.
 */
export function fallbackStarts(since: IsoDate, today: IsoDate): IsoDate[] {
	return FALLBACK_WINDOW_DAYS.map((days) => addDays(today, -days)).filter((start) => start > since);
}

const refusedPeriod = (error: unknown) =>
	error instanceof BankProviderError && error.failure.providerCode === "WRONG_TRANSACTIONS_PERIOD";

/** Booked beats pending; any other status never reaches the ledger. */
const rankOf = (status: string | null) => (status === "BOOK" ? 2 : status === "PDNG" ? 1 : 0);

/**
 * Sure's `build_transaction_content_key`: what makes two lines the same line
 * when the bank lists it twice, under two `entry_reference`s. Neither the
 * reference nor the status is part of it, so a booked copy and a pending one
 * are the same line.
 */
function contentKey(line: z.output<typeof transactionSchema>): string {
	return JSON.stringify([
		line.booking_date ?? line.value_date ?? line.transaction_date,
		line.transaction_amount,
		line.creditor,
		line.debtor,
		line.remittance_information,
		line.transaction_id,
		line.credit_debit_indicator,
	]);
}

/**
 * The positions of `raw` to keep: one copy of each booked or pending line,
 * the booked one when both exist, else the first. A line that cannot be read,
 * or with another status, is kept: the mapping refuses or drops it.
 */
export function withoutRepeats(raw: readonly unknown[]): Set<number> {
	const chosen = new Map<string, { position: number; rank: number }>();
	const kept = new Set<number>();

	for (const [position, item] of raw.entries()) {
		const parsed = transactionSchema.safeParse(item);
		const rank = parsed.success ? rankOf(parsed.data.status) : 0;

		if (!parsed.success || rank === 0) {
			kept.add(position);
			continue;
		}

		const key = contentKey(parsed.data);
		const current = chosen.get(key);

		if (current === undefined || rank > current.rank) {
			chosen.set(key, { position, rank });
		}
	}

	for (const { position } of chosen.values()) {
		kept.add(position);
	}

	return kept;
}

/**
 * Sure's `compute_external_id`: the transaction id, else the entry
 * reference, else the content key.
 */
const identityOf = (line: z.output<typeof transactionSchema>) =>
	line.transaction_id ?? line.entry_reference ?? contentKey(line);

/**
 * The positions of `raw` to keep once settled pending lines go, as Sure's
 * `EnableBankingItem::Importer` drops them: a pending line whose booked
 * version the same response lists, under the same entry reference or the
 * same `identityOf`. Some banks list both until the pending one expires; the
 * ledger would otherwise count the payment twice. Every other line is kept.
 */
export function withoutSettledPending(raw: readonly unknown[]): Set<number> {
	const parsed = raw.map((item) => transactionSchema.safeParse(item));
	const booked = new Set<string>();

	for (const item of parsed) {
		if (item.success && item.data.status === "BOOK") {
			booked.add(`id:${identityOf(item.data)}`);

			if (item.data.entry_reference !== null) {
				booked.add(`ref:${item.data.entry_reference}`);
			}
		}
	}

	const kept = new Set<number>();

	for (const [position, item] of parsed.entries()) {
		const settled =
			item.success &&
			item.data.status === "PDNG" &&
			(booked.has(`id:${identityOf(item.data)}`) ||
				(item.data.entry_reference !== null && booked.has(`ref:${item.data.entry_reference}`)));

		if (!settled) {
			kept.add(position);
		}
	}

	return kept;
}

/** By code points, so an emoji at the limit is never cut in half. */
const capped = (value: string, length: number) => Array.from(value).slice(0, length).join("");

/**
 * Sure's `EnableBankingEntry::Processor#name`: the other side of the line,
 * the bank's code description, the first remittance line, else the
 * direction.
 */
function labelOf(line: z.output<typeof transactionSchema>, debit: boolean): string {
	const counterparty = debit ? line.creditor : line.debtor;

	return capped(
		counterparty?.name ??
			line.bank_transaction_code?.description ??
			line.remittance_information[0] ??
			(debit ? "Virement sortant" : "Virement entrant"),
		LABEL_MAX_LENGTH,
	);
}

/**
 * One line as the ledger takes it (AD-18); `null` when it is neither booked
 * nor pending, or dated before `since` because the bank ignored `date_from`;
 * otherwise the reason the line is refused.
 */
export function toTransaction(
	raw: unknown,
	since: IsoDate,
): NormalizedTransaction | RejectionCode | null {
	const parsed = transactionSchema.safeParse(raw);

	// Not even an object: nothing, the amount included, can be read.
	if (!parsed.success) {
		return "INVALID_AMOUNT";
	}

	const line = parsed.data;

	// Cancelled and informational lines never count.
	if (line.status !== "BOOK" && line.status !== "PDNG") {
		return null;
	}

	const rawDate = line.booking_date ?? line.value_date ?? line.transaction_date;
	const date = rawDate === null ? null : providerIsoDate(rawDate);

	if (date === null) {
		return "INVALID_DATE";
	}

	if (date < since) {
		return null;
	}

	const money = line.transaction_amount;
	const magnitude = money === null ? null : parseAmount(money.amount, money.currency);
	const direction = line.credit_debit_indicator;

	// No direction, no sign: guessing one would book a payment as income.
	if (money === null || magnitude === null || direction === null) {
		return "INVALID_AMOUNT";
	}

	const debit = direction === "DBIT";
	const notes = line.remittance_information.join("\n");

	return {
		// Never `transaction_id`: some banks change it between two reads.
		externalId: line.entry_reference,
		date,
		amount: toMinorUnits(debit ? -Math.abs(magnitude) : Math.abs(magnitude)),
		currency: money.currency,
		label: labelOf(line, debit),
		reference: null,
		notes: notes === "" ? null : capped(notes, NOTES_MAX_LENGTH),
		pending: line.status === "PDNG",
	};
}

/**
 * AD-18: the interim booked balance, else the closing booked one, with the
 * day it describes; `null` when the bank gives neither.
 */
function chooseBalance(balances: readonly z.output<typeof balanceSchema>[]): BankBalance | null {
	const chosen = BALANCE_TYPES.map((type) =>
		balances.find((balance) => balance.balance_type === type),
	).find((balance) => balance !== undefined);

	if (chosen === undefined) {
		return null;
	}

	const { amount, currency } = chosen.balance_amount;
	const parsed = parseAmount(amount, currency);

	if (parsed === null) {
		throw failed(200);
	}

	return {
		amount: chosen.credit_debit_indicator === "DBIT" ? toMinorUnits(-Math.abs(parsed)) : parsed,
		currency,
		date: chosen.reference_date === null ? null : providerIsoDate(chosen.reference_date),
	};
}

type Call = { method: "GET" | "POST" | "DELETE"; path: string; body?: unknown };

async function call<Schema extends z.ZodType>(
	config: EnableBankingConfig,
	{ method, path, body }: Call,
	schema: Schema,
): Promise<z.output<Schema>> {
	const headers: Record<string, string> = {
		authorization: `Bearer ${await signJwt(config.applicationId, config.privateKey)}`,
		accept: "application/json",
	};
	let response: Response;

	try {
		response = await fetch(`${config.apiUrl.replace(/\/+$/u, "")}${path}`, {
			method,
			headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch {
		throw failed(null);
	}

	// A body that is not JSON reads as `null`: an error keeps no code from it,
	// and a schema that expects nothing, as a revocation's, still accepts it.
	const payload: unknown = await response.json().catch(() => null);

	if (!response.ok) {
		const error = errorResponseSchema.safeParse(payload);

		throw failed(response.status, error.success ? error.data.error : null);
	}

	const parsed = schema.safeParse(payload);

	if (!parsed.success) {
		throw failed(response.status);
	}

	return parsed.data;
}

/** Enable Banking behind the bank connector port, after Sure's `Provider::EnableBanking`. */
export function createEnableBankingConnector(config: EnableBankingConfig): BankConnector {
	async function fetchBalance(uid: string): Promise<BankBalance | null> {
		const { balances } = await call(
			config,
			{ method: "GET", path: `/accounts/${encodeURIComponent(uid)}/balances` },
			balancesResponseSchema,
		);

		return chooseBalance(balances);
	}

	/**
	 * Every raw line since `since`, page after page. Sure's importer follows
	 * the key until none comes back, it comes back a second time, or a
	 * hundred pages went by. A provider failure after the first page keeps
	 * the pages read, as Sure does; on the first page it throws.
	 */
	async function fetchLines(
		uid: string,
		since: IsoDate,
	): Promise<{ lines: unknown[]; interrupted: BankProviderError | null }> {
		const seen = new Set<string>();
		const lines: unknown[] = [];
		const fromPage = async (
			continuationKey: string | null,
			page: number,
		): Promise<BankProviderError | null> => {
			const query = new URLSearchParams({ date_from: since });

			if (continuationKey !== null) {
				query.set("continuation_key", continuationKey);
			}

			let answer: z.output<typeof transactionsPageSchema>;

			try {
				answer = await call(
					config,
					{
						method: "GET",
						path: `/accounts/${encodeURIComponent(uid)}/transactions?${query.toString()}`,
					},
					transactionsPageSchema,
				);
			} catch (error) {
				if (page === 0 || !(error instanceof BankProviderError)) {
					throw error;
				}

				return error;
			}

			lines.push(...answer.transactions);
			const next = answer.continuation_key;

			if (next === null || seen.has(next) || page + 1 >= MAX_PAGES) {
				return null;
			}

			seen.add(next);

			return fromPage(next, page + 1);
		};
		const interrupted = await fromPage(null, 0);

		return { lines, interrupted };
	}

	/**
	 * `fetchLines` from `since`, else from each fallback start while the bank
	 * refuses the period on the first page; the last refusal throws.
	 */
	async function readFrom(
		uid: string,
		from: IsoDate,
		fallbacks: readonly IsoDate[],
	): Promise<{ lines: unknown[]; interrupted: BankProviderError | null; from: IsoDate }> {
		try {
			return { ...(await fetchLines(uid, from)), from };
		} catch (error) {
			const [next, ...rest] = fallbacks;

			if (next === undefined || !refusedPeriod(error)) {
				throw error;
			}

			return readFrom(uid, next, rest);
		}
	}

	return {
		id: "enable-banking",

		async describeApplication() {
			const application = await call(
				config,
				{ method: "GET", path: "/application" },
				applicationResponseSchema,
			);

			return { redirectUrls: application.redirect_urls };
		},

		async listInstitutions(country) {
			const { aspsps } = await call(
				config,
				{ method: "GET", path: `/aspsps?${new URLSearchParams({ country }).toString()}` },
				aspspsResponseSchema,
			);

			return aspsps.map((aspsp): Institution => ({
				name: aspsp.name,
				country: aspsp.country,
				logo: aspsp.logo ?? null,
				bic: aspsp.bic ?? null,
				maximumConsentValidity: aspsp.maximum_consent_validity ?? null,
			}));
		},

		async startAuthorization({ institution, state, redirectUrl }) {
			const body = {
				access: {
					valid_until: consentValidUntil(
						Date.now(),
						institution.maximumConsentValidity,
					).toISOString(),
				},
				aspsp: { name: institution.name, country: institution.country },
				state,
				redirect_url: redirectUrl,
				psu_type: "personal",
				language: "fr",
			};

			try {
				return await call(config, { method: "POST", path: "/auth", body }, authResponseSchema);
			} catch (error) {
				// Sure names the URL to register rather than a bare failure.
				if (
					error instanceof BankProviderError &&
					error.failure.providerCode === "REDIRECT_URI_NOT_ALLOWED"
				) {
					throw new BankProviderError(
						"BANK_REDIRECT_NOT_ALLOWED",
						"Register the redirect URL in the Enable Banking control panel.",
						error.failure,
						{ url: redirectUrl },
					);
				}

				throw error;
			}
		},

		async completeAuthorization(code) {
			const session = await call(
				config,
				{ method: "POST", path: "/sessions", body: { code } },
				sessionResponseSchema,
			);

			return {
				sessionId: session.session_id,
				consentExpiresAt: session.access.valid_until,
				accounts: session.accounts.map(toBankAccount),
			};
		},

		async revokeAuthorization(sessionId) {
			await call(
				config,
				{ method: "DELETE", path: `/sessions/${encodeURIComponent(sessionId)}` },
				revokeResponseSchema,
			);
		},

		fetchBalance,

		async fetchStatement(uid, since, today): Promise<BankStatement> {
			const { lines, interrupted, from } = await readFrom(uid, since, fallbackStarts(since, today));
			const unique = withoutRepeats(lines);
			const unsettled = withoutSettledPending(lines);
			const statement: BankStatement = { transactions: [], rejected: [], from, interrupted };

			for (const [position, raw] of lines.entries()) {
				const kept = unique.has(position) && unsettled.has(position);
				const mapped = kept ? toTransaction(raw, from) : null;

				if (typeof mapped === "string") {
					statement.rejected.push({ ref: String(position), reason: mapped });
				} else if (mapped !== null) {
					statement.transactions.push(mapped);
				}
			}

			return statement;
		},
	};
}
