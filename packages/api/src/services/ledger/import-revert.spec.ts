import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import { imports } from "@archant/data/schema/imports";
import { transactions } from "@archant/data/schema/transactions";

import { addDays } from "../../domain/dates.ts";
import {
	add,
	cafe,
	checking,
	closingOn,
	counts,
	deps,
	entryImport,
	history,
	importStatement,
	keysOf,
	line,
	linkedAccount,
	newTag,
	openChecking,
	preview,
	previewRow,
	revert,
	salary,
	setToday,
	snapshot,
	snapshotsOf,
	statementOf,
	tagsOf,
	temp,
	transactionCount,
	valuationsOf,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { createTempDatabase } from "../../testing/temp-database.ts";
import { createAccount } from "./accounts.ts";
import { balanceOn, openingDateOf } from "./balances.ts";
import { updateTransaction } from "./edits.ts";
import { removableOf, revertImport } from "./import-revert.ts";
import { entryOrigins, findTransaction } from "./queries.ts";
import { updateSnapshot } from "./snapshots.ts";

useLedgerDatabase();

/** The daily balances from `date` on, as `history` gives them. */
async function historyFrom(accountId: string, date: string) {
	const all = await history(accountId);

	return new Map([...all].filter(([day]) => day >= date));
}

// Story 2.5: the history and the revert.

async function importOf(importId: string) {
	return temp.db.select().from(imports).where(eq(imports.id, importId)).get();
}

describe("the creation marker", () => {
	it("marks the created lines and the possible duplicates, never a matched entry", async () => {
		const account = await openChecking();
		const manual = await add(account.id, { date: "2026-09-03", amount: toMinorUnits(-777) });
		await add(account.id, { date: "2026-09-14", amount: toMinorUnits(-1000) });
		await add(account.id, { date: "2026-09-16", amount: toMinorUnits(-1000) });

		const { importId, result } = await importStatement(
			account.id,
			statementOf(
				cafe,
				line({ date: "2026-09-04", amount: toMinorUnits(-777), label: "Parking" }),
				line({ date: "2026-09-15", amount: toMinorUnits(-1000), label: "Péage" }),
			),
		);

		expect(counts(result)).toMatchObject({ created: 1, matched: 1, duplicates: 1 });
		const [created = "", duplicate = ""] = result.created;
		await expect(entryImport(created)).resolves.toBe(importId);
		await expect(entryImport(duplicate)).resolves.toBe(importId);
		await expect(entryImport(manual)).resolves.toBeNull();
	});

	it("leaves a manual line unmarked", async () => {
		const account = await openChecking();

		const id = await add(account.id);

		await expect(entryImport(id)).resolves.toBeNull();
	});

	it("stores where the opening stood only when the import moves it", async () => {
		const account = await openChecking();

		const kept = await importStatement(account.id, statementOf(cafe));
		const moved = await importStatement(
			account.id,
			statementOf(line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" })),
			{ moveOpeningDate: "2026-08-19" },
		);

		await expect(importOf(kept.importId)).resolves.toMatchObject({ previousOpeningDate: null });
		await expect(importOf(moved.importId)).resolves.toMatchObject({
			previousOpeningDate: "2026-09-01",
			revertedAt: null,
		});
	});
});

describe("revertImport", () => {
	it("deletes what the import created, its keys and its snapshot, and puts the balances back", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-05", amount: toMinorUnits(-1500), label: "Pharmacie" });
		const before = await history(account.id);
		const { importId, result } = await importStatement(account.id, closingOn(240861));
		const [cafeId = ""] = result.created;

		const reverted = await revert(importId);

		expect(reverted).toEqual({
			accountId: account.id,
			removed: { transactions: 2, snapshot: 1 },
		});
		await expect(findTransaction(deps(), cafeId)).resolves.toBeNull();
		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(snapshotsOf(account.id)).resolves.toEqual([]);
		await expect(
			temp.db.select().from(entryKeys).where(eq(entryKeys.importId, importId)),
		).resolves.toEqual([]);
		await expect(
			temp.db.select().from(transactions).where(eq(transactions.entryId, cafeId)),
		).resolves.toEqual([]);
		await expect(history(account.id)).resolves.toEqual(before);
		const stored = await importOf(importId);
		expect(stored).toMatchObject({ status: "reverted", counts: counts(result) });
		expect(typeof stored?.revertedAt).toBe("number");
	});

	it("keeps a matched manual entry as it was, without the import's keys", async () => {
		const account = await openChecking();
		const manual = await add(account.id, {
			date: "2026-09-03",
			amount: toMinorUnits(-4290),
			label: "Café",
		});
		const before = await history(account.id);
		const { importId } = await importStatement(
			account.id,
			statementOf({ ...cafe, date: "2026-09-05" }),
		);

		await expect(revert(importId)).resolves.toMatchObject({
			removed: { transactions: 0, snapshot: 0 },
		});

		await expect(findTransaction(deps(), manual)).resolves.toMatchObject({
			date: "2026-09-03",
			label: "Café",
			amount: -4290,
		});
		await expect(keysOf(manual)).resolves.toEqual([]);
		await expect(entryOrigins(deps(), [manual])).resolves.toEqual(new Map());
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("keeps an entry another source confirmed since, with that source's key", async () => {
		const account = await openChecking();
		const ofx = await importStatement(account.id, statementOf(cafe));
		const [id = ""] = ofx.result.created;
		const csv = await importStatement(
			account.id,
			statementOf({ ...cafe, externalId: null, date: "2026-09-11", label: "CARTE CAFE" }),
			{ source: "csv" },
		);
		expect(csv.result.groups.matched).toEqual([expect.objectContaining({ entryId: id })]);

		await expect(revert(ofx.importId)).resolves.toMatchObject({
			removed: { transactions: 0, snapshot: 0 },
		});

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ label: "CB Café" });
		await expect(entryImport(id)).resolves.toBeNull();
		const keys = await temp.db
			.select({ source: entryKeys.source, importId: entryKeys.importId })
			.from(entryKeys)
			.where(eq(entryKeys.entryId, id));
		expect(keys).toEqual([{ source: "csv", importId: csv.importId }]);
	});

	it("deletes the taggings of the transactions it deletes", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const { importId, result } = await importStatement(account.id, statementOf(cafe, salary));
		const [cafeId = "", salaryId = ""] = result.created;
		await updateTransaction(deps(), cafeId, { tagIds: [holidays] }, { origin: "user" });
		await updateTransaction(deps(), salaryId, { tagIds: [holidays] }, { origin: "user" });

		await expect(revert(importId)).resolves.toMatchObject({ removed: { transactions: 2 } });

		await expect(tagsOf(cafeId)).resolves.toEqual([]);
		await expect(tagsOf(salaryId)).resolves.toEqual([]);
	});

	it("deletes a transaction the user edited since the import", async () => {
		const account = await openChecking();
		const before = await history(account.id);
		const { importId, result } = await importStatement(account.id, statementOf(cafe));
		const [id = ""] = result.created;
		await updateTransaction(deps(), id, { label: "Café du matin" }, { origin: "user" });

		await revert(importId);

		await expect(findTransaction(deps(), id)).resolves.toBeNull();
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("keeps a snapshot the user edited since the import", async () => {
		const account = await openChecking();
		const { importId } = await importStatement(account.id, closingOn(240861));
		const [written] = await snapshotsOf(account.id);
		await updateSnapshot(
			deps(),
			written?.id ?? "",
			{ balance: toMinorUnits(240000) },
			{
				origin: "user",
			},
		);

		await expect(revert(importId)).resolves.toMatchObject({
			removed: { transactions: 2, snapshot: 0 },
		});

		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ id: written?.id, balance: 240000, importId: null }),
		]);
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: 240000,
		});
	});

	it("leaves a snapshot a newer file took over on that date", async () => {
		const account = await openChecking();
		const first = await importStatement(account.id, closingOn(240861));
		const newer = await importStatement(account.id, closingOn(250000));

		await expect(revert(first.importId)).resolves.toMatchObject({
			removed: { transactions: 2, snapshot: 0 },
		});

		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ balance: 250000, importId: newer.importId }),
		]);
	});

	it("puts the opening date and amount back, with no balance before it", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-1000) });
		const before = await history(account.id);
		const { importId } = await importStatement(
			account.id,
			statementOf(
				line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" }),
				line({ date: "2026-09-01", amount: toMinorUnits(5000), label: "Remboursement" }),
				line({ date: "2026-09-15", amount: toMinorUnits(-300), label: "Pain" }),
			),
			{ moveOpeningDate: "2026-08-19" },
		);

		await expect(revert(importId)).resolves.toMatchObject({
			removed: { transactions: 3, snapshot: 0 },
		});

		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-09-01");
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
		]);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("reads the same file the same way once reverted", async () => {
		const account = await openChecking();
		const file = statementOf(
			line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" }),
			line({ date: "2026-09-05", amount: toMinorUnits(-300), label: "Pain" }),
		);
		const first = await importStatement(account.id, file, { moveOpeningDate: "2026-08-19" });
		const imported = await history(account.id);

		await revert(first.importId);
		const { result } = await importStatement(account.id, file, {
			moveOpeningDate: "2026-08-19",
		});

		expect(counts(result)).toMatchObject({ created: 2, rejected: 0 });
		await expect(history(account.id)).resolves.toEqual(imported);
	});

	it("stops the opening date the day before a line another source still holds", async () => {
		const account = await openChecking();
		const first = await importStatement(
			account.id,
			statementOf(
				line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" }),
				line({ date: "2026-08-25", amount: toMinorUnits(-700), label: "Pain" }),
			),
			{ moveOpeningDate: "2026-08-19" },
		);
		const csv = await importStatement(
			account.id,
			statementOf(line({ date: "2026-08-26", amount: toMinorUnits(-700), label: "CB PAIN" })),
			{ source: "csv" },
		);
		expect(counts(csv.result)).toMatchObject({ matched: 1 });
		const kept = await historyFrom(account.id, "2026-08-24");

		await expect(revert(first.importId)).resolves.toMatchObject({
			removed: { transactions: 1, snapshot: 0 },
		});

		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-08-24");
		// 1 234,56 + 27,00 shifted in, less the 20,00 given back.
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-08-24", amount: 123456 + 700 },
		]);
		await expect(history(account.id)).resolves.toEqual(kept);
		await expect(balanceOn(deps(), account.id, "2026-09-01")).resolves.toMatchObject({
			amount: 123456,
		});
	});

	it("stops the opening date the day before a snapshot, whatever the entry's kind", async () => {
		const account = await openChecking();
		const { importId } = await importStatement(
			account.id,
			statementOf(line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" })),
			{ moveOpeningDate: "2026-08-19" },
		);
		const kept = await snapshot(account.id, "2026-08-22", 120000);

		await revert(importId);

		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-08-21");
		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ id: kept, date: "2026-08-22", balance: 120000 }),
		]);
		const [first] = (await history(account.id)).keys();
		expect(first).toBe("2026-08-21");
	});

	it("keeps the opening where a later import moved it further", async () => {
		const account = await openChecking();
		const alone = await openChecking();
		const later = statementOf(
			line({ date: "2026-08-10", amount: toMinorUnits(-500), label: "Pain" }),
		);
		const first = await importStatement(
			account.id,
			statementOf(line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" })),
			{ moveOpeningDate: "2026-08-19" },
		);
		await importStatement(account.id, later, { moveOpeningDate: "2026-08-09" });
		await importStatement(alone.id, later, { moveOpeningDate: "2026-08-09" });

		await revert(first.importId);

		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-08-09");
		await expect(history(account.id)).resolves.toEqual(await history(alone.id));
	});

	it("undoes two moves fully when reverted in reverse order", async () => {
		const account = await openChecking();
		const before = await history(account.id);
		const first = await importStatement(
			account.id,
			statementOf(line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" })),
			{ moveOpeningDate: "2026-08-19" },
		);
		const second = await importStatement(
			account.id,
			statementOf(line({ date: "2026-08-10", amount: toMinorUnits(-500), label: "Pain" })),
			{ moveOpeningDate: "2026-08-09" },
		);

		await revert(second.importId);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-08-19", amount: 123456 + 2000 },
		]);

		await revert(first.importId);

		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
		]);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("gives a credit card's opening back its amount owed and its date", async () => {
		const card = await openChecking({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(50000),
		});
		const before = await history(card.id);
		const { importId, result } = await importStatement(
			card.id,
			statementOf(line({ date: "2026-08-25", amount: toMinorUnits(-3000), label: "Achat" })),
			{ moveOpeningDate: "2026-08-24" },
		);
		expect(result.opening).toEqual({ date: "2026-08-24", balance: 47000 });

		await revert(importId);

		await expect(valuationsOf(card.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 50000 },
		]);
		await expect(history(card.id)).resolves.toEqual(before);
	});

	it("puts a bank-linked account's opening date back and derives its balances from there", async () => {
		const { account } = await linkedAccount();
		const before = await history(account.id);
		const { importId } = await importStatement(
			account.id,
			statementOf(line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" })),
			{ moveOpeningDate: "2026-08-19" },
		);
		await expect(balanceOn(deps(), account.id, "2026-08-19")).resolves.toMatchObject({
			amount: 102000,
		});

		await revert(importId);

		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-09-01");
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("deletes the possible duplicates the import created, and counts them beforehand", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-04", amount: toMinorUnits(-1000) });
		await add(account.id, { date: "2026-09-06", amount: toMinorUnits(-1000) });
		const before = await history(account.id);
		const { importId, result } = await importStatement(
			account.id,
			statementOf(line({ date: "2026-09-05", amount: toMinorUnits(-1000), label: "Péage" })),
		);
		expect(counts(result)).toMatchObject({ created: 0, duplicates: 1 });
		const [duplicate = ""] = result.created;

		await expect(removableOf(deps(), [importId])).resolves.toEqual(
			new Map([[importId, { transactions: 1, snapshot: 0 }]]),
		);
		await expect(revert(importId)).resolves.toMatchObject({
			removed: { transactions: 1, snapshot: 0 },
		});

		await expect(findTransaction(deps(), duplicate)).resolves.toBeNull();
		await expect(transactionCount(account.id)).resolves.toBe(2);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("lets the same file be imported again, every line created anew", async () => {
		const account = await openChecking();
		const { importId } = await importStatement(account.id, closingOn(240861));
		await revert(importId);

		const { result } = await preview(account.id, closingOn(240861));

		expect(counts(result)).toMatchObject({ created: 2, present: 0 });
		expect(result.balance).toMatchObject({ status: "recorded" });
	});

	it("refuses an import reverted already or only previewed, and changes nothing", async () => {
		const account = await openChecking();
		const { importId } = await importStatement(account.id, statementOf(cafe));
		await revert(importId);
		const pending = await previewRow(account.id);
		const before = await history(account.id);

		await expect(revert(importId)).rejects.toMatchObject({ code: "IMPORT_NOT_REVERTABLE" });
		await expect(revert(pending)).rejects.toMatchObject({ code: "IMPORT_NOT_REVERTABLE" });
		await expect(revert("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });

		await expect(importOf(pending)).resolves.toMatchObject({ status: "previewed" });
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("reverts 5,000 lines in one transaction", async () => {
		const big = await createTempDatabase();

		try {
			setToday("2026-09-21T10:00:00Z");
			const bigDeps = { db: big.db, timeZone: "Europe/Paris" };
			const account = await createAccount(
				bigDeps,
				{ ...checking, openingDate: "2016-01-01" },
				{ origin: "user" },
			);
			const before = await big.db
				.select()
				.from(balances)
				.where(eq(balances.accountId, account.id))
				.orderBy(balances.date);
			const lines = statementOf(
				...Array.from({ length: 5000 }, (_, index) =>
					line({
						externalId: `F${index}`,
						date: addDays("2016-01-02", index % 3800),
						amount: toMinorUnits(-(index + 1)),
						label: `Opération ${index}`,
					}),
				),
			);
			const { importId } = await importStatement(account.id, lines, { db: big.db });
			const started = performance.now();

			const reverted = await revertImport(bigDeps, importId, { origin: "user" });

			expect(performance.now() - started).toBeLessThan(10_000);
			expect(reverted.removed).toEqual({ transactions: 5000, snapshot: 0 });
			await expect(
				big.db.select({ id: entries.id }).from(entries).where(eq(entries.kind, "transaction")),
			).resolves.toEqual([]);
			await expect(big.db.select().from(entryKeys)).resolves.toEqual([]);
			await expect(
				big.db
					.select()
					.from(balances)
					.where(eq(balances.accountId, account.id))
					.orderBy(balances.date),
			).resolves.toEqual(before);
		} finally {
			await big.dispose();
		}
	}, 60_000);
});

describe("removableOf", () => {
	it("counts what a revert would delete now, per import", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-03", amount: toMinorUnits(-777) });
		const snapshotted = await importStatement(account.id, closingOn(240861));
		const matchedOnly = await importStatement(
			account.id,
			statementOf(line({ date: "2026-09-04", amount: toMinorUnits(-777), label: "Parking" })),
			{ source: "csv" },
		);
		// A CSV line confirming the café the OFX file created: one fewer to delete.
		await importStatement(
			account.id,
			statementOf({ ...cafe, externalId: null, date: "2026-09-11", label: "CARTE CAFE" }),
			{ source: "csv" },
		);

		const removable = await removableOf(deps(), [snapshotted.importId, matchedOnly.importId]);

		expect(removable).toEqual(
			new Map([
				[snapshotted.importId, { transactions: 1, snapshot: 1 }],
				[matchedOnly.importId, { transactions: 0, snapshot: 0 }],
			]),
		);
		await expect(removableOf(deps(), [])).resolves.toEqual(new Map());
	});
});
