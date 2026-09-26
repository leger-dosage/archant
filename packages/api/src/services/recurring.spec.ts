import type { TempDatabase } from "../testing/temp-database.ts";
import type { NewAccountInput } from "./ledger.ts";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { merchants } from "@archant/data/schema/merchants";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";
import type { RecurringStatus } from "@archant/data/schema/recurring-transactions";

import { createLogger } from "../lib/logger.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { confirmImport, createImport, revertImport } from "./imports.ts";
import {
	bulkUpdateTransactions,
	createAccount,
	findTransaction,
	ingest,
	recordSnapshot,
	updateTransaction,
} from "./ledger.ts";
import {
	addRecurringFromEntry,
	detectRecurring,
	listRecurring,
	recurringEntryIds,
	recurringOfEntry,
	setRecurringStatus,
} from "./recurring.ts";
import { applyRules, createRule } from "./rules.ts";

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
async function importRows(accountId: string, dates: readonly string[], label = "PRLV EDF") {
	const lines = dates.map(
		(date, index) =>
			`<STMTTRN><DTPOSTED>${date.replaceAll("-", "")}<TRNAMT>-65.00<FITID>F${index}<NAME>${label}</STMTTRN>`,
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

	await detectRecurring(deps());
	const [row] = await stored();

	return row!;
}

describe("detectRecurring", () => {
	it("stores a detected pattern and counts it", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 1 });
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
			currency: "EUR",
			expectedDayOfMonth: 10,
			lastOccurrenceDate: "2026-09-10",
			nextExpectedDate: "2026-10-10",
			occurrenceCount: 3,
			status: "detected",
			manual: false,
			createdAt: Date.parse("2026-09-21T10:00:00Z"),
			updatedAt: Date.parse("2026-09-21T10:00:00Z"),
		});
	});

	it("updates the same row when run twice", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		await detectRecurring(deps());
		const [first] = await stored();

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 1 });
		await expect(stored()).resolves.toEqual([first]);
	});

	it("updates the day, dates, count and label of a stored pattern", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		await detectRecurring(deps());
		const [first] = await stored();

		vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
		await addRows(accountId, ["2026-10-12"], "prlv  Édf");
		await detectRecurring(deps());

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
		await detectRecurring(deps());
		const [before] = await stored();

		vi.setSystemTime(new Date("2026-10-26T10:00:00Z"));

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 0 });
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

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 1 });

		vi.setSystemTime(new Date("2026-09-22T10:00:00Z"));
		await temp.db.delete(recurringTransactions);

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual([]);
	});

	it("reads rows from three months back, today in the household's time zone", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-06-21", "2026-07-21", "2026-08-21"]);

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 1 });

		// 22:30 UTC is already 22 September in Paris.
		vi.setSystemTime(new Date("2026-09-21T22:30:00Z"));

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 0 });
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

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 2 });
		const first = await stored();
		expect(first).toHaveLength(2);
		expect(first.map((row) => ({ merchantId: row.merchantId, labelKey: row.labelKey }))).toEqual(
			expect.arrayContaining([
				{ merchantId: "netflix", labelKey: null },
				{ merchantId: "spotify", labelKey: null },
			]),
		);

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 2 });
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

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 1 });
		await expect(stored()).resolves.toMatchObject([{ occurrenceCount: 3 }]);
	});
});

describe("detectRecurring and statuses", () => {
	it("marks a detected pattern inactive two months after its last row", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-05-15", "2026-06-15", "2026-07-15"]);
		vi.setSystemTime(new Date("2026-08-01T10:00:00Z"));
		await detectRecurring(deps());
		const [row] = await stored();

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual([
			{
				...row,
				status: "inactive",
				occurrenceCount: 1,
				updatedAt: Date.parse("2026-09-21T10:00:00Z"),
			},
		]);
	});

	it("keeps a detected pattern last seen exactly two months ago", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-05-21", "2026-06-21", "2026-07-21"]);
		vi.setSystemTime(new Date("2026-08-01T10:00:00Z"));
		await detectRecurring(deps());

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
		await detectRecurring(deps());

		await expect(stored()).resolves.toMatchObject([{ status: "detected" }]);
	});

	it("never marks a confirmed pattern inactive", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-04-01", "2026-05-01", "2026-06-01"]);
		vi.setSystemTime(new Date("2026-06-10T10:00:00Z"));
		await detectRecurring(deps());
		const [row] = await stored();
		await setStatus(row!.id, "confirmed");

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
		await detectRecurring(deps());

		// Six months back for a confirmed pattern: its three rows still count.
		await expect(stored()).resolves.toEqual([
			{
				...row,
				status: "confirmed",
				occurrenceCount: 3,
				nextExpectedDate: "2026-10-01",
				updatedAt: Date.parse("2026-09-21T10:00:00Z"),
			},
		]);
	});

	it("updates an inactive pattern detected again and keeps it inactive", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		await setStatus(row.id, "inactive");

		vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
		await addRows(accountId, ["2026-10-10"]);

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 1 });
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

	it("updates a confirmed pattern and keeps it confirmed", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		await setStatus(row.id, "confirmed");

		vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
		await addRows(accountId, ["2026-10-10"]);
		await detectRecurring(deps());

		await expect(stored()).resolves.toMatchObject([
			{ id: row.id, status: "confirmed", lastOccurrenceDate: "2026-10-10" },
		]);
	});

	it("leaves a dismissed pattern untouched and never recreates it", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		await setStatus(row.id, "dismissed");

		vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
		await addRows(accountId, ["2026-10-10"]);

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual([{ ...row, status: "dismissed" }]);
	});

	it("keeps a manual pattern detection does not find, due from today on", async () => {
		const accountId = await account();
		const [entryId = ""] = await addRows(accountId, ["2026-09-05"]);
		await addRecurringFromEntry(deps(), entryId);
		const [before] = await stored();

		vi.setSystemTime(new Date("2026-12-21T10:00:00Z"));

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual([
			{
				...before,
				nextExpectedDate: "2027-01-05",
				updatedAt: Date.parse("2026-12-21T10:00:00Z"),
			},
		]);
	});

	it("keeps a stale detected pattern detected when detection finds it again", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		await temp.db
			.update(recurringTransactions)
			.set({ lastOccurrenceDate: "2026-06-10" })
			.where(eq(recurringTransactions.id, row.id));

		await detectRecurring(deps());

		await expect(stored()).resolves.toMatchObject([
			{ id: row.id, status: "detected", lastOccurrenceDate: "2026-09-10" },
		]);
	});

	it("leaves a stale dismissed pattern dismissed", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-05-15", "2026-06-15", "2026-07-15"]);
		vi.setSystemTime(new Date("2026-08-01T10:00:00Z"));
		await detectRecurring(deps());
		const [row] = await stored();
		await setStatus(row!.id, "dismissed");

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
		await detectRecurring(deps());

		await expect(stored()).resolves.toEqual([{ ...row, status: "dismissed" }]);
	});
});

describe("listRecurring", () => {
	it("lists current patterns before inactive ones, each by next date, and hides dismissed ones", async () => {
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
		await detectRecurring(deps());
		const idOf = new Map((await stored()).map((row) => [row.label, row.id]));
		await setStatus(idOf.get("PRLV EDF")!, "inactive");
		await setStatus(idOf.get("GYM")!, "dismissed");
		await setStatus(idOf.get("LOYER")!, "confirmed");

		await expect(listRecurring(deps())).resolves.toEqual([
			{
				id: idOf.get("LOYER"),
				accountId,
				accountName: "Joint",
				merchantId: null,
				merchantName: null,
				label: "LOYER",
				amount: -90_000,
				currency: "EUR",
				expectedDayOfMonth: 15,
				lastOccurrenceDate: "2026-09-15",
				nextExpectedDate: "2026-10-15",
				occurrenceCount: 3,
				status: "confirmed",
				manual: false,
			},
			expect.objectContaining({
				id: idOf.get("NETFLIX.COM"),
				merchantId: "netflix",
				merchantName: "Netflix",
				nextExpectedDate: "2026-10-20",
				status: "detected",
			}),
			expect.objectContaining({ id: idOf.get("PRLV EDF"), status: "inactive" }),
		]);
	});

	it("breaks a tie on the next date by id", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"], "A");
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"], "B");
		await detectRecurring(deps());
		const ids = (await stored()).map((row) => row.id).toSorted();

		await expect(listRecurring(deps()).then((rows) => rows.map((row) => row.id))).resolves.toEqual(
			ids,
		);
	});
});

describe("setRecurringStatus", () => {
	it("confirms a detected or inactive pattern", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);

		await expect(setRecurringStatus(deps(), row.id, "confirmed")).resolves.toMatchObject({
			id: row.id,
			status: "confirmed",
		});

		await setStatus(row.id, "inactive");

		await expect(setRecurringStatus(deps(), row.id, "confirmed")).resolves.toMatchObject({
			status: "confirmed",
		});
		await expect(stored()).resolves.toMatchObject([{ status: "confirmed" }]);
	});

	it("moves a past next date from today on when it confirms, not when it dismisses", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		await temp.db
			.update(recurringTransactions)
			.set({ nextExpectedDate: "2026-09-10" })
			.where(eq(recurringTransactions.id, row.id));

		await expect(setRecurringStatus(deps(), row.id, "dismissed")).resolves.toMatchObject({
			nextExpectedDate: "2026-09-10",
		});
		await setStatus(row.id, "detected");
		await expect(setRecurringStatus(deps(), row.id, "confirmed")).resolves.toMatchObject({
			status: "confirmed",
			nextExpectedDate: "2026-10-10",
		});
		await expect(stored()).resolves.toMatchObject([{ nextExpectedDate: "2026-10-10" }]);
	});

	it("deactivates a confirmed pattern only", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);

		await expect(setRecurringStatus(deps(), row.id, "inactive")).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "status", code: "invalid_value" }],
		});

		await setStatus(row.id, "confirmed");

		await expect(setRecurringStatus(deps(), row.id, "inactive")).resolves.toMatchObject({
			status: "inactive",
		});
	});

	it("dismisses any pattern not dismissed yet", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		const statuses: RecurringStatus[] = ["detected", "confirmed", "inactive"];

		await statuses.reduce<Promise<unknown>>(
			(pending, status) =>
				pending
					.then(() => setStatus(row.id, status))
					.then(() =>
						expect(setRecurringStatus(deps(), row.id, "dismissed")).resolves.toMatchObject({
							status: "dismissed",
						}),
					),
			Promise.resolve(),
		);

		await expect(setRecurringStatus(deps(), row.id, "dismissed")).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
		});
	});

	it("refuses moving back to detected, or out of dismissed", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);

		await expect(setRecurringStatus(deps(), row.id, "detected")).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
		});

		await setStatus(row.id, "dismissed");

		await expect(setRecurringStatus(deps(), row.id, "confirmed")).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
		});
		await expect(stored()).resolves.toMatchObject([{ status: "dismissed" }]);
	});

	it("answers NOT_FOUND for an unknown id", async () => {
		await expect(setRecurringStatus(deps(), "nope", "confirmed")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("addRecurringFromEntry", () => {
	it("stores a confirmed manual pattern due next on the transaction's day", async () => {
		const accountId = await account("Joint");
		const [entryId = ""] = await addRows(accountId, ["2026-09-05"], "Prlv  EDF");

		const added = await addRecurringFromEntry(deps(), entryId);

		expect(added.id).toMatch(/^[0-9a-f-]{36}$/u);
		expect(added).toEqual({
			id: added.id,
			accountId,
			accountName: "Joint",
			merchantId: null,
			merchantName: null,
			label: "Prlv  EDF",
			amount: -6500,
			currency: "EUR",
			expectedDayOfMonth: 5,
			lastOccurrenceDate: "2026-09-05",
			nextExpectedDate: "2026-10-05",
			occurrenceCount: 1,
			status: "confirmed",
			manual: true,
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

	it("confirms the pattern already stored under the same key", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		const [entryId = ""] = await addRows(accountId, ["2026-09-10"]);

		await expect(addRecurringFromEntry(deps(), entryId)).resolves.toMatchObject({
			id: row.id,
			status: "confirmed",
			manual: false,
		});
		await expect(stored()).resolves.toEqual([{ ...row, status: "confirmed" }]);
	});

	it("moves a past next date from today on when it confirms a stored pattern", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		await temp.db
			.update(recurringTransactions)
			.set({ nextExpectedDate: "2026-09-10" })
			.where(eq(recurringTransactions.id, row.id));
		const [entryId = ""] = await addRows(accountId, ["2026-09-10"]);

		await expect(addRecurringFromEntry(deps(), entryId)).resolves.toMatchObject({
			id: row.id,
			status: "confirmed",
			nextExpectedDate: "2026-10-10",
		});
	});

	it("confirms a dismissed pattern of the same key", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		await setStatus(row.id, "dismissed");
		const [entryId = ""] = await addRows(accountId, ["2026-09-10"]);

		await expect(addRecurringFromEntry(deps(), entryId)).resolves.toMatchObject({
			id: row.id,
			status: "confirmed",
		});
	});

	it("confirms the series of the same key at another amount rather than add a twin", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"], "NETFLIX", -1349);
		await detectRecurring(deps());
		const [row] = await stored();
		const [entryId = ""] = await addRows(accountId, ["2026-09-12"], "NETFLIX", -1599);

		await expect(addRecurringFromEntry(deps(), entryId)).resolves.toMatchObject({
			id: row!.id,
			amount: -1349,
			status: "confirmed",
		});
		await expect(stored()).resolves.toEqual([{ ...row, status: "confirmed" }]);
	});

	it("confirms the one of the same amount first, else the latest", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-08"], "NETFLIX", -1349);
		await addRows(accountId, ["2026-07-15", "2026-08-15", "2026-09-15"], "NETFLIX", -1399);
		await detectRecurring(deps());
		const idOf = new Map((await stored()).map((row) => [row.amount, row.id]));
		const [same = ""] = await addRows(accountId, ["2026-09-10"], "NETFLIX", -1349);
		const [other = ""] = await addRows(accountId, ["2026-09-12"], "NETFLIX", -1599);

		await expect(addRecurringFromEntry(deps(), same)).resolves.toMatchObject({
			id: idOf.get(-1349),
		});
		await expect(addRecurringFromEntry(deps(), other)).resolves.toMatchObject({
			id: idOf.get(-1399),
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
			status: "confirmed",
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

describe("detectRecurring keeps a renamed series single", () => {
	it("follows its rows to the merchant a bulk edit set", async () => {
		const accountId = await account();
		const ids = await addRows(
			accountId,
			["2026-07-10", "2026-08-10", "2026-09-10"],
			"PRLV NETFLIX",
		);
		await detectRecurring(deps());
		const [row] = await stored();
		await temp.db
			.insert(merchants)
			.values({ id: "netflix", name: "Netflix", createdAt: 0, updatedAt: 0 });
		await bulkUpdateTransactions(deps(), { ids }, { merchantId: "netflix" }, { origin: "user" });

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 1 });
		await expect(stored()).resolves.toEqual([
			{ ...row, merchantId: "netflix", labelKey: null, label: "PRLV NETFLIX" },
		]);
	});

	it("follows its rows to the label a rule gave them, confirmed", async () => {
		const accountId = await account();
		// Imported: a rule never renames a row typed by hand, whose label is locked.
		await importRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		const [row] = await stored();
		await setStatus(row!.id, "confirmed");
		await createRule(deps(), {
			name: "EDF",
			conditions: [{ conditionType: "transaction_name", operator: "like", value: "edf" }],
			actions: [{ actionType: "set_transaction_name", value: "EDF ENERGIE" }],
		});
		await applyRules(deps());

		await detectRecurring(deps());

		await expect(stored()).resolves.toEqual([
			{ ...row, status: "confirmed", labelKey: "edf energie", label: "EDF ENERGIE" },
		]);
	});

	it("keeps a dismissed series dismissed, with no detected twin", async () => {
		const accountId = await account();
		const ids = await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		const row = await detectedBill(accountId, ids);
		await setStatus(row.id, "dismissed");
		await rename(ids, "EDF ENERGIE");

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual([
			{ ...row, status: "dismissed", labelKey: "edf energie", label: "EDF ENERGIE" },
		]);
	});

	it("drops a detected twin already on the new key and moves the confirmed series", async () => {
		const accountId = await account();
		const ids = await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		const row = await detectedBill(accountId, ids);
		await setStatus(row.id, "confirmed");
		await rename(ids, "EDF ENERGIE");
		await temp.db
			.insert(recurringTransactions)
			.values({ ...row, id: "twin", labelKey: "edf energie", label: "EDF ENERGIE" });

		await detectRecurring(deps());

		await expect(stored()).resolves.toEqual([
			{ ...row, status: "confirmed", labelKey: "edf energie", label: "EDF ENERGIE" },
		]);
	});

	it("stays put when only its latest row was renamed, and no twin comes back", async () => {
		const accountId = await account();
		const ids = await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		const row = await detectedBill(accountId, ids);
		await rename([ids[2]!], "EDF ENERGIE");

		await detectRecurring(deps());
		await addRows(accountId, ["2026-09-12"]);
		await detectRecurring(deps());

		await expect(stored()).resolves.toMatchObject([
			{ id: row.id, labelKey: "prlv edf", lastOccurrenceDate: "2026-09-12", occurrenceCount: 3 },
		]);
	});

	it("stays put when its last day's rows were renamed to two keys", async () => {
		const accountId = await account();
		const ids = await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10", "2026-09-10"]);
		const row = await detectedBill(accountId, ids);
		await setStatus(row.id, "confirmed");
		await rename([ids[2]!], "GAZ");
		await rename([ids[3]!], "EAU");

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual([
			{
				...row,
				status: "confirmed",
				labelKey: "prlv edf",
				lastOccurrenceDate: "2026-08-10",
				nextExpectedDate: "2026-10-10",
				occurrenceCount: 2,
			},
		]);
	});
});

describe("detectRecurring keeps every series current", () => {
	it("moves a late confirmed series' next date from today on", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-05-15", "2026-06-15", "2026-07-15"]);
		vi.setSystemTime(new Date("2026-08-01T10:00:00Z"));
		await detectRecurring(deps());
		const [row] = await stored();
		await setStatus(row!.id, "confirmed");

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
		await detectRecurring(deps());

		await expect(stored()).resolves.toMatchObject([
			{
				id: row!.id,
				status: "confirmed",
				lastOccurrenceDate: "2026-07-15",
				nextExpectedDate: "2026-10-15",
			},
		]);
	});

	it("moves a past next date from today on when a pattern updates a confirmed series", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-06-21", "2026-07-18", "2026-08-18"]);
		vi.setSystemTime(new Date("2026-08-20T10:00:00Z"));
		await detectRecurring(deps());
		const [row] = await stored();
		await setStatus(row!.id, "confirmed");

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));

		// The pattern alone would say 2026-09-18.
		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 1 });
		await expect(stored()).resolves.toMatchObject([
			{ id: row!.id, expectedDayOfMonth: 18, nextExpectedDate: "2026-10-18" },
		]);
	});

	it("catches a manual series up with the rows that came since", async () => {
		const accountId = await account();
		const [entryId = ""] = await addRows(accountId, ["2026-06-03"]);
		const added = await addRecurringFromEntry(deps(), entryId);
		await addRows(accountId, ["2026-07-03", "2026-08-03", "2026-09-03"]);

		await detectRecurring(deps());

		await expect(stored()).resolves.toMatchObject([
			{
				id: added.id,
				status: "confirmed",
				manual: true,
				occurrenceCount: 3,
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

		await detectRecurring(deps());

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
		const importId = await importRows(accountId, ["2026-07-14", "2026-08-14"]);
		const [row] = await stored();
		expect(row).toMatchObject({ occurrenceCount: 5, lastOccurrenceDate: "2026-09-10" });

		await revertImport(importDeps(), importId);

		await expect(stored()).resolves.toEqual([
			{ ...row, expectedDayOfMonth: 10, occurrenceCount: 3, lastOccurrenceDate: "2026-09-10" },
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

	it("deletes a detected series whose every row a revert removed", async () => {
		const accountId = await account();
		const importId = await importRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		await expect(stored()).resolves.toHaveLength(1);

		await revertImport(importDeps(), importId);

		await expect(stored()).resolves.toEqual([]);
	});

	it("keeps a confirmed series whose every row a revert removed, count 0", async () => {
		const accountId = await account();
		const importId = await importRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		const [row] = await stored();
		await setStatus(row!.id, "confirmed");

		await revertImport(importDeps(), importId);

		const [after] = await stored();
		expect(after).toEqual({ ...row, status: "confirmed", occurrenceCount: 0 });
		expect(after!.nextExpectedDate >= "2026-09-21").toBe(true);
	});

	it("moves a past next date from today on when a revert leaves a confirmed series empty", async () => {
		const accountId = await account();
		vi.setSystemTime(new Date("2026-08-20T10:00:00Z"));
		const importId = await importRows(accountId, ["2026-06-15", "2026-07-15", "2026-08-15"]);
		const [row] = await stored();
		await setStatus(row!.id, "confirmed");
		expect(row).toMatchObject({ nextExpectedDate: "2026-09-15" });

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
		await revertImport(importDeps(), importId);

		await expect(stored()).resolves.toMatchObject([
			{ id: row!.id, status: "confirmed", occurrenceCount: 0, nextExpectedDate: "2026-10-15" },
		]);
	});

	it("deletes a detected series left with no row and marks nothing inactive for it", async () => {
		const accountId = await account();
		const ids = await addRows(accountId, ["2026-05-15", "2026-06-15", "2026-07-15"]);
		vi.setSystemTime(new Date("2026-08-01T10:00:00Z"));
		await detectRecurring(deps());
		await rename(ids, "AUTRE CHOSE");
		await temp.db.update(recurringTransactions).set({ lastOccurrenceDate: "2026-07-20" });

		vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
		await detectRecurring(deps());

		await expect(stored()).resolves.toEqual([]);
	});
});

describe("recurringOfEntry", () => {
	it("answers the series of the transaction's account and key, the same amount first", async () => {
		const accountId = await account();
		const [transaction = ""] = await addRows(accountId, ["2026-06-10"], "NETFLIX", -1599);
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-08"], "NETFLIX", -1349);
		await addRows(accountId, ["2026-07-15", "2026-08-15", "2026-09-15"], "NETFLIX", -1399);
		await detectRecurring(deps());
		const idOf = new Map((await stored()).map((row) => [row.amount, row.id]));
		const [same = ""] = await addRows(accountId, ["2026-09-10"], "NETFLIX", -1349);

		await expect(recurringOfEntry(deps(), same)).resolves.toMatchObject({
			id: idOf.get(-1349),
			label: "NETFLIX",
			accountName: "Compte",
		});
		// No series at -15,99: the latest of the key.
		await expect(recurringOfEntry(deps(), transaction)).resolves.toMatchObject({
			id: idOf.get(-1399),
		});
	});

	it("skips a dismissed series, and answers null without one", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		const [entryId = ""] = await addRows(accountId, ["2026-09-11"]);
		const [other = ""] = await addRows(accountId, ["2026-09-11"], "AUTRE");

		await expect(recurringOfEntry(deps(), other)).resolves.toBeNull();

		await setStatus(row.id, "dismissed");

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

	it("leaves out a row whose only series is dismissed", async () => {
		const accountId = await account();
		const row = await detectedBill(accountId);
		const [entryId = ""] = await addRows(accountId, ["2026-09-21"]);
		await setStatus(row.id, "dismissed");

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
