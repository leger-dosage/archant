import type { TempDatabase } from "../../testing/temp-database.ts";
import type { NewAccountInput } from "../ledger/accounts.ts";

import { and, eq, gte } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { categories } from "@archant/data/schema/categories";
import { merchants } from "@archant/data/schema/merchants";
import { recurrenceRules } from "@archant/data/schema/recurrence-rules";
import { recurringOccurrences } from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";
import type { RecurringStatus } from "@archant/data/schema/recurring-transactions";

import { createLogger } from "../../lib/logger.ts";
import { createTempDatabase } from "../../testing/temp-database.ts";
import { confirmImport, createImport, revertImport } from "../imports.ts";
import { createAccount } from "../ledger/accounts.ts";
import { bulkUpdateTransactions, updateTransaction } from "../ledger/edits.ts";
import { ingest } from "../ledger/ingest.ts";
import { findTransaction } from "../ledger/queries.ts";
import { recordSnapshot } from "../ledger/snapshots.ts";
import { splitTransaction } from "../ledger/splits.ts";
import { applyRules, createRule } from "../rules.ts";
import { declareBill, editBill } from "./bills.ts";
import { runRecurring } from "./pipeline.ts";
import {
	addRecurringFromEntry,
	cleanupRecurring,
	deleteRecurring,
	listRecurring,
	recurringEntryIds,
	recurringOfEntry,
	setRecurringStatus,
} from "./series.ts";

let temp: TempDatabase;
const deps = () => ({ db: temp.db, timeZone: "Europe/Paris" });

// A database per test: detection reads every account, so rows left by one
// test would be counted by the next.
beforeEach(async () => {
	temp = await createTempDatabase();
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
});

afterEach(async () => {
	vi.useRealTimers();
	await temp.dispose();
});

async function account(
	name = "Compte",
	kind: Pick<NewAccountInput, "type" | "subtype"> = {
		type: "depository",
		subtype: "checking",
	},
) {
	const created = await createAccount(
		deps(),
		{
			name,
			...kind,
			currency: "EUR",
			openingBalance: toMinorUnits(0),
			openingDate: "2026-01-01",
		},
		{ origin: "user" },
	);

	return created.id;
}

async function addRows(
	accountId: string,
	dates: readonly string[],
	label = "PRLV EDF",
	amount = -6500,
) {
	const result = await ingest(
		deps(),
		accountId,
		{
			transactions: dates.map((date) => ({
				externalId: null,
				date,
				amount: toMinorUnits(amount),
				currency: "EUR",
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

const stored = () => temp.db.select().from(recurringTransactions);

/** One by one: each update takes the write lock. */
const rename = (ids: readonly string[], label: string) =>
	ids.reduce<Promise<unknown>>(
		(pending, id) =>
			pending.then(() => updateTransaction(deps(), id, { label }, { origin: "user" })),
		Promise.resolve(),
	);

const importDeps = () => ({ ...deps(), logger: createLogger("silent") });

/** Imports an OFX file of `label` rows on `dates` and returns the import's id. */
async function importRows(
	accountId: string,
	dates: readonly string[],
	label = "PRLV EDF",
	amount = "-65.00",
) {
	const lines = dates.map(
		(date, index) =>
			`<STMTTRN><DTPOSTED>${date.replaceAll("-", "")}<TRNAMT>${amount}<FITID>F${index}<NAME>${label}</STMTTRN>`,
	);
	const bytes = new TextEncoder().encode(
		`<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>EUR<BANKTRANLIST>\n${lines.join("\n")}\n</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`,
	);
	const preview = await createImport(importDeps(), accountId, { name: "releve.ofx", bytes });

	await confirmImport(importDeps(), preview.id);

	return preview.id;
}

const setStatus = (id: string, status: RecurringStatus) =>
	temp.db.update(recurringTransactions).set({ status }).where(eq(recurringTransactions.id, id));

/**
 * Detects the monthly EDF bill of 07-10, 08-10 and 09-10 and returns its row;
 * with `ids`, the rows are already there.
 */
async function detectedBill(accountId: string, ids?: readonly string[]) {
	if (ids === undefined) {
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
	}

	await runRecurring(deps(), { backfill: false });
	const [row] = await stored();

	return row!;
}

describe("detection", () => {
	it("stores a detected pattern and counts it", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 1 });
		const [row, ...others] = await stored();
		expect(others).toEqual([]);
		expect(row?.id).toMatch(/^[0-9a-f-]{36}$/u);
		expect(row).toEqual({
			id: row?.id,
			accountId,
			merchantId: null,
			labelKey: "prlv edf",
			label: "PRLV EDF",
			amount: -6500,
			expectedAmountMin: -6500,
			expectedAmountMax: -6500,
			expectedAmountAvg: -6500,
			currency: "EUR",
			expectedDayOfMonth: 10,
			lastOccurrenceDate: "2026-09-10",
			nextExpectedDate: "2026-10-10",
			occurrenceCount: 3,
			status: "suggested",
			manual: false,
			dedupScope: "",
			name: null,
			anchorDate: null,
			endAfterCount: null,
			billType: "bill",
			categoryId: null,
			autopay: false,
			notes: null,
			paymentUrl: null,
			schedulePinnedAt: null,
			nameAliases: [],
			learnedTolerance: null,
			createdAt: Date.parse("2026-09-21T10:00:00Z"),
			updatedAt: Date.parse("2026-09-21T10:00:00Z"),
		});
	});

	it("updates the same row when run twice", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		await runRecurring(deps(), { backfill: false });
		const [first] = await stored();

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 1 });
		await expect(stored()).resolves.toEqual([first]);
	});

	it("updates the day, dates, count and label of a stored pattern", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		await runRecurring(deps(), { backfill: false });
		const [first] = await stored();

		vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
		await addRows(accountId, ["2026-10-12"], "prlv  Édf");
		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toEqual([
			{
				...first,
				label: "prlv  Édf",
				expectedDayOfMonth: 10,
				lastOccurrenceDate: "2026-10-12",
				nextExpectedDate: "2026-11-10",
				// 2026-07-10 fell out of the three months.
				occurrenceCount: 3,
				updatedAt: Date.parse("2026-10-15T10:00:00Z"),
			},
		]);
	});

	it("recomputes a stored pattern it no longer detects from its current rows", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		await runRecurring(deps(), { backfill: false });
		const [before] = await stored();

		vi.setSystemTime(new Date("2026-10-26T10:00:00Z"));

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 0 });
		// 2026-07-10 fell out of the three months.
		await expect(stored()).resolves.toEqual([
			{
				...before,
				occurrenceCount: 2,
				lastOccurrenceDate: "2026-09-10",
				nextExpectedDate: "2026-10-10",
				updatedAt: Date.parse("2026-10-26T10:00:00Z"),
			},
		]);
	});

	it("detects a latest row 45 days old, not 46", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-06", "2026-07-07", "2026-08-07"]);

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 1 });

		vi.setSystemTime(new Date("2026-09-22T10:00:00Z"));
		await temp.db.delete(recurringTransactions);

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual([]);
	});

	it("reads rows from three months back, today in the household's time zone", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-06-21", "2026-07-21", "2026-08-21"]);

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 1 });

		// 22:30 UTC is already 22 September in Paris.
		vi.setSystemTime(new Date("2026-09-21T22:30:00Z"));

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 0 });
	});

	it("groups rows by merchant, and updates the same rows when run twice", async () => {
		const accountId = await account();
		await temp.db
			.insert(merchants)
			.values(["netflix", "spotify"].map((id) => ({ id, name: id, createdAt: 0, updatedAt: 0 })));
		const dates = ["2026-07-10", "2026-08-10", "2026-09-10"];
		const netflix = await addRows(accountId, dates, "NETFLIX.COM");
		const spotify = await addRows(accountId, dates, "SPOTIFY AB");
		// One by one: each update takes the write lock.
		const link = (ids: readonly string[], merchantId: string) =>
			ids.reduce<Promise<unknown>>(
				(pending, id) =>
					pending.then(() => updateTransaction(deps(), id, { merchantId }, { origin: "user" })),
				Promise.resolve(),
			);
		await link(netflix, "netflix");
		await link(spotify, "spotify");

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 2 });
		const first = await stored();
		expect(first).toHaveLength(2);
		expect(first.map((row) => ({ merchantId: row.merchantId, labelKey: row.labelKey }))).toEqual(
			expect.arrayContaining([
				{ merchantId: "netflix", labelKey: null },
				{ merchantId: "spotify", labelKey: null },
			]),
		);

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 2 });
		const second = await stored();
		expect(second).toHaveLength(2);
		expect(second.map((row) => row.id)).toEqual(expect.arrayContaining(first.map((row) => row.id)));
	});

	it("counts an excluded row", async () => {
		const accountId = await account();
		const [excluded = ""] = await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		await expect(
			updateTransaction(deps(), excluded, { excluded: true }, { origin: "user" }),
		).resolves.toEqual({ status: "updated" });

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 1 });
		await expect(stored()).resolves.toMatchObject([{ occurrenceCount: 3 }]);
	});

	it("reads a split's lines, never its parent", async () => {
		const accountId = await account();
		const bills = await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		await bills.reduce<Promise<unknown>>(
			(pending, id, index) =>
				pending.then(async () =>
					splitTransaction(
						deps(),
						id,
						[
							{ label: "Abonnement", amount: toMinorUnits(-5000), categoryId: null },
							{ label: `Option ${index}`, amount: toMinorUnits(-1500), categoryId: null },
						],
						{ origin: "user" },
					),
				),
			Promise.resolve(),
		);

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 1 });
		await expect(stored()).resolves.toMatchObject([
			{ label: "Abonnement", amount: -5000, occurrenceCount: 3 },
		]);
	});
});

/** Adds one row per `[date, amount]`, in order. */
const addPriced = (
	accountId: string,
	rows: readonly (readonly [string, number])[],
	label = "PRET",
) =>
	rows.reduce<Promise<unknown>>(
		(pending, [date, amount]) => pending.then(() => addRows(accountId, [date], label, amount)),
		Promise.resolve(),
	);

describe("detection as Sure's identifier", () => {
	it("finds the mortgage whose amount moves by a few cents", async () => {
		vi.setSystemTime(new Date("2026-09-15T10:00:00Z"));
		const accountId = await account();
		await addPriced(accountId, [
			["2026-07-07", -57_129],
			["2026-08-07", -57_136],
			["2026-09-08", -57_122],
		]);

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 1 });
		await expect(stored()).resolves.toMatchObject([
			{
				status: "suggested",
				amount: -57_122,
				expectedAmountMin: -57_136,
				expectedAmountMax: -57_122,
				expectedAmountAvg: -57_129,
				expectedDayOfMonth: 7,
				dedupScope: "",
			},
		]);
	});

	it("misses the mortgage whose day drifts by 3", async () => {
		vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
		const accountId = await account();
		await addPriced(accountId, [
			["2026-07-06", -57_129],
			["2026-08-10", -57_136],
			["2026-09-07", -57_122],
			["2026-10-05", -57_129],
		]);

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual([]);
	});

	it("keeps a price rise in one series, whose amount stays the claimed one", async () => {
		const accountId = await account();
		await addPriced(accountId, [
			["2026-06-21", -999],
			["2026-07-21", -999],
			["2026-08-21", -999],
		]);
		vi.setSystemTime(new Date("2026-08-25T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });
		const [row] = await stored();

		vi.setSystemTime(new Date("2026-09-25T10:00:00Z"));
		await addPriced(accountId, [["2026-09-21", -1049]]);
		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toEqual([
			{
				...row,
				amount: -999,
				expectedAmountMin: -1049,
				expectedAmountMax: -999,
				expectedAmountAvg: -1016,
				lastOccurrenceDate: "2026-09-21",
				nextExpectedDate: "2026-10-21",
				occurrenceCount: 3,
				updatedAt: Date.parse("2026-09-25T10:00:00Z"),
			},
		]);
	});

	it("stores three tiers of one key, a dedup scope on each one after the first", async () => {
		const accountId = await account();
		const dates = ["2026-07-05", "2026-08-05", "2026-09-05"];
		await addRows(accountId, dates, "ABO", -4000);
		await addRows(accountId, dates, "ABO", -1000);
		await addRows(accountId, dates, "ABO", -2000);

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 3 });
		const tiers = (await stored()).map((row) => [row.amount, row.dedupScope, row.status]);

		expect(tiers.toSorted(([a], [b]) => Number(b) - Number(a))).toEqual([
			[-1000, "", "suggested"],
			[-2000, "-2000", "suggested"],
			[-4000, "-4000", "suggested"],
		]);

		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toHaveLength(3);
	});

	it("scopes a new tier when its key already has a series of another status", async () => {
		const accountId = await account();
		const dates = ["2026-07-05", "2026-08-05", "2026-09-05"];
		const [entryId = ""] = await addRows(accountId, ["2026-06-05"], "ABO", -4000);
		await addRecurringFromEntry(deps(), entryId);
		await addRows(accountId, dates, "ABO", -1000);

		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ amount: -1000, dedupScope: "-1000", status: "suggested" }),
				expect.objectContaining({ amount: -4000, dedupScope: "", manual: true }),
			]),
		);
	});

	it("stores a series created in the run as a later pattern that claims it left it", async () => {
		const accountId = await account();
		// Two clusters of one key: the first one's latest amount, -10,70, lies
		// within 7.5 % of the second one's mean, -11,50, which claims it.
		await addPriced(
			accountId,
			[
				["2026-07-05", -1000],
				["2026-08-05", -1000],
				["2026-09-05", -1070],
				["2026-07-06", -1150],
				["2026-08-06", -1150],
				["2026-09-06", -1150],
			],
			"ABO",
		);

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 2 });
		await expect(stored()).resolves.toMatchObject([
			{
				amount: -1070,
				expectedAmountMin: -1150,
				expectedAmountMax: -1150,
				expectedAmountAvg: -1150,
				expectedDayOfMonth: 6,
				lastOccurrenceDate: "2026-09-06",
				nextExpectedDate: "2026-10-06",
				occurrenceCount: 3,
				dedupScope: "",
				status: "suggested",
			},
		]);
	});

	it("claims the nearest series within 7.5 % of the mean", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-05", "2026-08-05", "2026-09-05"], "ABO", -1000);
		await runRecurring(deps(), { backfill: false });
		const [row] = await stored();
		const far = { ...row!, id: "far", amount: -1070, dedupScope: "far", createdAt: 0 };
		const near = { ...row!, id: "near", amount: -1010, dedupScope: "near", createdAt: 1 };
		await temp.db.delete(recurringTransactions);
		await temp.db.insert(recurringTransactions).values([far, near]);

		await runRecurring(deps(), { backfill: false });
		const byId = new Map((await stored()).map((series) => [series.id, series]));

		expect(byId.get("near")).toMatchObject({ amount: -1010, occurrenceCount: 3 });
		expect(byId.get("near")!.updatedAt).toBe(Date.parse("2026-09-21T10:00:00Z"));
		expect(byId.get("far")).toEqual(far);
		expect(byId.size).toBe(2);
	});

	it("leaves an ended series untouched when it claims a pattern within 7.5 %", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		await setStatus(row.id, "ended");
		await temp.db
			.update(recurringTransactions)
			.set({ amount: -6900 })
			.where(eq(recurringTransactions.id, row.id));

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual([{ ...row, amount: -6900, status: "ended" }]);
	});

	it("leaves an investment account out", async () => {
		const pea = await account("PEA", { type: "investment", subtype: "pea" });
		await addRows(pea, ["2026-07-10", "2026-08-10", "2026-09-10"], "VERSEMENT", 10_000);

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual([]);
	});
});

describe("deleteRecurring", () => {
	it("ends a detected series, which detection then never brings back", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);

		await expect(deleteRecurring(deps(), row.id)).resolves.toEqual({ id: row.id });
		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toEqual([
			{ ...row, status: "ended", updatedAt: Date.parse("2026-09-21T10:00:00Z") },
		]);
	});

	it("deletes a manual series", async () => {
		const accountId = await account();
		const [entryId = ""] = await addRows(accountId, ["2026-09-05"]);
		const added = await addRecurringFromEntry(deps(), entryId);

		await deleteRecurring(deps(), added.id);

		await expect(stored()).resolves.toEqual([]);
	});

	it("answers NOT_FOUND for an unknown id", async () => {
		await expect(deleteRecurring(deps(), "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("cleanupRecurring", () => {
	it("marks stale active series inactive and counts them, leaving the rest", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-05-15", "2026-06-15", "2026-07-15"], "STALE");
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"], "FRESH");
		vi.setSystemTime(new Date("2026-08-01T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });
		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });
		await temp.db.update(recurringTransactions).set({ status: "active" });
		const before = await stored();

		await expect(cleanupRecurring(deps())).resolves.toEqual({ inactive: 1 });
		const after = new Map((await stored()).map((row) => [row.label, row]));

		expect(after.get("STALE")).toEqual({
			...before.find((row) => row.label === "STALE"),
			status: "inactive",
			updatedAt: Date.parse("2026-09-21T10:00:00Z"),
		});
		expect(after.get("FRESH")).toEqual(before.find((row) => row.label === "FRESH"));
		await expect(cleanupRecurring(deps())).resolves.toEqual({ inactive: 0 });
	});

	it("deletes a suggestion with no row left in its window, and never counts it", async () => {
		const accountId = await account();
		await detectedBill(accountId);
		vi.setSystemTime(new Date("2026-12-21T10:00:00Z"));

		await expect(cleanupRecurring(deps())).resolves.toEqual({ inactive: 0 });
		await expect(stored()).resolves.toEqual([]);
	});
});

describe("detection and statuses", () => {
	it("keeps a suggestion that goes stale suggested, and deletes it once its window is empty", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-05-15", "2026-06-15", "2026-07-15"]);
		vi.setSystemTime(new Date("2026-08-01T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });
		const [row] = await stored();

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual([
			{ ...row, occurrenceCount: 1, updatedAt: Date.parse("2026-09-21T10:00:00Z") },
		]);

		vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toEqual([]);
	});

	it("marks an active pattern inactive two months after its last row", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-05-15", "2026-06-15", "2026-07-15"]);
		vi.setSystemTime(new Date("2026-08-01T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });
		const [row] = await stored();
		await setStatus(row!.id, "active");

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 0 });
		// Six months back for an active pattern: its three rows still count.
		await expect(stored()).resolves.toEqual([
			{
				...row,
				status: "inactive",
				nextExpectedDate: "2026-10-15",
				updatedAt: Date.parse("2026-09-21T10:00:00Z"),
			},
		]);
	});

	it("keeps an active pattern last seen exactly two months ago", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-05-21", "2026-06-21", "2026-07-21"]);
		vi.setSystemTime(new Date("2026-08-01T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });
		const [row] = await stored();
		await setStatus(row!.id, "active");

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toMatchObject([{ status: "active" }]);
	});

	it("gives an active manual pattern six months before it becomes inactive", async () => {
		const accountId = await account();
		const [entryId = ""] = await addRows(accountId, ["2026-03-21"]);
		vi.setSystemTime(new Date("2026-03-22T10:00:00Z"));
		await addRecurringFromEntry(deps(), entryId);

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toMatchObject([{ status: "active", manual: true }]);

		vi.setSystemTime(new Date("2026-09-22T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toMatchObject([{ status: "inactive", manual: true }]);
	});

	it("updates an inactive pattern detected again and keeps it inactive", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		await setStatus(row.id, "inactive");

		vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
		await addRows(accountId, ["2026-10-10"]);

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 1 });
		await expect(stored()).resolves.toEqual([
			{
				...row,
				status: "inactive",
				lastOccurrenceDate: "2026-10-10",
				nextExpectedDate: "2026-11-10",
				updatedAt: Date.parse("2026-10-15T10:00:00Z"),
			},
		]);
	});

	it("updates an active pattern and keeps it active", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		await setStatus(row.id, "active");

		vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
		await addRows(accountId, ["2026-10-10"]);
		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toMatchObject([
			{ id: row.id, status: "active", lastOccurrenceDate: "2026-10-10" },
		]);
	});

	it("leaves an ended pattern untouched and never recreates it", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		await setStatus(row.id, "ended");

		vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
		await addRows(accountId, ["2026-10-10"]);

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual([{ ...row, status: "ended" }]);
	});

	it("keeps a manual pattern detection does not find, due from today on", async () => {
		const accountId = await account();
		const [entryId = ""] = await addRows(accountId, ["2026-09-05"]);
		await addRecurringFromEntry(deps(), entryId);
		const [before] = await stored();

		vi.setSystemTime(new Date("2026-12-21T10:00:00Z"));

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual([
			{
				...before,
				nextExpectedDate: "2027-01-05",
				updatedAt: Date.parse("2026-12-21T10:00:00Z"),
			},
		]);
	});

	it("keeps a stale suggested pattern suggested when detection finds it again", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		await temp.db
			.update(recurringTransactions)
			.set({ lastOccurrenceDate: "2026-06-10" })
			.where(eq(recurringTransactions.id, row.id));

		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toMatchObject([
			{ id: row.id, status: "suggested", lastOccurrenceDate: "2026-09-10" },
		]);
	});

	it("leaves a stale ended pattern ended", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-05-15", "2026-06-15", "2026-07-15"]);
		vi.setSystemTime(new Date("2026-08-01T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });
		const [row] = await stored();
		await setStatus(row!.id, "ended");

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toEqual([{ ...row, status: "ended" }]);
	});
});

describe("listRecurring", () => {
	it("lists current patterns before inactive ones, each by next date, and hides ended ones", async () => {
		const accountId = await account("Joint");
		await temp.db
			.insert(merchants)
			.values({ id: "netflix", name: "Netflix", createdAt: 0, updatedAt: 0 });
		const netflix = await addRows(
			accountId,
			["2026-07-20", "2026-08-20", "2026-09-20"],
			"NETFLIX.COM",
			-1399,
		);
		await netflix.reduce<Promise<unknown>>(
			(pending, id) =>
				pending.then(() =>
					updateTransaction(deps(), id, { merchantId: "netflix" }, { origin: "user" }),
				),
			Promise.resolve(),
		);
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"], "PRLV EDF");
		await addRows(accountId, ["2026-07-15", "2026-08-15", "2026-09-15"], "LOYER", -90_000);
		await addRows(accountId, ["2026-07-01", "2026-08-01", "2026-09-01"], "GYM", -3000);
		await runRecurring(deps(), { backfill: false });
		const idOf = new Map((await stored()).map((row) => [row.label, row.id]));
		await setStatus(idOf.get("PRLV EDF")!, "inactive");
		await setStatus(idOf.get("GYM")!, "ended");
		await setStatus(idOf.get("LOYER")!, "active");

		await expect(listRecurring(deps())).resolves.toEqual([
			{
				id: idOf.get("LOYER"),
				accountId,
				accountName: "Joint",
				accountType: "depository",
				merchantId: null,
				merchantName: null,
				label: "LOYER",
				amount: -90_000,
				expectedAmountMin: -90_000,
				expectedAmountMax: -90_000,
				currency: "EUR",
				expectedDayOfMonth: 15,
				lastOccurrenceDate: "2026-09-15",
				nextExpectedDate: "2026-10-15",
				occurrenceCount: 3,
				status: "active",
				manual: false,
				name: null,
				billType: "bill",
				categoryId: null,
				autopay: false,
				notes: null,
				paymentUrl: null,
				anchorDate: null,
				endAfterCount: null,
				rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 15 }],
				frequency: {
					key: "monthly",
					dayOfMonth: 15,
					secondDayOfMonth: null,
					weekday: null,
					monthOfYear: null,
					interval: null,
					intervalUnit: null,
				},
				// Activated behind the service's back: no occurrence yet.
				currentOccurrence: null,
			},
			expect.objectContaining({
				id: idOf.get("NETFLIX.COM"),
				merchantId: "netflix",
				merchantName: "Netflix",
				nextExpectedDate: "2026-10-20",
				status: "suggested",
			}),
			expect.objectContaining({ id: idOf.get("PRLV EDF"), status: "inactive" }),
		]);
	});

	it("breaks a tie on the next date by id", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"], "A");
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"], "B");
		await runRecurring(deps(), { backfill: false });
		const ids = (await stored()).map((row) => row.id).toSorted();

		await expect(listRecurring(deps()).then((rows) => rows.map((row) => row.id))).resolves.toEqual(
			ids,
		);
	});
});

/** Five series on one account, each with its own status and next date. */
async function fiveSeries() {
	const accountId = await account();
	await addRows(accountId, ["2026-06-24", "2026-07-24", "2026-08-24"], "SOON", -1000);
	await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"], "LATER", -2000);
	await addRows(accountId, ["2026-07-15", "2026-08-15", "2026-09-15"], "OVERDUE", -3000);
	await addRows(accountId, ["2026-06-25", "2026-07-25", "2026-08-25"], "STOPPED", -4000);
	await addRows(accountId, ["2026-06-26", "2026-07-26", "2026-08-26"], "GONE", -5000);
	await runRecurring(deps(), { backfill: false });
	const idOf = new Map((await stored()).map((row) => [row.label, row.id]));
	await setStatus(idOf.get("LATER")!, "active");
	await setStatus(idOf.get("STOPPED")!, "inactive");
	await setStatus(idOf.get("GONE")!, "ended");
	// Overdue since the 15th, as when the bank has not taken that month's bill yet.
	await temp.db
		.update(recurringTransactions)
		.set({ nextExpectedDate: "2026-09-15" })
		.where(eq(recurringTransactions.id, idOf.get("OVERDUE")!));
}

const labelsOf = (filter: Parameters<typeof listRecurring>[1]) =>
	listRecurring(deps(), filter).then((rows) => rows.map((row) => row.label));

describe("listRecurring with a filter", () => {
	it("keeps suggested and active series for current, inactive ones for inactive, both for all", async () => {
		await fiveSeries();

		await expect(labelsOf({ status: "current" })).resolves.toEqual(["OVERDUE", "SOON", "LATER"]);
		await expect(labelsOf({ status: "inactive" })).resolves.toEqual(["STOPPED"]);
		await expect(labelsOf({ status: "all" })).resolves.toEqual([
			"OVERDUE",
			"SOON",
			"LATER",
			"STOPPED",
		]);
		// The page's call, without a filter, is the same list as all.
		await expect(labelsOf(undefined)).resolves.toEqual(await labelsOf({ status: "all" }));
	});

	it("keeps the next dates from today to today plus the days, overdue ones out", async () => {
		await fiveSeries();
		const nextOf = new Map((await stored()).map((row) => [row.label, row.nextExpectedDate]));

		// Today is 2026-09-21: SOON is due in 3 days, LATER in 19, OVERDUE was due a week ago.
		expect(nextOf.get("SOON")).toBe("2026-09-24");
		expect(nextOf.get("LATER")).toBe("2026-10-10");
		expect(nextOf.get("OVERDUE")).toBe("2026-09-15");
		await expect(labelsOf({ status: "current", withinDays: 7 })).resolves.toEqual(["SOON"]);
		await expect(labelsOf({ status: "current", withinDays: 3 })).resolves.toEqual(["SOON"]);
		await expect(labelsOf({ status: "current", withinDays: 2 })).resolves.toEqual([]);
		await expect(labelsOf({ status: "all", withinDays: 19 })).resolves.toEqual([
			"SOON",
			"LATER",
			"STOPPED",
		]);
		await expect(labelsOf({ status: "inactive", withinDays: 7 })).resolves.toEqual(["STOPPED"]);
	});

	it("keeps a series due today in the window", async () => {
		await fiveSeries();
		await temp.db
			.update(recurringTransactions)
			.set({ nextExpectedDate: "2026-09-21" })
			.where(eq(recurringTransactions.label, "SOON"));

		await expect(labelsOf({ status: "current", withinDays: 1 })).resolves.toEqual(["SOON"]);
	});
});

describe("setRecurringStatus", () => {
	it("activates a suggested, inactive or ended pattern", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);

		await expect(setRecurringStatus(deps(), row.id, "active")).resolves.toMatchObject({
			id: row.id,
			status: "active",
		});

		await setStatus(row.id, "inactive");

		await expect(setRecurringStatus(deps(), row.id, "active")).resolves.toMatchObject({
			status: "active",
		});

		await setStatus(row.id, "ended");

		await expect(setRecurringStatus(deps(), row.id, "active")).resolves.toMatchObject({
			status: "active",
		});
		await expect(stored()).resolves.toMatchObject([{ status: "active" }]);
	});

	it("moves a past next date from today on when it activates, not when it ends", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		await temp.db
			.update(recurringTransactions)
			.set({ nextExpectedDate: "2026-09-10" })
			.where(eq(recurringTransactions.id, row.id));

		await expect(setRecurringStatus(deps(), row.id, "ended")).resolves.toMatchObject({
			nextExpectedDate: "2026-09-10",
		});
		await setStatus(row.id, "suggested");
		await expect(setRecurringStatus(deps(), row.id, "active")).resolves.toMatchObject({
			status: "active",
			nextExpectedDate: "2026-10-10",
		});
		await expect(stored()).resolves.toMatchObject([{ nextExpectedDate: "2026-10-10" }]);
	});

	it("pauses an active pattern only", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);

		await expect(setRecurringStatus(deps(), row.id, "inactive")).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "status", code: "invalid_value" }],
		});

		await setStatus(row.id, "active");

		await expect(setRecurringStatus(deps(), row.id, "inactive")).resolves.toMatchObject({
			status: "inactive",
		});
	});

	it("ends a suggestion only", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		const statuses: RecurringStatus[] = ["active", "inactive", "ended"];

		await statuses.reduce<Promise<unknown>>(
			(pending, status) =>
				pending
					.then(() => setStatus(row.id, status))
					.then(() =>
						expect(setRecurringStatus(deps(), row.id, "ended")).rejects.toMatchObject({
							code: "VALIDATION_ERROR",
							fields: [{ path: "status", code: "invalid_value" }],
						}),
					),
			Promise.resolve(),
		);

		await setStatus(row.id, "suggested");

		await expect(setRecurringStatus(deps(), row.id, "ended")).resolves.toMatchObject({
			status: "ended",
		});
	});

	it("refuses every move back to suggested, and pausing anything but an active pattern", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		const statuses: RecurringStatus[] = ["suggested", "active", "inactive", "ended"];

		await statuses.reduce<Promise<unknown>>(
			(pending, status) =>
				pending
					.then(() => setStatus(row.id, status))
					.then(() =>
						expect(setRecurringStatus(deps(), row.id, "suggested")).rejects.toMatchObject({
							code: "VALIDATION_ERROR",
						}),
					)
					.then(() =>
						status === "active"
							? undefined
							: expect(setRecurringStatus(deps(), row.id, "inactive")).rejects.toMatchObject({
									code: "VALIDATION_ERROR",
								}),
					),
			Promise.resolve(),
		);
		await expect(stored()).resolves.toMatchObject([{ status: "ended" }]);
	});

	it("answers NOT_FOUND for an unknown id", async () => {
		await expect(setRecurringStatus(deps(), "nope", "active")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("addRecurringFromEntry", () => {
	it("stores an active manual pattern due next on the transaction's day", async () => {
		const accountId = await account("Joint");
		const [entryId = ""] = await addRows(accountId, ["2026-09-05"], "Prlv  EDF");

		const added = await addRecurringFromEntry(deps(), entryId);

		expect(added.id).toMatch(/^[0-9a-f-]{36}$/u);
		expect(added).toEqual({
			id: added.id,
			accountId,
			accountName: "Joint",
			accountType: "depository",
			merchantId: null,
			merchantName: null,
			label: "Prlv  EDF",
			amount: -6500,
			expectedAmountMin: -6500,
			expectedAmountMax: -6500,
			currency: "EUR",
			expectedDayOfMonth: 5,
			lastOccurrenceDate: "2026-09-05",
			nextExpectedDate: "2026-10-05",
			occurrenceCount: 1,
			status: "active",
			manual: true,
			name: null,
			billType: "bill",
			categoryId: null,
			autopay: false,
			notes: null,
			paymentUrl: null,
			anchorDate: null,
			endAfterCount: null,
			rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 5 }],
			frequency: {
				key: "monthly",
				dayOfMonth: 5,
				secondDayOfMonth: null,
				weekday: null,
				monthOfYear: null,
				interval: null,
				intervalUnit: null,
			},
			currentOccurrence: added.currentOccurrence,
		});
		// From its cycle's start, as Sure's generator; the next run's match pays it.
		expect(added.currentOccurrence).toEqual({
			id: added.currentOccurrence?.id,
			dueOn: "2026-09-05",
			effectiveDueOn: "2026-09-05",
			status: "scheduled",
			state: "overdue",
			daysLate: 16,
		});
		await expect(stored()).resolves.toMatchObject([{ id: added.id, labelKey: "prlv edf" }]);
	});

	it("keys a transaction with a merchant by the merchant, due later this month", async () => {
		const accountId = await account();
		await temp.db
			.insert(merchants)
			.values({ id: "netflix", name: "Netflix", createdAt: 0, updatedAt: 0 });
		const [entryId = ""] = await addRows(accountId, ["2026-08-28"], "NETFLIX.COM", -1399);
		await updateTransaction(deps(), entryId, { merchantId: "netflix" }, { origin: "user" });

		await expect(addRecurringFromEntry(deps(), entryId)).resolves.toMatchObject({
			merchantId: "netflix",
			merchantName: "Netflix",
			nextExpectedDate: "2026-09-28",
		});
		await expect(stored()).resolves.toMatchObject([{ merchantId: "netflix", labelKey: null }]);
	});

	it("activates the pattern already stored under the same key", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		const [entryId = ""] = await addRows(accountId, ["2026-09-10"]);

		await expect(addRecurringFromEntry(deps(), entryId)).resolves.toMatchObject({
			id: row.id,
			status: "active",
			manual: false,
		});
		await expect(stored()).resolves.toEqual([{ ...row, status: "active" }]);
	});

	it("moves a past next date from today on when it activates a stored pattern", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		await temp.db
			.update(recurringTransactions)
			.set({ nextExpectedDate: "2026-09-10" })
			.where(eq(recurringTransactions.id, row.id));
		const [entryId = ""] = await addRows(accountId, ["2026-09-10"]);

		await expect(addRecurringFromEntry(deps(), entryId)).resolves.toMatchObject({
			id: row.id,
			status: "active",
			nextExpectedDate: "2026-10-10",
		});
	});

	it("activates an ended pattern of the same key", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		await setStatus(row.id, "ended");
		const [entryId = ""] = await addRows(accountId, ["2026-09-10"]);

		await expect(addRecurringFromEntry(deps(), entryId)).resolves.toMatchObject({
			id: row.id,
			status: "active",
		});
	});

	it("activates the series of the same key at another amount rather than add a twin", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"], "NETFLIX", -1349);
		await runRecurring(deps(), { backfill: false });
		const [row] = await stored();
		const [entryId = ""] = await addRows(accountId, ["2026-09-12"], "NETFLIX", -1599);

		await expect(addRecurringFromEntry(deps(), entryId)).resolves.toMatchObject({
			id: row!.id,
			amount: -1349,
			status: "active",
		});
		await expect(stored()).resolves.toEqual([{ ...row, status: "active" }]);
	});

	it("activates the one of the same amount first, else the latest", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-08"], "NETFLIX", -1349);
		// Apart from -13,49 by more than 7.5 %, so a series of its own.
		await addRows(accountId, ["2026-07-15", "2026-08-15", "2026-09-15"], "NETFLIX", -1999);
		await runRecurring(deps(), { backfill: false });
		const idOf = new Map((await stored()).map((row) => [row.amount, row.id]));
		const [same = ""] = await addRows(accountId, ["2026-09-10"], "NETFLIX", -1349);
		const [other = ""] = await addRows(accountId, ["2026-09-12"], "NETFLIX", -1599);

		await expect(addRecurringFromEntry(deps(), same)).resolves.toMatchObject({
			id: idOf.get(-1349),
		});
		await expect(addRecurringFromEntry(deps(), other)).resolves.toMatchObject({
			id: idOf.get(-1999),
		});
		await expect(stored()).resolves.toHaveLength(2);
	});

	it("refuses a transfer side", async () => {
		const checking = await account("Courant");
		const savings = await account("Livret");
		const [outflow = ""] = await addRows(checking, ["2026-09-10"], "VIR LIVRET", -20_000);
		const [inflow = ""] = await addRows(savings, ["2026-09-10"], "VIR COURANT", 20_000);
		// Ingestion links the pair on its own.
		await expect(findTransaction(deps(), inflow)).resolves.toMatchObject({
			transfer: { counterpartAccountId: checking },
		});

		await expect(addRecurringFromEntry(deps(), outflow)).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "entryId", code: "invalid_value" }],
		});
		await expect(stored()).resolves.toEqual([]);
	});

	it("accepts a loan payment's outflow, which is spent", async () => {
		const checking = await account("Courant");
		const loan = await account("Prêt", { type: "loan", subtype: "mortgage" });
		const [outflow = ""] = await addRows(checking, ["2026-09-10"], "ECHEANCE PRET", -80_000);
		await addRows(loan, ["2026-09-10"], "ECHEANCE", 80_000);
		await expect(findTransaction(deps(), outflow)).resolves.toMatchObject({
			transfer: { kind: "loan_payment" },
		});

		await expect(addRecurringFromEntry(deps(), outflow)).resolves.toMatchObject({
			accountId: checking,
			amount: -80_000,
			status: "active",
			manual: true,
		});
	});

	it("answers NOT_FOUND for an unknown entry or a valuation", async () => {
		const accountId = await account();
		const snapshot = await recordSnapshot(
			deps(),
			accountId,
			{ date: "2026-09-01", balance: toMinorUnits(1000) },
			{ origin: "user" },
		);

		await expect(addRecurringFromEntry(deps(), "nope")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(snapshot.status).toBe("recorded");
		await expect(
			addRecurringFromEntry(deps(), snapshot.status === "recorded" ? snapshot.id : ""),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("detection keeps a renamed series single", () => {
	it("follows its rows to the merchant a bulk edit set", async () => {
		const accountId = await account();
		const ids = await addRows(
			accountId,
			["2026-07-10", "2026-08-10", "2026-09-10"],
			"PRLV NETFLIX",
		);
		await runRecurring(deps(), { backfill: false });
		const [row] = await stored();
		await temp.db
			.insert(merchants)
			.values({ id: "netflix", name: "Netflix", createdAt: 0, updatedAt: 0 });
		await bulkUpdateTransactions(deps(), { ids }, { merchantId: "netflix" }, { origin: "user" });

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 1 });
		await expect(stored()).resolves.toEqual([
			{ ...row, merchantId: "netflix", labelKey: null, label: "PRLV NETFLIX" },
		]);
	});

	it("follows its rows to the label a rule gave them, active", async () => {
		const accountId = await account();
		// Imported: a rule never renames a row typed by hand, whose label is locked.
		await importRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		const [row] = await stored();
		await setStatus(row!.id, "active");
		await createRule(deps(), {
			name: "EDF",
			conditions: [{ conditionType: "transaction_name", operator: "like", value: "edf" }],
			actions: [{ actionType: "set_transaction_name", value: "EDF ENERGIE" }],
		});
		await applyRules(deps());

		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toEqual([
			{ ...row, status: "active", labelKey: "edf energie", label: "EDF ENERGIE" },
		]);
	});

	it("keeps an ended series ended, with no suggested twin", async () => {
		const accountId = await account();
		const ids = await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		const row = await detectedBill(accountId, ids);
		await setStatus(row.id, "ended");
		await rename(ids, "EDF ENERGIE");

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual([
			{ ...row, status: "ended", labelKey: "edf energie", label: "EDF ENERGIE" },
		]);
	});

	it("drops a suggested twin already on the new key and moves the active series", async () => {
		const accountId = await account();
		const ids = await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		const row = await detectedBill(accountId, ids);
		await setStatus(row.id, "active");
		await rename(ids, "EDF ENERGIE");
		await temp.db
			.insert(recurringTransactions)
			.values({ ...row, id: "twin", labelKey: "edf energie", label: "EDF ENERGIE" });

		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toEqual([
			{ ...row, status: "active", labelKey: "edf energie", label: "EDF ENERGIE" },
		]);
	});

	it("stays put when only its latest row was renamed, and no twin comes back", async () => {
		const accountId = await account();
		const ids = await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		const row = await detectedBill(accountId, ids);
		await rename([ids[2]!], "EDF ENERGIE");

		await runRecurring(deps(), { backfill: false });
		await addRows(accountId, ["2026-09-12"]);
		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toMatchObject([
			{ id: row.id, labelKey: "prlv edf", lastOccurrenceDate: "2026-09-12", occurrenceCount: 3 },
		]);
	});

	it("stays put when its last day's rows were renamed to two keys", async () => {
		const accountId = await account();
		const ids = await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10", "2026-09-10"]);
		const row = await detectedBill(accountId, ids);
		await setStatus(row.id, "active");
		await rename([ids[2]!], "GAZ");
		await rename([ids[3]!], "EAU");

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual([
			{
				...row,
				status: "active",
				labelKey: "prlv edf",
				lastOccurrenceDate: "2026-08-10",
				nextExpectedDate: "2026-10-10",
				occurrenceCount: 2,
			},
		]);
	});
});

describe("detection keeps every series current", () => {
	it("moves a late active series' next date from today on", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-06-15", "2026-07-15", "2026-08-15"]);
		vi.setSystemTime(new Date("2026-08-20T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });
		const [row] = await stored();
		await setStatus(row!.id, "active");

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toMatchObject([
			{
				id: row!.id,
				status: "active",
				lastOccurrenceDate: "2026-08-15",
				nextExpectedDate: "2026-10-15",
			},
		]);
	});

	it("moves a past next date from today on when a pattern updates an active series", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-06-21", "2026-07-20", "2026-08-20"]);
		vi.setSystemTime(new Date("2026-08-20T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });
		const [row] = await stored();
		await setStatus(row!.id, "active");

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));

		// The pattern alone would say 2026-09-20.
		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 1 });
		await expect(stored()).resolves.toMatchObject([
			{ id: row!.id, expectedDayOfMonth: 20, nextExpectedDate: "2026-10-20" },
		]);
	});

	it("catches a manual series up with six months of rows, its band included, though a pattern finds it", async () => {
		const accountId = await account();
		const [entryId = ""] = await addRows(accountId, ["2026-06-03"]);
		const added = await addRecurringFromEntry(deps(), entryId);
		await addRows(accountId, ["2026-07-03", "2026-08-03"]);
		await addRows(accountId, ["2026-09-03"], "PRLV EDF", -6700);

		await expect(runRecurring(deps(), { backfill: false })).resolves.toEqual({ detected: 1 });

		await expect(stored()).resolves.toMatchObject([
			{
				id: added.id,
				status: "active",
				manual: true,
				amount: -6500,
				expectedAmountMin: -6700,
				expectedAmountMax: -6500,
				expectedAmountAvg: -6550,
				occurrenceCount: 4,
				lastOccurrenceDate: "2026-09-03",
				nextExpectedDate: "2026-10-03",
			},
		]);
	});

	it("reads a manual series six months back when no pattern finds it", async () => {
		const accountId = await account();
		const [entryId = ""] = await addRows(accountId, ["2026-04-03"]);
		const added = await addRecurringFromEntry(deps(), entryId);
		await addRows(accountId, ["2026-05-04", "2026-09-02"]);

		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toMatchObject([
			{
				id: added.id,
				occurrenceCount: 3,
				lastOccurrenceDate: "2026-09-02",
				nextExpectedDate: "2026-10-03",
			},
		]);
	});

	it("recounts a series after a revert, from the rows left", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		// Another amount within 7.5 %, so the rows are no duplicates of the others.
		const importId = await importRows(
			accountId,
			["2026-07-12", "2026-08-12"],
			"PRLV EDF",
			"-66.00",
		);
		const [row] = await stored();
		expect(row).toMatchObject({ occurrenceCount: 5, lastOccurrenceDate: "2026-09-10" });

		await revertImport(importDeps(), importId);

		await expect(stored()).resolves.toEqual([
			{
				...row,
				expectedDayOfMonth: 10,
				occurrenceCount: 3,
				lastOccurrenceDate: "2026-09-10",
				expectedAmountMin: -6500,
				expectedAmountAvg: -6500,
			},
		]);
	});

	it("recounts a series no pattern finds after a revert", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10"]);
		const importId = await importRows(accountId, ["2026-09-10"]);
		const [row] = await stored();
		expect(row).toMatchObject({ occurrenceCount: 3 });

		await revertImport(importDeps(), importId);

		await expect(stored()).resolves.toEqual([
			{
				...row,
				occurrenceCount: 2,
				lastOccurrenceDate: "2026-08-10",
				nextExpectedDate: "2026-09-10",
			},
		]);
	});

	it("deletes a suggested series whose every row a revert removed", async () => {
		const accountId = await account();
		const importId = await importRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		await expect(stored()).resolves.toHaveLength(1);

		await revertImport(importDeps(), importId);

		await expect(stored()).resolves.toEqual([]);
	});

	it("keeps an active series whose every row a revert removed, count 0", async () => {
		const accountId = await account();
		const importId = await importRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		const [row] = await stored();
		await setStatus(row!.id, "active");

		await revertImport(importDeps(), importId);

		const [after] = await stored();
		expect(after).toEqual({ ...row, status: "active", occurrenceCount: 0 });
		expect(after!.nextExpectedDate >= "2026-09-21").toBe(true);
	});

	it("moves a past next date from today on when a revert leaves an active series empty", async () => {
		const accountId = await account();
		vi.setSystemTime(new Date("2026-08-20T10:00:00Z"));
		const importId = await importRows(accountId, ["2026-06-15", "2026-07-15", "2026-08-15"]);
		const [row] = await stored();
		await setStatus(row!.id, "active");
		expect(row).toMatchObject({ nextExpectedDate: "2026-09-15" });

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
		await revertImport(importDeps(), importId);

		await expect(stored()).resolves.toMatchObject([
			{ id: row!.id, status: "active", occurrenceCount: 0, nextExpectedDate: "2026-10-15" },
		]);
	});

	it("deletes a suggested series left with no row and marks nothing inactive for it", async () => {
		const accountId = await account();
		const ids = await addRows(accountId, ["2026-05-15", "2026-06-15", "2026-07-15"]);
		vi.setSystemTime(new Date("2026-08-01T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });
		await rename(ids, "AUTRE CHOSE");
		await temp.db.update(recurringTransactions).set({ lastOccurrenceDate: "2026-07-20" });

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toEqual([]);
	});
});

describe("recurringOfEntry", () => {
	it("answers the series of the transaction's account and key, the same amount first", async () => {
		const accountId = await account();
		const [transaction = ""] = await addRows(accountId, ["2026-06-10"], "NETFLIX", -1599);
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-08"], "NETFLIX", -1349);
		// Apart from -13,49 by more than 7.5 %, so a series of its own.
		await addRows(accountId, ["2026-07-15", "2026-08-15", "2026-09-15"], "NETFLIX", -1999);
		await runRecurring(deps(), { backfill: false });
		const idOf = new Map((await stored()).map((row) => [row.amount, row.id]));
		const [same = ""] = await addRows(accountId, ["2026-09-10"], "NETFLIX", -1349);

		await expect(recurringOfEntry(deps(), same)).resolves.toMatchObject({
			id: idOf.get(-1349),
			label: "NETFLIX",
			accountName: "Compte",
		});
		// No series at -15,99: the latest of the key.
		await expect(recurringOfEntry(deps(), transaction)).resolves.toMatchObject({
			id: idOf.get(-1999),
		});
	});

	it("skips an ended series, and answers null without one", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		const [entryId = ""] = await addRows(accountId, ["2026-09-11"]);
		const [other = ""] = await addRows(accountId, ["2026-09-11"], "AUTRE");

		await expect(recurringOfEntry(deps(), other)).resolves.toBeNull();

		await setStatus(row.id, "ended");

		await expect(recurringOfEntry(deps(), entryId)).resolves.toBeNull();
	});

	it("answers NOT_FOUND for an unknown entry", async () => {
		await expect(recurringOfEntry(deps(), "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

const rowsOf = (ids: readonly string[]) =>
	Promise.all(ids.map(async (id) => (await findTransaction(deps(), id))!));

describe("recurringEntryIds", () => {
	it("flags a row of a merchant's series on its account, whatever its amount", async () => {
		const accountId = await account();
		await temp.db
			.insert(merchants)
			.values({ id: "netflix", name: "Netflix", createdAt: 0, updatedAt: 0 });
		const [first = ""] = await addRows(accountId, ["2026-08-28"], "NETFLIX.COM", -1399);
		const [dearer = ""] = await addRows(accountId, ["2026-09-20"], "NFLX PAIEMENT", -1799);
		await updateTransaction(deps(), first, { merchantId: "netflix" }, { origin: "user" });
		await updateTransaction(deps(), dearer, { merchantId: "netflix" }, { origin: "user" });
		const [bare = ""] = await addRows(accountId, ["2026-09-20"], "NETFLIX.COM", -1399);
		await addRecurringFromEntry(deps(), first);

		await expect(recurringEntryIds(temp.db, await rowsOf([first, dearer, bare]))).resolves.toEqual(
			new Set([first, dearer]),
		);
	});

	it("flags a row by its normalised label when it has no merchant", async () => {
		const accountId = await account();
		await detectedBill(accountId);
		const [later = ""] = await addRows(accountId, ["2026-09-21"], "prlv  edf", -7000);

		await expect(recurringEntryIds(temp.db, await rowsOf([later]))).resolves.toEqual(
			new Set([later]),
		);
	});

	it("leaves out a row whose only series is ended", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		const [entryId = ""] = await addRows(accountId, ["2026-09-21"]);
		await setStatus(row.id, "ended");

		await expect(recurringEntryIds(temp.db, await rowsOf([entryId]))).resolves.toEqual(new Set());
	});

	it("leaves out a row on another account than the series", async () => {
		const withSeries = await account("Compte B");
		const without = await account("Compte A");
		await detectedBill(withSeries);
		const [entryId = ""] = await addRows(without, ["2026-09-21"]);

		await expect(recurringEntryIds(temp.db, await rowsOf([entryId]))).resolves.toEqual(new Set());
	});

	it("reads nothing for an empty page", async () => {
		await expect(recurringEntryIds(temp.db, [])).resolves.toEqual(new Set());
	});
});

const rulesOf = (id: string) =>
	temp.db
		.select({
			frequency: recurrenceRules.frequency,
			interval: recurrenceRules.interval,
			dayOfMonth: recurrenceRules.dayOfMonth,
		})
		.from(recurrenceRules)
		.where(eq(recurrenceRules.recurringTransactionId, id));

const oneByOneDates = (ids: readonly string[], dates: readonly string[]) =>
	ids.reduce<Promise<unknown>>(
		(pending, id, index) =>
			pending.then(() =>
				updateTransaction(deps(), id, { date: dates[index]! }, { origin: "user" }),
			),
		Promise.resolve(),
	);

/** The EDF bill detected on the 10th, its rows then moved to the 8th. */
async function driftedBill() {
	const accountId = await account();
	const ids = await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
	const row = await detectedBill(accountId, ids);
	await setRecurringStatus(deps(), row.id, "active");
	await oneByOneDates(ids, ["2026-07-08", "2026-08-08", "2026-09-08"]);

	return row;
}

describe("bills and schedules", () => {
	it("types a new suggestion with Sure's classifier, its category the most frequent of its rows", async () => {
		const accountId = await account();
		await temp.db.insert(categories).values(
			["loisirs", "abonnements"].map((id) => ({
				id,
				name: id,
				kind: "expense" as const,
				color: "#e99537",
				icon: "tag" as const,
				createdAt: 0,
				updatedAt: 0,
			})),
		);
		const netflix = await addRows(
			accountId,
			["2026-07-05", "2026-08-05", "2026-09-05"],
			"NETFLIX.COM",
			-1399,
		);
		await updateTransaction(deps(), netflix[0]!, { categoryId: "loisirs" }, { origin: "user" });
		await updateTransaction(deps(), netflix[1]!, { categoryId: "abonnements" }, { origin: "user" });
		await updateTransaction(deps(), netflix[2]!, { categoryId: "abonnements" }, { origin: "user" });
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"], "PRLV EDF");
		await addRows(accountId, ["2026-06-28", "2026-07-28", "2026-08-28"], "SALAIRE", 250_000);
		// The merchant's name carries the keyword, the label none.
		await temp.db
			.insert(merchants)
			.values({ id: "spotify", name: "Spotify", createdAt: 0, updatedAt: 0 });
		const music = await addRows(
			accountId,
			["2026-07-12", "2026-08-12", "2026-09-12"],
			"PRLV SEPA 4821",
			-1099,
		);
		await music.reduce<Promise<unknown>>(
			(pending, id) =>
				pending.then(() =>
					updateTransaction(deps(), id, { merchantId: "spotify" }, { origin: "user" }),
				),
			Promise.resolve(),
		);
		// No word to go by: a flat modest charge is a subscription on a credit card only.
		const card = await account("Carte", { type: "credit_card", subtype: null });
		await addRows(card, ["2026-07-15", "2026-08-15", "2026-09-15"], "SERVICE EN LIGNE", -999);
		await addRows(accountId, ["2026-07-16", "2026-08-16", "2026-09-16"], "SERVICE EN LIGNE", -999);

		await runRecurring(deps(), { backfill: false });

		const rows = new Map((await stored()).map((row) => [row.label, row]));
		expect(rows.get("NETFLIX.COM")).toMatchObject({
			billType: "subscription",
			categoryId: "abonnements",
			autopay: true,
		});
		expect(rows.get("PRLV EDF")).toMatchObject({
			billType: "bill",
			categoryId: null,
			autopay: false,
		});
		const all = await stored();
		expect(all.find((row) => row.merchantId === "spotify")).toMatchObject({
			billType: "subscription",
			autopay: true,
		});
		expect(
			all
				.filter((row) => row.label === "SERVICE EN LIGNE")
				.map((row) => [row.accountId === card, row.billType]),
		).toEqual(
			expect.arrayContaining([
				[true, "subscription"],
				[false, "bill"],
			]),
		);
		expect(rows.get("SALAIRE")).toMatchObject({
			billType: "income",
			categoryId: null,
			autopay: false,
		});
		await expect(rulesOf(rows.get("PRLV EDF")!.id)).resolves.toEqual([
			{ frequency: "monthly", interval: 1, dayOfMonth: 10 },
		]);
	});

	it("moves an unpinned monthly series' day and rule with the day detected", async () => {
		const row = await driftedBill();

		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toMatchObject([
			{
				id: row.id,
				expectedDayOfMonth: 8,
				lastOccurrenceDate: "2026-09-08",
				nextExpectedDate: "2026-10-08",
			},
		]);
		await expect(rulesOf(row.id)).resolves.toEqual([
			{ frequency: "monthly", interval: 1, dayOfMonth: 8 },
		]);
		// The open dates to come were rebuilt on the 8th.
		const future = await temp.db
			.select({ dueOn: recurringOccurrences.dueOn })
			.from(recurringOccurrences)
			.where(
				and(
					eq(recurringOccurrences.recurringTransactionId, row.id),
					eq(recurringOccurrences.status, "scheduled"),
					gte(recurringOccurrences.dueOn, "2026-09-21"),
				),
			)
			.orderBy(recurringOccurrences.dueOn);
		expect(future.map(({ dueOn }) => dueOn)).toEqual(["2026-10-08", "2026-11-08", "2026-12-08"]);
	});

	it("never moves the day or the rules of a cadence the owner set", async () => {
		const row = await driftedBill();
		await editBill(deps(), row.id, { frequency: { preset: "quarterly", dayOfMonth: "10" } });

		await runRecurring(deps(), { backfill: false });

		await expect(stored()).resolves.toMatchObject([
			{
				id: row.id,
				expectedDayOfMonth: 10,
				lastOccurrenceDate: "2026-09-08",
				nextExpectedDate: "2026-12-10",
				occurrenceCount: 3,
				status: "active",
			},
		]);
		await expect(rulesOf(row.id)).resolves.toEqual([
			{ frequency: "monthly", interval: 3, dayOfMonth: 10 },
		]);
	});

	it("keeps a quarterly series active two monthly cycles without payment, as two of its own", async () => {
		const accountId = await account();
		const insert = (id: string) =>
			temp.db.insert(recurringTransactions).values({
				id,
				accountId,
				labelKey: id,
				label: id,
				amount: -6500,
				currency: "EUR",
				expectedDayOfMonth: 10,
				anchorDate: "2026-06-10",
				lastOccurrenceDate: "2026-06-10",
				nextExpectedDate: "2026-09-10",
				occurrenceCount: 3,
				status: "active",
				createdAt: 0,
				updatedAt: 0,
			});
		await insert("eau");
		await insert("edf");
		await temp.db.insert(recurrenceRules).values(
			[
				["eau", 3],
				["edf", 1],
			].map(([id, interval]) => ({
				id: `rule-${id}`,
				recurringTransactionId: String(id),
				frequency: "monthly" as const,
				interval: Number(interval),
				dayOfMonth: 10,
			})),
		);

		await expect(cleanupRecurring(deps())).resolves.toEqual({ inactive: 1 });
		await expect(
			stored().then((rows) =>
				rows.map((row) => `${row.id} ${row.status}`).toSorted((a, b) => a.localeCompare(b)),
			),
		).resolves.toEqual(["eau active", "edf inactive"]);
	});

	it("keeps a declared bill as declared through detection, before its first payment", async () => {
		const accountId = await account();
		const ahead = await declareBill(deps(), {
			kind: "bill",
			name: "Assurance habitation",
			amount: "312,00",
			accountId,
			firstDueOn: "2026-11-15",
			frequency: { preset: "annual" },
		});
		const late = await declareBill(deps(), {
			kind: "bill",
			name: "Taxe foncière",
			amount: "1 200,00",
			accountId,
			firstDueOn: "2026-09-15",
			frequency: { preset: "annual" },
		});

		await runRecurring(deps(), { backfill: false });

		await expect(listRecurring(deps())).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: ahead.id,
					status: "active",
					lastOccurrenceDate: "2026-11-15",
					nextExpectedDate: "2026-11-15",
					occurrenceCount: 0,
				}),
				// Its due date passed unpaid: due again a year on, its last date kept.
				expect.objectContaining({
					id: late.id,
					status: "active",
					lastOccurrenceDate: "2026-09-15",
					nextExpectedDate: "2027-09-15",
					occurrenceCount: 0,
				}),
			]),
		);
	});
});
