import type { RowPlan } from "../../domain/rules/matching.ts";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { taggings } from "@archant/data/schema/taggings";
import { transactions } from "@archant/data/schema/transactions";

import { MAX_TAGS_PER_TRANSACTION } from "../../schemas/transactions.ts";
import {
	add,
	categoryOf,
	categoryOriginOf,
	deps,
	excludedOf,
	expectedOf,
	line,
	lockedFields,
	matchedPair,
	merchantOf,
	newCategory,
	newMerchant,
	newTag,
	openChecking,
	openHousehold,
	snapshot,
	splitInTwo,
	tagsOf,
	temp,
	transferAmount,
	transferRows,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { updateTransaction } from "./edits.ts";
import { ingest } from "./ingest.ts";
import { findTransaction } from "./queries.ts";
import { applyRulePlan, applyRulePlanToHistory, ruleCandidates } from "./rule-plans.ts";

useLedgerDatabase();

async function write(plan: Map<string, RowPlan>) {
	return temp.db.transaction(async (tx) => applyRulePlan(tx, plan, { origin: "rule" }));
}

describe("applyRulePlan", () => {
	it("writes nothing for an empty plan", async () => {
		await expect(write(new Map())).resolves.toEqual({ changed: [], marked: [] });
	});

	it("writes every planned field with a rule origin, and locks nothing", async () => {
		const { checking: joint, livret } = await openHousehold();
		const groceries = await newCategory("Courses");
		const merchant = await newMerchant("Amazon");
		const kept = await newTag("Voyage");
		const added = await newTag("Achats");
		const id = await add(joint.id, {}, "sync");
		const twin = await add(joint.id, {}, "sync");
		await updateTransaction(deps(), id, { tagIds: [kept] }, { origin: "rule" });

		const written = await write(
			new Map([
				[
					id,
					{
						categoryId: groceries,
						merchantId: merchant,
						addTagIds: [added],
						label: "Amazon",
						excluded: true,
						expectedTransferAccountId: livret.id,
					},
				],
				[twin, { categoryId: groceries }],
			]),
		);

		expect(written).toEqual({ changed: [id, twin], marked: [id] });
		await expect(categoryOf(id)).resolves.toBe(groceries);
		await expect(categoryOriginOf(id)).resolves.toBe("rule");
		await expect(merchantOf(id)).resolves.toBe(merchant);
		await expect(tagsOf(id)).resolves.toEqual([added, kept].toSorted());
		await expect(excludedOf(id)).resolves.toBe(true);
		await expect(expectedOf(id)).resolves.toBe(livret.id);
		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ label: "Amazon" });
		await expect(lockedFields(id)).resolves.toEqual([]);
		await expect(categoryOf(twin)).resolves.toBe(groceries);
	});

	it("skips locked fields, and values the row already holds", async () => {
		const { checking: joint, livret } = await openHousehold();
		const groceries = await newCategory("Courses");
		const leisure = await newCategory("Loisirs");
		const merchant = await newMerchant("Amazon");
		const tag = await newTag("Achats");
		const locked = await add(joint.id);
		await updateTransaction(deps(), locked, { categoryId: leisure }, { origin: "user" });
		// Clearing a field by hand locks it too, as in Sure; set here directly.
		await temp.db
			.update(transactions)
			.set({ lockedFields: ["label", "category", "merchant", "tags", "excluded"] })
			.where(eq(transactions.entryId, locked));
		const already = await add(joint.id, {}, "sync");
		await write(
			new Map([[already, { categoryId: groceries, expectedTransferAccountId: livret.id }]]),
		);

		const written = await write(
			new Map([
				[
					locked,
					{
						categoryId: groceries,
						merchantId: merchant,
						addTagIds: [tag],
						label: "X",
						excluded: true,
					},
				],
				[already, { categoryId: groceries, expectedTransferAccountId: livret.id }],
			]),
		);

		expect(written).toEqual({ changed: [], marked: [] });
		await expect(categoryOf(locked)).resolves.toBe(leisure);
		await expect(categoryOriginOf(locked)).resolves.toBe("user");
		await expect(merchantOf(locked)).resolves.toBeNull();
		await expect(tagsOf(locked)).resolves.toEqual([]);
		await expect(excludedOf(locked)).resolves.toBe(false);
		await expect(findTransaction(deps(), locked)).resolves.toMatchObject({ label: "Boulangerie" });
	});

	it("never excludes a split's child, whose exclusion is locked, and leaves its parent excluded", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const { parent, food } = await splitInTwo(account.id);

		const written = await write(
			new Map([
				[parent, { excluded: true }],
				[food, { excluded: true, categoryId: groceries }],
			]),
		);

		expect(written).toEqual({ changed: [food], marked: [] });
		await expect(excludedOf(parent)).resolves.toBe(true);
		await expect(excludedOf(food)).resolves.toBe(false);
		await expect(categoryOf(food)).resolves.toBe(groceries);
	});

	it("adds a tag beside the others, and skips it at the cap", async () => {
		const account = await openChecking();
		const full = await Promise.all(
			Array.from({ length: MAX_TAGS_PER_TRANSACTION }, (_, index) => newTag(`Plein ${index}`)),
		);
		const added = await newTag("Achats");
		const crowded = await add(account.id);
		await updateTransaction(deps(), crowded, { tagIds: full }, { origin: "rule" });

		await expect(write(new Map([[crowded, { addTagIds: [added] }]]))).resolves.toEqual({
			changed: [],
			marked: [],
		});
		await expect(tagsOf(crowded)).resolves.toHaveLength(MAX_TAGS_PER_TRANSACTION);
	});

	it("skips a planned tag the row carries since the plan, spending no slot", async () => {
		const account = await openChecking();
		const almost = await Promise.all(
			Array.from({ length: MAX_TAGS_PER_TRANSACTION - 1 }, (_, index) =>
				newTag(`Presque ${index}`),
			),
		);
		const carried = almost[0] ?? "";
		const added = await newTag("Achats");
		const id = await add(account.id);
		await updateTransaction(deps(), id, { tagIds: almost }, { origin: "rule" });

		await expect(write(new Map([[id, { addTagIds: [carried] }]]))).resolves.toEqual({
			changed: [],
			marked: [],
		});
		await expect(write(new Map([[id, { addTagIds: [carried, added] }]]))).resolves.toEqual({
			changed: [id],
			marked: [],
		});
		await expect(tagsOf(id)).resolves.toHaveLength(MAX_TAGS_PER_TRANSACTION);
		await expect(tagsOf(id)).resolves.toContain(added);
	});

	it("writes nothing for a row, category, merchant, tag or account gone since the plan", async () => {
		const { checking: joint } = await openHousehold();
		const id = await add(joint.id, {}, "sync");

		const written = await write(
			new Map<string, RowPlan>([
				[
					id,
					{
						categoryId: "gone",
						merchantId: "gone",
						addTagIds: ["gone"],
						expectedTransferAccountId: "gone",
					},
				],
				["no-such-row", { label: "X" }],
			]),
		);

		expect(written).toEqual({ changed: [], marked: [] });
		await expect(categoryOf(id)).resolves.toBeNull();
		await expect(merchantOf(id)).resolves.toBeNull();
		await expect(tagsOf(id)).resolves.toEqual([]);
		await expect(expectedOf(id)).resolves.toBeNull();
	});

	it("expects no counterpart on a row in a transfer, nor in the row's own account", async () => {
		const { outflow, checking: joint } = await matchedPair();
		const { livret } = await openHousehold();
		const alone = await add(joint.id, {}, "sync");

		await expect(
			write(
				new Map([
					[outflow, { expectedTransferAccountId: livret.id }],
					[alone, { expectedTransferAccountId: joint.id }],
				]),
			),
		).resolves.toEqual({ changed: [], marked: [] });
		await expect(expectedOf(outflow)).resolves.toBeNull();
		await expect(expectedOf(alone)).resolves.toBeNull();
	});
});

// Story 8.3: applying rules to history reads every transaction as a rule does.

const candidatesOf = async (ids: readonly string[], from: string | null = null) =>
	(await ruleCandidates(temp.db, from)).filter((candidate) => ids.includes(candidate.id));

describe("ruleCandidates", () => {
	it("reads what a rule reads and writes, locks and the transfer kind included", async () => {
		const { outflow, inflow, livret } = await matchedPair();
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const merchant = await newMerchant("Amazon");
		const tag = await newTag("Achats");
		const edited = await add(account.id, { label: "AMZN Mktp", notes: "Colis" }, "sync");
		await updateTransaction(
			deps(),
			edited,
			{ categoryId: groceries, merchantId: merchant, tagIds: [tag], excluded: true },
			{ origin: "user" },
		);
		await temp.db
			.update(transactions)
			.set({ expectedTransferAccountId: livret.id })
			.where(eq(transactions.entryId, edited));

		const [read] = await candidatesOf([edited]);

		expect(read).toMatchObject({
			id: edited,
			accountId: account.id,
			date: "2026-09-10",
			amount: -4290,
			currency: "EUR",
			label: "AMZN Mktp",
			notes: "Colis",
			merchantId: merchant,
			categoryId: groceries,
			tagIds: [tag],
			excluded: true,
			transfer: null,
			expectedTransferAccountId: livret.id,
		});
		expect(read?.lockedFields).toEqual(
			expect.arrayContaining(["category", "merchant", "tags", "excluded"]),
		);
		await expect(candidatesOf([outflow, inflow])).resolves.toMatchObject([
			{ transfer: { kind: "internal_move" } },
			{ transfer: { kind: "internal_move" } },
		]);
	});

	it("keeps rows dated on or after the start, every date without one", async () => {
		const account = await openChecking({ openingDate: "2026-05-01" });
		const may = await add(account.id, { date: "2026-05-31" });
		const june = await add(account.id, { date: "2026-06-01" });

		await expect(candidatesOf([may, june], "2026-06-01")).resolves.toMatchObject([{ id: june }]);
		await expect(candidatesOf([may, june])).resolves.toMatchObject([{ id: may }, { id: june }]);
	});

	it("leaves out the opening anchor and a reconciliation", async () => {
		const account = await openChecking();
		const id = await add(account.id);
		await snapshot(account.id, "2026-09-15", 1000);

		const own = (await ruleCandidates(temp.db, null)).filter(
			(candidate) => candidate.accountId === account.id,
		);

		expect(own.map((candidate) => candidate.id)).toEqual([id]);
	});

	it("reads a split's children and never its parent, whose exclusion stays locked", async () => {
		const account = await openChecking();
		const { parent, food, home } = await splitInTwo(account.id);

		const own = (await ruleCandidates(temp.db, null)).filter(
			(candidate) => candidate.accountId === account.id,
		);

		expect(own.map((candidate) => candidate.id).toSorted()).toEqual([food, home].toSorted());
		await expect(lockedFields(parent)).resolves.toContain("excluded");
	});

	it("reads the tags of more rows than one lookup holds", async () => {
		const account = await openChecking();
		const tag = await newTag("Lot");
		const result = await ingest(
			deps(),
			account.id,
			{
				transactions: Array.from({ length: 520 }, (_, index) =>
					line({ label: `Ligne ${index}`, amount: toMinorUnits(-(index + 1)) }),
				),
				balance: null,
				rejected: [],
			},
			{ manual: true },
			{ origin: "sync" },
		);
		const last = result.created.at(-1) ?? "";
		await temp.db.insert(taggings).values({ transactionId: last, tagId: tag });

		const read = await candidatesOf(result.created);

		expect(read).toHaveLength(520);
		expect(read.find((candidate) => candidate.id === last)?.tagIds).toEqual([tag]);
	});
});

describe("applyRulePlanToHistory", () => {
	it("pairs an existing row with the expected account's line it had to share before", async () => {
		const { checking: joint, livret, card } = await openHousehold();
		const amount = transferAmount();
		// Both inflows come first, so the outflow arrives with two candidates
		// and step 6 leaves every row unpaired.
		await add(card.id, { amount: toMinorUnits(amount), label: "Remboursement" });
		const inflow = await add(livret.id, { amount: toMinorUnits(amount), label: "VIR RECU" });
		const outflow = await add(joint.id, { amount: toMinorUnits(-amount), label: "VIR EPARGNE" });
		await expect(transferRows(outflow)).resolves.toEqual([]);

		const changed = await applyRulePlanToHistory(
			deps(),
			new Map([[outflow, { expectedTransferAccountId: livret.id }]]),
			{ origin: "rule" },
		);

		expect(changed).toBe(1);
		await expect(transferRows(outflow)).resolves.toMatchObject([
			{ outflowTransactionId: outflow, inflowTransactionId: inflow, kind: "internal_move" },
		]);
	});
});
