import type { CreateCategoryRequest } from "../schemas/categories.ts";
import type { TempDatabase } from "../testing/temp-database.ts";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { budgetCategories, budgets } from "@archant/data/schema/budgets";
import { categories } from "@archant/data/schema/categories";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { createTempDatabase } from "../testing/temp-database.ts";
import {
	bootstrapCategories,
	createCategory,
	deleteAllCategories,
	deleteCategory,
	listCategories,
	mergeCategories,
	updateCategory,
	withChildren,
} from "./categories.ts";
import { DEFAULT_CATEGORIES } from "./default-categories.ts";
import { createAccount } from "./ledger/accounts.ts";
import { updateTransaction } from "./ledger/edits.ts";
import { ingest } from "./ledger/ingest.ts";
import { seedDefaults } from "./seed.ts";

let temp: TempDatabase;
const deps = () => ({ db: temp.db, timeZone: "Europe/Paris" });

beforeAll(async () => {
	temp = await createTempDatabase();
});

afterAll(async () => {
	await temp.dispose();
});

// Each test starts from an empty set, so names never collide across tests.
beforeEach(async () => {
	await temp.db.run(sql`update transactions set category_id = null, category_origin = null`);
	await temp.db.update(categories).set({ parentId: null });
	await temp.db.delete(categories);
	await temp.db.delete(budgets);
});

const input = (overrides: Partial<CreateCategoryRequest> = {}): CreateCategoryRequest => ({
	name: "Courses",
	color: "#e99537",
	icon: "shopping-bag",
	parentId: null,
	...overrides,
});

const create = (overrides: Partial<CreateCategoryRequest> = {}) =>
	createCategory(deps(), input(overrides));

/** Gives each category an amount in a budget of its own month. */
async function budgeted(...categoryIds: string[]) {
	await categoryIds.reduce(async (previous, categoryId, index) => {
		await previous;
		const budgetId = crypto.randomUUID();
		await temp.db.insert(budgets).values({
			id: budgetId,
			month: `2026-${String(index + 1).padStart(2, "0")}`,
			currency: "EUR",
			budgetedSpending: 100_000,
			expectedIncome: 0,
			createdAt: 0,
			updatedAt: 0,
		});
		await temp.db.insert(budgetCategories).values({
			id: crypto.randomUUID(),
			budgetId,
			categoryId,
			budgetedSpending: 10_000,
			createdAt: 0,
			updatedAt: 0,
		});
	}, Promise.resolve());
}

const budgetedCategories = async () =>
	(await temp.db.select({ categoryId: budgetCategories.categoryId }).from(budgetCategories)).map(
		(row) => row.categoryId,
	);

/** `count` new transactions in `categoryId`, set by hand. */
async function transactionsIn(categoryId: string | null, count: number): Promise<string[]> {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));

	try {
		const account = await createAccount(
			deps(),
			{
				name: "Compte joint",
				type: "depository",
				subtype: "checking",
				currency: "EUR",
				openingBalance: toMinorUnits(0),
				openingDate: "2026-09-01",
			},
			{ origin: "user" },
		);
		const result = await ingest(
			deps(),
			account.id,
			{
				transactions: Array.from({ length: count }, (_, index) => ({
					externalId: null,
					date: "2026-09-10",
					amount: toMinorUnits(-100 - index),
					currency: "EUR",
					label: `Achat ${index}`,
					reference: null,
					notes: null,
					pending: false,
				})),
				balance: null,
				rejected: [],
			},
			{ manual: true },
			{ origin: "sync" },
		);
		await setCategory(result.created, categoryId);

		return result.created;
	} finally {
		vi.useRealTimers();
	}
}

// One after the other: each is an `immediate` ledger transaction.
async function setCategory(entryIds: string[], categoryId: string | null) {
	await entryIds.reduce<Promise<unknown>>(
		(pending, id) =>
			pending.then(() => updateTransaction(deps(), id, { categoryId }, { origin: "user" })),
		Promise.resolve(),
	);
}

async function originsOf(entryIds: string[]) {
	const rows = await Promise.all(
		entryIds.map((id) =>
			temp.db.get<{ origin: string | null; locked: string }>(
				sql`select category_origin as origin, (select json_group_array(key) from json_each(locked_fields)) as locked from transactions where entry_id = ${id}`,
			),
		),
	);

	return rows.map((row) => {
		const locked: unknown = JSON.parse(row?.locked ?? "[]");

		return { origin: row?.origin, locked };
	});
}

async function categoriesOf(entryIds: string[]) {
	const rows = await Promise.all(
		entryIds.map((id) =>
			temp.db.get<{ categoryId: string | null }>(
				sql`select category_id as categoryId from transactions where entry_id = ${id}`,
			),
		),
	);

	return rows.map((row) => row?.categoryId);
}

async function stored(id: string) {
	return temp.db.select().from(categories).where(eq(categories.id, id)).get();
}

const fieldError = (path: string, code: string) => ({
	code: "VALIDATION_ERROR",
	fields: [{ path, code }],
});

describe("listCategories", () => {
	it("sorts names as a French reader does, with each one's transaction count", async () => {
		const savings = await create({ name: "Épargne" });
		await create({ name: "Frais" });
		await create({ name: "Assurances" });
		await transactionsIn(savings.id, 2);

		const list = await listCategories(deps());

		expect(list.map((category) => category.name)).toEqual(["Assurances", "Épargne", "Frais"]);
		expect(list.find((category) => category.id === savings.id)).toEqual({
			id: savings.id,
			name: "Épargne",
			color: "#e99537",
			icon: "shopping-bag",
			parentId: null,
			transactionCount: 2,
		});
	});

	it("lists the defaults once seeded", async () => {
		const db = await createTempDatabase();

		try {
			await seedDefaults({ db: db.db });
			const list = await listCategories({ db: db.db, timeZone: "Europe/Paris" });

			expect(list).toHaveLength(22);
			expect(list.every((category) => category.transactionCount === 0)).toBe(true);
		} finally {
			await db.dispose();
		}
	});
});

describe("createCategory", () => {
	it("creates a top-level category with no transaction", async () => {
		const category = await create({ name: "Animaux", icon: "dog", color: "#805dee" });

		expect(category).toMatchObject({
			name: "Animaux",
			color: "#805dee",
			icon: "dog",
			parentId: null,
			transactionCount: 0,
		});
		expect(category.id).toMatch(/^[0-9a-f-]{36}$/u);
	});

	it.each(["courses", "COURSES"])("refuses %j when « Courses » exists", async (name) => {
		await create({ name: "Courses" });

		await expect(create({ name })).rejects.toMatchObject(fieldError("name", "name_taken"));
	});

	it("folds case beyond ASCII, where SQLite's `lower` stops", async () => {
		await create({ name: "Épargne" });

		await expect(create({ name: "ÉPARGNE" })).rejects.toMatchObject(
			fieldError("name", "name_taken"),
		);
		await expect(create({ name: "Epargne" })).resolves.toMatchObject({ name: "Epargne" });
	});

	it("gives a child its parent's colour, whatever it asked for", async () => {
		const income = await create({ name: "Revenus", color: "#6ad28a" });

		const child = await create({
			name: "Salaire",
			color: "#db5a54",
			parentId: income.id,
		});

		expect(child).toMatchObject({ color: "#6ad28a", parentId: income.id });
	});

	it("refuses a grandchild", async () => {
		const housing = await create({ name: "Logement" });
		const rent = await create({ name: "Loyer", parentId: housing.id });

		await expect(create({ name: "Caution", parentId: rent.id })).rejects.toMatchObject(
			fieldError("parentId", "invalid_parent"),
		);
	});

	it("refuses an unknown parent", async () => {
		await expect(create({ name: "Loyer", parentId: "nope" })).rejects.toMatchObject(
			fieldError("parentId", "invalid_parent"),
		);
	});
});

describe("updateCategory", () => {
	it("renames, recolours and changes the icon", async () => {
		const category = await create();

		await expect(
			updateCategory(deps(), category.id, { name: "Alimentation", color: "#4da568", icon: "tag" }),
		).resolves.toMatchObject({ name: "Alimentation", color: "#4da568", icon: "tag" });
	});

	it("keeps its own name, in another case", async () => {
		const category = await create({ name: "Courses" });

		await expect(updateCategory(deps(), category.id, { name: "COURSES" })).resolves.toMatchObject({
			name: "COURSES",
		});
	});

	it("refuses a name another category holds", async () => {
		await create({ name: "Courses" });
		const other = await create({ name: "Marché" });

		await expect(updateCategory(deps(), other.id, { name: "courses" })).rejects.toMatchObject(
			fieldError("name", "name_taken"),
		);
	});

	it("moves under a parent and takes its colour", async () => {
		const income = await create({ name: "Revenus", color: "#6ad28a" });
		const bonus = await create({ name: "Prime", color: "#db5a54" });

		await expect(updateCategory(deps(), bonus.id, { parentId: income.id })).resolves.toMatchObject({
			parentId: income.id,
			color: "#6ad28a",
		});
	});

	it("keeps a child on its parent's colour when the patch asks for another", async () => {
		const housing = await create({ name: "Logement", color: "#e99537" });
		const rent = await create({ name: "Loyer", parentId: housing.id });

		await expect(updateCategory(deps(), rent.id, { color: "#db5a54" })).resolves.toMatchObject({
			color: "#e99537",
		});
	});

	it("passes a parent's new colour on to its children", async () => {
		const housing = await create({ name: "Logement" });
		const rent = await create({ name: "Loyer", parentId: housing.id });
		const unrelated = await create({ name: "Loisirs", color: "#c44fe9" });

		await updateCategory(deps(), housing.id, { color: "#61c9ea" });

		await expect(stored(rent.id)).resolves.toMatchObject({ color: "#61c9ea" });
		await expect(stored(unrelated.id)).resolves.toMatchObject({
			color: "#c44fe9",
		});
	});

	it("becomes top-level again, keeping the colour it had", async () => {
		const income = await create({ name: "Revenus", color: "#6ad28a" });
		const salary = await create({ name: "Salaire", parentId: income.id });

		await expect(updateCategory(deps(), salary.id, { parentId: null })).resolves.toMatchObject({
			parentId: null,
			color: "#6ad28a",
		});
	});

	it.each([
		["itself", "self"],
		["a child", "child"],
		["an unknown category", "unknown"],
	])("refuses %s as parent", async (_label, which) => {
		const housing = await create({ name: "Logement" });
		const rent = await create({ name: "Loyer", parentId: housing.id });
		const leisure = await create({ name: "Loisirs" });
		const parentId = { self: leisure.id, child: rent.id, unknown: "nope" }[which] ?? "";

		await expect(updateCategory(deps(), leisure.id, { parentId })).rejects.toMatchObject(
			fieldError("parentId", "invalid_parent"),
		);
	});

	it("refuses a parent to a category that has children", async () => {
		const housing = await create({ name: "Logement" });
		await create({ name: "Loyer", parentId: housing.id });
		const leisure = await create({ name: "Loisirs" });

		await expect(
			updateCategory(deps(), housing.id, { parentId: leisure.id }),
		).rejects.toMatchObject(fieldError("parentId", "invalid_parent"));
	});

	it("answers NOT_FOUND for an unknown category", async () => {
		await expect(updateCategory(deps(), "nope", { name: "X" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("deleteCategory", () => {
	it("moves every transaction to the replacement, then deletes the category", async () => {
		const groceries = await create({ name: "Courses" });
		const food = await create({ name: "Alimentation" });
		const ids = await transactionsIn(groceries.id, 3);

		await expect(deleteCategory(deps(), groceries.id, food.id)).resolves.toEqual({
			id: groceries.id,
			moved: 3,
		});

		await expect(categoriesOf(ids)).resolves.toEqual([food.id, food.id, food.id]);
		await expect(stored(groceries.id)).resolves.toBeUndefined();
	});

	it("leaves the transactions uncategorised without a replacement", async () => {
		const gifts = await create({ name: "Cadeaux" });
		const ids = await transactionsIn(gifts.id, 2);

		await deleteCategory(deps(), gifts.id, undefined);

		await expect(categoriesOf(ids)).resolves.toEqual([null, null]);
		// The origin goes with the category; the lock stays (AD-10).
		await expect(originsOf(ids)).resolves.toEqual([
			{ origin: null, locked: ["category"] },
			{ origin: null, locked: ["category"] },
		]);
	});

	it("deletes the category's budget amounts, and only its own", async () => {
		const gifts = await create({ name: "Cadeaux" });
		const travel = await create({ name: "Voyages" });
		await budgeted(gifts.id, travel.id);

		await deleteCategory(deps(), gifts.id, travel.id);

		await expect(budgetedCategories()).resolves.toEqual([travel.id]);
	});

	it("makes the children top-level, keeping their colour", async () => {
		const income = await create({ name: "Revenus", color: "#6ad28a" });
		const salary = await create({ name: "Salaire", parentId: income.id });
		const bonus = await create({ name: "Prime", parentId: income.id });

		await deleteCategory(deps(), income.id, undefined);

		await expect(Promise.all([stored(salary.id), stored(bonus.id)])).resolves.toEqual([
			expect.objectContaining({ parentId: null, color: "#6ad28a" }),
			expect.objectContaining({ parentId: null, color: "#6ad28a" }),
		]);
	});

	it("accepts one of its own children as the replacement", async () => {
		const housing = await create({ name: "Logement" });
		const rent = await create({ name: "Loyer", parentId: housing.id });
		const ids = await transactionsIn(housing.id, 1);

		await deleteCategory(deps(), housing.id, rent.id);

		await expect(categoriesOf(ids)).resolves.toEqual([rent.id]);
		await expect(stored(rent.id)).resolves.toMatchObject({ parentId: null });
	});

	it.each([
		["an unknown replacement", "unknown"],
		["itself as the replacement", "self"],
	])("refuses %s and changes nothing", async (_label, which) => {
		const groceries = await create({ name: "Courses" });
		const ids = await transactionsIn(groceries.id, 1);
		const replacementId = which === "self" ? groceries.id : "nope";

		await expect(deleteCategory(deps(), groceries.id, replacementId)).rejects.toMatchObject(
			fieldError("replacementId", "invalid_value"),
		);
		await expect(categoriesOf(ids)).resolves.toEqual([groceries.id]);
		await expect(stored(groceries.id)).resolves.toBeDefined();
	});

	it("answers NOT_FOUND for an unknown category", async () => {
		await expect(deleteCategory(deps(), "nope", undefined)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

/** A month's budget, `lines` giving each category its amount in cents. */
async function budgetMonth(month: string, lines: Record<string, number>) {
	const budgetId = crypto.randomUUID();
	await temp.db.insert(budgets).values({
		id: budgetId,
		month,
		currency: "EUR",
		budgetedSpending: 100_000,
		expectedIncome: 0,
		createdAt: 0,
		updatedAt: 0,
	});

	await temp.db.insert(budgetCategories).values(
		Object.entries(lines).map(([categoryId, budgetedSpending]) => ({
			id: crypto.randomUUID(),
			budgetId,
			categoryId,
			budgetedSpending,
			createdAt: 0,
			updatedAt: 0,
		})),
	);
}

const budgetLines = async () =>
	(
		await temp.db
			.select({
				month: budgets.month,
				categoryId: budgetCategories.categoryId,
				amount: budgetCategories.budgetedSpending,
			})
			.from(budgetCategories)
			.innerJoin(budgets, eq(budgets.id, budgetCategories.budgetId))
	).toSorted((a, b) => a.month.localeCompare(b.month));

describe("mergeCategories", () => {
	it("moves several sources' transactions to the target, deletes them and returns the target", async () => {
		const groceries = await create({ name: "Courses" });
		const market = await create({ name: "Marché" });
		const food = await create({ name: "Alimentation" });
		const moved = [
			...(await transactionsIn(groceries.id, 2)),
			...(await transactionsIn(market.id, 1)),
		];
		const kept = await transactionsIn(food.id, 1);

		await expect(
			mergeCategories(deps(), food.id, [groceries.id, market.id]),
		).resolves.toMatchObject({ id: food.id, transactionCount: 4 });

		await expect(categoriesOf([...moved, ...kept])).resolves.toEqual(Array(4).fill(food.id));
		await expect(stored(groceries.id)).resolves.toBeUndefined();
		await expect(stored(market.id)).resolves.toBeUndefined();
		// Still the user's choice, still locked: a rule must not undo the merge.
		await expect(originsOf(moved)).resolves.toEqual(
			Array.from({ length: 3 }, () => ({ origin: "user", locked: ["category"] })),
		);
	});

	it("adds the sources' budget lines to the target's month by month, as Sure's merger", async () => {
		const groceries = await create({ name: "Courses" });
		const market = await create({ name: "Marché" });
		const food = await create({ name: "Alimentation" });
		await budgetMonth("2026-05", { [groceries.id]: 3000, [food.id]: 2000 });
		await budgetMonth("2026-06", { [market.id]: 1000 });
		await budgetMonth("2026-07", { [groceries.id]: 500, [market.id]: 250 });

		await mergeCategories(deps(), food.id, [groceries.id, market.id]);

		await expect(budgetLines()).resolves.toEqual([
			{ month: "2026-05", categoryId: food.id, amount: 5000 },
			{ month: "2026-06", categoryId: food.id, amount: 1000 },
			{ month: "2026-07", categoryId: food.id, amount: 750 },
		]);
	});

	it("moves a recurring series of a source to the target instead of clearing it", async () => {
		const groceries = await create({ name: "Courses" });
		const food = await create({ name: "Alimentation" });
		await temp.db.insert(recurringTransactions).values({
			id: "series",
			labelKey: "marche",
			label: "Marché",
			amount: -2000,
			currency: "EUR",
			expectedDayOfMonth: 5,
			lastOccurrenceDate: "2026-09-05",
			nextExpectedDate: "2026-10-05",
			occurrenceCount: 3,
			categoryId: groceries.id,
			createdAt: 0,
			updatedAt: 0,
		});

		await mergeCategories(deps(), food.id, [groceries.id]);

		const [series] = await temp.db
			.select({ categoryId: recurringTransactions.categoryId })
			.from(recurringTransactions);
		expect(series).toEqual({ categoryId: food.id });
		await temp.db.delete(recurringTransactions);
	});

	it("moves the sources' children under the target, with its colour", async () => {
		const housing = await create({ name: "Logement", color: "#e99537" });
		const rent = await create({ name: "Loyer", parentId: housing.id });
		const income = await create({ name: "Revenus", color: "#6ad28a" });

		await mergeCategories(deps(), income.id, [housing.id]);

		await expect(stored(rent.id)).resolves.toMatchObject({
			parentId: income.id,
			color: "#6ad28a",
		});
	});

	it("merges a child into its own parent, and a parent with its child into another", async () => {
		const income = await create({ name: "Revenus" });
		const salary = await create({ name: "Salaire", parentId: income.id });
		const housing = await create({ name: "Logement" });
		const rent = await create({ name: "Loyer", parentId: housing.id });
		const home = await create({ name: "Maison" });
		await budgetMonth("2026-05", { [salary.id]: 100, [income.id]: 200 });

		await expect(mergeCategories(deps(), income.id, [salary.id])).resolves.toMatchObject({
			id: income.id,
		});
		await expect(mergeCategories(deps(), home.id, [housing.id, rent.id])).resolves.toMatchObject({
			id: home.id,
		});

		await expect(budgetLines()).resolves.toEqual([
			{ month: "2026-05", categoryId: income.id, amount: 300 },
		]);
		await expect(stored(rent.id)).resolves.toBeUndefined();
	});

	it("merges categories without children into another's child", async () => {
		const housing = await create({ name: "Logement" });
		const rent = await create({ name: "Loyer", parentId: housing.id });
		const deposit = await create({ name: "Caution" });

		await expect(mergeCategories(deps(), rent.id, [deposit.id])).resolves.toMatchObject({
			id: rent.id,
		});
	});

	it.each([
		["into its own child", "child", "targetId", "parent_child"],
		["into another's child, while it has children", "otherChild", "targetId", "invalid_parent"],
		["into itself", "self", "sourceIds", "same_category"],
		["into an unknown category", "unknown", "targetId", "invalid_value"],
		["with an unknown source", "unknownSource", "sourceIds", "invalid_value"],
	])("refuses to merge a parent %s, writing nothing", async (_label, which, path, code) => {
		const housing = await create({ name: "Logement" });
		const rent = await create({ name: "Loyer", parentId: housing.id });
		const income = await create({ name: "Revenus" });
		const salary = await create({ name: "Salaire", parentId: income.id });
		const ids = await transactionsIn(housing.id, 1);
		await budgetMonth("2026-05", { [housing.id]: 100 });
		const targetId =
			{ child: rent.id, otherChild: salary.id, self: housing.id, unknown: "nope" }[which] ??
			income.id;
		const sourceIds = which === "unknownSource" ? [housing.id, "nope"] : [housing.id];

		await expect(mergeCategories(deps(), targetId, sourceIds)).rejects.toMatchObject(
			fieldError(path, code),
		);
		await expect(categoriesOf(ids)).resolves.toEqual([housing.id]);
		await expect(stored(rent.id)).resolves.toMatchObject({ parentId: housing.id });
		await expect(budgetedCategories()).resolves.toEqual([housing.id]);
	});
});

describe("deleteAllCategories", () => {
	it("deletes every category, children included, leaving transactions uncategorised and no budget line", async () => {
		const housing = await create({ name: "Logement" });
		const rent = await create({ name: "Loyer", parentId: housing.id });
		await create({ name: "Loisirs" });
		const ids = [...(await transactionsIn(rent.id, 1)), ...(await transactionsIn(housing.id, 1))];
		await budgetMonth("2026-05", { [housing.id]: 100, [rent.id]: 50 });

		await expect(deleteAllCategories(deps())).resolves.toEqual({ deleted: 3 });

		await expect(listCategories(deps())).resolves.toEqual([]);
		await expect(categoriesOf(ids)).resolves.toEqual([null, null]);
		await expect(originsOf(ids)).resolves.toEqual([
			{ origin: null, locked: ["category"] },
			{ origin: null, locked: ["category"] },
		]);
		await expect(budgetLines()).resolves.toEqual([]);
	});
});

describe("bootstrapCategories", () => {
	it("creates every default on an empty list", async () => {
		await expect(bootstrapCategories(deps())).resolves.toEqual({ created: 22 });

		const list = await listCategories(deps());
		expect(list.map((category) => category.name).toSorted()).toEqual(
			DEFAULT_CATEGORIES.map((category) => category.name).toSorted(),
		);
		expect(list.find((category) => category.name === "Logement")).toMatchObject({
			color: "#b45309",
			icon: "home",
			parentId: null,
		});
	});

	it("creates only the defaults no category holds by name, case aside, and changes none", async () => {
		const income = await create({ name: "revenus", color: "#e99537", icon: "coins" });
		const housing = await create({ name: "Maison" });
		const rent = await create({ name: "Logement", parentId: housing.id });

		await expect(bootstrapCategories(deps())).resolves.toEqual({ created: 20 });
		await expect(bootstrapCategories(deps())).resolves.toEqual({ created: 0 });

		await expect(stored(income.id)).resolves.toMatchObject({
			name: "revenus",
			color: "#e99537",
			icon: "coins",
		});
		await expect(stored(rent.id)).resolves.toMatchObject({ parentId: housing.id });
		await expect(listCategories(deps())).resolves.toHaveLength(23);
	});
});

describe("withChildren", () => {
	it("adds every parent's children, once each, and keeps unknown ids", async () => {
		const housing = await create({ name: "Logement" });
		const rent = await create({ name: "Loyer", parentId: housing.id });
		const energy = await create({ name: "Énergie", parentId: housing.id });
		const leisure = await create({ name: "Loisirs" });
		await create({ name: "Cinéma", parentId: leisure.id });

		const expanded = await withChildren(deps(), [housing.id, rent.id, "nope"]);

		expect(expanded.toSorted()).toEqual([housing.id, rent.id, energy.id, "nope"].toSorted());
		await expect(withChildren(deps(), [])).resolves.toEqual([]);
	});
});
