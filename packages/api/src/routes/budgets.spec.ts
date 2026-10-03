import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
	errorBody,
	openOwn,
	own,
	ownCategory,
	ownDatabase,
	ownRequest,
	postOwn,
	sendOwn,
	useSignedInApp,
} from "../testing/app.ts";

useSignedInApp();

// The clock is 2026-09-21 in Europe/Paris: the current month is 2026-09, and
// budgets reach from 2024-09, or the oldest entry's month, to 2028-09.

const envelope = z.object({
	budgetedSpending: z.number(),
	budgeted: z.boolean(),
	spent: z.number(),
	available: z.number(),
	percentSpent: z.number(),
	status: z.enum(["over", "near", "onTrack"]),
	section: z.enum(["over", "onTrack"]).nullable(),
	median: z.number().nullable(),
	average: z.number().nullable(),
});

const budgetBody = z.object({
	data: z.object({
		month: z.string(),
		from: z.string(),
		to: z.string(),
		currency: z.string(),
		setUp: z.boolean(),
		budgetedSpending: z.number().nullable(),
		expectedIncome: z.number().nullable(),
		actual: z.object({ spending: z.number(), income: z.number() }),
		segments: z.array(
			z.object({
				categoryId: z.string().nullable(),
				name: z.string().nullable(),
				color: z.string().nullable(),
				icon: z.string().nullable(),
				spent: z.number(),
			}),
		),
		categories: z.array(
			envelope.extend({
				categoryId: z.string(),
				parentId: z.string().nullable(),
				name: z.string(),
				color: z.string(),
				icon: z.string(),
				shared: z.boolean(),
			}),
		),
		uncategorised: envelope,
		allocated: z.number(),
		suggested: z.object({ spending: z.number().nullable(), income: z.number().nullable() }),
		previousMonth: z.string().nullable(),
		nextMonth: z.string().nullable(),
		bounds: z.object({ from: z.string(), to: z.string() }),
		leftOut: z.array(z.object({ id: z.string(), name: z.string(), currency: z.string() })),
	}),
});

async function budgetOf(month: string) {
	const { status, body } = await ownRequest("GET", `/api/budgets/${month}`);

	expect(status, JSON.stringify(body)).toBe(200);

	return budgetBody.parse(body).data;
}

async function save(month: string, budgetedSpending: string, expectedIncome: string) {
	return ownRequest("PUT", `/api/budgets/${month}`, { budgetedSpending, expectedIncome });
}

async function budgetRows() {
	return own?.db.all(
		sql`select month, currency, budgeted_spending as budgetedSpending, expected_income as expectedIncome from budgets`,
	);
}

async function amountRows() {
	return own?.db.all(
		sql`select category_id as categoryId, budgeted_spending as budgetedSpending from budget_categories order by budgeted_spending`,
	);
}

async function line(accountId: string, date: string, amount: string, categoryId?: string) {
	const id = await postOwn(accountId, { date, label: "Opération", amount });

	if (categoryId !== undefined) {
		await sendOwn("PATCH", `/api/transactions/${id}`, { categoryId });
	}

	return id;
}

/**
 * Four earlier months spending 100, 300, 200 and 400, two earning 2 000 and
 * 3 000, then September: groceries, an uncategorised outflow, a refund
 * beyond what « Vêtements » spent, and a salary.
 */
async function household() {
	const account = await openOwn({ openingDate: "2026-04-01", openingBalance: "10 000,00" });
	const courses = await ownCategory("Courses");
	const clothes = await ownCategory("Vêtements", { color: "#4ea7fc" });
	await line(account.id, "2026-05-10", "-100,00", courses);
	await line(account.id, "2026-06-10", "-300,00", courses);
	await line(account.id, "2026-06-25", "2 000,00");
	await line(account.id, "2026-07-10", "-200,00", courses);
	await line(account.id, "2026-08-10", "-400,00", courses);
	await line(account.id, "2026-08-25", "3 000,00");
	await line(account.id, "2026-09-05", "-60,00", courses);
	await line(account.id, "2026-09-06", "-15,00");
	await line(account.id, "2026-09-07", "30,00", clothes);
	await line(account.id, "2026-09-08", "1 000,00");

	return { account, courses, clothes };
}

describe("GET /api/budgets/:month", () => {
	it("answers a month not set up with its actuals and suggestions, and writes nothing", async () => {
		const { courses, clothes } = await household();

		await expect(budgetOf("2026-09")).resolves.toEqual({
			month: "2026-09",
			from: "2026-09-01",
			to: "2026-09-30",
			currency: "EUR",
			setUp: false,
			budgetedSpending: null,
			expectedIncome: null,
			// « Vêtements » nets +30,00: it spends nothing and draws no segment.
			actual: { spending: 7_500, income: 100_000 },
			segments: [
				{ categoryId: courses, name: "Courses", color: "#e99537", icon: "tag", spent: 6_000 },
				{ categoryId: null, name: null, color: null, icon: null, spent: 1_500 },
			],
			// Nothing is budgeted yet: « Courses » spent with no amount, so it is over.
			categories: [
				{
					categoryId: courses,
					parentId: null,
					name: "Courses",
					color: "#e99537",
					icon: "tag",
					budgetedSpending: 0,
					shared: false,
					budgeted: false,
					spent: 6_000,
					available: -6_000,
					percentSpent: 100,
					status: "over",
					section: "over",
					median: 25_000,
					average: 25_000,
				},
				{
					categoryId: clothes,
					parentId: null,
					name: "Vêtements",
					color: "#4ea7fc",
					icon: "tag",
					budgetedSpending: 0,
					shared: false,
					budgeted: false,
					spent: 0,
					available: 0,
					percentSpent: 0,
					status: "onTrack",
					section: null,
					median: null,
					average: null,
				},
			],
			uncategorised: {
				budgetedSpending: 0,
				budgeted: false,
				spent: 1_500,
				available: -1_500,
				percentSpent: 100,
				status: "over",
				section: "over",
				median: null,
				average: null,
			},
			allocated: 0,
			suggested: { spending: 25_000, income: 250_000 },
			previousMonth: "2026-08",
			nextMonth: "2026-10",
			bounds: { from: "2024-09", to: "2028-09" },
			leftOut: [],
		});
		await expect(budgetRows()).resolves.toEqual([]);
		await expect(amountRows()).resolves.toEqual([]);
	});

	it("suggests from the months before the shown one, or before the current one", async () => {
		await household();

		await expect(budgetOf("2026-07")).resolves.toMatchObject({
			suggested: { spending: 20_000, income: 200_000 },
		});
		// A later month takes the same medians as the current one: never a partial month.
		await expect(budgetOf("2027-02")).resolves.toMatchObject({
			suggested: { spending: 25_000, income: 250_000 },
			actual: { spending: 0, income: 0 },
			segments: [],
		});
	});

	it("suggests nothing without a counted line before the month", async () => {
		const account = await openOwn({ openingDate: "2026-09-01" });
		await line(account.id, "2026-09-05", "-60,00");

		await expect(budgetOf("2026-09")).resolves.toMatchObject({
			suggested: { spending: null, income: null },
			actual: { spending: 6_000, income: 0 },
		});
	});

	it("leaves an account in another currency out of actuals and medians, and names it", async () => {
		const account = await openOwn({ openingDate: "2026-07-01" });
		const dollars = await openOwn({
			name: "Épargne US",
			currency: "USD",
			openingDate: "2026-07-01",
			openingBalance: "0",
		});
		await line(account.id, "2026-08-10", "-100,00");
		await line(dollars.id, "2026-08-10", "-900.00");
		await line(dollars.id, "2026-09-10", "-50.00");

		await expect(budgetOf("2026-09")).resolves.toMatchObject({
			actual: { spending: 0, income: 0 },
			suggested: { spending: 10_000, income: null },
			leftOut: [{ id: dollars.id, name: "Épargne US", currency: "USD" }],
		});
	});

	it("refuses a month past either bound, and reaches back to the oldest entry", async () => {
		await openOwn({ openingDate: "2019-03-10" });

		await expect(budgetOf("2028-09")).resolves.toMatchObject({
			bounds: { from: "2019-03", to: "2028-09" },
			nextMonth: null,
		});
		await expect(budgetOf("2019-03")).resolves.toMatchObject({ previousMonth: null });

		const refused = await Promise.all(
			["2028-10", "2019-02"].map((month) => ownRequest("GET", `/api/budgets/${month}`)),
		);

		expect(refused.map(({ status, body }) => [status, errorBody.parse(body).error.code])).toEqual([
			[404, "NOT_FOUND"],
			[404, "NOT_FOUND"],
		]);
	});

	it("starts two years back when the ledger is empty", async () => {
		await ownDatabase();

		await expect(budgetOf("2024-09")).resolves.toMatchObject({
			bounds: { from: "2024-09", to: "2028-09" },
		});
		await expect(ownRequest("GET", "/api/budgets/2024-08")).resolves.toMatchObject({
			status: 404,
		});
	});

	it.each(["2026-13", "2026-9", "septembre"])("refuses a malformed month, %s", async (month) => {
		await openOwn();

		const { status, body } = await ownRequest("GET", `/api/budgets/${month}`);

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "month", code: "invalid_format" }],
		});
	});
});

describe("PUT /api/budgets/:month", () => {
	it("sets up a month, then updates the same row", async () => {
		await household();

		const { status, body } = await save("2026-09", "2 000,00", "2 500");

		expect(status).toBe(200);
		expect(budgetBody.parse(body).data).toMatchObject({
			month: "2026-09",
			setUp: true,
			budgetedSpending: 200_000,
			expectedIncome: 250_000,
			actual: { spending: 7_500, income: 100_000 },
		});
		await expect(budgetOf("2026-09")).resolves.toMatchObject({ setUp: true });

		await save("2026-09", "1 800", "0");

		await expect(budgetRows()).resolves.toEqual([
			{ month: "2026-09", currency: "EUR", budgetedSpending: 180_000, expectedIncome: 0 },
		]);
	});

	it.each([
		["a blank amount", "  ", "2 500", "budgetedSpending", "too_small"],
		["a negative amount", "-5", "2 500", "budgetedSpending", "negative_amount"],
		["text", "deux mille", "2 500", "budgetedSpending", "invalid_amount"],
		["a blank income", "2 000", "", "expectedIncome", "too_small"],
		["a negative income", "2 000", "-1", "expectedIncome", "negative_amount"],
		["a text income", "2 000", "beaucoup", "expectedIncome", "invalid_amount"],
	])(
		"refuses %s, and writes nothing",
		async (_label, budgetedSpending, expectedIncome, path, code) => {
			await openOwn();

			const { status, body } = await save("2026-09", budgetedSpending, expectedIncome);

			expect(status).toBe(400);
			expect(errorBody.parse(body).error).toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path, code }],
			});
			await expect(budgetRows()).resolves.toEqual([]);
		},
	);

	it("requires both amounts", async () => {
		await openOwn();

		const { status, body } = await ownRequest("PUT", "/api/budgets/2026-09", {
			budgetedSpending: "100",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "expectedIncome", code: "invalid_type" },
		]);
	});

	it("refuses a month out of bounds, and writes nothing", async () => {
		await openOwn({ openingDate: "2026-09-01" });

		const refused = await Promise.all(
			["2028-10", "2024-08"].map((month) => save(month, "100", "100")),
		);

		expect(refused.map(({ status, body }) => [status, errorBody.parse(body).error.code])).toEqual([
			[404, "NOT_FOUND"],
			[404, "NOT_FOUND"],
		]);
		await expect(budgetRows()).resolves.toEqual([]);
	});
});

const put = (month: string, categoryId: string, budgetedSpending: string) =>
	ownRequest("PUT", `/api/budgets/${month}/categories/${categoryId}`, { budgetedSpending });

async function saved(month: string, categoryId: string, budgetedSpending: string) {
	const { status, body } = await put(month, categoryId, budgetedSpending);

	expect(status, JSON.stringify(body)).toBe(200);

	return budgetBody.parse(body).data;
}

const lineOf = (budget: z.infer<typeof budgetBody>["data"], categoryId: string) =>
	budget.categories.find((item) => item.categoryId === categoryId);

/** « Maison » with two children, in a September set up at 2 000,00. */
async function house() {
	const account = await openOwn({ openingDate: "2026-04-01", openingBalance: "10 000,00" });
	const parent = await ownCategory("Maison");
	const works = await ownCategory("Travaux", { parentId: parent });
	const garden = await ownCategory("Jardin", { parentId: parent });
	await save("2026-09", "2 000", "0");

	return { account, parent, works, garden };
}

describe("PUT /api/budgets/:month/categories/:categoryId", () => {
	it("sets a parent's amount, which the allocation counts, and answers the month", async () => {
		const { parent } = await house();

		const budget = await saved("2026-09", parent, "500");

		expect(lineOf(budget, parent)).toMatchObject({
			budgetedSpending: 50_000,
			budgeted: true,
			section: "onTrack",
		});
		expect(budget).toMatchObject({
			allocated: 50_000,
			uncategorised: { budgetedSpending: 150_000 },
		});
		await expect(amountRows()).resolves.toEqual([{ categoryId: parent, budgetedSpending: 50_000 }]);

		await saved("2026-09", parent, "450,50");

		await expect(amountRows()).resolves.toEqual([{ categoryId: parent, budgetedSpending: 45_050 }]);
	});

	it("ring-fences a child, then shares it again, keeping the parent's reserve", async () => {
		const { parent, works, garden } = await house();
		await saved("2026-09", parent, "1 000");

		// Sure's `sync_parent_budgeted_spending!`: the parent keeps its whole
		// reserve beside the new child amount.
		const fenced = await saved("2026-09", works, "300");

		expect(lineOf(fenced, works)).toMatchObject({ budgetedSpending: 30_000, shared: false });
		expect(lineOf(fenced, parent)?.budgetedSpending).toBe(130_000);
		expect(lineOf(fenced, garden)).toMatchObject({ budgetedSpending: 0, shared: true });

		const sharedAgain = await saved("2026-09", works, "");

		expect(lineOf(sharedAgain, works)).toMatchObject({ budgetedSpending: 0, shared: true });
		expect(lineOf(sharedAgain, parent)?.budgetedSpending).toBe(100_000);
	});

	it("lowers the parent by what a ring-fenced child gives back", async () => {
		const { parent, works } = await house();
		// The parent at 1 000 holds « Travaux », ring-fenced at 300.
		await saved("2026-09", works, "300");
		await saved("2026-09", parent, "1 000");

		const budget = await saved("2026-09", works, "  ");

		expect(lineOf(budget, parent)?.budgetedSpending).toBe(70_000);
	});

	it("never lets a parent's own save go below its ring-fenced children", async () => {
		const { parent, works } = await house();
		await saved("2026-09", works, "300");

		const budget = await saved("2026-09", parent, "100");

		expect(lineOf(budget, parent)?.budgetedSpending).toBe(30_000);
		expect(budget.allocated).toBe(30_000);
	});

	it("keeps each month's amounts to that month", async () => {
		const { parent, works, garden } = await house();
		await save("2026-08", "2 000", "0");
		await saved("2026-08", parent, "800");
		await saved("2026-08", garden, "500");

		const september = await saved("2026-09", works, "200");

		// August's « Jardin » is no sibling of September's « Travaux ».
		expect(lineOf(september, parent)?.budgetedSpending).toBe(20_000);
		expect(lineOf(september, garden)?.budgetedSpending).toBe(0);
		expect(september.allocated).toBe(20_000);
		expect((await budgetOf("2026-08")).allocated).toBe(130_000);
	});

	it("creates the parent's row from a child's first amount", async () => {
		const { parent, works, garden } = await house();
		await saved("2026-09", garden, "50");

		const budget = await saved("2026-09", works, "200");

		expect(lineOf(budget, parent)?.budgetedSpending).toBe(25_000);
		expect(budget.allocated).toBe(25_000);
		await expect(amountRows()).resolves.toEqual([
			{ categoryId: garden, budgetedSpending: 5_000 },
			{ categoryId: works, budgetedSpending: 20_000 },
			{ categoryId: parent, budgetedSpending: 25_000 },
		]);
	});

	it("splits a parent's spending between ring-fenced and shared children", async () => {
		const { account, parent, works, garden } = await house();
		await saved("2026-09", parent, "700");
		await saved("2026-09", works, "300");
		await line(account.id, "2026-09-03", "-100,00", works);
		await line(account.id, "2026-09-04", "-650,00", garden);

		const budget = await budgetOf("2026-09");

		expect(lineOf(budget, parent)).toMatchObject({
			budgetedSpending: 100_000,
			spent: 75_000,
			available: 25_000,
		});
		expect(lineOf(budget, works)).toMatchObject({ spent: 10_000, available: 20_000 });
		expect(lineOf(budget, garden)).toMatchObject({
			shared: true,
			spent: 65_000,
			available: 5_000,
			status: "near",
			section: "onTrack",
		});
	});

	it("names each category's status and section", async () => {
		const account = await openOwn({ openingDate: "2026-04-01" });
		const groceries = await ownCategory("Courses");
		const leisure = await ownCategory("Loisirs");
		const gifts = await ownCategory("Cadeaux");
		const travel = await ownCategory("Voyages");
		await save("2026-09", "1 000", "0");
		await saved("2026-09", groceries, "100");
		await saved("2026-09", leisure, "100");
		await saved("2026-09", travel, "100");
		await line(account.id, "2026-09-05", "-90,00", groceries);
		await line(account.id, "2026-09-06", "-20,00", gifts);
		await line(account.id, "2026-09-07", "-120,00", travel);

		const budget = await budgetOf("2026-09");

		expect(
			budget.categories.map((item) => [item.name, item.status, item.section, item.available]),
		).toEqual([
			["Cadeaux", "over", "over", -2_000],
			["Courses", "near", "onTrack", 1_000],
			["Loisirs", "onTrack", "onTrack", 10_000],
			["Voyages", "over", "over", -2_000],
		]);
		expect(budget.uncategorised).toMatchObject({
			budgetedSpending: 70_000,
			section: "onTrack",
		});
	});

	it("budgets « Sans catégorie » nothing once the categories take more than the total", async () => {
		const account = await openOwn({ openingDate: "2026-04-01" });
		const groceries = await ownCategory("Courses");
		const rent = await ownCategory("Loyer");
		await save("2026-09", "1 000", "0");
		await saved("2026-09", groceries, "200");
		await line(account.id, "2026-09-05", "-15,00");

		const budget = await saved("2026-09", rent, "1 000");

		expect(budget.allocated).toBe(120_000);
		expect(budget.uncategorised).toMatchObject({
			budgetedSpending: 0,
			spent: 1_500,
			status: "over",
			section: "over",
		});
	});

	it("gives each category the median and average of the months it has a line in", async () => {
		const { account, parent, works } = await house();
		await line(account.id, "2026-05-10", "-100,00", works);
		await line(account.id, "2026-06-10", "-300,00", parent);
		await line(account.id, "2026-07-10", "-50,00", parent);
		await line(account.id, "2026-09-10", "-900,00", parent);

		const budget = await budgetOf("2026-09");

		expect(lineOf(budget, parent)).toMatchObject({ median: 10_000, average: 15_000 });
		expect(lineOf(budget, works)).toMatchObject({ median: 10_000, average: 10_000 });
	});

	it("refuses a month not set up, and writes nothing", async () => {
		await openOwn();
		const groceries = await ownCategory("Courses");

		const { status, body } = await put("2026-09", groceries, "100");

		expect(status).toBe(409);
		expect(errorBody.parse(body).error.code).toBe("BUDGET_NOT_SET_UP");
		await expect(amountRows()).resolves.toEqual([]);
	});

	it("refuses an income category or an unknown one, and writes nothing", async () => {
		await openOwn();
		const salary = await ownCategory("Salaire", { kind: "income" });
		await save("2026-09", "1 000", "0");

		const refused = await Promise.all([
			put("2026-09", salary, "100"),
			put("2026-09", "inconnue", "100"),
		]);

		expect(refused.map(({ status, body }) => [status, errorBody.parse(body).error.code])).toEqual([
			[404, "NOT_FOUND"],
			[404, "NOT_FOUND"],
		]);
		await expect(amountRows()).resolves.toEqual([]);
	});

	it("refuses a month out of bounds", async () => {
		await openOwn({ openingDate: "2026-09-01" });
		const groceries = await ownCategory("Courses");

		const { status, body } = await put("2028-10", groceries, "100");

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
	});

	it.each([
		["a negative amount", "-5", "negative_amount"],
		["text", "cent euros", "invalid_amount"],
	])("refuses %s, and writes nothing", async (_label, budgetedSpending, code) => {
		await openOwn();
		const groceries = await ownCategory("Courses");
		await save("2026-09", "1 000", "0");

		const { status, body } = await put("2026-09", groceries, budgetedSpending);

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "budgetedSpending", code }],
		});
		await expect(amountRows()).resolves.toEqual([]);
	});

	it("requires the amount as text", async () => {
		await openOwn();
		const groceries = await ownCategory("Courses");

		const { status, body } = await ownRequest(
			"PUT",
			`/api/budgets/2026-09/categories/${groceries}`,
			{
				budgetedSpending: 100,
			},
		);

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "budgetedSpending", code: "invalid_type" },
		]);
	});
});
