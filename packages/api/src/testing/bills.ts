import type { DeclareInput } from "../schemas/bills.ts";
import type { allBills } from "../services/recurring/all-bills.ts";

import type { CurrencyCode } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { AppError } from "../lib/errors.ts";
import { createAccount } from "../services/ledger/accounts.ts";
import { ingest } from "../services/ledger/ingest.ts";
import { deps, occurrencesOf, temp } from "./recurring.ts";

// Helpers the specs of the bill writes and reads share. Their `account` and
// `addRows` take other arguments than `recurring.ts`'s, which the bill specs'
// calls are written against.

export async function account(currency: CurrencyCode = "EUR", name = "Compte") {
	const created = await createAccount(
		deps(),
		{
			name,
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

export async function addRows(
	accountId: string,
	dates: readonly string[],
	label: string,
	amount: number,
	currency: CurrencyCode = "EUR",
) {
	const result = await ingest(
		deps(),
		accountId,
		{
			transactions: dates.map((date) => ({
				externalId: null,
				date,
				amount: toMinorUnits(amount),
				currency,
				label,
				reference: null,
				notes: null,
				pending: false,
			})),
			balance: null,
			rejected: [],
		},
		{ manual: true },
		{ origin: "user" },
	);

	return result.created;
}

export const stored = () => temp.db.select().from(recurringTransactions);

export const bill = (
	accountId: string | null,
	overrides: Partial<DeclareInput> = {},
): DeclareInput => ({
	kind: "bill",
	name: "Eau du Grand Lyon",
	amount: "84,20",
	accountId,
	firstDueOn: "2026-10-10",
	frequency: { preset: "monthly" },
	...overrides,
});

/** The error `promise` rejects with, as the API would answer it. */
export async function refusal(promise: Promise<unknown>) {
	const error = await promise.then(
		() => null,
		(reason: unknown) => reason,
	);

	if (!(error instanceof AppError)) {
		throw new Error("The promise did not reject with an AppError.");
	}

	return error.toJSON().error;
}

export const monthly = (day: number, interval = 1) => ({
	frequency: "monthly",
	interval,
	dayOfMonth: day,
});

export const firstOf = async (seriesId: string) => (await occurrencesOf(seriesId))[0]!;

export const query = (overrides: Partial<Parameters<typeof allBills>[1]> = {}) => ({
	sort: "due" as const,
	...overrides,
});
