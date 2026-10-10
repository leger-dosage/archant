import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createLogger } from "../lib/logger.ts";
import {
	openOwn,
	ownCategory,
	ownDatabase,
	pinned,
	postOwn,
	sendOwn,
	template,
	useSignedInApp,
} from "../testing/app.ts";
import { callTool, connect, registerClient } from "../testing/assistant.ts";
import { buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

// The clock stands at 2026-09-21, a Monday; each test has a household of its own.

const line = z.strictObject({
	category_id: z.string().nullable(),
	name: z.string().nullable(),
	total: z.string(),
	percentage_of_total: z.number().nullable(),
});

const side = z.strictObject({
	total: z.string(),
	by_category: z.array(line.extend({ subcategory_totals: z.array(line) })).nullable(),
});

const totals = z.strictObject({
	start_date: z.string(),
	end_date: z.string(),
	income: z.string(),
	expenses: z.string(),
	net: z.string(),
});

const change = z.strictObject({ amount: z.string(), percent: z.number().nullable() });

const statement = z.strictObject({
	currency: z.string(),
	period: z.strictObject({ start_date: z.string(), end_date: z.string() }),
	account_ids: z.array(z.string()).optional(),
	income: side,
	expense: side,
	net: z.string().optional(),
	breakdown_omitted_reason: z.string().optional(),
	insights: z
		.strictObject({
			net_income: z.string(),
			savings_rate: z.number(),
			median_monthly_income: z.string(),
			median_monthly_expenses: z.string(),
			avg_monthly_expenses: z.string(),
		})
		.optional(),
	monthly_series: z.array(totals).optional(),
	previous_period: totals
		.extend({ income_change: change, expenses_change: change })
		.strict()
		.optional(),
	left_out_count: z.number(),
	left_out_account_ids: z.array(z.string()),
});

/**
 * Three months of a household: a salary each month, groceries in a
 * sub-category of « Maison test », the rent in « Maison test » itself, a
 * line left uncategorised, the savings account's interest, and an account in
 * dollars every figure leaves out.
 */
async function household() {
	const { db } = await ownDatabase();
	const opened = { openingBalance: "1 000,00", openingDate: "2026-01-01" };
	const checking = await openOwn({ ...opened, name: "Courant" });
	const savings = await openOwn({ ...opened, name: "Livret", subtype: "savings" });
	const dollars = await openOwn({ ...opened, name: "Dollars", currency: "USD" });
	const pay = await ownCategory("Paie test", { kind: "income" });
	const home = await ownCategory("Maison test");
	const groceries = await ownCategory("Courses test", { parentId: home });

	const lines: [string, string, string, string | null][] = [
		["2026-07-10", "SALAIRE", "2 000,00", pay],
		["2026-07-20", "COURSES", "-50,00", groceries],
		["2026-08-05", "SALAIRE", "2 500,00", pay],
		["2026-08-12", "COURSES", "-64,20", groceries],
		["2026-08-14", "DIVERS", "-10,00", null],
		["2026-08-20", "LOYER", "-800,00", home],
		["2026-09-05", "SALAIRE", "2 500,00", pay],
		["2026-09-08", "COURSES", "-100,00", groceries],
	];

	// In order, as the owner types them.
	await lines.reduce(async (previous, [date, label, amount, categoryId]) => {
		await previous;
		const id = await postOwn(checking.id, { date, label, amount });

		if (categoryId !== null) {
			await sendOwn("PATCH", `/api/transactions/${id}`, { categoryId });
		}
	}, Promise.resolve());

	await postOwn(savings.id, { date: "2026-08-31", label: "INTERETS", amount: "12,00" });
	await postOwn(dollars.id, { date: "2026-08-10", label: "CAFE", amount: "-20,00" });

	const auth = createTestAuth(db);
	const app = buildTestApp(db, createLogger("silent"), auth);
	const session = withSession(buildTestApp(db, createLogger("silent"), auth), template.cookie);
	const token = (await connect(session, app, await registerClient(app))).access_token;

	return {
		accounts: { checking, savings, dollars },
		categories: { pay, home, groceries },
		call: (args: unknown) => callTool(app, token, "get_income_statement", args),
		read: async (args: unknown) =>
			statement.parse((await callTool(app, token, "get_income_statement", args)).structuredContent),
	};
}

const QUARTER = { start_date: "2026-07-01", end_date: "2026-09-30" };

describe("get_income_statement", () => {
	it("gives any period's income and expenses by category and sub-category, with Sure's insights", async () => {
		const tools = await household();
		const { pay, home, groceries } = tools.categories;

		const result = await tools.read(QUARTER);

		expect(result).toEqual({
			currency: "EUR",
			period: { start_date: "2026-07-01", end_date: "2026-09-30" },
			income: {
				total: "7012.00",
				by_category: [
					{
						category_id: pay,
						name: "Paie test",
						total: "7000.00",
						percentage_of_total: 99.8,
						subcategory_totals: [],
					},
					{
						category_id: null,
						name: null,
						total: "12.00",
						percentage_of_total: 0.2,
						subcategory_totals: [],
					},
				],
			},
			expense: {
				total: "-1024.20",
				by_category: [
					{
						category_id: home,
						name: "Maison test",
						total: "-1014.20",
						percentage_of_total: 99,
						// Over the side's total, as Sure's weight.
						subcategory_totals: [
							{
								category_id: groceries,
								name: "Courses test",
								total: "-214.20",
								percentage_of_total: 20.9,
							},
						],
					},
					{
						category_id: null,
						name: null,
						total: "-10.00",
						percentage_of_total: 1,
						subcategory_totals: [],
					},
				],
			},
			insights: {
				net_income: "5987.80",
				savings_rate: 85.4,
				// Every month of the history: 2 000,00, 2 512,00 and 2 500,00 in;
				// 50,00, 874,20 and 100,00 out.
				median_monthly_income: "2500.00",
				median_monthly_expenses: "-100.00",
				avg_monthly_expenses: "-341.40",
			},
			left_out_count: 1,
			left_out_account_ids: [tools.accounts.dollars.id],
		});
	});

	it("adds Sure's monthly_series, each calendar month cut to the period", async () => {
		const tools = await household();

		const result = await tools.read({
			start_date: "2026-07-15",
			end_date: "2026-09-10",
			group_by: "month",
		});

		expect(result.monthly_series).toEqual([
			{
				start_date: "2026-07-15",
				end_date: "2026-07-31",
				income: "0.00",
				expenses: "-50.00",
				net: "-50.00",
			},
			{
				start_date: "2026-08-01",
				end_date: "2026-08-31",
				income: "2512.00",
				expenses: "-874.20",
				net: "1637.80",
			},
			{
				start_date: "2026-09-01",
				end_date: "2026-09-10",
				income: "2500.00",
				expenses: "-100.00",
				net: "2400.00",
			},
		]);
		expect(result.income.total).toBe("5012.00");
		expect(result.previous_period).toBeUndefined();
	});

	it("compares with the equal-length period just before, as Sure's previous_period", async () => {
		const tools = await household();

		const result = await tools.read({
			start_date: "2026-08-01",
			end_date: "2026-08-31",
			compare_previous_period: true,
		});

		expect(result.previous_period).toEqual({
			start_date: "2026-07-01",
			end_date: "2026-07-31",
			income: "2000.00",
			expenses: "-50.00",
			net: "1950.00",
			income_change: { amount: "512.00", percent: 25.6 },
			// 874,20 spent against 50,00: Sure's 1 648,4 %.
			expenses_change: { amount: "-824.20", percent: 1648.4 },
		});
		expect(result.monthly_series).toBeUndefined();
	});

	it("scopes the totals to account_ids and drops the category breakdown, as Sure's", async () => {
		const tools = await household();
		const { savings } = tools.accounts;

		const result = await tools.read({
			...QUARTER,
			account_ids: [savings.id],
			group_by: "month",
			compare_previous_period: true,
		});

		expect(result).toMatchObject({
			account_ids: [savings.id],
			income: { total: "12.00", by_category: null },
			expense: { total: "0.00", by_category: null },
			net: "12.00",
			breakdown_omitted_reason: "category breakdown is not available with an account filter",
			left_out_count: 0,
		});
		expect(result.insights).toBeUndefined();
		expect(result.monthly_series?.map((month) => month.income)).toEqual(["0.00", "12.00", "0.00"]);
		expect(result.previous_period).toMatchObject({
			start_date: "2026-03-31",
			end_date: "2026-06-30",
			income_change: { amount: "12.00", percent: null },
		});
	});

	it("refuses an account the totals do not count, naming its place in account_ids", async () => {
		const tools = await household();
		const { savings, dollars } = tools.accounts;

		const refused = await tools.call({ ...QUARTER, account_ids: [savings.id, dollars.id, "nope"] });

		expect(refused.isError).toBe(true);
		expect(refused.content[0]?.text).toMatch(/^VALIDATION_ERROR: /u);
		expect(refused.content[0]?.text).toContain('{"path":"account_ids.1","code":"unknown_account"}');
		expect(refused.content[0]?.text).toContain('{"path":"account_ids.2","code":"unknown_account"}');
		expect(refused.content[0]?.text).not.toContain("account_ids.0");
	});

	it("leaves a PEA's line out, where it was an expense of −15,00 €, and refuses the PEA in account_ids", async () => {
		const tools = await household();
		const pea = await openOwn({
			openingBalance: "1 000,00",
			openingDate: "2026-01-01",
			name: "PEA test",
			type: "investment",
			subtype: "pea",
		});
		await postOwn(pea.id, { date: "2026-08-15", label: "FRAIS", amount: "-15,00" });

		const result = await tools.read(QUARTER);
		const refused = await tools.call({ ...QUARTER, account_ids: [pea.id] });

		expect(result.expense.total).toBe("-1024.20");
		expect(refused.isError).toBe(true);
		expect(refused.content[0]?.text).toContain('{"path":"account_ids.0","code":"unknown_account"}');
	});

	it("keeps a refund as income in its category, where it lowered the expense line", async () => {
		const tools = await household();
		await postOwn(tools.accounts.checking.id, {
			date: "2026-09-09",
			label: "REMBOURSEMENT",
			amount: "30,00",
		}).then((id) =>
			sendOwn("PATCH", `/api/transactions/${id}`, { categoryId: tools.categories.groceries }),
		);

		const result = await tools.read(QUARTER);

		expect(result.income.total).toBe("7042.00");
		expect(result.income.by_category).toContainEqual({
			category_id: tools.categories.home,
			name: "Maison test",
			total: "30.00",
			percentage_of_total: 0.4,
			subcategory_totals: [
				{
					category_id: tools.categories.groceries,
					name: "Courses test",
					total: "30.00",
					percentage_of_total: 0.4,
				},
			],
		});
		expect(result.expense.total).toBe("-1024.20");
	});

	it("refuses more than 36 monthly buckets, a reversed period and a bad date", async () => {
		const tools = await household();

		const longest = await tools.read({
			start_date: "2023-10-01",
			end_date: "2026-09-30",
			group_by: "month",
		});
		const tooLong = await tools.call({
			start_date: "2023-09-30",
			end_date: "2026-09-30",
			group_by: "month",
		});
		const reversed = await tools.call({ start_date: "2026-09-30", end_date: "2026-07-01" });
		const badDate = await tools.call({ start_date: "2026-02-30", end_date: "2026-07-01" });
		const missing = await tools.call({ start_date: "2026-07-01" });

		expect(longest.monthly_series).toHaveLength(36);
		expect(tooLong.content[0]?.text).toContain('{"path":"group_by","code":"too_many_periods"}');
		expect(reversed.content[0]?.text).toContain('"path":"end_date","code":"before_from"');
		expect(badDate.content[0]?.text).toContain('"path":"start_date"');
		expect(missing.content[0]?.text).toContain('"path":"end_date"');
	});
});

const history = z.strictObject({
	start_date: z.string(),
	end_date: z.string(),
	interval: z.enum(["1 day", "1 week", "1 month"]),
	currency: z.string(),
	values: z.array(z.string()),
});

const sheetSide = z.strictObject({ current: z.string(), monthly_history: history });

const balanceSheet = z.strictObject({
	as_of_date: z.string(),
	oldest_account_start_date: z.string(),
	currency: z.string(),
	net_worth: sheetSide.extend({
		change: z.strictObject({ amount: z.string(), percent: z.number().nullable() }).nullable(),
	}),
	assets: sheetSide,
	liabilities: sheetSide,
	insights: z.strictObject({ debt_to_asset_ratio: z.number().nullable() }),
	left_out_count: z.number(),
	left_out_account_ids: z.array(z.string()),
});

/**
 * A checking account opened on 2026-01-10 at 1 500,00 with −120,00 on
 * 2026-03-02, a card owing 300,00 from 2026-06-01, and an account in dollars
 * every figure leaves out.
 */
async function sheetHousehold() {
	const { db } = await ownDatabase();
	const checking = await openOwn({ ...pinned, name: "Courant" });
	await postOwn(checking.id, { date: "2026-03-02", label: "Courses", amount: "-120,00" });
	await openOwn({
		name: "Carte",
		type: "credit_card",
		subtype: null,
		openingBalance: "300,00",
		openingDate: "2026-06-01",
	});
	const dollars = await openOwn({ ...pinned, name: "Dollars", currency: "USD" });

	const auth = createTestAuth(db);
	const app = buildTestApp(db, createLogger("silent"), auth);
	const session = withSession(buildTestApp(db, createLogger("silent"), auth), template.cookie);
	const token = (await connect(session, app, await registerClient(app))).access_token;

	return {
		dollars,
		call: (args: unknown) => callTool(app, token, "get_balance_sheet", args),
		read: async (args: unknown) =>
			balanceSheet.parse((await callTool(app, token, "get_balance_sheet", args)).structuredContent),
	};
}

describe("get_balance_sheet", () => {
	it("samples any dates at Sure's interval, as Sure's chart series reads them", async () => {
		const tools = await sheetHousehold();

		const result = await tools.read({
			start_date: "2026-01-01",
			end_date: "2026-09-21",
			interval: "1 month",
		});
		const monthly = {
			start_date: "2026-01-01",
			end_date: "2026-09-21",
			interval: "1 month",
			currency: "EUR",
		};
		const assets = ["0.00", "1500.00", "1500.00", ...Array.from({ length: 7 }, () => "1380.00")];
		const liabilities = [
			...Array.from({ length: 5 }, () => "0.00"),
			...Array.from({ length: 5 }, () => "300.00"),
		];

		expect(result).toEqual({
			as_of_date: "2026-09-21",
			oldest_account_start_date: "2026-01-10",
			currency: "EUR",
			net_worth: {
				current: "1080.00",
				// The first of each month, then the last day; nothing before the opening.
				monthly_history: {
					start_date: "2026-01-01",
					end_date: "2026-09-21",
					interval: "1 month",
					currency: "EUR",
					values: [
						"0.00",
						"1500.00",
						"1500.00",
						"1380.00",
						"1380.00",
						"1080.00",
						"1080.00",
						"1080.00",
						"1080.00",
						"1080.00",
					],
				},
				change: { amount: "-420.00", percent: -28 },
			},
			assets: { current: "1380.00", monthly_history: { ...monthly, values: assets } },
			liabilities: { current: "300.00", monthly_history: { ...monthly, values: liabilities } },
			insights: { debt_to_asset_ratio: 21.7 },
			left_out_count: 1,
			left_out_account_ids: [tools.dollars.id],
		});
	});

	it("defaults to the last five years from the oldest entry, at one month", async () => {
		const tools = await sheetHousehold();

		const result = await tools.read({});

		expect(result.net_worth.monthly_history).toMatchObject({
			start_date: "2026-01-10",
			end_date: "2026-09-21",
			interval: "1 month",
		});
		// The tenth of each month, then today.
		expect(result.net_worth.monthly_history.values).toHaveLength(10);
		expect(result.net_worth.monthly_history.values.at(-1)).toBe(result.net_worth.current);
	});

	it("reads Sure's named periods, a custom range winning only with both dates", async () => {
		const tools = await sheetHousehold();

		const weeks = await tools.read({ period: "last_30_days", interval: "1 week" });
		const lastMonth = await tools.read({ period: "last_month", interval: "1 day" });
		const thisWeek = await tools.read({ period: "current_week" });
		const halfCustom = await tools.read({ period: "last_month", start_date: "2026-01-01" });

		expect(weeks.net_worth.monthly_history).toMatchObject({
			start_date: "2026-08-22",
			end_date: "2026-09-21",
			interval: "1 week",
		});
		expect(weeks.net_worth.monthly_history.values).toHaveLength(6);
		expect(lastMonth.net_worth.monthly_history).toMatchObject({
			start_date: "2026-08-01",
			end_date: "2026-08-31",
		});
		expect(lastMonth.net_worth.monthly_history.values).toHaveLength(31);
		// A period starting today has no history, as Sure's.
		expect(thisWeek.net_worth.monthly_history.values).toEqual([]);
		expect(thisWeek.net_worth.change).toBeNull();
		expect(halfCustom.net_worth.monthly_history.start_date).toBe("2026-08-01");
	});

	it("refuses more than 400 points, a reversed range and a period Sure lacks", async () => {
		const tools = await sheetHousehold();

		const most = await tools.read({
			start_date: "2025-08-17",
			end_date: "2026-09-20",
			interval: "1 day",
		});
		const tooMany = await tools.call({
			start_date: "2025-08-16",
			end_date: "2026-09-20",
			interval: "1 day",
		});
		const reversed = await tools.call({ start_date: "2026-09-21", end_date: "2026-01-01" });
		const unknown = await tools.call({ period: "1Y" });

		expect(most.net_worth.monthly_history.values).toHaveLength(400);
		expect(tooMany.isError).toBe(true);
		expect(tooMany.content[0]?.text).toContain('{"path":"interval","code":"too_many_points"}');
		expect(reversed.content[0]?.text).toContain('"path":"end_date","code":"before_from"');
		expect(unknown.content[0]?.text).toContain('"path":"period"');
	});
});
