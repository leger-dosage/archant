import type { IsoDate } from "../../domain/dates.ts";
import type { NormalizedTransaction, RejectionCode } from "../../domain/statement.ts";
import type {
	BankAccountRef,
	BankBalance,
	BankConnector,
	BankStatement,
	Institution,
	ProviderFailure,
	PsuContext,
} from "../bank-connector.ts";
import type { balanceSchema } from "./schemas.ts";
import type { KeyObject } from "node:crypto";
import type { z } from "zod";

import type { CurrencyCode } from "@archant/data/money";
import { parseAmount, toMinorUnits } from "@archant/data/money";
import type { EnableBankingDetails, TransactionExtra } from "@archant/data/schema/transactions";

import { addDays } from "../../domain/dates.ts";
import { providerIsoDate } from "../../domain/provider-date.ts";
import { NOTES_MAX_LENGTH } from "../../schemas/transactions.ts";
import { BankProviderError, NO_PSU } from "../bank-connector.ts";
import { signJwt } from "./jwt.ts";
import { capped, keyLabelOf, labelOf, merchantNameOf } from "./labels.ts";
import {
	applicationResponseSchema,
	aspspsResponseSchema,
	authResponseSchema,
	balancesResponseSchema,
	errorResponseSchema,
	revokeResponseSchema,
	sessionAccountSchema,
	sessionReadSchema,
	sessionResponseSchema,
	transactionSchema,
	transactionsPageSchema,
} from "./schemas.ts";

export type EnableBankingConfig = {
	applicationId: string;
	privateKey: KeyObject;
	/** `ENABLE_BANKING_API_URL`. */
	apiUrl: string;
	/** `ENABLE_BANKING_CONSENT_DAYS`: the longest consent asked for, in days. */
	consentDays: number;
};

const DAY_SECONDS = 86_400;

/**
 * Sure's `CONSENT_FALLBACK_DAYS`: the shorter consents asked for, in days,
 * when a bank refuses the length it advertised, as Trade Republic does
 * (we-promise/sure#2857).
 */
const CONSENT_FALLBACK_DAYS = [180, 90, 45, 30] as const;

// Sure's `CONSENT_SAFETY_MARGIN_SECONDS`: a consent asked for to the second
// of the bank's maximum is refused by some banks once the request has
// travelled.
const CONSENT_MARGIN_SECONDS = 60;

// A bank's listing can be slow; a request stuck longer is not coming back.
const TIMEOUT_MS = 30_000;

/**
 * Sure's `consent_safety_margin`: a minute off, never the whole of a consent
 * shorter than that.
 */
const shaved = (seconds: number) => seconds - Math.min(CONSENT_MARGIN_SECONDS, seconds - 1);

/**
 * Sure's `consent_seconds_ladder`: the consent lengths to ask for, in
 * seconds and in order. First the bank's own maximum capped at
 * `consentDays`, then each fallback strictly shorter than it, each a minute
 * short, so the ladder always ends.
 */
export function consentLadder(
	maximumConsentValidity: number | null,
	consentDays: number,
): [number, ...number[]] {
	const cap = consentDays * DAY_SECONDS;
	const primary = Math.min(maximumConsentValidity ?? cap, cap);
	// Strictly shorter than `primary` and distinct, so the ladder repeats no
	// length, which Sure's `uniq` ensures.
	const fallbacks = CONSENT_FALLBACK_DAYS.map((days) => days * DAY_SECONDS)
		.filter((seconds) => seconds < primary)
		.map(shaved);

	return [shaved(primary), ...fallbacks];
}

const failed = (status: number | null, providerCode: string | null = null) =>
	new BankProviderError("BANK_PROVIDER_ERROR", "The bank provider request failed.", {
		status,
		providerCode,
	});

/**
 * Sure's `wrong_consent_validity?`: the bank refused the consent's length,
 * so a shorter one may pass. Only the class tells it apart; the provider's
 * message that said so is not kept.
 */
class ConsentLengthRefused extends BankProviderError {}

/**
 * Sure's `wrong_transactions_period?`: the bank refused the period asked
 * for, with the start it suggests, if any.
 */
class PeriodRefused extends BankProviderError {
	readonly suggestedFrom: IsoDate | null;

	constructor(failure: ProviderFailure, suggestedFrom: IsoDate | null) {
		super("BANK_PROVIDER_ERROR", "The bank provider request failed.", failure);
		this.suggestedFrom = suggestedFrom;
	}
}

/**
 * The statuses whose body Sure's `handle_response` never reads, so a refused
 * period under one of them is no refusal there either.
 */
const BODILESS_STATUSES = new Set([401, 403, 404, 408, 429]);

/** Sure's `wrong_consent_validity?`: a 422 `WRONG_REQUEST_PARAMETERS` naming the consent validity. */
const refusesConsentLength = (status: number, error: z.output<typeof errorResponseSchema>) =>
	status === 422 && error.error === "WRONG_REQUEST_PARAMETERS" && error.consentValidity;

/** Sure's `normalize_balance_type`: `closing_booked` and `closingBooked` are one type. */
function normalizedType(type: string): string {
	return type.replaceAll(/[_-]/gu, "").toLowerCase();
}

/**
 * AD-18, Sure's `BALANCE_TYPE_PRIORITY`: booked ledger balances before
 * available ones, which some banks inflate with an arranged overdraft. Each
 * type under its ISO code and Enable Banking's long name.
 */
const BALANCE_PRIORITY = [
	"CLBD",
	"closingBooked",
	"ITBD",
	"interimBooked",
	"OPBD",
	"openingBooked",
	"PRCD",
	"previouslyClosedBooked",
	"XPCD",
	"expected",
	"CLAV",
	"closingAvailable",
	"ITAV",
	"interimAvailable",
].map((type) => normalizedType(type));

/**
 * Sure's `PERIOD_BOUNDARY_TYPES`: a period's opening or the previous one's
 * closing, up to a day old, so a strictly newer `FRESHNESS_TYPES` balance wins.
 */
const PERIOD_BOUNDARY_TYPES = new Set(
	["OPBD", "openingBooked", "PRCD", "previouslyClosedBooked"].map((type) => normalizedType(type)),
);

/**
 * Sure's `FRESHNESS_BALANCE_TYPES`: a forward-looking or informational
 * balance never beats a booked one on its date alone.
 */
const FRESHNESS_TYPES = new Set(
	["XPCD", "expected", "CLAV", "closingAvailable", "ITAV", "interimAvailable"].map((type) =>
		normalizedType(type),
	),
);

/** A card's limit in minor units of the currency it names, `null` when the amount does not read. */
function creditLimitOf(
	limit: z.output<typeof sessionAccountSchema>["credit_limit"],
): BankAccountRef["creditLimit"] {
	if (limit === null || limit === undefined) {
		return null;
	}

	const amount = parseAmount(limit.amount, limit.currency);

	return amount === null ? null : { amount, currency: limit.currency };
}

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
		creditLimit: creditLimitOf(account.credit_limit),
	};
}

/** Sure's `EnableBankingItem::Importer`: a bank looping on its own key stops here. */
export const MAX_PAGES = 100;

/**
 * Sure's `FALLBACK_TRANSACTIONS_DATE_FROM_DAYS`: the windows, in days before
 * today, asked for when a bank refuses the period without suggesting a start
 * that moves it forward.
 */
const FALLBACK_WINDOW_DAYS = [89, 60, 30] as const;

/**
 * Sure's `next_transactions_date_from`: the start to ask for after `refused`
 * was refused at retry `attempt`, counted from 0 on each page. On the first
 * retry, the bank's own `suggested` start when it is later; otherwise the
 * first fallback window ending `today` that starts later than `refused`, so
 * every retry moves forward. `null` once none is left, or after four retries.
 */
export function nextStart(
	refused: IsoDate,
	suggested: IsoDate | null,
	attempt: number,
	today: IsoDate,
): IsoDate | null {
	if (attempt > FALLBACK_WINDOW_DAYS.length) {
		return null;
	}

	if (attempt === 0 && suggested !== null && suggested > refused) {
		return suggested;
	}

	return (
		FALLBACK_WINDOW_DAYS.map((days) => addDays(today, -days)).find((start) => start > refused) ??
		null
	);
}

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

/** Whether a raw line is one the bank lists as pending, `PDNG`. */
function isPending(raw: unknown): boolean {
	const parsed = transactionSchema.safeParse(raw);

	return parsed.success && parsed.data.status === "PDNG";
}

/**
 * Sure's `EnableBankingEntry::Processor#extra`: the exchange rate and the
 * merchant category code the bank sent, and `pending` for a line it has not
 * booked, under `enable_banking`; `null` when none. Never logged.
 */
function extraOf(line: z.output<typeof transactionSchema>): TransactionExtra | null {
	const rate = line.exchange_rate;
	const fxRate = rate?.exchange_rate ?? null;
	const unitCurrency = rate?.unit_currency ?? null;
	const instructed = rate?.instructed_amount?.amount ?? null;
	const details: EnableBankingDetails = {
		...(fxRate === null ? {} : { fx_rate: fxRate }),
		...(unitCurrency === null ? {} : { fx_unit_currency: unitCurrency }),
		...(instructed === null ? {} : { fx_instructed_amount: instructed }),
		...(line.merchant_category_code === null
			? {}
			: { merchant_category_code: line.merchant_category_code }),
		...(line.status === "PDNG" ? { pending: true as const } : {}),
	};

	return Object.keys(details).length === 0 ? null : { enable_banking: details };
}

/**
 * One line as the ledger takes it (AD-18); `null` when it is neither booked
 * nor pending, or dated before `since` because the bank ignored `date_from`;
 * otherwise the reason the line is refused. `knownMerchants` are the
 * household's merchant names, which Sure's label and merchant prefer.
 */
export function toTransaction(
	raw: unknown,
	since: IsoDate,
	knownMerchants: readonly string[],
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

	if (money === null || magnitude === null) {
		return "INVALID_AMOUNT";
	}

	// Sure's `amount_value`: only `CRDT`, compared exactly, is money in; a
	// line without an indicator, or with one Sure does not know, is money out.
	// A bank that signs its amounts but sends no indicator has its income read
	// as spending too, as in Sure: keeping the line beats dropping it.
	const debit = line.credit_debit_indicator !== "CRDT";
	const notes = line.remittance_information.join("\n");

	return {
		// Never `transaction_id`: some banks change it between two reads.
		externalId: line.entry_reference,
		date,
		amount: toMinorUnits(debit ? -Math.abs(magnitude) : Math.abs(magnitude)),
		currency: money.currency,
		label: labelOf(line, debit, knownMerchants),
		keyLabel: keyLabelOf(line, debit),
		reference: null,
		// Every remittance line, the wallet included, as Sure's `notes`.
		notes: notes === "" ? null : capped(notes, NOTES_MAX_LENGTH),
		pending: line.status === "PDNG",
		merchant: merchantNameOf(line, debit, knownMerchants),
		extra: extraOf(line),
	};
}

type RawBalance = z.output<typeof balanceSchema>;

const referenceDate = (balance: RawBalance) =>
	balance.reference_date === null ? null : providerIsoDate(balance.reference_date);

/**
 * Sure's `split_balances_by_currency`: a multi-currency wallet lists one
 * balance per currency under the same type, so only those in the account's
 * currency are kept, else those in the first currency listed.
 */
function splitByCurrency(
	balances: readonly RawBalance[],
	accountCurrency: CurrencyCode | null,
): { kept: RawBalance[]; skipped: RawBalance[]; currency: CurrencyCode | null } {
	const currencies = [...new Set(balances.map((balance) => balance.balance_amount.currency))];
	const [first = null] = currencies;

	if (currencies.length <= 1) {
		return { kept: [...balances], skipped: [], currency: first };
	}

	const currency =
		accountCurrency !== null && currencies.includes(accountCurrency) ? accountCurrency : first;

	return {
		kept: balances.filter((balance) => balance.balance_amount.currency === currency),
		skipped: balances.filter((balance) => balance.balance_amount.currency !== currency),
		currency,
	};
}

/**
 * Sure's `fresher_balance`: the `FRESHNESS_TYPES` balance with the latest
 * `reference_date` strictly after the period boundary's. A date missing or
 * unreadable on either side skips the check.
 */
function fresherThan(boundary: RawBalance, balances: readonly RawBalance[]): RawBalance | null {
	const since = referenceDate(boundary);

	if (since === null) {
		return null;
	}

	let fresher: { balance: RawBalance; date: IsoDate } | null = null;

	for (const balance of balances) {
		const date = referenceDate(balance);

		if (
			FRESHNESS_TYPES.has(normalizedType(balance.balance_type)) &&
			date !== null &&
			date > since &&
			(fresher === null || date > fresher.date)
		) {
			fresher = { balance, date };
		}
	}

	return fresher?.balance ?? null;
}

/**
 * Sure's `select_current_balance`: the first type of `BALANCE_PRIORITY` the
 * bank sent, the last one listed of that type, else the first balance.
 */
function selectBalance(balances: readonly RawBalance[]): RawBalance | null {
	const byType = new Map(
		balances.map((balance) => [normalizedType(balance.balance_type), balance]),
	);

	for (const type of BALANCE_PRIORITY) {
		const balance = byType.get(type);

		if (balance !== undefined) {
			return (PERIOD_BOUNDARY_TYPES.has(type) ? fresherThan(balance, balances) : null) ?? balance;
		}
	}

	return balances[0] ?? null;
}

/**
 * How many balances left out hold money, Sure's
 * `capture_skipped_currency_balances`: one that does not read counts as
 * zero, as `to_d` reads it.
 */
const fundedCount = (skipped: readonly RawBalance[]) =>
	skipped.filter((balance) => {
		const amount = parseAmount(balance.balance_amount.amount, balance.balance_amount.currency);

		return amount !== null && amount !== 0;
	}).length;

/**
 * AD-18: the balance `selectBalance` picks among those in the account's
 * currency, signed and in minor units; `null` when the bank lists none. Its
 * `reference_date` only chose it, as Sure's `select_current_balance`.
 */
function chooseBalance(
	balances: readonly RawBalance[],
	accountCurrency: CurrencyCode | null,
): BankBalance | null {
	const { kept, skipped } = splitByCurrency(balances, accountCurrency);
	const chosen = selectBalance(kept);

	if (chosen === null) {
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
		otherCurrencies: fundedCount(skipped),
	};
}

/**
 * The URL without its trailing slashes. A loop rather than `/\/+$/`, whose
 * backtracking is quadratic on a long run of slashes, as CodeQL flagged.
 */
function withoutTrailingSlashes(url: string): string {
	let end = url.length;

	while (url[end - 1] === "/") {
		end -= 1;
	}

	return url.slice(0, end);
}

/**
 * Sure's `build_psu_headers`: Enable Banking takes either every PSU header
 * a bank requires or none, and only the address can be sent from the
 * server. So `Psu-Ip-Address` goes only to a bank whose required headers,
 * lower-cased, are all `psu-ip-address`, and only with an address stored;
 * any other bank gets none, rather than an incomplete set it would refuse.
 */
export function psuHeaders({ requiredHeaders, ipAddress }: PsuContext): Record<string, string> {
	const required = requiredHeaders.map((header) => header.toLowerCase());

	if (
		required.length === 0 ||
		!required.every((header) => header === "psu-ip-address") ||
		ipAddress === null ||
		ipAddress === ""
	) {
		return {};
	}

	return { "Psu-Ip-Address": ipAddress };
}

type Call = {
	method: "GET" | "POST" | "DELETE";
	path: string;
	body?: unknown;
	/** Sent as they are; only data calls carry any, the PSU ones. */
	headers?: Record<string, string>;
};

async function call<Schema extends z.ZodType>(
	config: EnableBankingConfig,
	{ method, path, body, headers: extra = {} }: Call,
	schema: Schema,
): Promise<z.output<Schema>> {
	const headers: Record<string, string> = {
		...extra,
		authorization: `Bearer ${await signJwt(config.applicationId, config.privateKey)}`,
		accept: "application/json",
	};
	let response: Response;

	try {
		response = await fetch(`${withoutTrailingSlashes(config.apiUrl)}${path}`, {
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

		if (error.success && error.data.periodRefused && !BODILESS_STATUSES.has(response.status)) {
			throw new PeriodRefused(
				{ status: response.status, providerCode: error.data.error },
				error.data.suggestedFrom,
			);
		}

		if (error.success && refusesConsentLength(response.status, error.data)) {
			throw new ConsentLengthRefused("BANK_PROVIDER_ERROR", "The bank provider request failed.", {
				status: response.status,
				providerCode: error.data.error,
			});
		}

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
	async function fetchBalance(
		uid: string,
		currency: CurrencyCode | null,
		psu: PsuContext = NO_PSU,
	): Promise<BankBalance | null> {
		const { balances } = await call(
			config,
			{
				method: "GET",
				path: `/accounts/${encodeURIComponent(uid)}/balances`,
				headers: psuHeaders(psu),
			},
			balancesResponseSchema,
		);

		return chooseBalance(balances, currency);
	}

	/**
	 * One page from `from`, Sure's `get_account_transactions`: while the bank
	 * refuses the period, asked again from `nextStart` with the same key. The
	 * last refusal throws. Returns the page and the start it was accepted from.
	 * Without `includePending`, the page asks `transaction_status=BOOK`, as
	 * Sure's importer; with it, no status, so one read returns both, where
	 * Sure's second `PDNG` read would only double the bank's unattended calls.
	 */
	async function fetchPage(
		uid: string,
		from: IsoDate,
		continuationKey: string | null,
		today: IsoDate,
		includePending: boolean,
		psu: PsuContext,
		attempt = 0,
	): Promise<{ page: z.output<typeof transactionsPageSchema>; from: IsoDate }> {
		const query = new URLSearchParams({ date_from: from });

		if (!includePending) {
			query.set("transaction_status", "BOOK");
		}

		if (continuationKey !== null) {
			query.set("continuation_key", continuationKey);
		}

		try {
			const page = await call(
				config,
				{
					method: "GET",
					path: `/accounts/${encodeURIComponent(uid)}/transactions?${query.toString()}`,
					headers: psuHeaders(psu),
				},
				transactionsPageSchema,
			);

			return { page, from };
		} catch (error) {
			const next =
				error instanceof PeriodRefused
					? nextStart(from, error.suggestedFrom, attempt, today)
					: null;

			if (next === null) {
				throw error;
			}

			return fetchPage(uid, next, continuationKey, today, includePending, psu, attempt + 1);
		}
	}

	/**
	 * Every raw line from `since`, page after page, Sure's
	 * `fetch_paginated_transactions`: it follows the key until none comes
	 * back, it comes back a second time, or a hundred pages went by, each page
	 * asked from `since` and retried on its own; `from` is the latest start a
	 * page was accepted from. After the first page, a 400 or 422 that is no
	 * refused period ends the read with the pages read, as Trade Republic
	 * rejects its own key; `cutShort` names it. Anything else throws.
	 */
	async function fetchLines(
		uid: string,
		since: IsoDate,
		today: IsoDate,
		includePending: boolean,
		psu: PsuContext,
	): Promise<{ lines: unknown[]; from: IsoDate; cutShort: ProviderFailure | null }> {
		const seen = new Set<string>();
		const lines: unknown[] = [];
		const fromPage = async (
			continuationKey: string | null,
			page: number,
			from: IsoDate,
		): Promise<{ from: IsoDate; cutShort: ProviderFailure | null }> => {
			let answer: Awaited<ReturnType<typeof fetchPage>>;

			try {
				answer = await fetchPage(uid, since, continuationKey, today, includePending, psu);
			} catch (error) {
				if (
					page === 0 ||
					!(error instanceof BankProviderError) ||
					error instanceof PeriodRefused ||
					(error.failure.status !== 400 && error.failure.status !== 422)
				) {
					throw error;
				}

				return { from, cutShort: error.failure };
			}

			lines.push(...answer.page.transactions);
			const next = answer.page.continuation_key;
			const latest = answer.from > from ? answer.from : from;

			if (next === null || seen.has(next) || page + 1 >= MAX_PAGES) {
				return { from: latest, cutShort: null };
			}

			seen.add(next);

			return fromPage(next, page + 1, latest);
		};

		return { lines, ...(await fromPage(null, 0, since)) };
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
				requiredPsuHeaders: aspsp.required_psu_headers,
			}));
		},

		/**
		 * Sure's `start_authorization`: each length of `consentLadder` in turn,
		 * dated from the clock at that attempt, while the bank refuses the
		 * consent's length; the last refusal throws, any other failure at once.
		 */
		async startAuthorization({ institution, state, redirectUrl }) {
			const attempt = async (
				seconds: number,
				shorter: readonly number[],
			): Promise<{ url: string }> => {
				const body = {
					access: { valid_until: new Date(Date.now() + seconds * 1000).toISOString() },
					aspsp: { name: institution.name, country: institution.country },
					state,
					redirect_url: redirectUrl,
					psu_type: "personal",
					language: "fr",
				};

				try {
					return await call(config, { method: "POST", path: "/auth", body }, authResponseSchema);
				} catch (error) {
					const [next, ...rest] = shorter;

					if (error instanceof ConsentLengthRefused && next !== undefined) {
						return attempt(next, rest);
					}

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
			};

			const [longest, ...shorter] = consentLadder(
				institution.maximumConsentValidity,
				config.consentDays,
			);

			return attempt(longest, shorter);
		},

		async completeAuthorization(code) {
			const session = await call(
				config,
				{ method: "POST", path: "/sessions", body: { code } },
				sessionResponseSchema,
			);

			const accounts: BankAccountRef[] = [];
			const fields = new Set<string>();
			let dropped = 0;

			for (const raw of session.accounts) {
				const parsed = sessionAccountSchema.safeParse(raw);

				if (parsed.success) {
					accounts.push(toBankAccount(parsed.data));
				} else {
					dropped += 1;

					for (const issue of parsed.error.issues) {
						fields.add(issue.path.length === 0 ? "(account)" : issue.path.map(String).join("."));
					}
				}
			}

			return {
				sessionId: session.session_id,
				consentExpiresAt: session.access.valid_until,
				accounts,
				dropped: { count: dropped, fields: [...fields].toSorted() },
			};
		},

		async revokeAuthorization(sessionId) {
			await call(
				config,
				{ method: "DELETE", path: `/sessions/${encodeURIComponent(sessionId)}` },
				revokeResponseSchema,
			);
		},

		async readSession(sessionId) {
			const session = await call(
				config,
				{ method: "GET", path: `/sessions/${encodeURIComponent(sessionId)}` },
				sessionReadSchema,
			);

			return { consentExpiresAt: session.access?.valid_until ?? null };
		},

		fetchBalance,

		async fetchStatement(
			uid,
			since,
			today,
			knownMerchants,
			includePending,
			psu = NO_PSU,
		): Promise<BankStatement> {
			const { lines, from, cutShort } = await fetchLines(uid, since, today, includePending, psu);
			const unique = withoutRepeats(lines);
			const unsettled = withoutSettledPending(lines);
			const statement: BankStatement = { transactions: [], rejected: [], from, cutShort };

			for (const [position, raw] of lines.entries()) {
				// A bank may ignore `transaction_status=BOOK`: Sure drops its pending lines all the same.
				const kept =
					unique.has(position) && unsettled.has(position) && (includePending || !isPending(raw));
				// From the start asked for, as Sure's `filter_transactions_by_date`:
				// a later page retried from a later start keeps the earlier pages' lines.
				const mapped = kept ? toTransaction(raw, since, knownMerchants) : null;

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
