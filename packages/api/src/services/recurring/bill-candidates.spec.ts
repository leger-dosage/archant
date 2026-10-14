import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { accounts } from "@archant/data/schema/accounts";
import { merchants } from "@archant/data/schema/merchants";

import { account, addRows, bill } from "../../testing/bills.ts";
import { deps, temp, useRecurringDatabase } from "../../testing/recurring.ts";
import { updateTransaction } from "../ledger/edits.ts";
import { oneByOne } from "../ledger/shared.ts";
import { billCandidates } from "./bill-candidates.ts";
import { declareBill } from "./bills.ts";

useRecurringDatabase("2026-09-21T10:00:00Z");

describe("billCandidates", () => {
	it("offers outflows seen twice that no series follows, latest first, with their latest transaction", async () => {
		const accountId = await account();
		const water = await addRows(accountId, ["2026-08-02", "2026-09-02"], "EAU", -3000);
		const box = await addRows(accountId, ["2026-08-12", "2026-09-12"], "BOX", -2999);
		await addRows(accountId, ["2026-08-04", "2026-09-04"], "PENNY", -99);
		await addRows(accountId, ["2026-08-05", "2026-09-05"], "REMBOURSEMENT", 3000);
		await addRows(accountId, ["2026-09-06"], "ONCE", -5000);

		await expect(billCandidates(deps(), "bill")).resolves.toEqual([
			{
				entryId: box[1],
				name: "BOX",
				amount: 2999,
				currency: "EUR",
				accountId,
				occurrenceCount: 2,
				lastOccurrenceDate: "2026-09-12",
				entryAmount: -2999,
			},
			expect.objectContaining({ entryId: water[1], name: "EAU", amount: 3000 }),
		]);
	});

	it("leaves out a pattern a series claims, and names one by its merchant", async () => {
		const accountId = await account();
		await temp.db.insert(merchants).values({ id: "sfr", name: "SFR", createdAt: 0, updatedAt: 0 });
		const box = await addRows(accountId, ["2026-08-12", "2026-09-12"], "PRLV SFR", -2999);
		await oneByOne(box, (id) =>
			updateTransaction(deps(), id, { merchantId: "sfr" }, { origin: "user" }),
		);
		const water = await addRows(accountId, ["2026-08-02", "2026-09-02"], "EAU", -3000);

		await expect(billCandidates(deps(), "bill")).resolves.toEqual([
			expect.objectContaining({ name: "SFR" }),
			expect.objectContaining({ name: "EAU" }),
		]);

		await declareBill(
			deps(),
			bill(accountId, { name: "Eau", amount: "30,50", entryId: water[1]! }),
		);

		await expect(billCandidates(deps(), "bill")).resolves.toEqual([
			expect.objectContaining({ name: "SFR" }),
		]);
	});

	it("leaves out an inactive account's patterns, which the dialog does not offer", async () => {
		const accountId = await account();
		const closed = await account("EUR", "Fermé");
		await addRows(accountId, ["2026-08-02", "2026-09-02"], "EAU", -3000);
		await addRows(closed, ["2026-08-12", "2026-09-12"], "BOX", -2999);
		await addRows(closed, ["2026-08-28", "2026-09-18"], "SALAIRE", 250_000);
		await temp.db.update(accounts).set({ active: false }).where(eq(accounts.id, closed));

		await expect(billCandidates(deps(), "bill")).resolves.toEqual([
			expect.objectContaining({ name: "EAU", accountId }),
		]);
		await expect(billCandidates(deps(), "income")).resolves.toEqual([]);
	});

	it("offers eight at most", async () => {
		const accountId = await account();

		await oneByOne([...Array.from({ length: 10 }).keys()], (index) =>
			addRows(accountId, ["2026-08-10", "2026-09-10"], `ABONNEMENT ${index}`, -1000 - index * 500),
		);

		await expect(billCandidates(deps(), "bill")).resolves.toHaveLength(8);
	});

	it("offers deposits of the last 90 days seen twice, largest total first, that no income series follows", async () => {
		const accountId = await account();
		const pay = await addRows(accountId, ["2026-07-28", "2026-08-28"], "SALAIRE", 250_000);
		await addRows(accountId, ["2026-08-10", "2026-08-24", "2026-09-07"], "FREELANCE", 40_000);
		await addRows(accountId, ["2026-08-01", "2026-09-01"], "INTERETS", 50);
		await addRows(accountId, ["2026-05-01", "2026-09-01"], "VIEUX", 10_000);
		await addRows(accountId, ["2026-09-01", "2026-09-02"], "PRLV", -10_000);

		await expect(billCandidates(deps(), "income")).resolves.toEqual([
			{
				entryId: pay[1],
				name: "SALAIRE",
				amount: 250_000,
				currency: "EUR",
				accountId,
				occurrenceCount: 2,
				lastOccurrenceDate: "2026-08-28",
				entryAmount: 250_000,
			},
			expect.objectContaining({ name: "FREELANCE", amount: 40_000, occurrenceCount: 3 }),
		]);

		await declareBill(
			deps(),
			bill(accountId, { kind: "income", name: "Salaire", amount: "1,00", entryId: pay[0]! }),
		);

		await expect(billCandidates(deps(), "income")).resolves.toEqual([
			expect.objectContaining({ name: "FREELANCE" }),
		]);
	});

	it("leaves out deposits an income paid into any account follows, as Sure's `claimed_income_source?`", async () => {
		const accountId = await account();
		const pay = await addRows(accountId, ["2026-07-28", "2026-08-28"], "SALAIRE", 250_000);
		await addRows(accountId, ["2026-08-10", "2026-08-24", "2026-09-07"], "FREELANCE", 40_000);

		await declareBill(
			deps(),
			bill(null, { kind: "income", name: "Salaire", amount: "1,00", entryId: pay[0]! }),
		);

		await expect(billCandidates(deps(), "income")).resolves.toEqual([
			expect.objectContaining({ name: "FREELANCE" }),
		]);
	});
});
