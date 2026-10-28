import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { merchants } from "@archant/data/schema/merchants";

import { account, addRows, bill } from "../../testing/bills.ts";
import { deps, occurrencesOf, temp, useRecurringDatabase } from "../../testing/recurring.ts";
import { updateTransaction } from "../ledger/edits.ts";
import { oneByOne } from "../ledger/shared.ts";
import { splitTransaction } from "../ledger/splits.ts";
import { billCandidates, billPicker } from "./bill-candidates.ts";
import { declareBill } from "./bills.ts";
import { addPayment } from "./payments.ts";

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
		await addRows(accountId, ["2026-08-02", "2026-09-02"], "EAU", -3000);

		await expect(billCandidates(deps(), "bill")).resolves.toEqual([
			expect.objectContaining({ name: "SFR" }),
			expect.objectContaining({ name: "EAU" }),
		]);

		await declareBill(deps(), bill(accountId, { name: "Eau", amount: "30,50" }));

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

		await declareBill(deps(), bill(accountId, { kind: "income", name: "Salaire", amount: "1,00" }));

		await expect(billCandidates(deps(), "income")).resolves.toEqual([
			expect.objectContaining({ name: "FREELANCE" }),
		]);
	});

	it("leaves out deposits an income paid into any account follows, as Sure's `claimed_income_source?`", async () => {
		const accountId = await account();
		await addRows(accountId, ["2026-07-28", "2026-08-28"], "SALAIRE", 250_000);
		await addRows(accountId, ["2026-08-10", "2026-08-24", "2026-09-07"], "FREELANCE", 40_000);

		await declareBill(deps(), bill(null, { kind: "income", name: "Salaire", amount: "1,00" }));

		await expect(billCandidates(deps(), "income")).resolves.toEqual([
			expect.objectContaining({ name: "FREELANCE" }),
		]);
	});
});

const asUser = { origin: "user" } as const;

const ids = (entries: readonly { entryId: string }[]) => entries.map((entry) => entry.entryId);

describe("billPicker", () => {
	it("lists the twenty latest of the dialog's sign, no transfer side, excluded row or split parent, as Sure's `picker_entries`", async () => {
		const accountId = await account();
		const savings = await account("EUR", "Livret");
		const card = await addRows(
			accountId,
			Array.from({ length: 22 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`),
			"CB CARREFOUR",
			-1000,
		);
		const [refund = ""] = await addRows(accountId, ["2026-09-10"], "REMBOURSEMENT", 3000);
		const [outflow = ""] = await addRows(accountId, ["2026-09-11"], "VIREMENT LIVRET", -50_000);
		const [inflow = ""] = await addRows(savings, ["2026-09-11"], "VIREMENT LIVRET", 50_000);
		const [excluded = ""] = await addRows(accountId, ["2026-09-12"], "CB EXCLUE", -2000);
		await updateTransaction(deps(), excluded, { excluded: true }, asUser);
		const [parent = ""] = await addRows(accountId, ["2026-09-13"], "CB PARTAGEE", -6000);
		const split = await splitTransaction(
			deps(),
			parent,
			[
				{ label: "Alimentation", amount: toMinorUnits(-4000), categoryId: null },
				{ label: "Maison", amount: toMinorUnits(-2000), categoryId: null },
			],
			asUser,
		);

		const bills = await billPicker(deps(), "bill");

		expect(bills).toHaveLength(20);
		expect(ids(bills).slice(0, 2).toSorted()).toEqual(split.childIds.toSorted());
		expect(ids(bills).slice(2)).toEqual(card.toReversed().slice(0, 18));
		expect(ids(bills)).not.toContain(parent);
		expect(bills[2]).toEqual({
			entryId: card[21],
			label: "CB CARREFOUR",
			merchantName: null,
			date: "2026-08-22",
			accountId,
			accountName: "Compte",
			amount: -1000,
			currency: "EUR",
			claimedBy: null,
		});
		await expect(billPicker(deps(), "income").then(ids)).resolves.toEqual([refund]);
		expect([outflow, inflow, excluded].filter((id) => ids(bills).includes(id))).toEqual([]);
	});

	it("searches the label, the notes and the merchant's name, a `%` read as itself", async () => {
		const accountId = await account();
		await temp.db
			.insert(merchants)
			.values({ id: "edf", name: "EDF Énergie", createdAt: 0, updatedAt: 0 });
		const [label = ""] = await addRows(accountId, ["2026-09-01"], "PRLV EDF", -6500);
		const [noted = ""] = await addRows(accountId, ["2026-09-02"], "CB 1234", -1200);
		await updateTransaction(deps(), noted, { notes: "Facture edf de juin" }, asUser);
		const [merchant = ""] = await addRows(accountId, ["2026-09-03"], "PRLV 778", -4000);
		await updateTransaction(deps(), merchant, { merchantId: "edf" }, asUser);
		await addRows(accountId, ["2026-09-04"], "CB AUTRE", -900);
		const [percent = ""] = await addRows(accountId, ["2026-09-05"], "REMISE 50%", -500);
		await addRows(accountId, ["2026-09-06"], "REMISE 500", -500);

		await expect(billPicker(deps(), "bill", "  edf ").then(ids)).resolves.toEqual([
			merchant,
			noted,
			label,
		]);
		await expect(billPicker(deps(), "bill", "edf")).resolves.toEqual(
			expect.arrayContaining([expect.objectContaining({ merchantName: "EDF Énergie" })]),
		);
		await expect(billPicker(deps(), "bill", "50%").then(ids)).resolves.toEqual([percent]);
		await expect(billPicker(deps(), "bill", "zzz")).resolves.toEqual([]);
	});

	it("names the bill a row already pays, as Sure's `claimed_series_names`", async () => {
		const accountId = await account();
		const [paid = "", free = ""] = await addRows(
			accountId,
			["2026-09-10", "2026-09-11"],
			"EAU DU GRAND LYON",
			-8420,
		);
		const water = await declareBill(deps(), bill(accountId, { firstDueOn: "2026-09-10" }));
		const [open] = await occurrencesOf(water.id);
		await addPayment(deps(), open!.id, { entryId: paid });

		await expect(billPicker(deps(), "bill")).resolves.toEqual([
			expect.objectContaining({ entryId: free, claimedBy: null }),
			expect.objectContaining({ entryId: paid, claimedBy: "Eau du Grand Lyon" }),
		]);
	});
});
