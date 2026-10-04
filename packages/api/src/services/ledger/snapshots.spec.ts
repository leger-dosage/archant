import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";

import * as forward from "../../domain/balances/forward.ts";
import {
	add,
	deps,
	firstPage,
	history,
	openPinned,
	setToday,
	snapshot,
	temp,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { balanceOn } from "./balances.ts";
import {
	deleteSnapshot,
	findSnapshot,
	listSnapshots,
	recordSnapshot,
	updateSnapshot,
} from "./snapshots.ts";

useLedgerDatabase();

describe("recordSnapshot", () => {
	it("fixes the day's balance and the next days continue from it", async () => {
		const account = await openPinned();

		await snapshot(account.id, "2026-03-05", 200000);
		await add(account.id, { date: "2026-03-06", amount: toMinorUnits(-5000) });

		const days = await history(account.id);
		expect(days.get("2026-03-04")).toBe(138000);
		expect(days.get("2026-03-05")).toBe(200000);
		expect(days.get("2026-03-06")).toBe(195000);
		expect(days.get("2026-09-21")).toBe(195000);
	});

	it("stores a valuation in the account's currency", async () => {
		const account = await openPinned();

		const id = await snapshot(account.id, "2026-03-05", 200000);

		await expect(
			temp.db.select().from(entries).where(eq(entries.id, id)).get(),
		).resolves.toMatchObject({
			accountId: account.id,
			kind: "valuation",
			valuationKind: "reconciliation",
			date: "2026-03-05",
			amount: 200000,
			currency: "EUR",
		});
	});

	it("keeps the day at the snapshot when a transaction lands on it", async () => {
		const account = await openPinned();
		await snapshot(account.id, "2026-03-05", 200000);

		await add(account.id, { date: "2026-03-05", amount: toMinorUnits(-3000) });

		const days = await history(account.id);
		expect(days.get("2026-03-05")).toBe(200000);
		expect(days.get("2026-09-21")).toBe(200000);
	});

	it("updates the snapshot already on that date and keeps its id", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);

		const again = await snapshot(account.id, "2026-03-05", 199000);

		expect(again).toBe(id);
		const list = await listSnapshots(deps(), account.id, firstPage);
		expect(list.total).toBe(1);
		expect(list.items[0]).toMatchObject({ id, balance: 199000 });
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: 199000,
		});
	});

	it("stores an overdraft and a card's amount owed as typed", async () => {
		const account = await openPinned();
		const card = await openPinned({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(49030),
		});

		await snapshot(account.id, "2026-03-05", -8000);
		await snapshot(card.id, "2026-03-05", 52000);

		await expect(balanceOn(deps(), account.id, "2026-03-05")).resolves.toMatchObject({
			amount: -8000,
		});
		await expect(balanceOn(deps(), card.id, "2026-03-05")).resolves.toMatchObject({
			amount: 52000,
		});
	});

	it("refuses the opening date and tomorrow, and writes nothing", async () => {
		const account = await openPinned();
		const before = await history(account.id);

		await expect(
			recordSnapshot(
				deps(),
				account.id,
				{ date: "2026-01-10", balance: toMinorUnits(1) },
				{ origin: "user" },
			),
		).resolves.toEqual({ status: "rejected", reason: "BEFORE_OPENING_DATE" });
		await expect(
			recordSnapshot(
				deps(),
				account.id,
				{ date: "2026-09-22", balance: toMinorUnits(1) },
				{ origin: "user" },
			),
		).resolves.toEqual({ status: "rejected", reason: "DATE_IN_FUTURE" });

		await expect(history(account.id)).resolves.toEqual(before);
		await expect(listSnapshots(deps(), account.id, firstPage)).resolves.toEqual({
			items: [],
			total: 0,
		});
	});

	it("refuses an account that does not exist", async () => {
		setToday("2026-09-21T10:00:00Z");

		await expect(
			recordSnapshot(
				deps(),
				"nope",
				{ date: "2026-03-05", balance: toMinorUnits(1) },
				{ origin: "user" },
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("leaves no row behind when the recompute fails", async () => {
		const account = await openPinned();
		const before = await history(account.id);
		const row = { date: "2026-09-21", balance: toMinorUnits(1), cash: toMinorUnits(1) };
		vi.spyOn(forward, "forwardBalances").mockReturnValue([row, row]);

		await expect(snapshot(account.id, "2026-03-05", 200000)).rejects.toThrow();

		await expect(listSnapshots(deps(), account.id, firstPage)).resolves.toMatchObject({ total: 0 });
		await expect(history(account.id)).resolves.toEqual(before);
	});
});

describe("updateSnapshot", () => {
	it("moves a snapshot earlier and recomputes from the new date", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);

		await expect(
			updateSnapshot(deps(), id, { date: "2026-02-20" }, { origin: "user" }),
		).resolves.toEqual({ status: "updated" });

		const days = await history(account.id);
		expect(days.get("2026-02-19")).toBe(150000);
		expect(days.get("2026-02-20")).toBe(200000);
		expect(days.get("2026-03-02")).toBe(188000);
		expect(days.get("2026-03-05")).toBe(188000);
	});

	it("moves a snapshot later and restores the days it left", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-02-20", 200000);

		await updateSnapshot(deps(), id, { date: "2026-03-05" }, { origin: "user" });

		const days = await history(account.id);
		expect(days.get("2026-02-20")).toBe(150000);
		expect(days.get("2026-03-04")).toBe(138000);
		expect(days.get("2026-03-05")).toBe(200000);
	});

	it("changes the balance alone", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);

		await updateSnapshot(deps(), id, { balance: toMinorUnits(210000) }, { origin: "user" });

		await expect(findSnapshot(deps(), id)).resolves.toMatchObject({
			date: "2026-03-05",
			balance: 210000,
		});
		await expect(balanceOn(deps(), account.id, "2026-09-21")).resolves.toMatchObject({
			amount: 210000,
		});
	});

	it("refuses a date another snapshot holds and changes nothing", async () => {
		const account = await openPinned();
		await snapshot(account.id, "2026-02-20", 190000);
		const id = await snapshot(account.id, "2026-03-05", 200000);
		const before = await history(account.id);

		await expect(
			updateSnapshot(deps(), id, { date: "2026-02-20" }, { origin: "user" }),
		).resolves.toEqual({ status: "rejected", reason: "SNAPSHOT_EXISTS" });

		await expect(history(account.id)).resolves.toEqual(before);
		await expect(listSnapshots(deps(), account.id, firstPage)).resolves.toMatchObject({ total: 2 });
	});

	it("keeps its own date without calling it taken", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);

		await expect(
			updateSnapshot(
				deps(),
				id,
				{ date: "2026-03-05", balance: toMinorUnits(1) },
				{ origin: "user" },
			),
		).resolves.toEqual({ status: "updated" });
	});

	it("refuses the opening date and tomorrow", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);

		await expect(
			updateSnapshot(deps(), id, { date: "2026-01-10" }, { origin: "user" }),
		).resolves.toEqual({ status: "rejected", reason: "BEFORE_OPENING_DATE" });
		await expect(
			updateSnapshot(deps(), id, { date: "2026-09-22" }, { origin: "user" }),
		).resolves.toEqual({ status: "rejected", reason: "DATE_IN_FUTURE" });
		await expect(findSnapshot(deps(), id)).resolves.toMatchObject({ date: "2026-03-05" });
	});

	it("answers NOT_FOUND for an unknown id and for a transaction's id", async () => {
		const account = await openPinned();
		const transaction = await add(account.id);

		await expect(
			updateSnapshot(deps(), "nope", { date: "2026-03-05" }, { origin: "user" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			updateSnapshot(deps(), transaction, { date: "2026-03-05" }, { origin: "user" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("deleteSnapshot", () => {
	it("lets the balances follow the transactions again from its date", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);

		await deleteSnapshot(deps(), id, { origin: "user" });

		await expect(findSnapshot(deps(), id)).resolves.toBeNull();
		const days = await history(account.id);
		expect(days.get("2026-03-05")).toBe(138000);
		expect(days.get("2026-09-21")).toBe(138000);
	});

	it("answers NOT_FOUND for an unknown snapshot", async () => {
		await expect(deleteSnapshot(deps(), "nope", { origin: "user" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("listSnapshots", () => {
	it("gives each snapshot the balance its day would have had, and the gap", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);

		await expect(listSnapshots(deps(), account.id, firstPage)).resolves.toEqual({
			items: [
				{
					id,
					accountId: account.id,
					date: "2026-03-05",
					balance: 200000,
					computed: 138000,
					gap: 62000,
					currency: "EUR",
				},
			],
			total: 1,
		});
	});

	it("counts a transaction of the snapshot day in the computed balance", async () => {
		const account = await openPinned();
		await snapshot(account.id, "2026-03-05", 200000);

		await add(account.id, { date: "2026-03-05", amount: toMinorUnits(-3000) });

		const { items } = await listSnapshots(deps(), account.id, firstPage);
		expect(items[0]).toMatchObject({ computed: 135000, gap: 65000 });
	});

	it("subtracts a card's purchases from the amount owed", async () => {
		const card = await openPinned({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(49030),
		});
		await snapshot(card.id, "2026-03-05", 52000);

		const { items } = await listSnapshots(deps(), card.id, firstPage);

		// 490,30 owed, plus the 120,00 purchase of 03-02.
		expect(items[0]).toMatchObject({ balance: 52000, computed: 61030, gap: -9030 });
	});

	it("orders by date, most recent first, and pages", async () => {
		const account = await openPinned();
		const older = await snapshot(account.id, "2026-02-20", 190000);
		const newer = await snapshot(account.id, "2026-03-05", 200000);

		const all = await listSnapshots(deps(), account.id, firstPage);
		const secondPage = await listSnapshots(deps(), account.id, { page: 2, pageSize: 1 });

		expect(all.items.map((item) => item.id)).toEqual([newer, older]);
		// The later snapshot is computed from the earlier one.
		expect(all.items[0]).toMatchObject({ computed: 178000, gap: 22000 });
		expect(secondPage).toEqual({ items: [expect.objectContaining({ id: older })], total: 2 });
	});

	it("fails loudly when the day before a snapshot has no balance row", async () => {
		const account = await openPinned();
		await snapshot(account.id, "2026-03-05", 200000);
		await temp.db
			.delete(balances)
			.where(and(eq(balances.accountId, account.id), eq(balances.date, "2026-03-04")));

		await expect(listSnapshots(deps(), account.id, firstPage)).rejects.toMatchObject({
			code: "INTERNAL_ERROR",
		});
	});
});

describe("findSnapshot", () => {
	it("returns one snapshot with its gap, or null for an id that names none", async () => {
		const account = await openPinned();
		const id = await snapshot(account.id, "2026-03-05", 200000);
		const transaction = await add(account.id);

		await expect(findSnapshot(deps(), id)).resolves.toMatchObject({ id, gap: 62000 });
		await expect(findSnapshot(deps(), transaction)).resolves.toBeNull();
		await expect(findSnapshot(deps(), "nope")).resolves.toBeNull();
	});
});
