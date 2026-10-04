import type { TempDatabase } from "../../testing/temp-database.ts";

import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";
import { goalAccounts, goals } from "@archant/data/schema/goals";
import { imports } from "@archant/data/schema/imports";
import { transactions } from "@archant/data/schema/transactions";

import * as forward from "../../domain/balances/forward.ts";
import {
	add,
	checking,
	closingOn,
	deps,
	importStatement,
	newTag,
	openChecking,
	openPinned,
	setToday,
	snapshot,
	splitInTwo,
	tagsOf,
	temp,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { createTempDatabase } from "../../testing/temp-database.ts";
import { createAccount, deleteAccount } from "./accounts.ts";
import { balanceOn } from "./balances.ts";
import { updateTransaction } from "./edits.ts";

useLedgerDatabase();

describe("createAccount", () => {
	it("stores the account, one opening anchor and a balance for every day up to today", async () => {
		setToday("2026-09-21T10:00:00Z");

		const account = await createAccount(deps(), checking, { origin: "user" });

		const stored = await temp.db.select().from(accounts).where(eq(accounts.id, account.id)).get();
		expect(stored).toMatchObject({
			name: "Compte joint",
			type: "depository",
			subtype: "checking",
			currency: "EUR",
		});

		const anchors = await temp.db.select().from(entries).where(eq(entries.accountId, account.id));
		expect(anchors).toEqual([
			expect.objectContaining({
				kind: "valuation",
				valuationKind: "opening_anchor",
				date: "2026-09-01",
				amount: 123456,
				currency: "EUR",
			}),
		]);

		const days = await temp.db
			.select()
			.from(balances)
			.where(eq(balances.accountId, account.id))
			.orderBy(balances.date);
		expect(days).toHaveLength(21);
		expect(days[0]).toMatchObject({ date: "2026-09-01", balance: 123456, currency: "EUR" });
		expect(days.at(-1)).toMatchObject({ date: "2026-09-21", balance: 123456 });
	});

	it("takes today in the application time zone, not in UTC", async () => {
		// 23:30 UTC on the 21st is already the 22nd in Paris.
		setToday("2026-09-21T23:30:00Z");

		const account = await createAccount(deps(), checking, { origin: "user" });

		await expect(balanceOn(deps(), account.id, "2026-09-22")).resolves.toEqual({
			amount: 123456,
			currency: "EUR",
		});
		const last = await temp.db
			.select()
			.from(balances)
			.where(eq(balances.accountId, account.id))
			.orderBy(balances.date);
		expect(last.at(-1)?.date).toBe("2026-09-22");
	});

	it("writes a long history in several statements", async () => {
		setToday("2026-09-21T10:00:00Z");

		const account = await createAccount(
			deps(),
			{ ...checking, openingDate: "2023-01-01" },
			{ origin: "user" },
		);

		const days = await temp.db.select().from(balances).where(eq(balances.accountId, account.id));
		expect(days).toHaveLength(1360);
	});

	it("keeps a credit card's amount owed as a positive stored balance", async () => {
		setToday("2026-09-21T10:00:00Z");

		const card = await createAccount(
			deps(),
			{
				...checking,
				name: "Carte",
				type: "credit_card",
				subtype: null,
				openingBalance: toMinorUnits(49030),
				openingDate: "2026-09-21",
			},
			{ origin: "user" },
		);

		await expect(balanceOn(deps(), card.id, "2026-09-21")).resolves.toEqual({
			amount: 49030,
			currency: "EUR",
		});
	});

	it("writes nothing when the last step fails", async () => {
		setToday("2026-09-21T10:00:00Z");
		const accountsBefore = await temp.db.select().from(accounts);
		const entriesBefore = await temp.db.select().from(entries);
		// Two rows for one day break the balances primary key, after the account
		// and its opening anchor are already inserted.
		const row = { date: "2026-09-21", balance: toMinorUnits(1) };
		vi.spyOn(forward, "forwardBalances").mockReturnValue([row, row]);

		await expect(createAccount(deps(), checking, { origin: "user" })).rejects.toThrow();

		await expect(temp.db.select().from(accounts)).resolves.toEqual(accountsBefore);
		await expect(temp.db.select().from(entries)).resolves.toEqual(entriesBefore);
	});
});

/** Every row an account owns, in the four tables `deleteAccount` clears. */
async function rowsOf(db: TempDatabase["db"], accountId: string) {
	const accountRows = await db.select().from(accounts).where(eq(accounts.id, accountId));
	const entryRows = await db.select().from(entries).where(eq(entries.accountId, accountId));
	const transactionRows = await db
		.select({ entryId: transactions.entryId })
		.from(transactions)
		.innerJoin(entries, eq(entries.id, transactions.entryId))
		.where(eq(entries.accountId, accountId));
	const balanceRows = await db.select().from(balances).where(eq(balances.accountId, accountId));

	return {
		accounts: accountRows.length,
		entries: entryRows.length,
		transactions: transactionRows.length,
		balances: balanceRows.length,
	};
}

describe("deleteAccount", () => {
	it("removes the account, its transactions, snapshots, opening anchor and balances", async () => {
		const account = await openPinned();
		await add(account.id, { date: "2026-04-01" });
		await add(account.id, { date: "2026-05-01" });
		await snapshot(account.id, "2026-03-05", 200000);
		const other = await openPinned({ name: "Livret A", subtype: "savings" });
		const otherBefore = await rowsOf(temp.db, other.id);

		await deleteAccount(deps(), account.id, { origin: "user" });

		await expect(rowsOf(temp.db, account.id)).resolves.toEqual({
			accounts: 0,
			entries: 0,
			transactions: 0,
			balances: 0,
		});
		await expect(rowsOf(temp.db, other.id)).resolves.toEqual(otherBefore);
		expect(otherBefore).toMatchObject({ accounts: 1, entries: 2, transactions: 1 });
		await expect(balanceOn(deps(), other.id, "2026-09-21")).resolves.toMatchObject({
			amount: 138000,
		});
	});

	it("removes an import's snapshot before the import it points at", async () => {
		const account = await openChecking();
		await importStatement(account.id, closingOn(240861));

		await deleteAccount(deps(), account.id, { origin: "user" });

		await expect(rowsOf(temp.db, account.id)).resolves.toMatchObject({ accounts: 0, entries: 0 });
		await expect(
			temp.db.select().from(imports).where(eq(imports.accountId, account.id)),
		).resolves.toEqual([]);
	});

	it("removes the taggings of its transactions, keeping the tags and other accounts' taggings", async () => {
		const account = await openChecking();
		const other = await openChecking({ name: "Livret A", subtype: "savings" });
		const holidays = await newTag("Vacances");
		const mine = await add(account.id);
		const theirs = await add(other.id);
		await updateTransaction(deps(), mine, { tagIds: [holidays] }, { origin: "user" });
		await updateTransaction(deps(), theirs, { tagIds: [holidays] }, { origin: "user" });

		await deleteAccount(deps(), account.id, { origin: "user" });

		await expect(rowsOf(temp.db, account.id)).resolves.toMatchObject({ transactions: 0 });
		await expect(tagsOf(mine)).resolves.toEqual([]);
		await expect(tagsOf(theirs)).resolves.toEqual([holidays]);
	});

	it("removes a split's children before their parent", async () => {
		const account = await openChecking();
		const { food } = await splitInTwo(account.id);
		await updateTransaction(
			deps(),
			food,
			{ tagIds: [await newTag("Divisée")] },
			{ origin: "user" },
		);

		await deleteAccount(deps(), account.id, { origin: "user" });

		await expect(rowsOf(temp.db, account.id)).resolves.toMatchObject({ transactions: 0 });
		await expect(tagsOf(food)).resolves.toEqual([]);
	});

	it("removes the account's goal links, keeping the goal and its other account", async () => {
		const account = await openChecking({ name: "Livret A", subtype: "savings" });
		const other = await openChecking({ name: "LDDS", subtype: "savings" });
		await temp.db.insert(goals).values({
			id: "goal-1",
			name: "Vacances",
			targetAmount: 100_000,
			currency: "EUR",
			color: "#27a644",
			icon: "piggy-bank",
			createdAt: 0,
			updatedAt: 0,
		});
		await temp.db.insert(goalAccounts).values([
			{ goalId: "goal-1", accountId: account.id, allocatedAmount: null },
			{ goalId: "goal-1", accountId: other.id, allocatedAmount: 20_000 },
		]);

		await deleteAccount(deps(), account.id, { origin: "user" });

		await expect(temp.db.select().from(goalAccounts)).resolves.toEqual([
			{ goalId: "goal-1", accountId: other.id, allocatedAmount: 20_000 },
		]);
		await expect(temp.db.select({ id: goals.id }).from(goals)).resolves.toEqual([{ id: "goal-1" }]);
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		await expect(deleteAccount(deps(), "nope", { origin: "user" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("deletes more transactions than SQLite binds parameters in one statement", async () => {
		const big = await createTempDatabase();

		try {
			setToday("2026-09-21T10:00:00Z");
			const bigDeps = { db: big.db, timeZone: "Europe/Paris" };
			const account = await createAccount(
				bigDeps,
				{ ...checking, openingDate: "2016-01-01" },
				{ origin: "user" },
			);
			vi.useRealTimers();
			// Past the 32 766 parameters a list of ids would bind.
			const ids = Array.from({ length: 33_000 }, () => crypto.randomUUID());
			const chunks = Array.from({ length: Math.ceil(ids.length / 2000) }, (_, index) =>
				ids.slice(index * 2000, (index + 1) * 2000),
			);

			// Seeded directly, as `history-volume.spec.ts` does: only the delete is under test.
			await chunks.reduce(async (previous, chunk) => {
				await previous;
				await big.db.insert(entries).values(
					chunk.map((id) => ({
						id,
						accountId: account.id,
						kind: "transaction" as const,
						date: "2026-01-02",
						amount: -1,
						currency: "EUR",
						createdAt: 0,
						updatedAt: 0,
					})),
				);
				await big.db
					.insert(transactions)
					.values(chunk.map((id) => ({ entryId: id, label: "Opération", notes: null })));
			}, Promise.resolve());

			await deleteAccount(bigDeps, account.id, { origin: "user" });

			await expect(rowsOf(big.db, account.id)).resolves.toEqual({
				accounts: 0,
				entries: 0,
				transactions: 0,
				balances: 0,
			});
		} finally {
			await big.dispose();
		}
	}, 60_000);
});
