import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { balances } from "@archant/data/schema/balances";
import { categories } from "@archant/data/schema/categories";
import { entries } from "@archant/data/schema/entries";
import { tags } from "@archant/data/schema/tags";
import { transactions } from "@archant/data/schema/transactions";

import * as forward from "../../domain/balances/forward.ts";
import { MAX_TAGS_PER_TRANSACTION } from "../../schemas/transactions.ts";
import {
	add,
	asUser,
	cafe,
	categoryOf,
	categoryOriginOf,
	checking,
	deps,
	excludedOf,
	history,
	importStatement,
	keysOf,
	lockedFields,
	merchantOf,
	newCategory,
	newMerchant,
	newTag,
	openChecking,
	setToday,
	statementOf,
	tagsOf,
	temp,
	transactionCount,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { createTempDatabase } from "../../testing/temp-database.ts";
import { createAccount } from "./accounts.ts";
import { balanceOn } from "./balances.ts";
import {
	bulkDeleteTransactions,
	bulkUpdateTransactions,
	countByCategory,
	countByMerchant,
	countByTag,
	deleteTransaction,
	moveMerchant,
	recategorise,
	removeTag,
	updateTransaction,
} from "./edits.ts";
import { findTransaction } from "./queries.ts";

useLedgerDatabase();

describe("updateTransaction", () => {
	it("moves and changes a transaction, recomputing from the earlier date and locking both fields", async () => {
		const account = await openChecking();
		const id = await add(account.id, {}, "sync");

		await expect(
			updateTransaction(
				deps(),
				id,
				{ date: "2026-09-05", amount: toMinorUnits(-5000), label: "Boulangerie" },
				{ origin: "user" },
			),
		).resolves.toEqual({ status: "updated" });

		const days = await history(account.id);
		expect(days.get("2026-09-04")).toBe(123456);
		expect(days.get("2026-09-05")).toBe(118456);
		expect(days.get("2026-09-10")).toBe(118456);
		expect(days.get("2026-09-21")).toBe(118456);
		await expect(lockedFields(id)).resolves.toEqual(["date", "amount"]);
	});

	it("moves a transaction later and restores the days it left", async () => {
		const account = await openChecking();
		const id = await add(account.id, { date: "2026-09-05" });

		await updateTransaction(deps(), id, { date: "2026-09-10" }, { origin: "user" });

		const days = await history(account.id);
		expect(days.get("2026-09-05")).toBe(123456);
		expect(days.get("2026-09-09")).toBe(123456);
		expect(days.get("2026-09-10")).toBe(119166);
	});

	it("adds changed fields to those already locked, once each", async () => {
		const account = await openChecking();
		const id = await add(account.id);

		await updateTransaction(
			deps(),
			id,
			{ label: "Boulangerie Dupont", notes: "Pain" },
			{ origin: "user" },
		);

		await expect(lockedFields(id)).resolves.toEqual(["date", "amount", "label", "notes"]);
		await expect(findTransaction(deps(), id)).resolves.toMatchObject({
			label: "Boulangerie Dupont",
			notes: "Pain",
		});
	});

	it("never overwrites a locked field for another origin, nor locks what it changes", async () => {
		const account = await openChecking();
		const id = await add(account.id);

		await updateTransaction(
			deps(),
			id,
			{ label: "RULE LABEL", notes: "Catégorisé" },
			{ origin: "rule" },
		);

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({
			label: "Boulangerie",
			notes: "Catégorisé",
		});
		await expect(lockedFields(id)).resolves.toEqual(["date", "amount", "label"]);
	});

	it("writes nothing when no field changes", async () => {
		const account = await openChecking();
		const id = await add(account.id);
		const before = await temp.db.select().from(entries).where(eq(entries.id, id)).get();
		setToday("2026-09-21T11:00:00Z");

		await expect(
			updateTransaction(deps(), id, { amount: toMinorUnits(-4290) }, { origin: "user" }),
		).resolves.toEqual({ status: "updated" });

		await expect(temp.db.select().from(entries).where(eq(entries.id, id)).get()).resolves.toEqual(
			before,
		);
	});

	it("rejects a date on the opening day and changes nothing", async () => {
		const account = await openChecking();
		const id = await add(account.id);

		await expect(
			updateTransaction(deps(), id, { date: "2026-09-01" }, { origin: "user" }),
		).resolves.toEqual({ status: "rejected", reason: "BEFORE_OPENING_DATE" });

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ date: "2026-09-10" });
	});

	it("drops the rows past the new end when the latest transaction moves back", async () => {
		const account = await openChecking();
		const id = await add(account.id, { date: "2026-12-31" });

		await updateTransaction(deps(), id, { date: "2026-09-15" }, { origin: "user" });

		const days = await history(account.id);
		expect([...days.keys()].at(-1)).toBe("2026-09-21");
		expect(days.get("2026-09-15")).toBe(119166);
	});

	it("excludes a transaction from reports, locks the flag and leaves the balance alone", async () => {
		const account = await openChecking();
		const id = await add(account.id);
		const before = await history(account.id);

		await expect(
			updateTransaction(deps(), id, { excluded: true }, { origin: "user" }),
		).resolves.toEqual({ status: "updated" });

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ excluded: true });
		await expect(lockedFields(id)).resolves.toEqual(["date", "amount", "label", "excluded"]);
		await expect(history(account.id)).resolves.toEqual(before);
	});

	it("never clears a locked exclusion for another origin", async () => {
		const account = await openChecking();
		const id = await add(account.id);
		await updateTransaction(deps(), id, { excluded: true }, { origin: "user" });

		await updateTransaction(deps(), id, { excluded: false }, { origin: "rule" });

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ excluded: true });
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		await expect(
			updateTransaction(deps(), "nope", { label: "x" }, { origin: "user" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("sets a category by hand, recording the user and locking it, without touching balances", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const id = await add(account.id, {}, "sync");
		const entry = await temp.db.select().from(entries).where(eq(entries.id, id)).get();
		const recompute = vi.spyOn(forward, "forwardBalances");
		setToday("2026-09-21T11:00:00Z");

		await expect(
			updateTransaction(deps(), id, { categoryId: groceries }, { origin: "user" }),
		).resolves.toEqual({ status: "updated" });

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ categoryId: groceries });
		await expect(categoryOriginOf(id)).resolves.toBe("user");
		await expect(lockedFields(id)).resolves.toEqual(["category"]);
		await expect(temp.db.select().from(entries).where(eq(entries.id, id)).get()).resolves.toEqual(
			entry,
		);
		expect(recompute).not.toHaveBeenCalled();
	});

	it("clears a category by hand, locking it too", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { categoryId: groceries }, { origin: "rule" });

		await updateTransaction(deps(), id, { categoryId: null }, { origin: "user" });

		await expect(categoryOf(id)).resolves.toBeNull();
		await expect(categoryOriginOf(id)).resolves.toBeNull();
		await expect(lockedFields(id)).resolves.toEqual(["category"]);
	});

	it("records a rule's category without locking it, and a provider's for a sync", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const byRule = await add(account.id, {}, "sync");
		const bySync = await add(account.id, {}, "sync");

		await updateTransaction(deps(), byRule, { categoryId: groceries }, { origin: "rule" });
		await updateTransaction(deps(), bySync, { categoryId: groceries }, { origin: "sync" });

		await expect(categoryOriginOf(byRule)).resolves.toBe("rule");
		await expect(lockedFields(byRule)).resolves.toEqual([]);
		await expect(categoryOriginOf(bySync)).resolves.toBe("provider");
	});

	it("never changes a locked category for another origin", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const leisure = await newCategory("Loisirs");
		const set = await add(account.id, {}, "sync");
		const cleared = await add(account.id, {}, "sync");
		await updateTransaction(deps(), set, { categoryId: groceries }, { origin: "user" });
		await updateTransaction(deps(), cleared, { categoryId: null }, { origin: "user" });
		// Clearing an empty category changes nothing, so nothing is locked yet.
		await updateTransaction(deps(), cleared, { categoryId: groceries }, { origin: "user" });
		await updateTransaction(deps(), cleared, { categoryId: null }, { origin: "user" });

		await updateTransaction(deps(), set, { categoryId: leisure }, { origin: "rule" });
		await updateTransaction(deps(), cleared, { categoryId: leisure }, { origin: "rule" });

		await expect(categoryOf(set)).resolves.toBe(groceries);
		await expect(categoryOriginOf(set)).resolves.toBe("user");
		await expect(categoryOf(cleared)).resolves.toBeNull();
	});

	it("refuses to set or clear one transaction's category for maintenance", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { categoryId: groceries }, { origin: "rule" });

		await expect(
			updateTransaction(deps(), id, { categoryId: null }, { origin: "maintenance" }),
		).rejects.toThrow(/maintenance/u);

		await expect(categoryOf(id)).resolves.toBe(groceries);
		await expect(categoryOriginOf(id)).resolves.toBe("rule");
	});

	it("refuses an unknown category and writes nothing", async () => {
		const account = await openChecking();
		const id = await add(account.id, {}, "sync");

		await expect(
			updateTransaction(deps(), id, { categoryId: "nope", label: "Autre" }, { origin: "user" }),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "categoryId", code: "invalid_value" }],
		});

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({
			label: "Boulangerie",
			categoryId: null,
		});
		await expect(lockedFields(id)).resolves.toEqual([]);
	});

	it("sets a merchant by hand, locking it, without touching the entry or balances", async () => {
		const account = await openChecking();
		const carrefour = await newMerchant("Carrefour");
		const id = await add(account.id, {}, "sync");
		const entry = await temp.db.select().from(entries).where(eq(entries.id, id)).get();
		const recompute = vi.spyOn(forward, "forwardBalances");
		setToday("2026-09-21T11:00:00Z");

		await expect(
			updateTransaction(deps(), id, { merchantId: carrefour }, { origin: "user" }),
		).resolves.toEqual({ status: "updated" });

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ merchantId: carrefour });
		await expect(lockedFields(id)).resolves.toEqual(["merchant"]);
		await expect(temp.db.select().from(entries).where(eq(entries.id, id)).get()).resolves.toEqual(
			entry,
		);
		expect(recompute).not.toHaveBeenCalled();
	});

	it("sets a category and a merchant together without recomputing balances", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const carrefour = await newMerchant("Carrefour");
		const id = await add(account.id, {}, "sync");
		const recompute = vi.spyOn(forward, "forwardBalances");

		await updateTransaction(
			deps(),
			id,
			{ categoryId: groceries, merchantId: carrefour },
			{ origin: "user" },
		);

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({
			categoryId: groceries,
			merchantId: carrefour,
		});
		await expect(lockedFields(id)).resolves.toEqual(["category", "merchant"]);
		expect(recompute).not.toHaveBeenCalled();
	});

	it("clears a merchant by hand, locking it too", async () => {
		const account = await openChecking();
		const carrefour = await newMerchant("Carrefour");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { merchantId: carrefour }, { origin: "rule" });
		await expect(lockedFields(id)).resolves.toEqual([]);

		await updateTransaction(deps(), id, { merchantId: null }, { origin: "user" });

		await expect(merchantOf(id)).resolves.toBeNull();
		await expect(lockedFields(id)).resolves.toEqual(["merchant"]);
	});

	it("never changes a locked merchant for another origin", async () => {
		const account = await openChecking();
		const carrefour = await newMerchant("Carrefour");
		const lidl = await newMerchant("Lidl");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { merchantId: carrefour }, { origin: "user" });

		await updateTransaction(deps(), id, { merchantId: lidl }, { origin: "rule" });
		await updateTransaction(deps(), id, { merchantId: null }, { origin: "provider" });

		await expect(merchantOf(id)).resolves.toBe(carrefour);
	});

	it("refuses an unknown merchant and writes nothing", async () => {
		const account = await openChecking();
		const id = await add(account.id, {}, "sync");

		await expect(
			updateTransaction(deps(), id, { merchantId: "nope", label: "Autre" }, { origin: "user" }),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "merchantId", code: "invalid_value" }],
		});

		await expect(findTransaction(deps(), id)).resolves.toMatchObject({
			label: "Boulangerie",
			merchantId: null,
		});
		await expect(lockedFields(id)).resolves.toEqual([]);
	});
	it("sets tags by hand, locking them, without touching the entry or balances", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const work = await newTag("Travaux");
		const id = await add(account.id, {}, "sync");
		const entry = await temp.db.select().from(entries).where(eq(entries.id, id)).get();
		const recompute = vi.spyOn(forward, "forwardBalances");

		await expect(
			updateTransaction(deps(), id, { tagIds: [holidays, work, holidays] }, { origin: "user" }),
		).resolves.toEqual({ status: "updated" });

		await expect(tagsOf(id)).resolves.toEqual([holidays, work].toSorted());
		await expect(findTransaction(deps(), id)).resolves.toMatchObject({
			tagIds: [holidays, work].toSorted(),
		});
		await expect(lockedFields(id)).resolves.toEqual(["tags"]);
		await expect(temp.db.select().from(entries).where(eq(entries.id, id)).get()).resolves.toEqual(
			entry,
		);
		expect(recompute).not.toHaveBeenCalled();
	});

	it("replaces the whole set of tags", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const work = await newTag("Travaux");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { tagIds: [holidays] }, { origin: "user" });

		await updateTransaction(deps(), id, { tagIds: [work] }, { origin: "user" });

		await expect(tagsOf(id)).resolves.toEqual([work]);
	});

	it("clears the tags by hand, locking them", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { tagIds: [holidays] }, { origin: "rule" });
		await expect(lockedFields(id)).resolves.toEqual([]);

		await updateTransaction(deps(), id, { tagIds: [] }, { origin: "user" });

		await expect(tagsOf(id)).resolves.toEqual([]);
		await expect(lockedFields(id)).resolves.toEqual(["tags"]);
	});

	it("treats the same tags in another order as no change", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const work = await newTag("Travaux");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { tagIds: [holidays, work] }, { origin: "rule" });

		await updateTransaction(deps(), id, { tagIds: [work, holidays] }, { origin: "user" });

		await expect(lockedFields(id)).resolves.toEqual([]);
	});

	it("never changes locked tags for another origin", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const work = await newTag("Travaux");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { tagIds: [holidays] }, { origin: "user" });

		await updateTransaction(deps(), id, { tagIds: [work] }, { origin: "rule" });
		await updateTransaction(deps(), id, { tagIds: [] }, { origin: "provider" });

		await expect(tagsOf(id)).resolves.toEqual([holidays]);
	});

	it("refuses an unknown tag and writes nothing", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const id = await add(account.id, {}, "sync");

		await expect(
			updateTransaction(
				deps(),
				id,
				{ tagIds: [holidays, "nope"], label: "Autre" },
				{ origin: "user" },
			),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "tagIds", code: "invalid_value" }],
		});

		await expect(tagsOf(id)).resolves.toEqual([]);
		await expect(findTransaction(deps(), id)).resolves.toMatchObject({ label: "Boulangerie" });
		await expect(lockedFields(id)).resolves.toEqual([]);
	});
});

describe("deleteTransaction", () => {
	it("removes the transaction and puts the balance back", async () => {
		const account = await openChecking();
		const id = await add(account.id);

		await deleteTransaction(deps(), id, { origin: "user" });

		await expect(findTransaction(deps(), id)).resolves.toBeNull();
		await expect(temp.db.select().from(entries).where(eq(entries.id, id))).resolves.toEqual([]);
		const days = await history(account.id);
		expect(new Set(days.values())).toEqual(new Set([123456]));
		expect(days.size).toBe(21);
	});

	it("keeps the later transactions deducted after deleting an earlier one", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-09-15", amount: toMinorUnits(-1000) });
		const earlier = await add(account.id, { date: "2026-09-05", amount: toMinorUnits(-4290) });

		await deleteTransaction(deps(), earlier, { origin: "user" });

		const days = await history(account.id);
		expect(days.get("2026-09-05")).toBe(123456);
		expect(days.get("2026-09-15")).toBe(122456);
		expect(days.get("2026-09-21")).toBe(122456);
	});

	it("deletes the rows past the new end after removing the latest entry", async () => {
		const account = await openChecking();
		await add(account.id, { date: "2026-10-15" });
		const future = await add(account.id, { date: "2026-12-31" });

		await deleteTransaction(deps(), future, { origin: "user" });

		const past = await temp.db
			.select()
			.from(balances)
			.where(and(eq(balances.accountId, account.id), gt(balances.date, "2026-10-15")));
		expect(past).toEqual([]);
		await expect(balanceOn(deps(), account.id, "2026-10-15")).resolves.toMatchObject({
			amount: 119166,
		});
	});

	it("deletes a tagged transaction with its taggings, keeping the tag", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const id = await add(account.id);
		await updateTransaction(deps(), id, { tagIds: [holidays] }, { origin: "user" });

		await deleteTransaction(deps(), id, { origin: "user" });

		await expect(findTransaction(deps(), id)).resolves.toBeNull();
		await expect(tagsOf(id)).resolves.toEqual([]);
		await expect(temp.db.select().from(tags).where(eq(tags.id, holidays))).resolves.toHaveLength(1);
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		await expect(deleteTransaction(deps(), "nope", { origin: "user" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("recategorise", () => {
	it("moves every transaction of a category to another, and only those", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const food = await newCategory("Alimentation");
		const other = await newCategory("Loisirs");
		// One after the other: each is an `immediate` ledger transaction.
		const ids = [
			await add(account.id, { label: "Marché" }),
			await add(account.id, { label: "Épicerie" }),
			await add(account.id, { label: "Primeur" }),
		];
		const untouched = await add(account.id, { label: "Cinéma" });
		await temp.db
			.update(transactions)
			.set({ categoryId: groceries, categoryOrigin: "rule" })
			.where(inArray(transactions.entryId, ids));
		await temp.db
			.update(transactions)
			.set({ categoryId: other, categoryOrigin: "rule" })
			.where(eq(transactions.entryId, untouched));
		const days = await history(account.id);

		await expect(recategorise(deps(), groceries, food, { origin: "maintenance" })).resolves.toBe(3);

		await expect(Promise.all(ids.map(categoryOf))).resolves.toEqual([food, food, food]);
		await expect(categoryOf(untouched)).resolves.toBe(other);
		await expect(Promise.all(ids.map(categoryOriginOf))).resolves.toEqual(["rule", "rule", "rule"]);
		await expect(history(account.id)).resolves.toEqual(days);
	});

	it("keeps a category set by hand locked and the user's when it merges", async () => {
		const account = await openChecking();
		const source = await newCategory("Supermarché");
		const target = await newCategory("Courses");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { categoryId: source }, { origin: "user" });

		await recategorise(deps(), source, target, { origin: "maintenance" });

		await expect(categoryOf(id)).resolves.toBe(target);
		await expect(categoryOriginOf(id)).resolves.toBe("user");
		await expect(lockedFields(id)).resolves.toEqual(["category"]);
	});

	it("leaves the transactions uncategorised with null, dropping the origin and keeping the locks", async () => {
		const account = await openChecking();
		const category = await newCategory("Cadeaux");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(
			deps(),
			id,
			{ label: "Fleuriste", categoryId: category },
			{ origin: "user" },
		);

		await expect(recategorise(deps(), category, null, { origin: "maintenance" })).resolves.toBe(1);

		await expect(categoryOf(id)).resolves.toBeNull();
		await expect(categoryOriginOf(id)).resolves.toBeNull();
		await expect(lockedFields(id)).resolves.toEqual(["label", "category"]);
	});

	it("moves nothing from a category no transaction uses", async () => {
		const empty = await newCategory("Vide");
		const target = await newCategory("Cible");

		await expect(recategorise(deps(), empty, target, { origin: "maintenance" })).resolves.toBe(0);
	});
});

describe("countByCategory", () => {
	it("counts each category's transactions, leaving out uncategorised ones and empty categories", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const leisure = await newCategory("Loisirs");
		const empty = await newCategory("Vide");
		const first = await add(account.id, { label: "Marché" });
		const second = await add(account.id, { label: "Épicerie" });
		const third = await add(account.id, { label: "Cinéma" });
		await add(account.id, { label: "Sans catégorie" });
		await temp.db
			.update(transactions)
			.set({ categoryId: groceries, categoryOrigin: "rule" })
			.where(inArray(transactions.entryId, [first, second]));
		await temp.db
			.update(transactions)
			.set({ categoryId: leisure, categoryOrigin: "rule" })
			.where(eq(transactions.entryId, third));

		const perCategory = await countByCategory(deps());

		expect(perCategory.get(groceries)).toBe(2);
		expect(perCategory.get(leisure)).toBe(1);
		expect(perCategory.has(empty)).toBe(false);
		expect([...perCategory.keys()]).not.toContain(null);
	});
});

describe("moveMerchant", () => {
	it("moves every transaction of a merchant to another, keeping locks and balances", async () => {
		const account = await openChecking();
		const source = await newMerchant("CB Carrefour");
		const target = await newMerchant("Carrefour");
		const other = await newMerchant("Lidl");
		const locked = await add(account.id, { label: "CB CARREFOUR 1234" }, "sync");
		const market = await add(account.id, { label: "CARREFOUR MARKET" }, "sync");
		const city = await add(account.id, { label: "CARREFOUR CITY" }, "sync");
		const untouched = await add(account.id, { label: "LIDL" }, "sync");
		await updateTransaction(deps(), locked, { merchantId: source }, { origin: "user" });
		await updateTransaction(deps(), market, { merchantId: source }, { origin: "rule" });
		await updateTransaction(deps(), city, { merchantId: source }, { origin: "rule" });
		await updateTransaction(deps(), untouched, { merchantId: other }, { origin: "rule" });
		const days = await history(account.id);

		await expect(moveMerchant(deps(), source, target, { origin: "maintenance" })).resolves.toBe(3);

		const ids = [locked, market, city];
		await expect(Promise.all(ids.map(merchantOf))).resolves.toEqual([target, target, target]);
		await expect(merchantOf(untouched)).resolves.toBe(other);
		await expect(Promise.all(ids.map(lockedFields))).resolves.toEqual([["merchant"], [], []]);
		await expect(history(account.id)).resolves.toEqual(days);
	});

	it("unlinks the transactions with null, keeping the locks", async () => {
		const account = await openChecking();
		const merchant = await newMerchant("Fleuriste");
		const first = await add(account.id, {}, "sync");
		const second = await add(account.id, {}, "sync");
		await updateTransaction(deps(), first, { merchantId: merchant }, { origin: "user" });
		await updateTransaction(deps(), second, { merchantId: merchant }, { origin: "rule" });

		await expect(moveMerchant(deps(), merchant, null, { origin: "maintenance" })).resolves.toBe(2);

		await expect(merchantOf(first)).resolves.toBeNull();
		await expect(merchantOf(second)).resolves.toBeNull();
		await expect(lockedFields(first)).resolves.toEqual(["merchant"]);
	});
});

describe("countByMerchant", () => {
	it("counts each merchant's transactions, leaving out unlinked ones and empty merchants", async () => {
		const account = await openChecking();
		const carrefour = await newMerchant("Carrefour");
		const empty = await newMerchant("Vide");
		const first = await add(account.id, {}, "sync");
		const second = await add(account.id, {}, "sync");
		await add(account.id, {}, "sync");
		await updateTransaction(deps(), first, { merchantId: carrefour }, { origin: "rule" });
		await updateTransaction(deps(), second, { merchantId: carrefour }, { origin: "rule" });

		const perMerchant = await countByMerchant(deps());

		expect(perMerchant.get(carrefour)).toBe(2);
		expect(perMerchant.has(empty)).toBe(false);
		expect([...perMerchant.keys()]).not.toContain(null);
	});
});

describe("removeTag", () => {
	it("removes a tag from every transaction, keeping locks and balances", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const work = await newTag("Travaux");
		const first = await add(account.id, {}, "sync");
		const second = await add(account.id, {}, "sync");
		await updateTransaction(deps(), first, { tagIds: [holidays, work] }, { origin: "user" });
		await updateTransaction(deps(), second, { tagIds: [holidays] }, { origin: "rule" });
		const days = await history(account.id);

		await expect(removeTag(deps(), holidays, { origin: "maintenance" })).resolves.toBe(2);

		await expect(tagsOf(first)).resolves.toEqual([work]);
		await expect(tagsOf(second)).resolves.toEqual([]);
		await expect(lockedFields(first)).resolves.toEqual(["tags"]);
		await expect(lockedFields(second)).resolves.toEqual([]);
		await expect(history(account.id)).resolves.toEqual(days);
	});
});

describe("countByTag", () => {
	it("counts each tag's transactions, leaving out unused tags", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const empty = await newTag("Vide");
		const first = await add(account.id, {}, "sync");
		const second = await add(account.id, {}, "sync");
		await add(account.id, {}, "sync");
		await updateTransaction(deps(), first, { tagIds: [holidays] }, { origin: "rule" });
		await updateTransaction(deps(), second, { tagIds: [holidays] }, { origin: "rule" });

		const perTag = await countByTag(deps());

		expect(perTag.get(holidays)).toBe(2);
		expect(perTag.has(empty)).toBe(false);
	});
});

describe("bulkUpdateTransactions", () => {
	it("sets a category on the given rows, locking it, without touching the balances", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const ids = [
			await add(account.id, {}, "sync"),
			await add(account.id, {}, "sync"),
			await add(account.id, {}, "sync"),
		];
		const days = await history(account.id);
		const recompute = vi.spyOn(forward, "forwardBalances");

		await expect(
			bulkUpdateTransactions(deps(), { ids }, { categoryId: groceries }, asUser),
		).resolves.toEqual({ matched: 3, changed: 3 });

		await expect(Promise.all(ids.map(categoryOf))).resolves.toEqual([
			groceries,
			groceries,
			groceries,
		]);
		await expect(Promise.all(ids.map(categoryOriginOf))).resolves.toEqual(["user", "user", "user"]);
		await expect(Promise.all(ids.map(lockedFields))).resolves.toEqual([
			["category"],
			["category"],
			["category"],
		]);
		expect(recompute).not.toHaveBeenCalled();
		await expect(history(account.id)).resolves.toEqual(days);
	});

	it("clears a merchant, locking it", async () => {
		const account = await openChecking();
		const merchant = await newMerchant("Fleuriste");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { merchantId: merchant }, { origin: "rule" });

		await bulkUpdateTransactions(deps(), { ids: [id] }, { merchantId: null }, asUser);

		await expect(merchantOf(id)).resolves.toBeNull();
		await expect(lockedFields(id)).resolves.toEqual(["merchant"]);
	});

	it("adds tags to those a row carries, never removing one", async () => {
		const account = await openChecking();
		const holidays = await newTag("Vacances");
		const work = await newTag("Travaux");
		const tagged = await add(account.id, {}, "sync");
		const bare = await add(account.id, {}, "sync");
		await updateTransaction(deps(), tagged, { tagIds: [holidays] }, { origin: "rule" });

		await expect(
			bulkUpdateTransactions(deps(), { ids: [tagged, bare] }, { addTagIds: [work] }, asUser),
		).resolves.toEqual({ matched: 2, changed: 2 });

		await expect(tagsOf(tagged)).resolves.toEqual([holidays, work].toSorted());
		await expect(tagsOf(bare)).resolves.toEqual([work]);
		await expect(lockedFields(tagged)).resolves.toEqual(["tags"]);
	});

	it("writes nothing when a row would carry more tags than the cap", async () => {
		const account = await openChecking();
		const full = Array.from({ length: MAX_TAGS_PER_TRANSACTION }, () => crypto.randomUUID());
		await temp.db
			.insert(tags)
			.values(full.map((id) => ({ id, name: `Tag ${id}`, createdAt: 0, updatedAt: 0 })));
		const extra = await newTag("En trop");
		const bare = await add(account.id, {}, "sync");
		const crowded = await add(account.id, {}, "sync");
		await updateTransaction(deps(), crowded, { tagIds: full }, { origin: "rule" });

		await expect(
			bulkUpdateTransactions(deps(), { ids: [bare, crowded] }, { addTagIds: [extra] }, asUser),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "patch.addTagIds", code: "too_big" }],
		});

		await expect(tagsOf(bare)).resolves.toEqual([]);
		await expect(tagsOf(crowded)).resolves.toHaveLength(MAX_TAGS_PER_TRANSACTION);
		await expect(lockedFields(bare)).resolves.toEqual([]);
	});

	it("counts a row already on the category without locking it again", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const already = await add(account.id, {}, "sync");
		const moved = await add(account.id, {}, "sync");
		await updateTransaction(deps(), already, { categoryId: groceries }, { origin: "rule" });

		await expect(
			bulkUpdateTransactions(deps(), { ids: [already, moved] }, { categoryId: groceries }, asUser),
		).resolves.toEqual({ matched: 2, changed: 1 });

		await expect(lockedFields(already)).resolves.toEqual([]);
		await expect(categoryOriginOf(already)).resolves.toBe("rule");
		await expect(lockedFields(moved)).resolves.toEqual(["category"]);
	});

	it("updates every row a filter matches, whatever the page", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const other = await newCategory("Loisirs");
		const uncategorised = [
			await add(account.id, {}, "sync"),
			await add(account.id, {}, "sync"),
			await add(account.id, {}, "sync"),
		];
		const kept = await add(account.id, {}, "sync");
		await updateTransaction(deps(), kept, { categoryId: other }, { origin: "rule" });

		await expect(
			bulkUpdateTransactions(
				deps(),
				{ filter: { accountIds: [account.id], uncategorised: true } },
				{ categoryId: groceries },
				asUser,
			),
		).resolves.toEqual({ matched: 3, changed: 3 });

		await expect(Promise.all(uncategorised.map(categoryOf))).resolves.toEqual([
			groceries,
			groceries,
			groceries,
		]);
		await expect(categoryOf(kept)).resolves.toBe(other);
	});

	it("answers 0 when the filter matches nothing", async () => {
		const account = await openChecking();
		await add(account.id, {}, "sync");

		await expect(
			bulkUpdateTransactions(
				deps(),
				{ filter: { accountIds: [account.id], q: "introuvable" } },
				{ excluded: true },
				asUser,
			),
		).resolves.toEqual({ matched: 0, changed: 0 });
		await expect(
			bulkUpdateTransactions(deps(), { filter: { merchantIds: [] } }, { excluded: true }, asUser),
		).resolves.toEqual({ matched: 0, changed: 0 });
	});

	it("writes nothing when an id names no transaction", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const first = await add(account.id, {}, "sync");
		const second = await add(account.id, {}, "sync");

		await expect(
			bulkUpdateTransactions(
				deps(),
				{ ids: [first, second, "nope"] },
				{ categoryId: groceries },
				asUser,
			),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "ids", code: "invalid_value" }],
		});

		await expect(categoryOf(first)).resolves.toBeNull();
		await expect(categoryOf(second)).resolves.toBeNull();
	});

	it("reads a repeated id once", async () => {
		const account = await openChecking();
		const id = await add(account.id, {}, "sync");

		await expect(
			bulkUpdateTransactions(deps(), { ids: [id, id] }, { excluded: true }, asUser),
		).resolves.toEqual({ matched: 1, changed: 1 });
	});

	it.each([
		["patch.categoryId", { categoryId: "nope" }],
		["patch.merchantId", { merchantId: "nope" }],
		["patch.addTagIds", { addTagIds: ["nope"] }],
	])("writes nothing for an unknown reference, on %s", async (path, patch) => {
		const account = await openChecking();
		const id = await add(account.id, {}, "sync");

		await expect(
			bulkUpdateTransactions(deps(), { ids: [id] }, patch, asUser),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path, code: "invalid_value" }],
		});
		await expect(lockedFields(id)).resolves.toEqual([]);
	});

	it("excludes the rows, locking the field, without rewriting a balance", async () => {
		const account = await openChecking();
		const ids = [await add(account.id, {}, "sync"), await add(account.id, {}, "sync")];
		const days = await history(account.id);
		const recompute = vi.spyOn(forward, "forwardBalances");

		await bulkUpdateTransactions(deps(), { ids }, { excluded: true }, asUser);

		await expect(Promise.all(ids.map(excludedOf))).resolves.toEqual([true, true]);
		await expect(Promise.all(ids.map(lockedFields))).resolves.toEqual([["excluded"], ["excluded"]]);
		expect(recompute).not.toHaveBeenCalled();
		await expect(history(account.id)).resolves.toEqual(days);
	});

	it("keeps a locked field for any origin but the user's", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const leisure = await newCategory("Loisirs");
		const id = await add(account.id, {}, "sync");
		await updateTransaction(deps(), id, { categoryId: groceries }, asUser);

		await bulkUpdateTransactions(
			deps(),
			{ ids: [id] },
			{ categoryId: leisure },
			{ origin: "rule" },
		);

		await expect(categoryOf(id)).resolves.toBe(groceries);
	});

	it("writes nothing when a filter now selects another count than expected", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const ids = [await add(account.id, {}, "sync"), await add(account.id, {}, "sync")];

		await expect(
			bulkUpdateTransactions(
				deps(),
				{ filter: { accountIds: [account.id], uncategorised: true } },
				{ categoryId: groceries },
				{ ...asUser, expectedCount: 3 },
			),
		).rejects.toMatchObject({ code: "BULK_COUNT_STALE", params: { count: "2" } });

		await expect(Promise.all(ids.map(categoryOf))).resolves.toEqual([null, null]);
		await expect(Promise.all(ids.map(lockedFields))).resolves.toEqual([[], []]);
	});

	it("writes when the filter selects the count expected, unchanged rows counted apart", async () => {
		const account = await openChecking();
		const groceries = await newCategory("Courses");
		const already = await add(account.id, {}, "sync");
		const moved = await add(account.id, {}, "sync");
		await updateTransaction(deps(), already, { categoryId: groceries }, { origin: "rule" });

		await expect(
			bulkUpdateTransactions(
				deps(),
				{ filter: { accountIds: [account.id] } },
				{ categoryId: groceries },
				{ ...asUser, expectedCount: 2 },
			),
		).resolves.toEqual({ matched: 2, changed: 1 });

		await expect(categoryOf(moved)).resolves.toBe(groceries);
		await expect(lockedFields(already)).resolves.toEqual([]);
	});
});

describe("bulkUpdateTransactions on 5,000 rows", () => {
	it("categorises every row a filter matches in one transaction", async () => {
		const big = await createTempDatabase();

		try {
			const bigDeps = { db: big.db, timeZone: "Europe/Paris" };
			setToday("2026-09-21T10:00:00Z");
			const account = await createAccount(
				bigDeps,
				{ ...checking, openingDate: "2016-01-01" },
				{ origin: "user" },
			);
			const category = crypto.randomUUID();
			const tag = crypto.randomUUID();
			await big.db.insert(categories).values({
				id: category,
				name: "Courses",
				kind: "expense",
				color: "#e99537",
				icon: "tag",
				createdAt: 0,
				updatedAt: 0,
			});
			await big.db.insert(tags).values({ id: tag, name: "Vacances", createdAt: 0, updatedAt: 0 });
			const rows = Array.from({ length: 5000 }, (_, index) => ({
				id: crypto.randomUUID(),
				date: new Date(Date.UTC(2016, 0, 2) + (index % 3650) * 86_400_000)
					.toISOString()
					.slice(0, 10),
				index,
			}));
			// Seeded directly, in sequence, for the same reason as `history-volume.spec.ts`.
			await Array.from({ length: 5 }, (_, index) =>
				rows.slice(index * 1000, (index + 1) * 1000),
			).reduce(async (previous, chunk) => {
				await previous;
				await big.db.insert(entries).values(
					chunk.map((row) => ({
						id: row.id,
						accountId: account.id,
						kind: "transaction" as const,
						date: row.date,
						amount: -1,
						currency: "EUR",
						createdAt: row.index,
						updatedAt: row.index,
					})),
				);
				await big.db
					.insert(transactions)
					.values(chunk.map((row) => ({ entryId: row.id, label: `Opération ${row.index}` })));
			}, Promise.resolve());
			const transaction = vi.spyOn(big.db, "transaction");

			await expect(
				bulkUpdateTransactions(
					bigDeps,
					{ filter: { uncategorised: true } },
					{ categoryId: category, addTagIds: [tag] },
					asUser,
				),
			).resolves.toEqual({ matched: 5000, changed: 5000 });

			expect(transaction).toHaveBeenCalledTimes(1);
			await expect(
				big.db.all(
					sql`select count(*) as count from transactions where category_id = ${category} and locked_fields = '["category","tags"]'`,
				),
			).resolves.toEqual([{ count: 5000 }]);
			await expect(
				big.db.all(sql`select count(*) as count from taggings where tag_id = ${tag}`),
			).resolves.toEqual([{ count: 5000 }]);
		} finally {
			await big.dispose();
		}
	}, 60_000);
});

describe("bulkDeleteTransactions", () => {
	it("deletes rows over two accounts with their keys and taggings, recomputing each account once", async () => {
		const joint = await openChecking();
		const card = await openChecking({ name: "Carte" });
		const holidays = await newTag("Vacances");
		const { result } = await importStatement(joint.id, statementOf(cafe));
		const [imported = ""] = result.created;
		const early = await add(joint.id, { date: "2026-09-05", amount: toMinorUnits(-1000) });
		const kept = await add(joint.id, { date: "2026-09-15", amount: toMinorUnits(-500) });
		const onCard = await add(card.id, { date: "2026-09-08" });
		await updateTransaction(deps(), onCard, { tagIds: [holidays] }, asUser);
		const recompute = vi.spyOn(forward, "forwardBalances");

		await expect(
			bulkDeleteTransactions(deps(), { ids: [imported, early, onCard] }, asUser),
		).resolves.toBe(3);

		await expect(
			temp.db
				.select()
				.from(entries)
				.where(inArray(entries.id, [imported, early, onCard])),
		).resolves.toEqual([]);
		await expect(keysOf(imported)).resolves.toEqual([]);
		await expect(tagsOf(onCard)).resolves.toEqual([]);
		await expect(findTransaction(deps(), kept)).resolves.not.toBeNull();
		expect(recompute).toHaveBeenCalledTimes(2);
		expect(recompute.mock.calls.map(([input]) => input.from).toSorted()).toEqual([
			"2026-09-05",
			"2026-09-08",
		]);
		const jointDays = await history(joint.id);
		expect(jointDays.get("2026-09-14")).toBe(123456);
		expect(jointDays.get("2026-09-21")).toBe(122956);
		const cardDays = await history(card.id);
		expect(new Set(cardDays.values())).toEqual(new Set([123456]));
	});

	it("deletes every row a filter matches", async () => {
		const account = await openChecking();
		await add(account.id, { label: "Boulangerie" });
		await add(account.id, { label: "Boulangerie Dupont" });
		const kept = await add(account.id, { label: "Pharmacie" });

		await expect(
			bulkDeleteTransactions(
				deps(),
				{ filter: { accountIds: [account.id], q: "boulangerie" } },
				asUser,
			),
		).resolves.toBe(2);

		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(findTransaction(deps(), kept)).resolves.not.toBeNull();
	});

	it("deletes nothing when an id names no transaction", async () => {
		const account = await openChecking();
		const id = await add(account.id);

		await expect(
			bulkDeleteTransactions(deps(), { ids: [id, "nope"] }, asUser),
		).rejects.toMatchObject({ fields: [{ path: "ids", code: "invalid_value" }] });

		await expect(findTransaction(deps(), id)).resolves.not.toBeNull();
	});

	it("never deletes a snapshot or an opening anchor named by id", async () => {
		const account = await openChecking();
		const anchor = await temp.db
			.select({ id: entries.id })
			.from(entries)
			.where(and(eq(entries.accountId, account.id), eq(entries.valuationKind, "opening_anchor")))
			.get();

		await expect(
			bulkDeleteTransactions(deps(), { ids: [anchor?.id ?? ""] }, asUser),
		).rejects.toMatchObject({ fields: [{ path: "ids", code: "invalid_value" }] });
	});
});
