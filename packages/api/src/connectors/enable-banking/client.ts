import type { IsoDate } from "../../domain/dates.ts";
import type {
	NormalizedTransaction,
	ParsedStatement,
	RejectionCode,
} from "../../domain/statement.ts";
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

import { providerIsoDate } from "../../domain/provider-date.ts";
import { LABEL_MAX_LENGTH, NOTES_MAX_LENGTH } from "../../schemas/transactions.ts";
import { BankProviderError } from "../bank-connector.ts";
import { signJwt } from "./jwt.ts";
import {
	aspspsResponseSchema,
	authResponseSchema,
	balancesResponseSchema,
	errorResponseSchema,
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

/** Sure asks for 90 days at most, even from a bank that allows 180. */
const MAX_CONSENT_SECONDS = 90 * 86_400;

// A bank's listing can be slow; a request stuck longer is not coming back.
const TIMEOUT_MS = 30_000;

/**
 * When the consent asked for ends: the bank's own maximum, capped at 90
 * days, as Sure does.
 */
export function consentValidUntil(now: number, maximumConsentValidity: number | null): Date {
	const seconds = Math.min(maximumConsentValidity ?? MAX_CONSENT_SECONDS, MAX_CONSENT_SECONDS);

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

type Call = { method: "GET" | "POST"; path: string; body?: unknown };

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
	 * hundred pages went by.
	 */
	async function fetchLines(uid: string, since: IsoDate): Promise<unknown[]> {
		const seen = new Set<string>();
		const fromPage = async (continuationKey: string | null, page: number): Promise<unknown[]> => {
			const query = new URLSearchParams({ date_from: since });

			if (continuationKey !== null) {
				query.set("continuation_key", continuationKey);
			}

			const { transactions, continuation_key: next } = await call(
				config,
				{
					method: "GET",
					path: `/accounts/${encodeURIComponent(uid)}/transactions?${query.toString()}`,
				},
				transactionsPageSchema,
			);

			if (next === null || seen.has(next) || page + 1 >= MAX_PAGES) {
				return transactions;
			}

			seen.add(next);

			return [...transactions, ...(await fromPage(next, page + 1))];
		};

		return fromPage(null, 0);
	}

	return {
		id: "enable-banking",

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

		fetchBalance,

		async fetchStatement(uid, since): Promise<BankStatement> {
			const statement: Omit<ParsedStatement, "balance"> = { transactions: [], rejected: [] };

			for (const [position, raw] of (await fetchLines(uid, since)).entries()) {
				const mapped = toTransaction(raw, since);

				if (typeof mapped === "string") {
					statement.rejected.push({ ref: String(position), reason: mapped });
				} else if (mapped !== null) {
					statement.transactions.push(mapped);
				}
			}

			return { ...statement, balance: await fetchBalance(uid) };
		},
	};
}
