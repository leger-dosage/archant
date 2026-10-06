import type { DeclareInput } from "../schemas/bills.ts";
import type { TempDatabase } from "./temp-database.ts";

import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";
import { merchants } from "@archant/data/schema/merchants";
import {
	recurringAllocations,
	recurringOccurrences,
} from "@archant/data/schema/recurring-occurrences";

import { createAccount } from "../services/ledger/accounts.ts";
import { linkBankAccount } from "../services/ledger/bank-link.ts";
import { updateTransaction } from "../services/ledger/edits.ts";
import { ingest } from "../services/ledger/ingest.ts";
import { oneByOne } from "../services/ledger/shared.ts";
import { declareBill } from "../services/recurring/bills.ts";
import { createTempDatabase } from "./temp-database.ts";

// A live binding: `useRecurringDatabase` assigns it before each test.
export let temp: TempDatabase;
export const deps = () => ({ db: temp.db, timeZone: "Europe/Paris" });

/**
 * A database per test, as `series.spec.ts`: the pipeline reads every account,
 * so rows left by one test would be matched by the next. The clock starts on
 * `now`, which a test may move with `setToday`.
 */
export function useRecurringDatabase(now: string): void {
	beforeEach(async () => {
		temp = await createTempDatabase();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(now));
	});

	afterEach(async () => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		await temp.dispose();
	});
}

/** Moves the clock to noon, Paris time, of `date`. */
export function setToday(date: string): void {
	vi.setSystemTime(new Date(`${date}T10:00:00Z`));
}

export async function openAccount(currency: "EUR" | "USD" = "EUR"): Promise<string> {
	const created = await createAccount(
		deps(),
		{
			name: `Compte ${currency}`,
			type: "depository",
			subtype: "checking",
			currency,
			openingBalance: toMinorUnits(0),
			openingDate: "2026-01-01",
		},
		{ origin: "user" },
	);

	return created.id;
}

export type Row = { date: string; amount: number; label?: string; pending?: boolean };

/** Writes `rows` as manual lines, labelled « Prêt immobilier » unless they say otherwise, and answers their ids. */
export async function addRows(
	accountId: string,
	rows: readonly Row[],
	currency: "EUR" | "USD" = "EUR",
): Promise<string[]> {
	const result = await ingest(
		deps(),
		accountId,
		{
			transactions: rows.map((row) => ({
				externalId: null,
				date: row.date,
				amount: toMinorUnits(row.amount),
				currency,
				label: row.label ?? "Prêt immobilier",
				reference: null,
				notes: null,
				pending: row.pending ?? false,
			})),
			balance: null,
			rejected: [],
		},
		{ manual: true },
		{ origin: "user" },
	);

	return result.created;
}

/** Links `accountId` to a bank account of a new connection, and answers the connection's id. */
export async function linkBank(accountId: string): Promise<string> {
	const connectionId = crypto.randomUUID();
	const bankAccountId = crypto.randomUUID();
	await temp.db.insert(bankConnections).values({
		id: connectionId,
		connector: "enable-banking",
		institutionName: "Banque Test",
		country: "FR",
		status: "active",
		createdAt: 0,
		updatedAt: 0,
	});
	await temp.db.insert(bankAccounts).values({
		id: bankAccountId,
		bankConnectionId: connectionId,
		identificationHash: `hash-${bankAccountId}`,
		providerUid: `uid-${bankAccountId}`,
		name: "Compte courant",
		currency: "EUR",
		createdAt: 0,
		updatedAt: 0,
	});
	await linkBankAccount(deps(), accountId, { bankAccountId, balance: null }, { origin: "sync" });

	return connectionId;
}

/** Writes `rows` as a sync of `connectionId` reads them, each keyed by the bank's `ref`. */
export async function syncRows(
	accountId: string,
	connectionId: string,
	rows: readonly (Row & { ref: string })[],
): Promise<string[]> {
	const result = await ingest(
		deps(),
		accountId,
		{
			transactions: rows.map((row) => ({
				externalId: row.ref,
				date: row.date,
				amount: toMinorUnits(row.amount),
				currency: "EUR",
				label: row.label ?? "Prêt immobilier",
				reference: null,
				notes: null,
				pending: row.pending ?? false,
			})),
			balance: null,
			rejected: [],
		},
		{ connectionId, missesFrom: null },
		{ origin: "sync" },
	);

	return result.created;
}

/** Gives every row of `ids` the merchant « Crédit Agricole », created once. */
export async function withMerchant(ids: readonly string[]): Promise<string> {
	await temp.db
		.insert(merchants)
		.values({ id: "ca", name: "Crédit Agricole", createdAt: 0, updatedAt: 0 })
		.onConflictDoNothing();
	await oneByOne(ids, (id) =>
		updateTransaction(deps(), id, { merchantId: "ca" }, { origin: "user" }),
	);

	return "ca";
}

/** The owner's mortgage, 571,29 € monthly from `firstDueOn`, keyed by `entryId`'s row or else its name. */
export async function declareMortgage(accountId: string, overrides: Partial<DeclareInput> = {}) {
	return declareBill(deps(), {
		kind: "bill",
		name: "Prêt immobilier",
		amount: "571,29",
		accountId,
		firstDueOn: "2026-08-05",
		frequency: { preset: "monthly" },
		...overrides,
	});
}

/** A series' occurrences, by due date. */
export function occurrencesOf(seriesId: string) {
	return temp.db
		.select({
			id: recurringOccurrences.id,
			dueOn: recurringOccurrences.dueOn,
			status: recurringOccurrences.status,
			expectedAmount: recurringOccurrences.expectedAmount,
			closedSource: recurringOccurrences.closedSource,
		})
		.from(recurringOccurrences)
		.where(eq(recurringOccurrences.recurringTransactionId, seriesId))
		.orderBy(asc(recurringOccurrences.dueOn));
}

/** Every payment, by its occurrence's due date. */
export function payments() {
	return temp.db
		.select({
			id: recurringAllocations.id,
			dueOn: recurringOccurrences.dueOn,
			entryId: recurringAllocations.entryId,
			amount: recurringAllocations.allocatedAmount,
			state: recurringAllocations.state,
			source: recurringAllocations.source,
			confidence: recurringAllocations.matchConfidence,
			paidOn: recurringAllocations.paidOn,
		})
		.from(recurringAllocations)
		.innerJoin(
			recurringOccurrences,
			eq(recurringOccurrences.id, recurringAllocations.recurringOccurrenceId),
		)
		.orderBy(asc(recurringOccurrences.dueOn), asc(recurringAllocations.createdAt));
}
