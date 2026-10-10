import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import { transactions } from "@archant/data/schema/transactions";

import { MAX_SPLIT_LINES, MAX_TAGS_PER_TRANSACTION } from "../../schemas/transactions.ts";
import {
	add,
	asUser,
	categoryOf,
	categoryOriginOf,
	deps,
	excludedOf,
	history,
	keysOf,
	lockedFields,
	matchedPair,
	merchantOf,
	newCategory,
	newMerchant,
	newTag,
	openChecking,
	splitInTwo,
	tagsOf,
	temp,
	transactionCount,
	transferAmount,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { updateTransaction } from "./edits.ts";
import { cashFlowByCategory, listTransactions, sumTransactions } from "./queries.ts";
import { editSplit, splitOf, splitTransaction, unsplitTransaction } from "./splits.ts";

useLedgerDatabase();

/** An expense of an amount of its own, so step 6 never links it to another test's rows. */
async function expense(accountId: string, label = "HYPERMARCHE") {
	const amount = -transferAmount();
	const id = await add(accountId, { date: "2026-09-10", amount: toMinorUnits(amount), label });

	return { id, amount };
}

async function childRow(id: string) {
	return temp.db
		.select({
			accountId: entries.accountId,
			date: entries.date,
			amount: entries.amount,
			currency: entries.currency,
			importId: entries.importId,
			parentEntryId: entries.parentEntryId,
			label: transactions.label,
			notes: transactions.notes,
			pending: transactions.pending,
			excluded: transactions.excluded,
			possibleDuplicate: transactions.possibleDuplicate,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(entries.id, id))
		.get();
}

/** One line taking the whole amount. */
const whole = (value: number) => [{ label: "Tout", amount: toMinorUnits(value), categoryId: null }];

const invalid = (path: string, code = "invalid_value") => ({
	code: "VALIDATION_ERROR",
	fields: [{ path, code }],
});

describe("splitTransaction", () => {
	it("keeps the parent excluded and locked, and copies its account, date, currency and merchant onto each child", async () => {
		const account = await openChecking({ name: "Courses" });
		const { id: parent, amount } = await expense(account.id);
		const merchant = await newMerchant("Carrefour");
		await updateTransaction(deps(), parent, { merchantId: merchant }, asUser);
		const [food, home] = [await newCategory("Alimentation"), await newCategory("Maison")];
		const tag = await newTag("Reçu");
		const before = await history(account.id);

		const split = await splitTransaction(
			deps(),
			parent,
			[
				{
					label: "Alimentation",
					amount: toMinorUnits(-6_000),
					categoryId: food,
					tagIds: [tag, tag],
					notes: "Fruits",
				},
				{ label: "Maison", amount: toMinorUnits(amount + 6_000), categoryId: home },
			],
			asUser,
		);
		const [first, second] = split.childIds;

		expect(split.parentId).toBe(parent);
		expect(split.childIds).toHaveLength(2);
		await expect(excludedOf(parent)).resolves.toBe(true);
		await expect(lockedFields(parent)).resolves.toEqual([
			"date",
			"amount",
			"label",
			"merchant",
			"excluded",
		]);
		await expect(childRow(first ?? "")).resolves.toEqual({
			accountId: account.id,
			date: "2026-09-10",
			amount: -6_000,
			currency: "EUR",
			importId: null,
			parentEntryId: parent,
			label: "Alimentation",
			notes: "Fruits",
			pending: false,
			excluded: false,
			possibleDuplicate: false,
		});
		await expect(childRow(second ?? "")).resolves.toMatchObject({
			amount: amount + 6_000,
			notes: null,
		});
		await expect(merchantOf(first ?? "")).resolves.toBe(merchant);
		await expect(merchantOf(second ?? "")).resolves.toBe(merchant);
		await expect(categoryOf(first ?? "")).resolves.toBe(food);
		await expect(categoryOriginOf(first ?? "")).resolves.toBe("user");
		await expect(tagsOf(first ?? "")).resolves.toEqual([tag]);
		await expect(tagsOf(second ?? "")).resolves.toEqual([]);
		await expect(lockedFields(first ?? "")).resolves.toEqual([
			"date",
			"amount",
			"label",
			"excluded",
			"notes",
			"category",
			"tags",
		]);
		await expect(lockedFields(second ?? "")).resolves.toEqual([
			"date",
			"amount",
			"label",
			"excluded",
			"category",
		]);
		await expect(keysOf(first ?? "")).resolves.toEqual([]);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("counts the children and never the parent in the list, its totals and the cash flow", async () => {
		const account = await openChecking({ name: "Lecteurs" });
		const { parent, food, home, amount } = await splitInTwo(account.id);
		const [groceries, household] = [await newCategory("Épicerie"), await newCategory("Foyer")];
		await updateTransaction(deps(), food, { categoryId: groceries }, asUser);
		await updateTransaction(deps(), home, { categoryId: household }, asUser);

		const { items, total } = await listTransactions(
			deps(),
			{ accountIds: [account.id] },
			{ page: 1, pageSize: 50 },
		);
		const [sums] = await sumTransactions(deps(), { accountIds: [account.id] });
		const flow = await cashFlowByCategory(deps(), {
			from: "2026-09-01",
			to: "2026-09-30",
			accountIds: [account.id],
		});

		expect(items.map((item) => item.id).toSorted()).toEqual([food, home].toSorted());
		expect(items.find((item) => item.id === food)?.parentEntryId).toBe(parent);
		expect(total).toBe(2);
		expect(sums).toMatchObject({ amount, expense: amount, count: 2 });
		expect(flow.toSorted((a, b) => a.amount - b.amount)).toEqual(
			[
				{ categoryId: groceries, amount: -6_000 },
				{ categoryId: household, amount: amount + 6_000 },
			].toSorted((a, b) => a.amount - b.amount),
		);
	});

	it("gives each child a one-time parent's flag, as Sure's `Entry#split!` its kind, so the split stays out of cash flow", async () => {
		const account = await openChecking({ name: "Ponctuelle divisée" });
		const { id: parent, amount } = await expense(account.id);
		await updateTransaction(deps(), parent, { oneTime: true }, asUser);

		const split = await splitTransaction(
			deps(),
			parent,
			[
				{ label: "Four", amount: toMinorUnits(-6_000), categoryId: null },
				{ label: "Pose", amount: toMinorUnits(amount + 6_000), categoryId: null },
			],
			asUser,
		);
		const flow = await cashFlowByCategory(deps(), {
			from: "2026-09-01",
			to: "2026-09-30",
			accountIds: [account.id],
		});

		const flags = await Promise.all(
			split.childIds.map(
				async (id) =>
					(
						await temp.db
							.select({ oneTime: transactions.oneTime })
							.from(transactions)
							.where(eq(transactions.entryId, id))
							.get()
					)?.oneTime,
			),
		);
		expect(flags).toEqual([true, true]);
		expect(flow).toEqual([]);
	});

	it("allows zero and mixed signs, as Sure", async () => {
		const account = await openChecking({ name: "Signes" });
		const { id, amount } = await expense(account.id);

		const split = await splitTransaction(
			deps(),
			id,
			[
				{ label: "Achat", amount: toMinorUnits(amount - 2_000), categoryId: null },
				{ label: "Remise", amount: toMinorUnits(2_000), categoryId: null },
				{ label: "Offert", amount: toMinorUnits(0), categoryId: null },
			],
			asUser,
		);

		expect(split.childIds).toHaveLength(3);
		await expect(transactionCount(account.id)).resolves.toBe(4);
	});

	it("refuses lines a cent off the parent's amount, and writes nothing", async () => {
		const account = await openChecking({ name: "Centime" });
		const { id, amount } = await expense(account.id);

		await expect(
			splitTransaction(
				deps(),
				id,
				[
					{ label: "Courses", amount: toMinorUnits(-6_000), categoryId: null },
					{ label: "Maison", amount: toMinorUnits(amount + 6_001), categoryId: null },
				],
				asUser,
			),
		).rejects.toMatchObject(invalid("lines", "split_sum_mismatch"));
		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(excludedOf(id)).resolves.toBe(false);
	});

	it("refuses no line, and more lines than the cap", async () => {
		const account = await openChecking({ name: "Lignes" });
		const { id, amount } = await expense(account.id);
		const many = Array.from({ length: MAX_SPLIT_LINES + 1 }, (_, index) => ({
			label: `Ligne ${index}`,
			amount: toMinorUnits(index === 0 ? amount : 0),
			categoryId: null,
		}));

		await expect(splitTransaction(deps(), id, [], asUser)).rejects.toMatchObject(
			invalid("lines", "too_small"),
		);
		await expect(splitTransaction(deps(), id, many, asUser)).rejects.toMatchObject(
			invalid("lines", "too_big"),
		);
		await expect(
			splitTransaction(deps(), id, many.slice(0, MAX_SPLIT_LINES), asUser),
		).resolves.toMatchObject({ parentId: id });
	});

	it("refuses an unknown category or tag, too many tags, or an id, on its line", async () => {
		const account = await openChecking({ name: "Champs" });
		const { id, amount } = await expense(account.id);
		const tags = await Promise.all(
			Array.from({ length: MAX_TAGS_PER_TRANSACTION + 1 }, async (_, index) =>
				newTag(`Étiquette ${index}`),
			),
		);
		const lines = (line: Record<string, unknown>) => [
			{ label: "Courses", amount: toMinorUnits(-6_000), categoryId: null },
			{ label: "Maison", amount: toMinorUnits(amount + 6_000), categoryId: null, ...line },
		];

		await expect(
			splitTransaction(deps(), id, lines({ categoryId: "inconnue" }), asUser),
		).rejects.toMatchObject(invalid("lines.1.categoryId"));
		await expect(
			splitTransaction(deps(), id, lines({ tagIds: ["inconnue"] }), asUser),
		).rejects.toMatchObject(invalid("lines.1.tagIds"));
		await expect(
			splitTransaction(deps(), id, lines({ tagIds: tags }), asUser),
		).rejects.toMatchObject(invalid("lines.1.tagIds", "too_big"));
		await expect(splitTransaction(deps(), id, lines({ id }), asUser)).rejects.toMatchObject(
			invalid("lines.1.id", "not_a_child"),
		);
		await expect(transactionCount(account.id)).resolves.toBe(1);
	});

	it.each([
		["pending", { pending: true }],
		["excluded", { excluded: true }],
		["possibly duplicated", { possibleDuplicate: true }],
	])("refuses a %s transaction with NOT_SPLITTABLE, writing nothing", async (_name, flags) => {
		const account = await openChecking({ name: "Refus" });
		const { id, amount } = await expense(account.id);
		await temp.db.update(transactions).set(flags).where(eq(transactions.entryId, id));

		await expect(
			splitTransaction(
				deps(),
				id,
				[{ label: "Tout", amount: toMinorUnits(amount), categoryId: null }],
				asUser,
			),
		).rejects.toMatchObject({ code: "NOT_SPLITTABLE" });
		await expect(transactionCount(account.id)).resolves.toBe(1);
	});

	it("refuses a transfer side, a parent and a child with NOT_SPLITTABLE", async () => {
		const pair = await matchedPair();
		const { parent, food, amount } = await splitInTwo(pair.checking.id);

		await expect(
			splitTransaction(deps(), pair.outflow, whole(-pair.amount), asUser),
		).rejects.toMatchObject({ code: "NOT_SPLITTABLE" });
		await expect(splitTransaction(deps(), parent, whole(amount), asUser)).rejects.toMatchObject({
			code: "NOT_SPLITTABLE",
		});
		await expect(splitTransaction(deps(), food, whole(-6_000), asUser)).rejects.toMatchObject({
			code: "NOT_SPLITTABLE",
		});
		await expect(transactionCount(pair.checking.id)).resolves.toBe(4);
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		await expect(splitTransaction(deps(), "inconnue", [], asUser)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("locks nothing for another origin, and records its category origin", async () => {
		const account = await openChecking({ name: "Règle" });
		const { id, amount } = await expense(account.id);
		const category = await newCategory("Règle");

		const split = await splitTransaction(
			deps(),
			id,
			[{ label: "Tout", amount: toMinorUnits(amount), categoryId: category }],
			{ origin: "rule" },
		);

		await expect(excludedOf(id)).resolves.toBe(true);
		await expect(lockedFields(id)).resolves.toEqual(["date", "amount", "label"]);
		await expect(lockedFields(split.childIds[0] ?? "")).resolves.toEqual([]);
		await expect(categoryOriginOf(split.childIds[0] ?? "")).resolves.toBe("rule");
	});
});

describe("splitOf", () => {
	it("reads a split from its parent or a child, its children in order", async () => {
		const account = await openChecking({ name: "Lecture" });
		const { parent, food, home } = await splitInTwo(account.id);

		await expect(splitOf(deps(), parent)).resolves.toEqual({
			parentId: parent,
			childIds: [food, home],
		});
		await expect(splitOf(deps(), home)).resolves.toEqual({
			parentId: parent,
			childIds: [food, home],
		});
	});

	it("answers NOT_FOUND for an unsplit or unknown transaction", async () => {
		const account = await openChecking({ name: "Entière" });
		const { id } = await expense(account.id);

		await expect(splitOf(deps(), id)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(splitOf(deps(), "inconnue")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("editSplit", () => {
	it("updates a kept child in place, creates a new one, and deletes the one left out", async () => {
		const account = await openChecking({ name: "Modifier" });
		const { parent, food, home, amount } = await splitInTwo(account.id);
		const tag = await newTag("Garder");
		await updateTransaction(deps(), food, { tagIds: [tag], notes: "Marché" }, asUser);
		const before = await history(account.id);

		const split = await editSplit(
			deps(),
			home,
			[
				{ id: food, label: "Alimentation", amount: toMinorUnits(-5_000), categoryId: null },
				{ label: "Hygiène", amount: toMinorUnits(amount + 5_000), categoryId: null },
			],
			asUser,
		);
		const created = split.childIds.find((id) => id !== food);

		expect(split.parentId).toBe(parent);
		expect(split.childIds).toHaveLength(2);
		expect(split.childIds).toContain(food);
		expect(created).not.toBe(home);
		await expect(childRow(home)).resolves.toBeUndefined();
		await expect(childRow(food)).resolves.toMatchObject({
			amount: -5_000,
			label: "Alimentation",
			notes: "Marché",
		});
		await expect(tagsOf(food)).resolves.toEqual([tag]);
		await expect(childRow(created ?? "")).resolves.toMatchObject({
			amount: amount + 5_000,
			label: "Hygiène",
			parentEntryId: parent,
		});
		await expect(excludedOf(parent)).resolves.toBe(true);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("replaces or clears a kept child's tags, and keeps an amount it did not change", async () => {
		const account = await openChecking({ name: "Étiquettes" });
		const { food, home, amount } = await splitInTwo(account.id);
		const [old, fresh] = [await newTag("Ancienne"), await newTag("Nouvelle")];
		await updateTransaction(deps(), food, { tagIds: [old] }, asUser);
		await updateTransaction(deps(), home, { tagIds: [old] }, asUser);

		await editSplit(
			deps(),
			food,
			[
				{ id: food, label: "Courses", amount: toMinorUnits(-6_000), categoryId: null, tagIds: [] },
				{
					id: home,
					label: "Maison",
					amount: toMinorUnits(amount + 6_000),
					categoryId: null,
					tagIds: [fresh],
					notes: null,
				},
			],
			asUser,
		);

		await expect(tagsOf(food)).resolves.toEqual([]);
		await expect(tagsOf(home)).resolves.toEqual([fresh]);
		await expect(childRow(food)).resolves.toMatchObject({ amount: -6_000 });
		await expect(lockedFields(food)).resolves.toContain("tags");
	});

	it("refuses an id that is no child of this split, or the same child twice", async () => {
		const account = await openChecking({ name: "Intrus" });
		const { parent, food, amount } = await splitInTwo(account.id);
		const other = await splitInTwo(account.id);

		await expect(
			editSplit(
				deps(),
				parent,
				[
					{ id: food, label: "Courses", amount: toMinorUnits(-6_000), categoryId: null },
					{
						id: other.home,
						label: "Maison",
						amount: toMinorUnits(amount + 6_000),
						categoryId: null,
					},
				],
				asUser,
			),
		).rejects.toMatchObject(invalid("lines.1.id", "not_a_child"));
		await expect(
			editSplit(
				deps(),
				parent,
				[
					{ id: food, label: "Courses", amount: toMinorUnits(-6_000), categoryId: null },
					{ id: food, label: "Maison", amount: toMinorUnits(amount + 6_000), categoryId: null },
				],
				asUser,
			),
		).rejects.toMatchObject(invalid("lines.1.id", "not_a_child"));
		await expect(
			editSplit(
				deps(),
				parent,
				[{ id: food, label: "Courses", amount: toMinorUnits(amount - 1), categoryId: null }],
				asUser,
			),
		).rejects.toMatchObject(invalid("lines", "split_sum_mismatch"));
		expect((await splitOf(deps(), parent)).childIds).toContain(food);
	});

	it("answers NOT_FOUND for an unsplit or unknown transaction", async () => {
		const account = await openChecking({ name: "Pas divisée" });
		const { id, amount } = await expense(account.id);
		await expect(editSplit(deps(), id, whole(amount), asUser)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(editSplit(deps(), "inconnue", whole(amount), asUser)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("unsplitTransaction", () => {
	it("deletes the children and counts the parent again, its exclusion still locked", async () => {
		const account = await openChecking({ name: "Annuler" });
		const { parent, food, home } = await splitInTwo(account.id);
		await updateTransaction(deps(), food, { tagIds: [await newTag("Partie")] }, asUser);
		const before = await history(account.id);

		await expect(unsplitTransaction(deps(), food, asUser)).resolves.toBe(parent);

		await expect(childRow(food)).resolves.toBeUndefined();
		await expect(childRow(home)).resolves.toBeUndefined();
		await expect(excludedOf(parent)).resolves.toBe(false);
		await expect(lockedFields(parent)).resolves.toContain("excluded");
		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("locks nothing for another origin", async () => {
		const account = await openChecking({ name: "Annuler sans verrou" });
		const { id, amount } = await expense(account.id);
		await splitTransaction(
			deps(),
			id,
			[{ label: "Tout", amount: toMinorUnits(amount), categoryId: null }],
			{ origin: "rule" },
		);

		await unsplitTransaction(deps(), id, { origin: "rule" });

		await expect(excludedOf(id)).resolves.toBe(false);
		await expect(lockedFields(id)).resolves.toEqual(["date", "amount", "label"]);
	});

	it("answers NOT_FOUND for an unsplit transaction", async () => {
		const account = await openChecking({ name: "Rien à annuler" });
		const { id } = await expense(account.id);

		await expect(unsplitTransaction(deps(), id, asUser)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});
