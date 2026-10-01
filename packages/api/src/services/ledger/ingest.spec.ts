import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { categories } from "@archant/data/schema/categories";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import { imports } from "@archant/data/schema/imports";
import { rules } from "@archant/data/schema/rules";
import { transactions } from "@archant/data/schema/transactions";

import * as forward from "../../domain/balances/forward.ts";
import { addDays } from "../../domain/dates.ts";
import {
	add,
	addStandard,
	cafe,
	categoryOf,
	categoryOriginOf,
	checking,
	closingOn,
	confirm,
	counts,
	deps,
	entryImport,
	excludedOf,
	expectedOf,
	history,
	importStatement,
	keyRows,
	keysOf,
	labelLike,
	line,
	link,
	linkedChecking,
	lockedFields,
	merchantOf,
	newBankAccount,
	newBankLine,
	newCategory,
	newMerchant,
	newTag,
	openChecking,
	openHousehold,
	preview,
	previewRow,
	rejectedRows,
	revert,
	salary,
	setToday,
	snapshot,
	snapshotsOf,
	statementOf,
	sync,
	tagsOf,
	temp,
	transactionCount,
	transferAmount,
	transferRows,
	valuationsOf,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { createTempDatabase } from "../../testing/temp-database.ts";
import { createRule, setRuleEnabled } from "../rules.ts";
import { createAccount, deleteAccount } from "./accounts.ts";
import { balanceOn, openingDateOf } from "./balances.ts";
import { updateTransaction } from "./edits.ts";
import { removableOf } from "./import-revert.ts";
import { ingest } from "./ingest.ts";
import { entryOrigins, findTransaction, listTransactions } from "./queries.ts";
import { listSnapshots, updateSnapshot } from "./snapshots.ts";
import { rejectTransfer } from "./transfers.ts";

useLedgerDatabase();

describe("ingest", () => {
	it("records an expense and recomputes the balance from its date", async () => {
		const account = await openChecking();

		const id = await add(account.id);

		await expect(findTransaction(deps(), id)).resolves.toEqual({
			id,
			accountId: account.id,
			date: "2026-09-10",
			amount: -4290,
			currency: "EUR",
			label: "Boulangerie",
			notes: null,
			reference: null,
			excluded: false,
			pending: false,
			categoryId: null,
			merchantId: null,
			tagIds: [],
			transfer: null,
			transferSuggested: false,
			possibleDuplicate: false,
		});
		const days = await history(account.id);
		expect(days.size).toBe(21);
		expect(days.get("2026-09-09")).toBe(123456);
		expect(days.get("2026-09-10")).toBe(119166);
		expect(days.get("2026-09-21")).toBe(119166);
	});

	it("raises a card's amount owed on a purchase", async () => {
		const card = await openChecking({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(49030),
		});

		await add(card.id, { amount: toMinorUnits(-3000) });

		await expect(balanceOn(deps(), card.id, "2026-09-21")).resolves.toEqual({
			amount: 52030,
			currency: "EUR",
		});
	});

	it("locks every field a user filled, notes included when present", async () => {
		const account = await openChecking();

		const withoutNotes = await add(account.id);
		const withNotes = await add(account.id, { notes: "Pour dimanche" });

		await expect(lockedFields(withoutNotes)).resolves.toEqual(["date", "amount", "label"]);
		await expect(lockedFields(withNotes)).resolves.toEqual(["date", "amount", "label", "notes"]);
	});

	it("locks nothing for any other origin", async () => {
		const account = await openChecking();

		const id = await add(account.id, {}, "sync");

		await expect(lockedFields(id)).resolves.toEqual([]);
	});

	it("rejects lines on or before the opening day, too far ahead or in another currency", async () => {
		const account = await openChecking();
		const before = await history(account.id);

		const result = await ingest(
			deps(),
			account.id,
			{
				transactions: [
					line({ date: "2026-09-01" }),
					line({ date: "2026-08-31" }),
					line({ date: "2027-09-23" }),
					line({ currency: "USD" }),
				],
				balance: null,
				rejected: [],
			},
			{ manual: true },
			{ origin: "user" },
		);

		expect(result).toMatchObject({
			created: [],
			rejected: [
				{ ref: "0", reason: "BEFORE_OPENING_DATE" },
				{ ref: "1", reason: "BEFORE_OPENING_DATE" },
				{ ref: "2", reason: "DATE_TOO_LATE" },
				{ ref: "3", reason: "CURRENCY_MISMATCH" },
			],
		});
		await expect(history(account.id)).resolves.toEqual(before);
		await expect(
			listTransactions(deps(), { accountIds: [account.id] }, { page: 1, pageSize: 50 }),
		).resolves.toEqual({
			items: [],
			total: 0,
		});
	});

	it("keeps the accepted lines of a statement and reports the others", async () => {
		const account = await openChecking();

		const result = await ingest(
			deps(),
			account.id,
			{
				transactions: [line({ date: "2026-09-01" }), line({ date: "2026-09-15" })],
				balance: null,
				rejected: [],
			},
			{ manual: true },
			{ origin: "user" },
		);

		expect(result.created).toHaveLength(1);
		expect(result.rejected).toEqual([{ ref: "0", reason: "BEFORE_OPENING_DATE" }]);
		await expect(balanceOn(deps(), account.id, "2026-09-14")).resolves.toMatchObject({
			amount: 123456,
		});
		await expect(balanceOn(deps(), account.id, "2026-09-15")).resolves.toMatchObject({
			amount: 119166,
		});
	});

	it("adds up several transactions on one day, from one statement or several", async () => {
		const account = await openChecking();
		await ingest(
			deps(),
			account.id,
			{
				transactions: [
					line({ date: "2026-09-10", amount: toMinorUnits(-4290) }),
					line({ date: "2026-09-10", amount: toMinorUnits(10000) }),
				],
				balance: null,
				rejected: [],
			},
			{ manual: true },
			{ origin: "user" },
		);

		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-1000) });

		const days = await history(account.id);
		expect(days.get("2026-09-09")).toBe(123456);
		expect(days.get("2026-09-10")).toBe(128166);
		expect(days.get("2026-09-21")).toBe(128166);
	});

	it("replays the later transactions when an earlier one is recorded", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-15", amount: toMinorUnits(-1000) });

		await add(account.id, { date: "2026-09-05", amount: toMinorUnits(-4290) });

		const days = await history(account.id);
		expect(days.get("2026-09-05")).toBe(119166);
		expect(days.get("2026-09-15")).toBe(118166);
		expect(days.get("2026-09-21")).toBe(118166);
	});

	it("extends the history to a transaction dated after today", async () => {
		const account = await openChecking();

		await add(account.id, { date: "2026-10-05" });

		const days = await history(account.id);
		expect([...days.keys()].at(-1)).toBe("2026-10-05");
		expect(days.get("2026-10-04")).toBe(123456);
		expect(days.get("2026-10-05")).toBe(119166);
	});

	it("refuses an account that does not exist", async () => {
		setToday("2026-09-21T10:00:00Z");

		await expect(
			ingest(
				deps(),
				"nope",
				{ transactions: [line()], balance: null, rejected: [] },
				{ manual: true },
				{ origin: "user" },
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("leaves no row behind when the recompute fails", async () => {
		const account = await openChecking();
		const before = await history(account.id);
		const row = { date: "2026-09-21", balance: toMinorUnits(1) };
		vi.spyOn(forward, "forwardBalances").mockReturnValue([row, row]);

		await expect(
			ingest(
				deps(),
				account.id,
				{ transactions: [line()], balance: null, rejected: [] },
				{ manual: true },
				{ origin: "user" },
			),
		).rejects.toThrow();

		const stored = await temp.db
			.select()
			.from(entries)
			.where(and(eq(entries.accountId, account.id), eq(entries.kind, "transaction")));
		expect(stored).toEqual([]);
		await expect(history(account.id)).resolves.toEqual(before);
	});
});

describe("ingest from an import", () => {
	it("previews the groups without writing anything", async () => {
		const account = await openChecking();
		const before = await history(account.id);

		const { result } = await preview(account.id, statementOf(cafe, salary));

		expect(result.groups.created).toEqual([
			{ ref: "0", date: "2026-09-10", amount: -4290, label: "CB Café", entryId: null },
			{ ref: "1", date: "2026-09-12", amount: 215000, label: "VIR SALAIRE", entryId: null },
		]);
		expect(counts(result)).toEqual({
			created: 2,
			present: 0,
			matched: 0,
			duplicates: 0,
			rejected: 0,
		});
		expect(result.created).toEqual([]);
		expect(result.digest).toMatch(/^[0-9a-f]{64}$/u);
		expect(result.openingSuggestion).toBeNull();
		expect(result.opening).toBeNull();
		await expect(transactionCount(account.id)).resolves.toBe(0);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("confirms: writes the lines with their keys, marks the import and moves the balance", async () => {
		const account = await openChecking();

		const { importId, result } = await importStatement(account.id, statementOf(cafe, salary));

		expect(result.created).toHaveLength(2);
		const [cafeId = "", salaryId = ""] = result.created;
		await expect(findTransaction(deps(), cafeId)).resolves.toMatchObject({
			date: "2026-09-10",
			amount: -4290,
			label: "CB Café",
		});
		await expect(keysOf(cafeId)).resolves.toEqual([
			expect.stringMatching(/^ext:F1$/u),
			expect.stringMatching(/^fp:[0-9a-f]{64}$/u),
		]);
		await expect(keysOf(salaryId)).resolves.toHaveLength(2);
		await expect(lockedFields(cafeId)).resolves.toEqual([]);
		const stored = await temp.db.select().from(imports).where(eq(imports.id, importId)).get();
		expect(stored).toMatchObject({
			status: "confirmed",
			counts: { created: 2, present: 0, matched: 0, duplicates: 0, rejected: 0 },
		});
		expect(typeof stored?.confirmedAt).toBe("number");
		expect(stored?.content).toHaveLength(0);
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: 123456 - 4290 + 215000,
		});
	});

	it("writes a line's reference", async () => {
		const account = await openChecking();

		const { result } = await importStatement(
			account.id,
			statementOf({ ...cafe, reference: "1234567" }, salary),
		);

		const [cafeId = "", salaryId = ""] = result.created;
		await expect(findTransaction(deps(), cafeId)).resolves.toMatchObject({ reference: "1234567" });
		await expect(findTransaction(deps(), salaryId)).resolves.toMatchObject({ reference: null });
	});

	it("gives two previews that differ only in the opening they would write different digests", async () => {
		const account = await openChecking();

		const kept = await preview(account.id, statementOf(cafe));
		const moved = await preview(account.id, statementOf(cafe), { moveOpeningDate: "2026-08-20" });

		expect(moved.result.groups).toEqual(kept.result.groups);
		expect(moved.result.opening).toEqual({ date: "2026-08-20", balance: 123456 });
		expect(moved.result.digest).not.toBe(kept.result.digest);
	});

	it("recognises every line of the same file on re-import", async () => {
		const account = await openChecking();
		await importStatement(account.id, statementOf(cafe, salary));

		const { importId, result } = await preview(account.id, statementOf(cafe, salary));

		expect(counts(result)).toMatchObject({ created: 0, present: 2 });
		expect(result.groups.present.map((item) => item.entryId)).toEqual([
			expect.any(String),
			expect.any(String),
		]);
		await confirm(account.id, importId, statementOf(cafe, salary));
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});

	it("recognises a bank re-export with new FITIDs through the fingerprint", async () => {
		const account = await openChecking();
		await importStatement(account.id, statementOf(cafe));

		const { result } = await preview(
			account.id,
			statementOf({ ...cafe, externalId: "NEW", label: "CB CAFE" }),
		);

		expect(counts(result)).toMatchObject({ created: 0, present: 1 });
	});

	it("recognises a line by its FITID when the bank changed its label", async () => {
		const account = await openChecking();
		await importStatement(account.id, statementOf(cafe));

		const { result } = await preview(
			account.id,
			statementOf({ ...cafe, label: "CARTE CAFE GARE" }),
		);

		expect(counts(result)).toMatchObject({ created: 0, present: 1 });
	});

	it("creates two identical lines of one day, and recognises both on re-import", async () => {
		const account = await openChecking();
		const bread = line({ date: "2026-09-10", amount: toMinorUnits(-350), label: "CB BOULANGERIE" });

		const first = await importStatement(account.id, statementOf(bread, bread));
		const again = await preview(account.id, statementOf(bread, bread));

		expect(first.result.created).toHaveLength(2);
		expect(counts(again.result)).toMatchObject({ created: 0, present: 2 });
	});

	it("still recognises an imported line after its label and amount were edited", async () => {
		const account = await openChecking();
		const { result } = await importStatement(account.id, statementOf(cafe));
		const [id = ""] = result.created;
		await updateTransaction(
			deps(),
			id,
			{ label: "Café du matin", amount: toMinorUnits(-5000) },
			{ origin: "user" },
		);

		const again = await preview(account.id, statementOf(cafe));

		expect(counts(again.result)).toMatchObject({ created: 0, present: 1 });
	});

	it("pairs a manual twin two days away, attaches the keys and changes nothing else", async () => {
		const account = await openChecking();
		const manual = await add(account.id, {
			date: "2026-09-03",
			amount: toMinorUnits(-4290),
			label: "Café",
		});
		const before = await history(account.id);
		const fileLine = line({
			externalId: "F9",
			date: "2026-09-05",
			amount: toMinorUnits(-4290),
			label: "CB CAFE GARE",
		});

		const { result } = await importStatement(account.id, statementOf(fileLine));

		expect(result.groups.matched).toEqual([expect.objectContaining({ ref: "0", entryId: manual })]);
		expect(result.created).toEqual([]);
		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(findTransaction(deps(), manual)).resolves.toMatchObject({
			date: "2026-09-03",
			label: "Café",
			amount: -4290,
		});
		await expect(lockedFields(manual)).resolves.toEqual(["date", "amount", "label"]);
		await expect(keysOf(manual)).resolves.toHaveLength(2);
		await expect(history(account.id)).resolves.toEqual(before);
		// Recognised next time, as the confirm label promised.
		expect(counts((await preview(account.id, statementOf(fileLine))).result)).toMatchObject({
			present: 1,
		});
	});

	it("creates a line with two equally near candidates and flags it a possible duplicate", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-04", amount: toMinorUnits(-1000) });
		await add(account.id, { date: "2026-09-06", amount: toMinorUnits(-1000) });

		const { result } = await importStatement(
			account.id,
			statementOf(line({ date: "2026-09-05", amount: toMinorUnits(-1000), label: "Péage" })),
		);

		expect(counts(result)).toMatchObject({ created: 0, duplicates: 1, matched: 0 });
		const [id = ""] = result.created;
		const row = await temp.db.select().from(transactions).where(eq(transactions.entryId, id)).get();
		expect(row?.possibleDuplicate).toBe(true);
		await expect(transactionCount(account.id)).resolves.toBe(3);
	});

	it("never pairs with an entry this source already keyed, nor one 4 days away", async () => {
		const account = await openChecking();
		await importStatement(account.id, statementOf(cafe));
		const manual = await add(account.id, { date: "2026-09-16", amount: toMinorUnits(-4290) });
		await add(account.id, { date: "2026-09-19", amount: toMinorUnits(-777) });

		const { result } = await preview(
			account.id,
			statementOf(
				line({ date: "2026-09-11", amount: toMinorUnits(-4290), label: "Autre café" }),
				line({ date: "2026-09-19", amount: toMinorUnits(-4290), label: "Encore un café" }),
				line({ date: "2026-09-15", amount: toMinorUnits(-777), label: "Parking" }),
			),
		);

		expect(counts(result)).toMatchObject({ created: 2, matched: 1 });
		expect(result.groups.created.map((item) => item.ref)).toEqual(["0", "2"]);
		expect(result.groups.matched).toEqual([expect.objectContaining({ ref: "1", entryId: manual })]);
	});

	it("writes a FITID shared by two lines of one file once, on the first", async () => {
		const account = await openChecking();

		const { result } = await importStatement(
			account.id,
			statementOf(cafe, { ...cafe, label: "CB Café bis" }),
		);

		const [first = "", second = ""] = result.created;
		await expect(keysOf(first)).resolves.toEqual(["ext:F1", expect.stringMatching(/^fp:/u)]);
		await expect(keysOf(second)).resolves.toEqual([expect.stringMatching(/^fp:/u)]);
	});

	it("reports the source's unreadable lines with the ledger's refusals", async () => {
		const account = await openChecking();

		const { result } = await importStatement(account.id, {
			transactions: [line({ date: "2026-09-01" }), cafe],
			balance: null,
			rejected: [{ ref: "3", reason: "INVALID_AMOUNT" }],
		});

		expect(result.groups.rejected).toEqual([
			{ ref: "3", reason: "INVALID_AMOUNT", line: null },
			{
				ref: "0",
				reason: "BEFORE_OPENING_DATE",
				line: { date: "2026-09-01", amount: -4290, label: "Boulangerie" },
			},
		]);
		expect(result.rejected).toEqual([
			{ ref: "3", reason: "INVALID_AMOUNT" },
			{ ref: "0", reason: "BEFORE_OPENING_DATE" },
		]);
		expect(result.openingSuggestion).toBe("2026-08-31");
	});

	it("refuses a confirm when the account changed since the preview, writing nothing", async () => {
		const account = await openChecking();
		const { importId } = await preview(account.id, statementOf(cafe, salary));
		await add(account.id, { date: "2026-09-11", amount: toMinorUnits(-4290), label: "Café" });
		const before = await history(account.id);

		await expect(confirm(account.id, importId, statementOf(cafe, salary))).rejects.toMatchObject({
			code: "IMPORT_PREVIEW_STALE",
		});

		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(history(account.id)).resolves.toEqual(before);
		const stored = await temp.db.select().from(imports).where(eq(imports.id, importId)).get();
		expect(stored?.status).toBe("previewed");
		await expect(
			temp.db.select().from(entryKeys).where(eq(entryKeys.importId, importId)),
		).resolves.toEqual([]);
	});

	it("answers NOT_FOUND for an import already confirmed, unknown, or of another account", async () => {
		const account = await openChecking();
		const other = await openChecking();
		const { importId } = await importStatement(account.id, statementOf(cafe));
		const pending = await previewRow(other.id);

		await expect(confirm(account.id, importId, statementOf(cafe))).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(confirm(account.id, "nope", statementOf(cafe))).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(confirm(account.id, pending, statementOf(cafe))).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("ignores an opening date that is not earlier than the account's", async () => {
		const account = await openChecking();

		const { result } = await preview(account.id, statementOf(cafe), {
			moveOpeningDate: "2026-09-05",
		});

		expect(result.opening).toBeNull();
		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-09-01");
	});

	it("moves an asset's opening back, keeping the old opening day's balance and today's", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-10", amount: toMinorUnits(-1000) });
		const today = await balanceOn(deps(), account.id, "2026-09-21");
		const lines = statementOf(
			line({ date: "2026-08-20", amount: toMinorUnits(-2000), label: "Loyer" }),
			line({ date: "2026-09-01", amount: toMinorUnits(5000), label: "Remboursement" }),
			line({ date: "2026-09-15", amount: toMinorUnits(-300), label: "Pain" }),
		);
		const first = await preview(account.id, lines);

		expect(first.result.openingSuggestion).toBe("2026-08-19");
		expect(counts(first.result)).toMatchObject({ created: 1, rejected: 2 });

		const moved = await importStatement(account.id, lines, { moveOpeningDate: "2026-08-19" });

		expect(counts(moved.result)).toMatchObject({ created: 3, rejected: 0 });
		// 1 234,56 − (−20,00 + 50,00): the old opening day still ends at 1 234,56.
		expect(moved.result.opening).toEqual({ date: "2026-08-19", balance: 123456 - 3000 });
		await expect(openingDateOf(deps(), account.id)).resolves.toBe("2026-08-19");
		await expect(balanceOn(deps(), account.id, "2026-08-19")).resolves.toMatchObject({
			amount: 120456,
		});
		await expect(balanceOn(deps(), account.id, "2026-08-20")).resolves.toMatchObject({
			amount: 118456,
		});
		await expect(balanceOn(deps(), account.id, "2026-09-01")).resolves.toMatchObject({
			amount: 123456,
		});
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: (today?.amount ?? 0) - 300,
		});
	});

	it("moves a credit card's opening back, keeping the amount owed on the old opening day", async () => {
		const card = await openChecking({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(50000),
		});
		const lines = statementOf(
			line({ date: "2026-08-25", amount: toMinorUnits(-3000), label: "Achat" }),
		);

		const { result } = await importStatement(card.id, lines, { moveOpeningDate: "2026-08-24" });

		// 500,00 owed − 30,00 bought after the new opening: 470,00 owed then.
		expect(result.opening).toEqual({ date: "2026-08-24", balance: 47000 });
		await expect(balanceOn(deps(), card.id, "2026-08-25")).resolves.toMatchObject({
			amount: 50000,
		});
		await expect(balanceOn(deps(), card.id, "2026-09-01")).resolves.toMatchObject({
			amount: 50000,
		});
	});

	it("imports 5,000 lines in chunks, then recognises all of them", async () => {
		const big = await createTempDatabase();

		try {
			setToday("2026-09-21T10:00:00Z");
			const bigDeps = { db: big.db, timeZone: "Europe/Paris" };
			const account = await createAccount(
				bigDeps,
				{ ...checking, openingDate: "2016-01-01" },
				{ origin: "user" },
			);
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
			const started = performance.now();

			const { result } = await importStatement(account.id, lines, { db: big.db });

			expect(performance.now() - started).toBeLessThan(10_000);
			expect(result.created).toHaveLength(5000);
			const again = await preview(account.id, lines, { db: big.db });
			expect(counts(again.result)).toMatchObject({ created: 0, present: 5000 });
		} finally {
			await big.dispose();
		}
	}, 60_000);
});

describe("ingest the statement balance", () => {
	it("previews a checking account's balance as recorded, and writes nothing", async () => {
		const account = await openChecking();
		const before = await history(account.id);

		const { result } = await preview(account.id, closingOn(240861));

		expect(result.balance).toEqual({ status: "recorded", date: "2026-09-15", balance: 240861 });
		await expect(snapshotsOf(account.id)).resolves.toEqual([]);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("records it on confirm as a snapshot owned by the import, which sets the balance", async () => {
		const account = await openChecking();

		const { importId, result } = await importStatement(account.id, closingOn(240861));

		expect(result.balance).toEqual({ status: "recorded", date: "2026-09-15", balance: 240861 });
		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ date: "2026-09-15", balance: 240861, importId }),
		]);
		await expect(balanceOn(deps(), account.id, "2026-09-15")).resolves.toEqual({
			amount: 240861,
			currency: "EUR",
		});
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: 240861,
		});
		// The lines before it still move the days before it.
		await expect(balanceOn(deps(), account.id, "2026-09-12")).resolves.toMatchObject({
			amount: 123456 - 4290 + 215000,
		});
		const { items } = await listSnapshots(deps(), account.id, { page: 1, pageSize: 50 });
		expect(items).toEqual([expect.objectContaining({ date: "2026-09-15", balance: 240861 })]);
	});

	it("turns a card's negative statement balance into a positive amount owed", async () => {
		const card = await openChecking({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(0),
		});

		const { result } = await importStatement(card.id, closingOn(-51230, "2026-09-15", "EUR", []));

		expect(result.balance).toEqual({ status: "recorded", date: "2026-09-15", balance: 51230 });
		await expect(balanceOn(deps(), card.id, "2026-09-21")).resolves.toMatchObject({
			amount: 51230,
		});
	});

	it("records nothing for a statement without a balance", async () => {
		const account = await openChecking();

		const { result } = await importStatement(account.id, statementOf(cafe));

		expect(result.balance).toBeNull();
		await expect(snapshotsOf(account.id)).resolves.toEqual([]);
	});

	it("ignores a balance on a manual statement: only an import carries one", async () => {
		const account = await openChecking();

		const result = await ingest(
			deps(),
			account.id,
			closingOn(999, "2026-09-15", "EUR", [cafe]),
			{ manual: true },
			{ origin: "user" },
		);

		expect(result.balance).toBeNull();
		await expect(snapshotsOf(account.id)).resolves.toEqual([]);
	});

	it("keeps a snapshot the user entered on that date, and gives the gap", async () => {
		const account = await openChecking();
		const typed = await snapshot(account.id, "2026-09-15", 240000);

		const { result } = await importStatement(account.id, closingOn(240861));

		expect(result.balance).toEqual({
			status: "kept",
			date: "2026-09-15",
			balance: 240861,
			recorded: 240000,
			gap: 861,
		});
		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ id: typed, balance: 240000, importId: null }),
		]);
		await expect(balanceOn(deps(), account.id, "2026-09-15")).resolves.toMatchObject({
			amount: 240000,
		});
	});

	it("writes nothing when the same file comes again, keeping the first import as owner", async () => {
		const account = await openChecking();
		const first = await importStatement(account.id, closingOn(240861));
		const [written] = await snapshotsOf(account.id);
		const before = await history(account.id);

		const again = await importStatement(account.id, closingOn(240861));

		expect(again.result.balance).toEqual({
			status: "present",
			date: "2026-09-15",
			balance: 240861,
		});
		await expect(snapshotsOf(account.id)).resolves.toEqual([
			{ ...written, importId: first.importId },
		]);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("gives a snapshot the user typed with the same value as present, writing nothing", async () => {
		const account = await openChecking();
		const typed = await snapshot(account.id, "2026-09-15", 240861);
		const [before] = await snapshotsOf(account.id);

		const { result } = await importStatement(account.id, closingOn(240861));

		expect(result.balance).toEqual({ status: "present", date: "2026-09-15", balance: 240861 });
		await expect(snapshotsOf(account.id)).resolves.toEqual([
			{ ...before, id: typed, importId: null },
		]);
	});

	it("records a later balance when every line is already present", async () => {
		const account = await openChecking();
		await importStatement(account.id, closingOn(240861));

		const later = await importStatement(account.id, closingOn(230000, "2026-09-18"));

		expect(counts(later.result)).toMatchObject({ created: 0, present: 2 });
		expect(later.result.balance).toEqual({
			status: "recorded",
			date: "2026-09-18",
			balance: 230000,
		});
		await expect(snapshotsOf(account.id)).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ date: "2026-09-18", balance: 230000, importId: later.importId }),
			]),
		);
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: 230000,
		});
	});

	it("replaces another import's snapshot on that date with a newer file's value", async () => {
		const account = await openChecking();
		await importStatement(account.id, closingOn(240861));
		const [written] = await snapshotsOf(account.id);

		// The same lines, all present: only the snapshot moves the balance.
		const newer = await importStatement(account.id, closingOn(250000));

		expect(counts(newer.result)).toMatchObject({ created: 0, present: 2 });
		expect(newer.result.balance).toEqual({
			status: "recorded",
			date: "2026-09-15",
			balance: 250000,
		});
		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ id: written?.id, balance: 250000, importId: newer.importId }),
		]);
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: 250000,
		});
		await expect(balanceOn(deps(), account.id, "2026-09-14")).resolves.toMatchObject({
			amount: 123456 - 4290 + 215000,
		});
	});

	it.each([
		["on the opening date", "2026-09-01", "EUR", "BEFORE_OPENING_DATE"],
		["before the opening date", "2026-08-20", "EUR", "BEFORE_OPENING_DATE"],
		["after today", "2026-09-22", "EUR", "DATE_IN_FUTURE"],
		["in another currency", "2026-09-15", "USD", "CURRENCY_MISMATCH"],
	])("skips a balance dated %s, writing nothing for it", async (_name, date, currency, reason) => {
		const card = await openChecking({ type: "credit_card", subtype: null });

		const { result } = await importStatement(card.id, closingOn(-51230, date, currency));

		expect(result.balance).toEqual({ status: "skipped", date, balance: 51230, reason });
		expect(result.created).toHaveLength(2);
		await expect(snapshotsOf(card.id)).resolves.toEqual([]);
	});

	it("checks the date against the opening date the import moves", async () => {
		const account = await openChecking();
		const lines = closingOn(100000, "2026-08-25", "EUR", [
			line({ date: "2026-08-22", amount: toMinorUnits(-2000), label: "Loyer" }),
		]);

		const { result } = await importStatement(account.id, lines, { moveOpeningDate: "2026-08-20" });

		expect(result.balance).toEqual({ status: "recorded", date: "2026-08-25", balance: 100000 });
		await expect(balanceOn(deps(), account.id, "2026-08-25")).resolves.toMatchObject({
			amount: 100000,
		});
	});

	it("refuses a confirm when the user entered a snapshot on that date since the preview", async () => {
		const account = await openChecking();
		const { importId } = await preview(account.id, closingOn(240861));
		await snapshot(account.id, "2026-09-15", 240000);
		const before = await history(account.id);

		await expect(confirm(account.id, importId, closingOn(240861))).rejects.toMatchObject({
			code: "IMPORT_PREVIEW_STALE",
		});

		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ balance: 240000, importId: null }),
		]);
		await expect(transactionCount(account.id)).resolves.toBe(0);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("hands an imported snapshot to the user once they record a value on its date", async () => {
		const account = await openChecking();
		await importStatement(account.id, closingOn(240861));

		await snapshot(account.id, "2026-09-15", 240500);

		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ balance: 240500, importId: null }),
		]);
		const { result } = await preview(account.id, closingOn(240861));
		expect(result.balance).toMatchObject({ status: "kept", recorded: 240500, gap: 361 });
	});

	it("hands an imported snapshot to the user once they edit it", async () => {
		const account = await openChecking();
		await importStatement(account.id, closingOn(240861));
		const [written] = await snapshotsOf(account.id);

		await updateSnapshot(deps(), written?.id ?? "", { date: "2026-09-16" }, { origin: "user" });

		await expect(snapshotsOf(account.id)).resolves.toEqual([
			expect.objectContaining({ date: "2026-09-16", balance: 240861, importId: null }),
		]);
	});
});

describe("rules at ingestion", () => {
	// Every rule reaches every new transaction: none may outlive its test.
	afterEach(async () => {
		await temp.db.delete(rules);
	});

	let created = 0;

	/** A rule setting `categoryId`, created after every earlier one. */
	async function newRule(
		categoryId: string,
		conditions: Parameters<typeof createRule>[1]["conditions"] = [],
		effectiveDate: string | null = null,
	) {
		return newRuleWith(
			[{ actionType: "set_transaction_category", value: categoryId }],
			conditions,
			effectiveDate,
		);
	}

	/** A rule with `actions`, created after every earlier one. */
	async function newRuleWith(
		actions: Parameters<typeof createRule>[1]["actions"],
		conditions: Parameters<typeof createRule>[1]["conditions"] = [],
		effectiveDate: string | null = null,
	) {
		const rule = await createRule(deps(), { effectiveDate, conditions, actions });
		created += 1;
		// Frozen clocks would give two rules the same creation time.
		await temp.db.update(rules).set({ createdAt: created }).where(eq(rules.id, rule.id));

		return rule;
	}

	it("categorises a new transaction a rule matches, with a rule origin and no lock", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		await newRule(groceries, [labelLike("carrefour  city")]);

		const hit = await add(account.id, { label: "CB CARREFOUR CITY 12/09" });
		const miss = await add(account.id, { label: "CB AUCHAN" });

		await expect(categoryOf(hit)).resolves.toBe(groceries);
		await expect(categoryOriginOf(hit)).resolves.toBe("rule");
		await expect(lockedFields(hit)).resolves.toEqual(["date", "amount", "label"]);
		await expect(categoryOf(miss)).resolves.toBeNull();
	});

	it("matches an amount above 50,00 in the reporting currency only", async () => {
		const account = await openChecking();
		const dollars = await openChecking({ name: "USD", currency: "USD" });
		const big = await newCategory("Gros achats");
		await newRule(big, [{ conditionType: "transaction_amount", operator: ">", value: "50,00" }]);

		const expense = await add(account.id, { amount: toMinorUnits(-6000) });
		const small = await add(account.id, { amount: toMinorUnits(4000) });
		const income = await add(account.id, { amount: toMinorUnits(6000) });
		const foreign = await add(dollars.id, { amount: toMinorUnits(-6000), currency: "USD" });

		await expect(categoryOf(expense)).resolves.toBe(big);
		await expect(categoryOf(small)).resolves.toBeNull();
		await expect(categoryOf(income)).resolves.toBe(big);
		await expect(categoryOf(foreign)).resolves.toBeNull();
	});

	it("lets the later of two matching rules win, and skips a disabled one", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const leisure = await newCategory("Loisirs");
		const other = await newCategory("Autre");
		await newRule(groceries);
		await newRule(leisure);
		const disabled = await newRule(other);
		await setRuleEnabled(deps(), disabled.id, { enabled: false });

		const id = await add(account.id);

		await expect(categoryOf(id)).resolves.toBe(leisure);
	});

	it("reaches only the lines dated on or after the start date", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		await newRule(groceries, [], "2026-09-10");

		const before = await add(account.id, { date: "2026-09-09" });
		const on = await add(account.id, { date: "2026-09-10" });

		await expect(categoryOf(before)).resolves.toBeNull();
		await expect(categoryOf(on)).resolves.toBe(groceries);
	});

	it("writes nothing for a rule whose category was deleted, nor for an account condition on a deleted account", async () => {
		const account = await openChecking();
		const gone = await openChecking({ name: "Fermé" });
		const groceries = await newCategory("Courses");
		const deleted = await newCategory("Supprimée");
		await newRule(groceries, [
			{ conditionType: "transaction_account", operator: "=", value: gone.id },
		]);
		await newRule(deleted);
		await temp.db.delete(categories).where(eq(categories.id, deleted));
		await deleteAccount(deps(), gone.id, { origin: "user" });

		const id = await add(account.id);

		await expect(categoryOf(id)).resolves.toBeNull();
	});

	it("categorises a possible duplicate an import creates", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-04", amount: toMinorUnits(-1000) });
		await add(account.id, { date: "2026-09-06", amount: toMinorUnits(-1000) });
		const tolls = await newCategory("Péages");
		await newRule(tolls, [labelLike("péage")]);

		const { result } = await importStatement(
			account.id,
			statementOf(line({ date: "2026-09-05", amount: toMinorUnits(-1000), label: "Péage" })),
		);

		expect(counts(result)).toMatchObject({ created: 0, duplicates: 1 });
		const [id = ""] = result.created;
		await expect(categoryOf(id)).resolves.toBe(tolls);
		await expect(categoryOriginOf(id)).resolves.toBe("rule");
	});

	it("categorises the lines of a confirmed import it matches, and nothing at preview", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		await newRule(groceries, [labelLike("carrefour")]);
		const statement = statementOf(
			line({ externalId: "1", label: "CB CARREFOUR MARKET" }),
			line({ externalId: "2", label: "CB BOULANGERIE" }),
			line({ externalId: "3", label: "Carrefour city", date: "2026-09-11" }),
			line({ externalId: "4", label: "VIR SALAIRE", amount: toMinorUnits(215000) }),
			line({ externalId: "5", label: "PRLV EDF" }),
		);

		const { importId } = await preview(account.id, statement);
		await expect(transactionCount(account.id)).resolves.toBe(0);
		const result = await confirm(account.id, importId, statement);

		const categorised = await Promise.all(result.created.map(categoryOf));
		expect(categorised).toEqual([groceries, null, groceries, null, null]);
	});

	// Story 8.2: every action, chained over one planned state per row.

	it("chains a merchant into a tag, and renames and excludes an imported line", async () => {
		const account = await openChecking();
		const amazon = await newMerchant("Amazon");
		const purchases = await newTag("Achats");
		await newRuleWith(
			[
				{ actionType: "set_transaction_merchant", value: amazon },
				{ actionType: "set_transaction_name", value: " Amazon " },
				{ actionType: "exclude_transaction" },
			],
			[labelLike("amzn")],
		);
		await newRuleWith(
			[{ actionType: "set_transaction_tags", value: purchases }],
			[{ conditionType: "transaction_merchant", operator: "=", value: amazon }],
		);

		const { result } = await importStatement(
			account.id,
			statementOf(
				line({ externalId: "1", label: "CB AMZN MKTP" }),
				line({ externalId: "2", label: "PRLV AMZN PRIME" }),
				line({ externalId: "3", label: "CB FNAC" }),
			),
		);

		const [first = "", second = "", other = ""] = result.created;
		const both = [first, second];
		await expect(Promise.all(both.map(merchantOf))).resolves.toEqual([amazon, amazon]);
		await expect(Promise.all(both.map(tagsOf))).resolves.toEqual([[purchases], [purchases]]);
		await expect(Promise.all(both.map(excludedOf))).resolves.toEqual([true, true]);
		await expect(Promise.all(both.map(lockedFields))).resolves.toEqual([[], []]);
		await expect(
			Promise.all(both.map(async (id) => (await findTransaction(deps(), id))?.label)),
		).resolves.toEqual(["Amazon", "Amazon"]);
		await expect(merchantOf(other)).resolves.toBeNull();
		await expect(tagsOf(other)).resolves.toEqual([]);
	});

	it("never renames a line typed by hand, whose label is locked", async () => {
		const account = await openChecking();
		await newRuleWith([{ actionType: "set_transaction_name", value: "Boulangerie Paul" }]);

		const typed = await add(account.id, { label: "CB PAUL" });
		const synced = await add(account.id, { label: "CB PAUL" }, "sync");

		await expect(findTransaction(deps(), typed)).resolves.toMatchObject({ label: "CB PAUL" });
		await expect(findTransaction(deps(), synced)).resolves.toMatchObject({
			label: "Boulangerie Paul",
		});
	});

	it("matches on notes and type, and sees no transfer on a new line", async () => {
		const account = await openChecking();
		const gifts = await newCategory("Cadeaux");
		const moves = await newCategory("Virements");
		await newRule(gifts, [
			{ conditionType: "transaction_notes", operator: "like", value: "cadeau" },
			{ conditionType: "transaction_type", operator: "=", value: "expense" },
		]);
		await newRule(moves, [{ conditionType: "transaction_type", operator: "=", value: "transfer" }]);

		const gift = await add(account.id, { amount: toMinorUnits(-1000), notes: "Cadeau Léa" });
		const refund = await add(account.id, { amount: toMinorUnits(1000), notes: "Cadeau Léa" });

		await expect(categoryOf(gift)).resolves.toBe(gifts);
		await expect(categoryOf(refund)).resolves.toBeNull();
	});

	it("records the expected account without creating an entry or a transfer", async () => {
		const { checking: joint, livret } = await openHousehold();
		await newRuleWith(
			[{ actionType: "set_as_transfer_or_payment", value: livret.id }],
			[labelLike("epargne")],
		);

		const id = await add(joint.id, {
			amount: toMinorUnits(-transferAmount()),
			label: "VIR EPARGNE",
		});

		await expect(expectedOf(id)).resolves.toBe(livret.id);
		await expect(transferRows(id)).resolves.toEqual([]);
		await expect(transactionCount(livret.id)).resolves.toBe(0);
	});

	it("never links a line a rule excludes, step 5 running before step 6", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		const inflow = await add(livret.id, { amount: toMinorUnits(amount) });
		await newRuleWith([{ actionType: "exclude_transaction" }], [labelLike("interne")]);

		const outflow = await add(joint.id, { amount: toMinorUnits(-amount), label: "VIR INTERNE" });

		await expect(excludedOf(outflow)).resolves.toBe(true);
		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(transferRows(inflow)).resolves.toEqual([]);
	});

	it("pairs a line with the one candidate on the expected account, whatever other accounts hold", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		const onLivret = await add(livret.id, { amount: toMinorUnits(amount) });
		await add(card.id, { amount: toMinorUnits(amount) });
		await newRuleWith(
			[{ actionType: "set_as_transfer_or_payment", value: livret.id }],
			[labelLike("epargne")],
		);

		const outflow = await add(joint.id, { amount: toMinorUnits(-amount), label: "VIR EPARGNE" });

		await expect(transferRows(outflow)).resolves.toMatchObject([
			{ outflowTransactionId: outflow, inflowTransactionId: onLivret, kind: "internal_move" },
		]);
	});

	it("leaves a line unpaired when the expected account holds two candidates", async () => {
		const { checking: joint, livret } = await openHousehold();
		const amount = transferAmount();
		await add(livret.id, { amount: toMinorUnits(amount), label: "A" });
		await add(livret.id, { amount: toMinorUnits(amount), label: "B" });
		await newRuleWith(
			[{ actionType: "set_as_transfer_or_payment", value: livret.id }],
			[labelLike("epargne")],
		);

		const outflow = await add(joint.id, { amount: toMinorUnits(-amount), label: "VIR EPARGNE" });

		await expect(transferRows(outflow)).resolves.toEqual([]);
	});

	it("stops a later rule from seeing a rename the locked label refused", async () => {
		const account = await openChecking();
		const bakery = await newCategory("Boulangerie");
		await newRuleWith([{ actionType: "set_transaction_name", value: "Paul" }]);
		await newRule(bakery, [{ conditionType: "transaction_name", operator: "=", value: "Paul" }]);

		const typed = await add(account.id, { label: "CB PAUL" });

		await expect(findTransaction(deps(), typed)).resolves.toMatchObject({ label: "CB PAUL" });
		await expect(categoryOf(typed)).resolves.toBeNull();
	});

	it("narrows the candidate's own list too, so its line with two candidates still pairs", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		const onLivret = await add(livret.id, { amount: toMinorUnits(amount) });
		// A second candidate for the Livret A line, unlinked from it: without
		// narrowing its list, the choice would not be mutual.
		await addStandard(card.id, { amount: toMinorUnits(-amount) });
		await newRuleWith(
			[{ actionType: "set_as_transfer_or_payment", value: livret.id }],
			[labelLike("epargne")],
		);

		const outflow = await add(joint.id, { amount: toMinorUnits(-amount), label: "VIR EPARGNE" });

		await expect(transferRows(outflow)).resolves.toMatchObject([
			{ outflowTransactionId: outflow, inflowTransactionId: onLivret },
		]);
	});

	it("keeps a rejected pair apart when one side expects the other's account", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		await newRuleWith(
			[{ actionType: "set_as_transfer_or_payment", value: livret.id }],
			[labelLike("epargne")],
		);
		const outflow = await add(joint.id, { amount: toMinorUnits(-amount), label: "VIR EPARGNE" });
		const inflow = await add(livret.id, { amount: toMinorUnits(amount) });
		const [linked] = await transferRows(outflow);
		await rejectTransfer(deps(), linked?.id ?? "", { origin: "user" });

		// A new line makes the expecting side a candidate again: its list is
		// read anew, and the rejected Livret A line must stay out of it.
		await add(card.id, { amount: toMinorUnits(amount) });

		await expect(rejectedRows(outflow)).resolves.toEqual([{ outflow, inflow }]);
		await expect(transferRows(outflow)).resolves.toEqual([]);
		await expect(transferRows(inflow)).resolves.toEqual([]);
	});

	it("pairs an expecting line with the expected account's line when that one arrives later", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		await newRuleWith(
			[{ actionType: "set_as_transfer_or_payment", value: livret.id }],
			[labelLike("epargne")],
		);
		const outflow = await add(joint.id, { amount: toMinorUnits(-amount), label: "VIR EPARGNE" });
		// A second candidate for the inflow, on another account: without the
		// expectation, the inflow would have two and pair with neither.
		await add(card.id, { amount: toMinorUnits(-amount), label: "Autre" });

		const { result } = await importStatement(
			livret.id,
			statementOf(line({ amount: toMinorUnits(amount), label: "VIR RECU" })),
		);

		await expect(transferRows(outflow)).resolves.toMatchObject([
			{ outflowTransactionId: outflow, inflowTransactionId: result.created[0] },
		]);
	});
});

// Story 10.3: the keyed path of `ingest`, as a bank sync drives it.

/** The bank's 995,00, as it describes the end of `date`. */
const bankBalance = (date: string) => ({ amount: toMinorUnits(99500), currency: "EUR", date });

describe("ingest from a bank connection", () => {
	it("keys its lines under the connector and the connection, and rewrites the anchor", async () => {
		const { account, bank } = await linkedChecking();

		const result = await sync(account.id, bank.connectionId, [newBankLine()], {
			amount: toMinorUnits(95710),
			currency: "EUR",
			date: "2026-09-21",
		});

		const [id = ""] = result.created;
		expect(result.balance).toEqual({ status: "recorded", date: "2026-09-21", balance: 95710 });
		await expect(keyRows(id)).resolves.toEqual([
			{ source: "enable-banking", importId: null, connectionId: bank.connectionId },
			{ source: "enable-banking", importId: null, connectionId: bank.connectionId },
		]);
		await expect(entryImport(id)).resolves.toBeNull();
		await expect(lockedFields(id)).resolves.toEqual([]);
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "current_anchor", date: "2026-09-21", amount: 95710 },
		]);
		const days = await history(account.id);
		expect(days.get("2026-09-21")).toBe(95710);
		expect(days.get("2026-09-11")).toBe(100000);
		await expect(entryOrigins(deps(), [id])).resolves.toEqual(
			new Map([[id, { kind: "bank", connector: "enable-banking" }]]),
		);
	});

	it("creates nothing the second time, keyed by reference or, without one, by fingerprint", async () => {
		const { account, bank } = await linkedChecking();
		const lines = [newBankLine(), newBankLine({ externalId: null, label: "SANS REFERENCE" })];
		await sync(account.id, bank.connectionId, lines);

		const again = await sync(account.id, bank.connectionId, lines);

		expect(again.created).toEqual([]);
		expect(again.groups.present).toHaveLength(2);
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});

	it("dates the anchor on the balance's own day, never after today", async () => {
		const account = await openChecking();
		const bank = await newBankAccount();
		await link(account.id, bank.id, 100000, "2026-09-19");

		await sync(
			account.id,
			bank.connectionId,
			[newBankLine({ date: "2026-09-21", amount: toMinorUnits(-500) })],
			bankBalance("2026-09-20"),
		);

		const days = await history(account.id);
		expect(days.get("2026-09-20")).toBe(99500);
		expect(days.get("2026-09-21")).toBe(99000);

		const later = await sync(account.id, bank.connectionId, [], bankBalance("2026-10-02"));

		expect(later.balance).toMatchObject({ status: "recorded", date: "2026-09-21" });
		await expect(valuationsOf(account.id)).resolves.toContainEqual({
			kind: "current_anchor",
			date: "2026-09-21",
			amount: 99500,
		});
	});

	it("keeps the anchor when the bank gives no balance, or one in another currency", async () => {
		const account = await openChecking();
		const bank = await newBankAccount();
		await link(account.id, bank.id, 100000, "2026-09-19");

		const none = await sync(account.id, bank.connectionId, [newBankLine()]);
		const foreign = await sync(account.id, bank.connectionId, [], {
			amount: toMinorUnits(1),
			currency: "USD",
			date: "2026-09-21",
		});

		expect(none.balance).toBeNull();
		expect(foreign.balance).toEqual({
			status: "skipped",
			date: "2026-09-21",
			balance: 1,
			reason: "CURRENCY_MISMATCH",
		});
		await expect(valuationsOf(account.id)).resolves.toEqual([
			{ kind: "opening_anchor", date: "2026-09-01", amount: 123456 },
			{ kind: "current_anchor", date: "2026-09-19", amount: 100000 },
		]);
		expect((await history(account.id)).get("2026-09-21")).toBe(100000);
	});

	it("attaches its keys to a file's entry of the same amount within 3 days", async () => {
		const { account, bank } = await linkedChecking();
		const { result } = await importStatement(
			account.id,
			statementOf(line({ label: "CB CARREFOUR" })),
			{
				source: "csv",
			},
		);
		const [csvEntry = ""] = result.created;

		const synced = await sync(account.id, bank.connectionId, [newBankLine()]);

		expect(synced.created).toEqual([]);
		expect(synced.groups.matched).toEqual([
			expect.objectContaining({ entryId: csvEntry, date: "2026-09-12" }),
		]);
		await expect(transactionCount(account.id)).resolves.toBe(1);
		expect((await keyRows(csvEntry)).map(({ source }) => source).toSorted()).toEqual([
			"csv",
			"enable-banking",
			"enable-banking",
		]);
		// The sheet names the bank from then on.
		await expect(entryOrigins(deps(), [csvEntry])).resolves.toEqual(
			new Map([[csvEntry, { kind: "bank", connector: "enable-banking" }]]),
		);
	});

	it("keeps an entry a sync paired with when its file import is reverted", async () => {
		const { account, bank } = await linkedChecking();
		const { importId, result } = await importStatement(
			account.id,
			statementOf(line({ label: "CB CARREFOUR" })),
			{ source: "csv" },
		);
		const [csvEntry = ""] = result.created;
		await sync(account.id, bank.connectionId, [newBankLine()]);

		await expect(removableOf(deps(), [importId])).resolves.toEqual(
			new Map([[importId, { transactions: 0, snapshot: 0 }]]),
		);
		await revert(importId);

		await expect(findTransaction(deps(), csvEntry)).resolves.not.toBeNull();
		expect((await keyRows(csvEntry)).map(({ source }) => source)).toEqual([
			"enable-banking",
			"enable-banking",
		]);
	});

	it("creates a line two file entries are equally near, flagged as a possible duplicate", async () => {
		const { account, bank } = await linkedChecking();
		await importStatement(
			account.id,
			statementOf(line({ date: "2026-09-11" }), line({ date: "2026-09-13" })),
			{ source: "csv" },
		);

		const synced = await sync(account.id, bank.connectionId, [newBankLine()]);

		const [id = ""] = synced.created;
		expect(synced.groups.duplicates).toHaveLength(1);
		await expect(
			temp.db
				.select({ flagged: transactions.possibleDuplicate })
				.from(transactions)
				.where(eq(transactions.entryId, id))
				.get(),
		).resolves.toEqual({ flagged: true });
	});

	it("never pairs with an entry another sync of the same connector wrote", async () => {
		const { account, bank } = await linkedChecking();
		await sync(account.id, bank.connectionId, [newBankLine()]);

		const synced = await sync(account.id, bank.connectionId, [
			newBankLine({ externalId: "EB2", date: "2026-09-13", label: "AUTRE" }),
		]);

		expect(synced.created).toHaveLength(1);
		await expect(transactionCount(account.id)).resolves.toBe(2);
	});

	it("refuses lines on or before the opening date, as any source", async () => {
		const { account, bank } = await linkedChecking();

		const synced = await sync(account.id, bank.connectionId, [newBankLine({ date: "2026-09-01" })]);

		expect(synced.rejected).toEqual([{ ref: "0", reason: "BEFORE_OPENING_DATE" }]);
	});

	it("refuses an unknown connection and writes nothing", async () => {
		const { account } = await linkedChecking();

		await expect(sync(account.id, crypto.randomUUID(), [newBankLine()])).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(transactionCount(account.id)).resolves.toBe(0);
	});
});
