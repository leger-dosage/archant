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

/** Sure's `Money#format` in its `:fr` locale: `eur("1 024,20")` is « 1 024,20 € ». */
const eur = (amount: string) => `${amount.replaceAll(" ", "\u00A0")}\u00A0€`;

const subcategoryLine = z.strictObject({
	name: z.string(),
	total: z.string(),
	percentage_of_total: z.string(),
});

const side = z.strictObject({
	total: z.string(),
	by_category: z
		.array(subcategoryLine.extend({ subcategory_totals: z.array(subcategoryLine) }).strict())
		.nullable(),
});

const totals = z.strictObject({
	start_date: z.string(),
	end_date: z.string(),
	income: z.string(),
	expenses: z.string(),
	net: z.string(),
});

const change = z.strictObject({ amount: z.string(), percent: z.string().nullable() });

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
			savings_rate: z.string(),
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
});

/** A category of the household nothing counted, as Sure lists it. */
const zero = (name: string, subcategories: string[] = []) => ({
	name,
	total: eur("0,00"),
	percentage_of_total: "0,0%",
	subcategory_totals: subcategories.map((child) => ({
		name: child,
		total: eur("0,00"),
		percentage_of_total: "0,0%",
	})),
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
	const pay = await ownCategory("Paie test");
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
	it("gives the quarter in Sure's formats, every category on both sides, zero included", async () => {
		const tools = await household();

		const result = await tools.read(QUARTER);

		expect(result).toEqual({
			currency: "EUR",
			period: { start_date: "2026-07-01", end_date: "2026-09-30" },
			income: {
				total: eur("7 012,00"),
				by_category: [
					{
						name: "Paie test",
						total: eur("7 000,00"),
						percentage_of_total: "99,8%",
						subcategory_totals: [],
					},
					{
						name: "Non catégorisé",
						total: eur("12,00"),
						percentage_of_total: "0,2%",
						subcategory_totals: [],
					},
					// The expense category stays on the income side at zero, as Sure's.
					zero("Autres investissements"),
					zero("Maison test", ["Courses test"]),
				],
			},
			expense: {
				total: eur("1 024,20"),
				by_category: [
					{
						name: "Maison test",
						total: eur("1 014,20"),
						percentage_of_total: "99,0%",
						// Over the side's total, as Sure's weight.
						subcategory_totals: [
							{ name: "Courses test", total: eur("214,20"), percentage_of_total: "20,9%" },
						],
					},
					{
						name: "Non catégorisé",
						total: eur("10,00"),
						percentage_of_total: "1,0%",
						subcategory_totals: [],
					},
					zero("Autres investissements"),
					zero("Paie test"),
				],
			},
			insights: {
				net_income: eur("5 987,80"),
				// 85,394 % rounded to two decimals, then printed with three.
				savings_rate: "85,390%",
				// Every month of the history: 2 000,00, 2 512,00 and 2 500,00 in;
				// 50,00, 874,20 and 100,00 out.
				median_monthly_income: eur("2 500,00"),
				median_monthly_expenses: eur("100,00"),
				avg_monthly_expenses: eur("341,40"),
			},
		});
		expect(Object.keys(result)).toEqual(["currency", "period", "income", "expense", "insights"]);
		expect(Object.keys(result.expense.by_category?.[0] ?? {})).toEqual([
			"name",
			"total",
			"percentage_of_total",
			"subcategory_totals",
		]);
	});

	it("takes Sure's monthly statistics over the whole history, next month included and a one-time line left out", async () => {
		const tools = await household();
		const { checking } = tools.accounts;
		await postOwn(checking.id, { date: "2026-10-05", label: "COURSES", amount: "-300,00" });
		const oneTime = await postOwn(checking.id, {
			date: "2026-09-15",
			label: "ÉLECTROMÉNAGER",
			amount: "-900,00",
		});
		await sendOwn("PATCH", `/api/transactions/${oneTime}`, { oneTime: true });

		const result = await tools.read(QUARTER);

		// Out: 50,00, 874,20, 100,00 and October's 300,00, where October was
		// left out and the one-time 900,00 made September 1 000,00.
		expect(result.insights).toMatchObject({
			median_monthly_income: eur("2 500,00"),
			median_monthly_expenses: eur("200,00"),
			avg_monthly_expenses: eur("331,05"),
		});
		expect(result.expense.total).toBe(eur("1 024,20"));
	});

	it("gives a negative net income and savings rate when more went out", async () => {
		const tools = await household();

		const result = await tools.read({ start_date: "2026-08-12", end_date: "2026-08-31" });

		// 12,00 in, 874,20 out: −862,20, −7 185 % of the income.
		expect(result.insights).toMatchObject({
			net_income: eur("-862,20"),
			savings_rate: "-7185,000%",
		});
		expect(result.income.total).toBe(eur("12,00"));
	});

	it("rounds the savings rate half up from the exact ratio, where a float rounds 1,005 % down", async () => {
		const { db } = await ownDatabase();
		const account = await openOwn({ openingDate: "2026-01-01", name: "Courant" });
		await postOwn(account.id, { date: "2026-03-02", label: "SALAIRE", amount: "200,00" });
		await postOwn(account.id, { date: "2026-03-03", label: "LOYER", amount: "-197,99" });
		const auth = createTestAuth(db);
		const app = buildTestApp(db, createLogger("silent"), auth);
		const session = withSession(buildTestApp(db, createLogger("silent"), auth), template.cookie);
		const token = (await connect(session, app, await registerClient(app))).access_token;

		const result = statement.parse(
			(
				await callTool(app, token, "get_income_statement", {
					start_date: "2026-03-01",
					end_date: "2026-03-31",
				})
			).structuredContent,
		);

		// 2,01 kept of 200,00: exactly 1,005 %.
		expect(result.insights?.savings_rate).toBe("1,010%");
	});

	it('gives "0,000%" for the savings rate and "0,0%" for every line without income or spending', async () => {
		const tools = await household();

		const result = await tools.read({ start_date: "2025-02-01", end_date: "2025-02-28" });

		expect(result.income).toEqual({
			total: eur("0,00"),
			by_category: [
				zero("Autres investissements"),
				zero("Maison test", ["Courses test"]),
				zero("Non catégorisé"),
				zero("Paie test"),
			],
		});
		expect(result.insights).toMatchObject({ net_income: eur("0,00"), savings_rate: "0,000%" });
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
				income: eur("0,00"),
				expenses: eur("50,00"),
				net: eur("-50,00"),
			},
			{
				start_date: "2026-08-01",
				end_date: "2026-08-31",
				income: eur("2 512,00"),
				expenses: eur("874,20"),
				net: eur("1 637,80"),
			},
			{
				start_date: "2026-09-01",
				end_date: "2026-09-10",
				income: eur("2 500,00"),
				expenses: eur("100,00"),
				net: eur("2 400,00"),
			},
		]);
		expect(result.income.total).toBe(eur("5 012,00"));
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
			income: eur("2 000,00"),
			expenses: eur("50,00"),
			net: eur("1 950,00"),
			income_change: { amount: eur("512,00"), percent: "25.6" },
			// 874,20 spent against 50,00: Sure's 1 648,4 %.
			expenses_change: { amount: eur("824,20"), percent: "1648.4" },
		});
		expect(result.monthly_series).toBeUndefined();
	});

	it("gives a fall as a negative change, as Sure's delta", async () => {
		const tools = await household();

		const result = await tools.read({
			start_date: "2026-09-01",
			end_date: "2026-09-30",
			compare_previous_period: true,
		});

		// 2 to 31 August: 2 512,00 in and 874,20 out, against September's 2 500,00 and 100,00.
		expect(result.previous_period).toMatchObject({
			income_change: { amount: eur("-12,00"), percent: "-0.5" },
			expenses_change: { amount: eur("-774,20"), percent: "-88.6" },
		});
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

		expect(Object.keys(result)).toEqual([
			"currency",
			"period",
			"account_ids",
			"income",
			"expense",
			"net",
			"breakdown_omitted_reason",
			"monthly_series",
			"previous_period",
		]);
		expect(result).toMatchObject({
			account_ids: [savings.id],
			income: { total: eur("12,00"), by_category: null },
			expense: { total: eur("0,00"), by_category: null },
			net: eur("12,00"),
			breakdown_omitted_reason: "category breakdown is not available with an account filter",
		});
		expect(result.monthly_series?.map((month) => month.income)).toEqual([
			eur("0,00"),
			eur("12,00"),
			eur("0,00"),
		]);
		expect(result.previous_period).toMatchObject({
			start_date: "2026-03-31",
			end_date: "2026-06-30",
			income_change: { amount: eur("12,00"), percent: null },
		});
	});

	it("refuses an account the totals do not count as Sure's unknown_account_ids, naming each once", async () => {
		const tools = await household();
		const { savings, dollars } = tools.accounts;

		const refused = await tools.call({
			...QUARTER,
			account_ids: [savings.id, dollars.id, "nope", dollars.id],
		});

		expect(refused.isError).toBe(true);
		expect(JSON.parse(refused.content[0]?.text ?? "")).toEqual({
			error: "unknown_account_ids",
			message:
				"Some account ids were not found or are not part of income and expense reporting (hidden, excluded-from-reports and tax-advantaged accounts are not eligible). Call get_accounts for ids and retry once with eligible accounts.",
			unknown_ids: [dollars.id, "nope"],
		});
	});

	it("leaves a PEA's line out, where it was an expense of 15,00 €, and refuses the PEA in account_ids", async () => {
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

		expect(result.expense.total).toBe(eur("1 024,20"));
		expect(refused.isError).toBe(true);
		expect(refused.content[0]?.text).toContain(`"unknown_ids":["${pea.id}"]`);
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

		expect(result.income.total).toBe(eur("7 042,00"));
		expect(result.income.by_category).toContainEqual({
			name: "Maison test",
			total: eur("30,00"),
			percentage_of_total: "0,4%",
			subcategory_totals: [
				{ name: "Courses test", total: eur("30,00"), percentage_of_total: "0,4%" },
			],
		});
		expect(result.expense.total).toBe(eur("1 024,20"));
	});

	it("refuses more than 36 monthly buckets, a reversed period and a bad or missing date, as Sure's", async () => {
		const tools = await household();
		const refusal = async (args: unknown) => {
			const refused = await tools.call(args);

			expect(refused.isError).toBe(true);

			return z.unknown().parse(JSON.parse(refused.content[0]?.text ?? ""));
		};
		const badDate = {
			error: "invalid_date",
			message: "Dates must be valid and in YYYY-MM-DD format.",
		};

		const longest = await tools.read({
			start_date: "2023-10-01",
			end_date: "2026-09-30",
			group_by: "month",
		});

		expect(longest.monthly_series).toHaveLength(36);
		await expect(
			refusal({ start_date: "2023-09-30", end_date: "2026-09-30", group_by: "month" }),
		).resolves.toEqual({
			error: "too_many_periods",
			message: "That range produces more than 36 monthly buckets. Use a shorter range.",
		});
		await expect(refusal({ start_date: "2026-09-30", end_date: "2026-07-01" })).resolves.toEqual({
			error: "invalid_date",
			message: "start_date must be on or before end_date.",
		});
		await expect(refusal({ start_date: "2026-02-30", end_date: "2026-07-01" })).resolves.toEqual(
			badDate,
		);
		await expect(refusal({ start_date: "2026-07-01" })).resolves.toEqual(badDate);
		// A bad date before an unknown account, as Sure parses the dates first.
		await expect(
			refusal({ start_date: "juillet", end_date: "2026-07-31", account_ids: ["nope"] }),
		).resolves.toEqual(badDate);
	});
});

const history = z.union([
	z.strictObject({
		start_date: z.string(),
		end_date: z.string(),
		interval: z.enum(["1 day", "1 week", "1 month"]),
		currency: z.string(),
		values: z.array(z.number()),
	}),
	z.tuple([]),
]);

const sheetSide = z.strictObject({ current: z.string(), monthly_history: history });

const balanceSheet = z.strictObject({
	as_of_date: z.string(),
	oldest_account_start_date: z.string(),
	currency: z.string(),
	net_worth: sheetSide,
	assets: sheetSide,
	liabilities: sheetSide,
	insights: z.strictObject({ debt_to_asset_ratio: z.string() }),
});

/** The values of a history that has some. */
const valuesOf = (figure: z.infer<typeof sheetSide>) =>
	Array.isArray(figure.monthly_history) ? [] : figure.monthly_history.values;

/** The tool over the household this test opened. */
async function sheetTools(db: Awaited<ReturnType<typeof ownDatabase>>["db"]) {
	const auth = createTestAuth(db);
	const app = buildTestApp(db, createLogger("silent"), auth);
	const session = withSession(buildTestApp(db, createLogger("silent"), auth), template.cookie);
	const token = (await connect(session, app, await registerClient(app))).access_token;

	return {
		call: async (args: unknown) => callTool(app, token, "get_balance_sheet", args),
		read: async (args: unknown) =>
			balanceSheet.parse((await callTool(app, token, "get_balance_sheet", args)).structuredContent),
	};
}

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
	await openOwn({ ...pinned, name: "Dollars", currency: "USD" });

	return sheetTools(db);
}

describe("get_balance_sheet", () => {
	it("samples any dates at Sure's interval, current figures formatted and the history in JSON numbers", async () => {
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

		expect(result).toEqual({
			as_of_date: "2026-09-21",
			oldest_account_start_date: "2026-01-10",
			currency: "EUR",
			net_worth: {
				current: eur("1 080,00"),
				// The first of each month, then the last day; nothing before the opening.
				monthly_history: {
					...monthly,
					values: [0, 1500, 1500, 1380, 1380, 1080, 1080, 1080, 1080, 1080],
				},
			},
			assets: {
				current: eur("1 380,00"),
				monthly_history: {
					...monthly,
					values: [0, 1500, 1500, ...Array.from({ length: 7 }, () => 1380)],
				},
			},
			// What is owed today positive, its history negative, as Sure's.
			liabilities: {
				current: eur("300,00"),
				monthly_history: {
					...monthly,
					values: [0, 0, 0, 0, 0, -300, -300, -300, -300, -300],
				},
			},
			// 300,00 over 1 380,00: 21,7 %.
			insights: { debt_to_asset_ratio: "22%" },
		});
		expect(Object.keys(result)).toEqual([
			"as_of_date",
			"oldest_account_start_date",
			"currency",
			"net_worth",
			"assets",
			"liabilities",
			"insights",
		]);
		expect(Object.keys(result.net_worth.monthly_history)).toEqual([
			"start_date",
			"end_date",
			"interval",
			"currency",
			"values",
		]);
	});

	it("keeps the decimals of a figure in its JSON number", async () => {
		const { db } = await ownDatabase();
		await openOwn({ openingBalance: "1 234,56", openingDate: "2026-09-01", name: "Courant" });
		const tools = await sheetTools(db);

		const result = await tools.read({ period: "last_7_days", interval: "1 day" });

		expect(valuesOf(result.net_worth).at(-1)).toBe(1234.56);
		expect(result.net_worth.current).toBe(eur("1 234,56"));
		// Without liabilities, as Sure's: 0 rather than a division.
		expect(result.insights.debt_to_asset_ratio).toBe("0%");
	});

	it('gives "Inf%" for a household that owes without assets, as Sure\'s division by zero', async () => {
		const { db } = await ownDatabase();
		await openOwn({
			name: "Prêt",
			type: "credit_card",
			subtype: null,
			openingBalance: "5 000,00",
			openingDate: "2026-09-01",
		});
		const tools = await sheetTools(db);

		const result = await tools.read({});

		expect(result.insights.debt_to_asset_ratio).toBe("Inf%");
		expect(result.liabilities.current).toBe(eur("5 000,00"));
		expect(result.net_worth.current).toBe(eur("-5 000,00"));
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
		expect(valuesOf(result.net_worth)).toHaveLength(10);
		expect(valuesOf(result.net_worth).at(-1)).toBe(1080);
	});

	it("reads Sure's named periods, a custom range winning only with both dates, and an unknown period or interval as its default", async () => {
		const tools = await sheetHousehold();

		const weeks = await tools.read({ period: "last_30_days", interval: "1 week" });
		const lastMonth = await tools.read({ period: "last_month", interval: "1 day" });
		const thisWeek = await tools.read({ period: "current_week" });
		const halfCustom = await tools.read({ period: "last_month", start_date: "2026-01-01" });
		const halfBad = await tools.read({ period: "last_month", start_date: "janvier" });
		const unknown = await tools.read({ period: "1Y", interval: "2 days" });

		expect(weeks.net_worth.monthly_history).toMatchObject({
			start_date: "2026-08-22",
			end_date: "2026-09-21",
			interval: "1 week",
		});
		expect(valuesOf(weeks.net_worth)).toHaveLength(6);
		expect(lastMonth.net_worth.monthly_history).toMatchObject({
			start_date: "2026-08-01",
			end_date: "2026-08-31",
		});
		expect(valuesOf(lastMonth.net_worth)).toHaveLength(31);
		// A period starting today has no history, as Sure's: an empty list.
		expect(thisWeek.net_worth.monthly_history).toEqual([]);
		expect(thisWeek.liabilities.monthly_history).toEqual([]);
		expect(halfCustom.net_worth.monthly_history).toMatchObject({ start_date: "2026-08-01" });
		expect(halfBad.net_worth.monthly_history).toMatchObject({ start_date: "2026-08-01" });
		expect(unknown.net_worth.monthly_history).toMatchObject({
			start_date: "2026-01-10",
			interval: "1 month",
		});
	});

	it("refuses more than 400 points, a reversed range and a bad date, as Sure's", async () => {
		const tools = await sheetHousehold();
		const refusal = async (args: unknown) => {
			const refused = await tools.call(args);

			expect(refused.isError).toBe(true);

			return z.unknown().parse(JSON.parse(refused.content[0]?.text ?? ""));
		};

		const most = await tools.read({
			start_date: "2025-08-17",
			end_date: "2026-09-20",
			interval: "1 day",
		});

		expect(valuesOf(most.net_worth)).toHaveLength(400);
		await expect(
			refusal({ start_date: "2025-08-16", end_date: "2026-09-20", interval: "1 day" }),
		).resolves.toEqual({
			error: "too_many_points",
			message:
				"That period and interval combination produces too many data points. Use a coarser interval or a shorter period.",
		});
		await expect(refusal({ start_date: "2026-09-21", end_date: "2026-01-01" })).resolves.toEqual({
			error: "invalid_date",
			message: "start_date must be on or before end_date.",
		});
		await expect(refusal({ start_date: "2026-02-30", end_date: "2026-03-01" })).resolves.toEqual({
			error: "invalid_date",
			message: "Dates must be valid and in YYYY-MM-DD format.",
		});
	});
});
