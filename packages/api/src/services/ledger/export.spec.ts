import type { Column } from "drizzle-orm";

import { asc, eq, getTableColumns, getTableName, gte, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { readSnapshot } from "@archant/data/client";
import { toMicros } from "@archant/data/micros";
import { toMinorUnits } from "@archant/data/money";
import { balances } from "@archant/data/schema/balances";
import { budgetCategories, budgets } from "@archant/data/schema/budgets";
import { entries } from "@archant/data/schema/entries";
import { holdings } from "@archant/data/schema/holdings";
import { ruleActions, ruleConditions, rules } from "@archant/data/schema/rules";
import { securityPrices } from "@archant/data/schema/securities";
import { taggings } from "@archant/data/schema/taggings";
import { trades } from "@archant/data/schema/trades";

import {
	add,
	addStandard,
	deps,
	linkedAccount,
	matchedPair,
	newCategory,
	newMerchant,
	newTag,
	openChecking,
	openPea,
	setToday,
	snapshot,
	temp,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import {
	EXPORTED_COLUMNS,
	LEFT_OUT,
	balancePages,
	exportedAccounts,
	exportedBudgetCategories,
	exportedBudgets,
	exportedCategories,
	exportedMerchants,
	exportedRecurring,
	exportedRejectedTransfers,
	exportedRules,
	exportedTags,
	exportedTransfers,
	exportedCostBasisLocks,
	exportedTypedPrices,
	exportedValuations,
	holdingPages,
	transactionPages,
} from "./export.ts";
import { lockCostBasis } from "./holdings.ts";
import { splitTransaction } from "./splits.ts";
import { recordTrade } from "./trades.ts";
import { rejectTransfer } from "./transfers.ts";

useLedgerDatabase();

async function all<Page>(pages: AsyncIterable<Page[]>): Promise<Page[][]> {
	const read: Page[][] = [];

	for await (const page of pages) {
		read.push(page);
	}

	return read;
}

describe("the columns the archive reads", () => {
	it("cover every table and column of a migrated database, each exported or left out, never both", async () => {
		const tables = z
			.array(z.object({ name: z.string() }))
			.parse(
				(
					await temp.db.$client.execute(
						"select name from sqlite_schema where type = 'table' and name not like 'sqlite_%'",
					)
				).rows,
			)
			.map((row) => row.name);
		const exported: Record<string, Record<string, Column>> = EXPORTED_COLUMNS;
		const leftOut: Record<string, string | Record<string, string>> = LEFT_OUT;
		const problems: string[] = [];

		const columnsOf = new Map(
			await Promise.all(
				tables.map(async (table) => {
					const result = await temp.db.$client.execute(`pragma table_info(${table})`);

					return [table, z.array(z.object({ name: z.string() })).parse(result.rows)] as const;
				}),
			),
		);

		for (const table of tables) {
			const columns = (columnsOf.get(table) ?? []).map((row) => row.name);
			const reads = Object.values(exported[table] ?? {});
			const [first] = reads;
			const reason = leftOut[table];
			const keyed = first === undefined ? {} : getTableColumns(first.table);
			const omitted =
				typeof reason === "string"
					? columns
					: Object.keys(reason ?? {}).map((key) => keyed[key]?.name ?? `unknown key ${key}`);

			if (typeof reason === "string" && reads.length > 0) {
				problems.push(`${table} is left out whole and exported`);
			}

			for (const column of columns) {
				const isExported = reads.some((read) => read.name === column);
				const isOmitted = omitted.includes(column);

				if (isExported === isOmitted) {
					problems.push(`${table}.${column} is ${isExported ? "both" : "neither"}`);
				}
			}

			problems.push(
				...omitted
					.filter((column) => !columns.includes(column))
					.map((column) => `${table}.${column} is no column`),
			);
		}

		problems.push(
			...[...Object.keys(exported), ...Object.keys(leftOut)]
				.filter((table) => !tables.includes(table))
				.map((table) => `${table} is no table`),
		);

		expect(problems).toEqual([]);
	});

	it("names each table by its SQL name and each column by its TypeScript key", () => {
		for (const [table, columns] of Object.entries(EXPORTED_COLUMNS)) {
			for (const [key, column] of Object.entries(columns)) {
				expect(getTableColumns(column.table)[key]).toBe(column);
				expect(getTableName(column.table)).toBe(table);
			}
		}
	});
});

describe("balancePages", () => {
	it("reads every stored balance once, by account then day, a page at a time", async () => {
		await openChecking({ openingDate: "2026-09-15" });
		await openChecking({ openingDate: "2026-09-18" });
		const expected = await temp.db
			.select({ accountId: balances.accountId, date: balances.date })
			.from(balances)
			.orderBy(asc(balances.accountId), asc(balances.date));

		const pages = await all(balancePages(temp.db, 3));

		expect(pages.every((page) => page.length <= 3)).toBe(true);
		expect(pages.flat().map(({ accountId, date }) => ({ accountId, date }))).toEqual(expected);
		expect(pages.flat()[0]).toMatchObject({
			accountId: expected[0]?.accountId,
			date: expected[0]?.date,
			currency: "EUR",
		});
		expect(typeof pages.flat()[0]?.balance).toBe("number");
	});
});

describe("holdingPages", () => {
	it("reads every holding from a day on once, by account, day then security, a page at a time", async () => {
		const pea = await openPea();
		const buy = async (security: { source: "manual"; isin: string; name: string }, date: string) =>
			recordTrade(
				deps(),
				pea.id,
				{
					side: "buy",
					security,
					date,
					quantity: toMicros(2_000_000),
					price: toMicros(10_500_000),
					fee: toMinorUnits(0),
				},
				{ origin: "user" },
			);
		await buy({ source: "manual", isin: "FR0010315770", name: "Fonds euros" }, "2026-09-10");
		await buy({ source: "manual", isin: "FR0000120073", name: "Parts sociales" }, "2026-09-15");
		const expected = await temp.db
			.select({
				accountId: holdings.accountId,
				date: holdings.date,
				securityId: holdings.securityId,
			})
			.from(holdings)
			.where(gte(holdings.date, "2026-09-14"))
			.orderBy(asc(holdings.accountId), asc(holdings.date), asc(holdings.securityId));

		const pages = await all(holdingPages(temp.db, "2026-09-14", 3));
		const rows = pages.flat();

		expect(pages.every((page) => page.length <= 3)).toBe(true);
		expect(
			rows.map(({ accountId, date, securityId }) => ({ accountId, date, securityId })),
		).toEqual(expected);
		expect(expected).toHaveLength(8 + 7);
		expect(
			rows.find((row) => row.date === "2026-09-15" && row.security.name === "Parts sociales"),
		).toMatchObject({
			accountId: pea.id,
			quantity: 2_000_000,
			price: 10_500_000,
			amount: 2100,
			costBasis: 10_500_000,
			currency: "EUR",
			security: { ticker: null, mic: null, isin: "FR0000120073" },
		});
	});
});

describe("the cost basis locks and typed prices", () => {
	it("read each lock of a running position with its last day at zero, and the typed prices alone", async () => {
		setToday("2026-09-21T10:00:00Z");
		const pea = await openPea();
		const trade = (date: string, quantity: number, side: "buy" | "sell" = "buy") =>
			recordTrade(
				deps(),
				pea.id,
				{
					side,
					security: { source: "manual", isin: "FR0010315771", name: "Fonds verrouillé" },
					date,
					quantity: toMicros(quantity),
					price: toMicros(10_500_000),
					fee: toMinorUnits(0),
				},
				{ origin: "user" },
			);
		const { id: tradeId } = await trade("2026-09-17", 2_000_000);
		const [{ securityId } = { securityId: "" }] = await temp.db
			.select({ securityId: trades.securityId })
			.from(trades)
			.where(eq(trades.entryId, tradeId));
		// Sold in full, then bought again: the lock is the new position's.
		await trade("2026-09-18", 2_000_000, "sell");
		await trade("2026-09-19", 1_000_000);
		await lockCostBasis(deps(), pea.id, securityId, toMicros(9_000_000), { origin: "user" });
		await temp.db.insert(securityPrices).values([
			{
				securityId,
				date: "2026-09-19",
				price: toMicros(11_000_000),
				currency: "EUR",
				source: "manual",
			},
			{
				securityId,
				date: "2026-09-18",
				price: toMicros(10_000_000),
				currency: "EUR",
				source: "provider",
			},
			{
				securityId,
				date: "2026-09-17",
				price: toMicros(10_200_000),
				currency: "EUR",
				source: "manual",
			},
		]);

		const typed = (await exportedTypedPrices(temp.db)).filter(
			(row) => row.securityId === securityId,
		);

		await expect(exportedCostBasisLocks(temp.db)).resolves.toContainEqual({
			accountId: pea.id,
			securityId,
			costBasis: 9_000_000,
			after: "2026-09-18",
		});
		expect(typed).toEqual([
			{
				securityId,
				date: "2026-09-17",
				price: 10_200_000,
				currency: "EUR",
				source: "manual",
				security: {
					id: securityId,
					isin: "FR0010315771",
					ticker: null,
					mic: null,
					name: "Fonds verrouillé",
				},
			},
			expect.objectContaining({ date: "2026-09-19" }),
		]);

		// A full sale on or after the day it was locked ends the position and the lock.
		await trade("2026-09-21", 1_000_000, "sell");

		await expect(exportedCostBasisLocks(temp.db)).resolves.not.toContainEqual(
			expect.objectContaining({ accountId: pea.id }),
		);
	});
});

describe("transactionPages", () => {
	it("reads every transaction once, by date then creation, with its tags and transfer side", async () => {
		const pair = await matchedPair("2026-09-12");
		const tagged = await addStandard(pair.checking.id, { date: "2026-09-12", label: "Libraire" });
		const [first, second] = [await newTag("Vacances"), await newTag("Cadeaux")];
		await temp.db.insert(taggings).values([
			{ transactionId: tagged, tagId: first },
			{ transactionId: tagged, tagId: second },
		]);
		const expected = await temp.db
			.select({ id: entries.id })
			.from(entries)
			.where(eq(entries.kind, "transaction"))
			.orderBy(asc(entries.date), asc(entries.createdAt), asc(entries.id));

		const pages = await all(transactionPages(temp.db, "lines", 2));
		const rows = pages.flat();
		const byId = new Map(rows.map((row) => [row.id, row]));

		expect(pages.every((page) => page.length <= 2)).toBe(true);
		expect(rows.map((row) => row.id)).toEqual(expected.map((row) => row.id));
		expect(byId.get(tagged)).toMatchObject({
			tagIds: [first, second].toSorted(),
			outflowOf: null,
			inflowOf: null,
			transaction: { label: "Libraire", pending: false, lockedFields: ["date", "amount", "label"] },
		});
		expect(byId.get(pair.outflow)).toMatchObject({
			outflowOf: { id: pair.transfer.id, kind: "internal_move" },
			inflowOf: null,
			tagIds: [],
		});
		expect(byId.get(pair.inflow)).toMatchObject({
			outflowOf: null,
			inflowOf: { id: pair.transfer.id, kind: "internal_move" },
		});
	});

	it("reads only the snapshot it is handed, while a write elsewhere goes through", async () => {
		const account = await openChecking({ name: "Instantané" });
		await add(account.id, { date: "2026-09-02", label: "Avant" });
		const before = (await all(transactionPages(temp.db, "lines"))).flat().length;
		const reading = await readSnapshot(temp.db);

		try {
			const pages = transactionPages(reading.db, "lines", 1);
			await pages.next();
			await add(account.id, { date: "2026-09-03", label: "Après" });
			const rest = await all({ [Symbol.asyncIterator]: () => pages });

			expect(1 + rest.flat().length).toBe(before);
			expect((await all(transactionPages(temp.db, "lines"))).flat()).toHaveLength(before + 1);
		} finally {
			reading.close();
		}
	});

	it("reads a split's lines alone, or its parent with its lines nested, as Sure's exporter", async () => {
		const account = await openChecking({ name: "Divisé" });
		const parent = await add(account.id, {
			date: "2026-09-04",
			amount: toMinorUnits(-10_000),
			label: "HYPERMARCHE",
		});
		const kept = await add(account.id, { date: "2026-09-04", label: "Seule" });
		const [food, home] = [await newCategory("Courses"), await newCategory("Maison")];
		const tag = await newTag("Reçu");
		const split = await splitTransaction(
			deps(),
			parent,
			[
				{ label: "Courses", amount: toMinorUnits(-6_000), categoryId: food, tagIds: [tag] },
				{ label: "Maison", amount: toMinorUnits(-4_000), categoryId: home },
			],
			{ origin: "user" },
		);
		const ofAccount = async (view: "lines" | "nested") =>
			(await all(transactionPages(temp.db, view, 1)))
				.flat()
				.filter((row) => row.accountId === account.id);

		const lines = await ofAccount("lines");
		const nested = await ofAccount("nested");

		expect(lines.map((row) => row.id).toSorted()).toEqual([...split.childIds, kept].toSorted());
		expect(lines.every((row) => row.splitLines.length === 0)).toBe(true);
		expect(nested.map((row) => row.id).toSorted()).toEqual([parent, kept].toSorted());
		expect(nested.find((row) => row.id === parent)).toMatchObject({
			transaction: { excluded: true },
			splitLines: [
				{
					id: split.childIds[0],
					parentEntryId: parent,
					amount: -6_000,
					tagIds: [tag],
					transaction: { label: "Courses", categoryId: food },
				},
				{ id: split.childIds[1], amount: -4_000, tagIds: [], transaction: { label: "Maison" } },
			],
		});
		expect(nested.find((row) => row.id === kept)?.splitLines).toEqual([]);
	});
});

describe("the other tables", () => {
	it("reads each account with today's balance, and each opening anchor with its day's", async () => {
		setToday("2026-09-21T10:00:00Z");
		const manual = await openChecking({ name: "Manuel", openingBalance: toMinorUnits(10_000) });
		await add(manual.id, { date: "2026-09-05", amount: toMinorUnits(-2_500) });
		await snapshot(manual.id, "2026-09-10", 9_000);
		const { account: linked } = await linkedAccount(50_000);

		const accounts = new Map((await exportedAccounts(deps())).map((row) => [row.id, row]));
		const valuations = (await exportedValuations(deps())).filter(
			(row) => row.accountId === manual.id || row.accountId === linked.id,
		);

		expect(accounts.get(manual.id)).toMatchObject({
			name: "Manuel",
			type: "depository",
			balance: { amount: 9_000, currency: "EUR" },
		});
		expect(accounts.get(linked.id)?.balance).toEqual({ amount: 50_000, currency: "EUR" });
		const manualRows = [
			[manual.id, "opening_anchor", { amount: 10_000, currency: "EUR" }],
			[manual.id, "reconciliation", null],
		];
		const linkedRows = [
			[linked.id, "opening_anchor", { amount: 50_000, currency: "EUR" }],
			[linked.id, "current_anchor", null],
		];

		// By account id, then day.
		expect(valuations.map((row) => [row.accountId, row.valuationKind, row.dayBalance])).toEqual(
			manual.id < linked.id ? [...manualRows, ...linkedRows] : [...linkedRows, ...manualRows],
		);
	});

	it("reads the transfers with their sides, and the pairs refused", async () => {
		const pair = await matchedPair("2026-09-14");
		const other = await matchedPair("2026-09-15");
		await rejectTransfer(deps(), other.transfer.id, { origin: "user" });

		const transfer = (await exportedTransfers(temp.db)).find((row) => row.id === pair.transfer.id);
		const rejected = (await exportedRejectedTransfers(temp.db)).find(
			(row) => row.outflowTransactionId === other.outflow,
		);

		expect(transfer).toMatchObject({
			outflowTransactionId: pair.outflow,
			inflowTransactionId: pair.inflow,
			kind: "internal_move",
			outflow: { accountId: pair.checking.id, date: "2026-09-14", amount: -pair.amount },
			inflow: { accountId: pair.livret.id, date: "2026-09-14", amount: pair.amount },
		});
		expect(rejected?.inflowTransactionId).toBe(other.inflow);
	});

	it("reads categories, tags, merchants and recurring patterns by name or age", async () => {
		const category = await newCategory("Épicerie");
		const tag = await newTag("Été");
		const merchant = await newMerchant("Boulanger");
		const account = await openChecking();
		await temp.db.run(
			sql`insert into recurring_transactions (id, account_id, label_key, label, amount, currency, expected_day_of_month, last_occurrence_date, next_expected_date, occurrence_count, created_at, updated_at) values (${crypto.randomUUID()}, ${account.id}, 'abonnement', 'Abonnement', -1500, 'EUR', 10, '2026-09-10', '2026-10-10', 3, 0, 0)`,
		);

		expect((await exportedCategories(temp.db)).map((row) => row.id)).toContain(category);
		expect((await exportedTags(temp.db)).map((row) => row.id)).toContain(tag);
		expect((await exportedMerchants(temp.db)).map((row) => row.id)).toContain(merchant);
		expect(await exportedRecurring(temp.db)).toContainEqual(
			expect.objectContaining({ accountId: account.id, label: "Abonnement", status: "detected" }),
		);
	});

	it("reads each month's budget and category amounts with that month's currency", async () => {
		const category = await newCategory("Budget");
		const budgetId = crypto.randomUUID();
		await temp.db.insert(budgets).values({
			id: budgetId,
			month: "2026-08",
			currency: "EUR",
			budgetedSpending: 100_000,
			expectedIncome: null,
			createdAt: 1,
			updatedAt: 1,
		});
		await temp.db.insert(budgetCategories).values({
			id: crypto.randomUUID(),
			budgetId,
			categoryId: category,
			budgetedSpending: 20_000,
			rolloverEnabled: true,
			rolledOverAmount: 5_000,
			createdAt: 1,
			updatedAt: 1,
		});

		expect(await exportedBudgets(temp.db)).toContainEqual(
			expect.objectContaining({ id: budgetId, month: "2026-08", expectedIncome: null }),
		);
		expect(await exportedBudgetCategories(temp.db)).toContainEqual(
			expect.objectContaining({
				budgetId,
				categoryId: category,
				month: "2026-08",
				currency: "EUR",
				rolloverEnabled: true,
			}),
		);
	});

	it("reads each rule with its own conditions and actions, in the form's order", async () => {
		const [ruleId, otherId, groupId] = [
			crypto.randomUUID(),
			crypto.randomUUID(),
			crypto.randomUUID(),
		];
		await temp.db.insert(rules).values([
			{ id: ruleId, name: null, createdAt: 1, updatedAt: 1 },
			{ id: otherId, name: "Autre", createdAt: 2, updatedAt: 2 },
		]);
		await temp.db.insert(ruleConditions).values([
			{ id: groupId, ruleId, position: 1, conditionType: "compound", operator: "or" },
			{
				id: crypto.randomUUID(),
				ruleId,
				parentId: groupId,
				position: 0,
				conditionType: "transaction_name",
				operator: "like",
				value: "CB",
			},
		]);
		await temp.db.insert(ruleActions).values([
			{ id: crypto.randomUUID(), ruleId, position: 1, actionType: "exclude_transaction" },
			{
				id: crypto.randomUUID(),
				ruleId,
				position: 0,
				actionType: "replace_in_transaction_name",
				value: "CB ",
				replacement: "",
			},
		]);

		const ids = new Set<string>([ruleId, otherId]);
		const read = (await exportedRules(temp.db)).filter((rule) => ids.has(rule.id));

		expect(read.map((rule) => rule.id)).toEqual([ruleId, otherId]);
		expect(read[0]?.conditions.map((condition) => condition.conditionType)).toEqual([
			"transaction_name",
			"compound",
		]);
		expect(read[0]?.actions.map((action) => [action.actionType, action.replacement])).toEqual([
			["replace_in_transaction_name", ""],
			["exclude_transaction", null],
		]);
		expect(read[1]).toMatchObject({ name: "Autre", conditions: [], actions: [] });
	});
});
