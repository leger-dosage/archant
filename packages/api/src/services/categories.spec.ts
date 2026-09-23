import type { CreateCategoryRequest } from "../schemas/categories.ts";
import type { TempDatabase } from "../testing/temp-database.ts";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { categories } from "@archant/data/schema/categories";

import { createTempDatabase } from "../testing/temp-database.ts";
import {
	createCategory,
	deleteCategory,
	listCategories,
	mergeCategory,
	updateCategory,
} from "./categories.ts";
import { createAccount, ingest } from "./ledger.ts";
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
	await temp.db.run(sql`update transactions set category_id = null`);
	await temp.db.update(categories).set({ parentId: null });
	await temp.db.delete(categories);
});

const input = (overrides: Partial<CreateCategoryRequest> = {}): CreateCategoryRequest => ({
	name: "Courses",
	kind: "expense",
	color: "#e99537",
	icon: "shopping-bag",
	parentId: null,
	...overrides,
});

const create = (overrides: Partial<CreateCategoryRequest> = {}) =>
	createCategory(deps(), input(overrides));

/** `count` new transactions in `categoryId`, written as Story 4.2 will. */
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

// Raw SQL: only the ledger imports the transactions table (AD-2), and until
// Story 4.2 no ledger function sets one transaction's category.
async function setCategory(entryIds: string[], categoryId: string | null) {
	await temp.db.run(
		sql`update transactions set category_id = ${categoryId} where entry_id in (${sql.join(
			entryIds.map((id) => sql`${id}`),
			sql`, `,
		)})`,
	);
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
			kind: "expense",
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

			expect(list).toHaveLength(15);
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
			kind: "expense",
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

	it("gives a child its parent's kind and colour, whatever it asked for", async () => {
		const income = await create({ name: "Revenus", kind: "income", color: "#6ad28a" });

		const child = await create({
			name: "Salaire",
			kind: "expense",
			color: "#db5a54",
			parentId: income.id,
		});

		expect(child).toMatchObject({ kind: "income", color: "#6ad28a", parentId: income.id });
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

	it("moves under a parent and takes its kind and colour", async () => {
		const income = await create({ name: "Revenus", kind: "income", color: "#6ad28a" });
		const bonus = await create({ name: "Prime", color: "#db5a54" });

		await expect(updateCategory(deps(), bonus.id, { parentId: income.id })).resolves.toMatchObject({
			parentId: income.id,
			kind: "income",
			color: "#6ad28a",
		});
	});

	it("keeps a child on its parent's colour when the patch asks for another", async () => {
		const housing = await create({ name: "Logement", color: "#e99537" });
		const rent = await create({ name: "Loyer", parentId: housing.id });

		await expect(
			updateCategory(deps(), rent.id, { color: "#db5a54", kind: "income" }),
		).resolves.toMatchObject({ color: "#e99537", kind: "expense" });
	});

	it("passes a parent's new kind and colour on to its children", async () => {
		const housing = await create({ name: "Logement" });
		const rent = await create({ name: "Loyer", parentId: housing.id });
		const unrelated = await create({ name: "Loisirs", color: "#c44fe9" });

		await updateCategory(deps(), housing.id, { kind: "income", color: "#61c9ea" });

		await expect(stored(rent.id)).resolves.toMatchObject({ kind: "income", color: "#61c9ea" });
		await expect(stored(unrelated.id)).resolves.toMatchObject({
			kind: "expense",
			color: "#c44fe9",
		});
	});

	it("becomes top-level again, keeping the kind and colour it had", async () => {
		const income = await create({ name: "Revenus", kind: "income", color: "#6ad28a" });
		const salary = await create({ name: "Salaire", parentId: income.id });

		await expect(updateCategory(deps(), salary.id, { parentId: null })).resolves.toMatchObject({
			parentId: null,
			kind: "income",
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
	});

	it("makes the children top-level, keeping their kind and colour", async () => {
		const income = await create({ name: "Revenus", kind: "income", color: "#6ad28a" });
		const salary = await create({ name: "Salaire", parentId: income.id });
		const bonus = await create({ name: "Prime", parentId: income.id });

		await deleteCategory(deps(), income.id, undefined);

		await expect(Promise.all([stored(salary.id), stored(bonus.id)])).resolves.toEqual([
			expect.objectContaining({ parentId: null, kind: "income", color: "#6ad28a" }),
			expect.objectContaining({ parentId: null, kind: "income", color: "#6ad28a" }),
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

describe("mergeCategory", () => {
	it("moves the transactions to the target, deletes the source and returns the target", async () => {
		const groceries = await create({ name: "Courses" });
		const food = await create({ name: "Alimentation" });
		const moved = await transactionsIn(groceries.id, 2);
		const kept = await transactionsIn(food.id, 1);

		await expect(mergeCategory(deps(), groceries.id, food.id)).resolves.toMatchObject({
			id: food.id,
			transactionCount: 3,
		});

		await expect(categoriesOf([...moved, ...kept])).resolves.toEqual([food.id, food.id, food.id]);
		await expect(stored(groceries.id)).resolves.toBeUndefined();
	});

	it("moves the source's children under the target, with its kind and colour", async () => {
		const housing = await create({ name: "Logement", color: "#e99537" });
		const rent = await create({ name: "Loyer", parentId: housing.id });
		const income = await create({ name: "Revenus", kind: "income", color: "#6ad28a" });

		await mergeCategory(deps(), housing.id, income.id);

		await expect(stored(rent.id)).resolves.toMatchObject({
			parentId: income.id,
			kind: "income",
			color: "#6ad28a",
		});
	});

	it("merges across kinds, and a child into its own parent", async () => {
		const income = await create({ name: "Revenus", kind: "income" });
		const salary = await create({ name: "Salaire", parentId: income.id });
		const leisure = await create({ name: "Loisirs", kind: "expense" });

		await expect(mergeCategory(deps(), salary.id, income.id)).resolves.toMatchObject({
			id: income.id,
		});
		await expect(mergeCategory(deps(), leisure.id, income.id)).resolves.toMatchObject({
			kind: "income",
		});
	});

	it("merges a category without children into another's child", async () => {
		const housing = await create({ name: "Logement" });
		const rent = await create({ name: "Loyer", parentId: housing.id });
		const deposit = await create({ name: "Caution" });

		await expect(mergeCategory(deps(), deposit.id, rent.id)).resolves.toMatchObject({
			id: rent.id,
		});
	});

	it.each([
		["its own child", "child"],
		["another's child, while it has children", "otherChild"],
		["itself", "self"],
		["an unknown category", "unknown"],
	])("refuses to merge into %s", async (_label, which) => {
		const housing = await create({ name: "Logement" });
		const rent = await create({ name: "Loyer", parentId: housing.id });
		const income = await create({ name: "Revenus" });
		const salary = await create({ name: "Salaire", parentId: income.id });
		const ids = await transactionsIn(housing.id, 1);
		const targetId =
			{ child: rent.id, otherChild: salary.id, self: housing.id, unknown: "nope" }[which] ?? "";

		await expect(mergeCategory(deps(), housing.id, targetId)).rejects.toMatchObject(
			fieldError("targetId", "invalid_value"),
		);
		await expect(categoriesOf(ids)).resolves.toEqual([housing.id]);
		await expect(stored(rent.id)).resolves.toMatchObject({ parentId: housing.id });
	});

	it("answers NOT_FOUND for an unknown source", async () => {
		const target = await create();

		await expect(mergeCategory(deps(), "nope", target.id)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});
