import type { TempDatabase } from "../testing/temp-database.ts";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { merchants } from "@archant/data/schema/merchants";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { createTempDatabase } from "../testing/temp-database.ts";
import { createAccount, ingest, updateTransaction } from "./ledger.ts";
import { detectRecurring } from "./recurring.ts";

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

async function account() {
	const created = await createAccount(
		deps(),
		{
			name: "Compte",
			type: "depository",
			subtype: "checking",
			currency: "EUR",
			openingBalance: toMinorUnits(0),
			openingDate: "2026-01-01",
		},
		{ origin: "user" },
	);

	return created.id;
}

async function addRows(accountId: string, dates: readonly string[], label = "PRLV EDF") {
	const result = await ingest(
		deps(),
		accountId,
		{
			transactions: dates.map((date) => ({
				externalId: null,
				date,
				amount: toMinorUnits(-6500),
				currency: "EUR",
				label,
				reference: null,
				notes: null,
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

	it("keeps a stored pattern it no longer detects", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-10", "2026-08-10", "2026-09-10"]);
		await detectRecurring(deps());
		const before = await stored();

		vi.setSystemTime(new Date("2026-10-26T10:00:00Z"));

		await expect(detectRecurring(deps())).resolves.toEqual({ detected: 0 });
		await expect(stored()).resolves.toEqual(before);
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
