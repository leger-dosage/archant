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

const budgetBody = z.object({
	data: z.object({
		month: z.string(),
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
		const { courses } = await household();

		await expect(budgetOf("2026-09")).resolves.toEqual({
			month: "2026-09",
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
			suggested: { spending: 25_000, income: 250_000 },
			previousMonth: "2026-08",
			nextMonth: "2026-10",
			bounds: { from: "2024-09", to: "2028-09" },
			leftOut: [],
		});
		await expect(budgetRows()).resolves.toEqual([]);
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
