import { describe, expect, it, vi } from "vitest";

import {
	buildApp,
	car,
	cashFlowOf,
	errorBody,
	expense,
	home,
	listed,
	mortgage,
	netWorthOf,
	openOwn,
	own,
	ownCard,
	ownCategory,
	pea,
	postOwn,
	request,
	sendOwn,
	useSignedInApp,
} from "../testing/app.ts";

useSignedInApp();

async function patchOwn(accountId: string, body: unknown) {
	const response = await buildApp(own?.db).request(`/api/accounts/${accountId}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

	expect(response.status).toBe(200);
}

describe("GET /api/reports/net-worth", () => {
	it("subtracts what a loan still owes", async () => {
		await openOwn({ openingBalance: "200 000,00" });
		await openOwn(mortgage);

		await expect(netWorthOf()).resolves.toMatchObject({
			netWorth: 2000000,
			assets: 20000000,
			liabilities: 18000000,
		});
	});

	it("adds what a PEA is worth to the assets", async () => {
		await openOwn({ openingBalance: "1 000,00" });
		await openOwn(pea);

		await expect(netWorthOf()).resolves.toMatchObject({
			netWorth: 2600000,
			assets: 2600000,
			liabilities: 0,
		});
	});

	it("adds what a home and a car are worth to the assets", async () => {
		await openOwn({ openingBalance: "1 000,00" });
		await openOwn(home);
		await openOwn(car);

		await expect(netWorthOf()).resolves.toMatchObject({
			netWorth: 33950000,
			assets: 33950000,
			liabilities: 0,
		});
	});

	it("subtracts what a card owes from what the checking account holds", async () => {
		await openOwn({ openingBalance: "1 000,00" });
		await openOwn(ownCard);

		const data = await netWorthOf();

		expect(data).toMatchObject({
			period: "1M",
			from: "2026-09-01",
			to: "2026-09-21",
			currency: "EUR",
			netWorth: 70000,
			assets: 100000,
			liabilities: 30000,
			change: { amount: 0, percent: 0 },
			leftOut: [],
		});
		expect(data.points).toHaveLength(21);
		expect(data.points.at(-1)).toEqual({ date: "2026-09-21", balance: 70000 });
	});

	it("starts at the earliest opening and adds a later account from its own opening", async () => {
		await openOwn({ openingDate: "2026-07-23", openingBalance: "1 000,00" });
		await openOwn({
			name: "Livret A",
			subtype: "savings",
			openingDate: "2026-09-11",
			openingBalance: "500,00",
		});

		const data = await netWorthOf("3M");

		expect(data.from).toBe("2026-07-23");
		expect(data.points[0]).toEqual({ date: "2026-07-23", balance: 100000 });
		expect(data.points.find((point) => point.date === "2026-09-10")?.balance).toBe(100000);
		expect(data.points.find((point) => point.date === "2026-09-11")?.balance).toBe(150000);
		expect(data.change).toEqual({ amount: 50000, percent: 50 });
	});

	it("carries an untouched account's balance forward to today", async () => {
		await openOwn({ openingBalance: "1 000,00" });
		vi.setSystemTime(new Date("2026-10-11T10:00:00Z"));

		const data = await netWorthOf();

		expect(data).toMatchObject({ from: "2026-09-11", to: "2026-10-11", netWorth: 100000 });
		expect(data.points).toHaveLength(31);
		expect(data.points.at(-1)).toEqual({ date: "2026-10-11", balance: 100000 });
	});

	it("ends today, leaving out a transaction dated tomorrow", async () => {
		const account = await openOwn({ openingBalance: "1 000,00" });
		await postOwn(account.id, { ...expense, date: "2026-09-22", amount: "-100,00" });

		const data = await netWorthOf();

		expect(data.netWorth).toBe(100000);
		expect(data.points.at(-1)).toEqual({ date: "2026-09-21", balance: 100000 });
	});

	it("leaves an excluded and an inactive account out of totals, points and notice", async () => {
		await openOwn({ openingBalance: "1 000,00" });
		const excluded = await openOwn({ name: "Livret A", subtype: "savings" });
		const inactive = await openOwn(ownCard);
		await patchOwn(excluded.id, { excludedFromReports: true });
		await patchOwn(inactive.id, { active: false });

		const data = await netWorthOf();

		expect(data).toMatchObject({ netWorth: 100000, assets: 100000, liabilities: 0, leftOut: [] });
		expect(data.points.every((point) => point.balance === 100000)).toBe(true);
	});

	it("names active, reported accounts in another currency by name instead of counting them", async () => {
		await openOwn({ openingBalance: "1 000,00" });
		const usd = await openOwn({ name: "Épargne US", currency: "USD", openingBalance: "10.00" });
		const chf = await openOwn({ name: "Compte suisse", currency: "CHF", openingBalance: "10.00" });
		const excluded = await openOwn({ name: "Exclu", currency: "USD", openingBalance: "10.00" });
		const inactive = await openOwn({ name: "Inactif", currency: "CHF", openingBalance: "10.00" });
		await patchOwn(excluded.id, { excludedFromReports: true });
		await patchOwn(inactive.id, { active: false });

		const data = await netWorthOf();

		expect(data).toMatchObject({ netWorth: 100000, assets: 100000 });
		expect(data.leftOut).toEqual([
			{ id: chf.id, name: "Compte suisse", currency: "CHF" },
			{ id: usd.id, name: "Épargne US", currency: "USD" },
		]);
		expect(data.points.at(-1)?.balance).toBe(100000);
	});

	it("adds nothing for a counted account opening after today", async () => {
		await openOwn({ openingBalance: "1 000,00" });
		await openOwn({ name: "Livret A", subtype: "savings", openingDate: "2026-09-30" });

		const data = await netWorthOf();

		expect(data).toMatchObject({ from: "2026-09-01", netWorth: 100000, assets: 100000 });
		expect(data.points).toHaveLength(21);
		expect(data.points.every((point) => point.balance === 100000)).toBe(true);
	});

	it("gives the amount alone when the period starts at zero", async () => {
		const account = await openOwn({ openingBalance: "0" });
		await postOwn(account.id, { ...expense, amount: "500,00" });

		const data = await netWorthOf();

		expect(data.points[0]?.balance).toBe(0);
		expect(data.change).toEqual({ amount: 50000, percent: null });
	});

	it("measures a rise from a negative start against its size", async () => {
		const card = await openOwn({ ...ownCard, openingBalance: "200,00" });
		await postOwn(card.id, { ...expense, label: "Remboursement", amount: "100,00" });

		const data = await netWorthOf();

		expect(data.points[0]?.balance).toBe(-20000);
		expect(data.netWorth).toBe(-10000);
		expect(data.change).toEqual({ amount: 10000, percent: 50 });
	});

	it("is empty without any account", async () => {
		await expect(netWorthOf("all")).resolves.toEqual({
			period: "all",
			from: null,
			to: "2026-09-21",
			currency: "EUR",
			netWorth: 0,
			assets: 0,
			liabilities: 0,
			points: [],
			change: null,
			leftOut: [],
		});
	});

	it("is empty when every account is excluded", async () => {
		const account = await openOwn();
		await patchOwn(account.id, { excludedFromReports: true });

		await expect(netWorthOf()).resolves.toMatchObject({
			from: null,
			netWorth: 0,
			assets: 0,
			liabilities: 0,
			points: [],
			change: null,
		});
	});

	it("refuses an unknown period", async () => {
		const { status, body } = await request("GET", "/api/reports/net-worth?period=2W");

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "period", code: "invalid_value" }],
		});
	});
});

/** A line of the cash-flow breakdown, in the colour and icon `category()` gives. */
const line = (
	categoryId: string | null,
	name: string | null,
	amount: number,
	share: number | null = 1,
) => ({
	categoryId,
	name,
	color: categoryId === null ? null : "#e99537",
	icon: categoryId === null ? null : "tag",
	amount,
	share,
});

const refusedReport = async (query: string, code: string) => {
	const { status, body } = await request("GET", `/api/reports/cash-flow${query}`);

	expect(status).toBe(400);
	expect(errorBody.parse(body).error).toMatchObject({
		code: "VALIDATION_ERROR",
		fields: [{ path: "month", code }],
	});
};

async function spend(accountId: string, amount: string, categoryId?: string, date = "2026-09-10") {
	const id = await postOwn(accountId, { date, label: "Opération", amount });

	if (categoryId !== undefined) {
		await sendOwn("PATCH", `/api/transactions/${id}`, { categoryId });
	}

	return id;
}

describe("GET /api/reports/cash-flow", () => {
	// Opened before September, so a row can sit on the month's first day.
	const august = { openingDate: "2026-08-01" } as const;

	it("rolls a sub-category up into its parent", async () => {
		const account = await openOwn(august);
		const courses = await ownCategory("Courses");
		const bio = await ownCategory("Bio", { parentId: courses });
		await spend(account.id, "-30,00", courses);
		await spend(account.id, "-20,00", bio);

		const data = await cashFlowOf("2026-09");

		expect(data).toEqual({
			month: "2026-09",
			from: "2026-09-01",
			to: "2026-09-30",
			currency: "EUR",
			income: 0,
			expenses: -5000,
			lines: { income: [], expense: [line(courses, "Courses", -5000)] },
			leftOut: [],
		});
	});

	it("lowers a category and « Dépenses » by a refund, Sure's net view", async () => {
		const account = await openOwn(august);
		const courses = await ownCategory("Courses");
		await spend(account.id, "-80,00", courses);
		await spend(account.id, "20,00", courses);

		const data = await cashFlowOf("2026-09");

		expect(data.expenses).toBe(-6000);
		expect(data.lines.expense).toEqual([line(courses, "Courses", -6000)]);
	});

	it("nets « Sans catégorie » into an income line of +60 €, where it split into +100 € and −40 €", async () => {
		const account = await openOwn(august);
		await spend(account.id, "100,00");
		await spend(account.id, "-40,00");

		const data = await cashFlowOf("2026-09");

		expect(data).toMatchObject({
			income: 6000,
			expenses: 0,
			lines: { income: [line(null, null, 6000)], expense: [] },
		});
	});

	it("leaves out excluded rows, internal moves, card payments and uncounted accounts", async () => {
		const checking = await openOwn({ ...august, name: "Compte courant" });
		const livret = await openOwn({ ...august, name: "Livret A", subtype: "savings" });
		const card = await openOwn({ ...august, ...ownCard });
		const excludedAccount = await openOwn({ ...august, name: "Exclu" });
		const inactive = await openOwn({ ...august, name: "Inactif" });
		const dollars = await openOwn({ ...august, name: "US", currency: "USD", openingBalance: "0" });
		await patchOwn(excludedAccount.id, { excludedFromReports: true });
		await patchOwn(inactive.id, { active: false });
		await spend(checking.id, "-12,00");
		const excluded = await spend(checking.id, "-13,00");
		await sendOwn("PATCH", `/api/transactions/${excluded}`, { excluded: true });
		// Each pair links on creation: same amount, opposite signs, days apart.
		await spend(checking.id, "-500,00", undefined, "2026-09-11");
		await spend(livret.id, "500,00", undefined, "2026-09-12");
		await spend(checking.id, "-300,00", undefined, "2026-09-14");
		await spend(card.id, "300,00", undefined, "2026-09-14");
		await spend(excludedAccount.id, "-14,00");
		await spend(inactive.id, "-15,00");
		await spend(dollars.id, "-16.00");
		const transfers = await listed("?direction=transfer");
		expect(transfers.items).toHaveLength(4);

		const data = await cashFlowOf("2026-09");

		expect(data).toMatchObject({
			income: 0,
			expenses: -1200,
			lines: { income: [], expense: [line(null, null, -1200)] },
		});
	});

	it("leaves a one-time −900 € out of « Dépenses », where it counted, and the list's total keeps it", async () => {
		const account = await openOwn(august);
		const appliances = await ownCategory("Électroménager");
		const oneTime = await spend(account.id, "-900,00", appliances);
		await sendOwn("PATCH", `/api/transactions/${oneTime}`, { oneTime: true });
		await spend(account.id, "-12,00");

		const data = await cashFlowOf("2026-09");
		const list = await listed(`?account=${account.id}`);

		expect(data).toMatchObject({
			expenses: -1200,
			lines: { income: [], expense: [line(null, null, -1200)] },
		});
		expect(list).toMatchObject({ total: 2, sum: { amount: -91_200, expense: -91_200 } });
	});

	it("counts a loan payment's outflow in « Dépenses », its loan side in neither", async () => {
		const checking = await openOwn({ ...august, name: "Compte courant" });
		const loan = await openOwn({ ...august, ...mortgage });
		const outflow = await spend(checking.id, "-1 200,00", undefined, "2026-09-12");
		const inflow = await spend(loan.id, "1 200,00", undefined, "2026-09-12");
		const [matched] = (await listed("?direction=transfer")).items;
		expect(matched?.transfer?.kind).toBe("loan_payment");

		const data = await cashFlowOf("2026-09");

		expect(data).toMatchObject({
			income: 0,
			expenses: -120000,
			lines: { income: [], expense: [line(null, null, -120000)] },
		});
		// The « Sans catégorie » drill-down lists what the line counts.
		const drilled = await listed("?category=none&from=2026-09-01&to=2026-09-30");
		expect(drilled.items.map((item) => item.id)).toEqual([outflow]);
		expect(drilled.items.map((item) => item.id)).not.toContain(inflow);
	});

	it("counts a contribution's outflow in « Dépenses », its PEA side in neither", async () => {
		const checking = await openOwn({ ...august, name: "Compte courant" });
		const account = await openOwn({ ...august, ...pea });
		const outflow = await spend(checking.id, "-500,00", undefined, "2026-09-12");
		const inflow = await spend(account.id, "500,00", undefined, "2026-09-12");
		const [matched] = (await listed("?direction=transfer")).items;
		expect(matched?.transfer?.kind).toBe("investment_contribution");

		const data = await cashFlowOf("2026-09");

		expect(data).toMatchObject({
			income: 0,
			expenses: -50000,
			lines: { income: [], expense: [line(null, null, -50000)] },
		});
		const drilled = await listed("?category=none&from=2026-09-01&to=2026-09-30");
		expect(drilled.items.map((item) => item.id)).toEqual([outflow]);
		expect(drilled.items.map((item) => item.id)).not.toContain(inflow);
	});

	it("counts nothing of a PEA's own line, where it was a −15 € expense, as Sure leaves tax-advantaged accounts out", async () => {
		const checking = await openOwn({ ...august, name: "Compte courant" });
		const account = await openOwn({ ...august, ...pea });
		await spend(account.id, "-15,00");
		await spend(checking.id, "-12,00");

		await expect(cashFlowOf("2026-09")).resolves.toMatchObject({
			income: 0,
			expenses: -1200,
			lines: { income: [], expense: [line(null, null, -1200)] },
		});
	});

	it("counts a loan payment's outflow in the category picked on it", async () => {
		const checking = await openOwn({ ...august, name: "Compte courant" });
		const loan = await openOwn({ ...august, ...mortgage });
		const housing = await ownCategory("Logement");
		const outflow = await spend(checking.id, "-1 200,00", undefined, "2026-09-12");
		await spend(loan.id, "1 200,00", undefined, "2026-09-12");
		const [matched] = (await listed("?direction=transfer")).items;
		expect(matched?.transfer?.kind).toBe("loan_payment");

		await sendOwn("PATCH", `/api/transactions/${outflow}`, { categoryId: housing });
		const data = await cashFlowOf("2026-09");

		expect(data).toMatchObject({
			expenses: -120000,
			lines: { income: [], expense: [line(housing, "Logement", -120000)] },
		});
		const drilled = await listed(`?category=${housing}&from=2026-09-01&to=2026-09-30`);
		expect(drilled.items.map((item) => item.id)).toEqual([outflow]);
	});

	it("keeps and counts the category a contribution had before its match", async () => {
		const checking = await openOwn({ ...august, name: "Compte courant" });
		const account = await openOwn({ ...august, ...pea });
		const savings = await ownCategory("Épargne");
		const outflow = await spend(checking.id, "-500,00", savings, "2026-09-12");
		await spend(account.id, "500,00", undefined, "2026-09-12");
		const [matched] = (await listed("?direction=transfer")).items;
		expect(matched?.transfer?.kind).toBe("investment_contribution");

		const data = await cashFlowOf("2026-09");

		expect(data).toMatchObject({
			expenses: -50000,
			lines: { income: [], expense: [line(savings, "Épargne", -50000)] },
		});
		const { items } = await listed(`?category=${savings}`);
		expect(items.map((item) => item.id)).toEqual([outflow]);
		expect(items[0]?.categoryId).toBe(savings);
	});

	it("counts neither side of a move between two investments", async () => {
		const account = await openOwn({ ...august, ...pea });
		const lifeInsurance = await openOwn({
			...august,
			...pea,
			name: "Assurance-vie",
			subtype: "assurance_vie",
		});
		await spend(account.id, "-700,00", undefined, "2026-09-12");
		await spend(lifeInsurance.id, "700,00", undefined, "2026-09-12");
		const [matched] = (await listed("?direction=transfer")).items;
		expect(matched?.transfer?.kind).toBe("internal_move");

		const data = await cashFlowOf("2026-09");

		expect(data).toMatchObject({ income: 0, expenses: 0, lines: { income: [], expense: [] } });
	});

	it("counts neither side of a move into a home", async () => {
		const checking = await openOwn({ ...august, name: "Compte courant" });
		const account = await openOwn({ ...august, ...home });
		await spend(checking.id, "-2 000,00", undefined, "2026-09-12");
		await spend(account.id, "2 000,00", undefined, "2026-09-12");
		const [matched] = (await listed("?direction=transfer")).items;
		expect(matched?.transfer?.kind).toBe("internal_move");

		const data = await cashFlowOf("2026-09");

		expect(data).toMatchObject({ income: 0, expenses: 0, lines: { income: [], expense: [] } });
	});

	it("leaves out a transfer side put in a category before its match", async () => {
		const checking = await openOwn({ ...august, name: "Compte courant" });
		const livret = await openOwn({ ...august, name: "Livret A", subtype: "savings" });
		const courses = await ownCategory("Courses");
		const outflow = await spend(checking.id, "-500,00", courses);
		await spend(livret.id, "500,00", undefined, "2026-09-12");
		const matched = (await listed("?direction=transfer")).items.find((item) => item.id === outflow);
		expect(matched?.transfer).not.toBeNull();

		const data = await cashFlowOf("2026-09");

		expect(data).toMatchObject({ income: 0, expenses: 0, lines: { income: [], expense: [] } });
	});

	it("counts the month's first and last days, not the next month's first", async () => {
		const account = await openOwn(august);
		await spend(account.id, "-1,00", undefined, "2026-08-31");
		await spend(account.id, "-2,00", undefined, "2026-09-01");
		await spend(account.id, "-4,00", undefined, "2026-09-30");
		await spend(account.id, "-8,00", undefined, "2026-10-01");

		await expect(cashFlowOf("2026-09")).resolves.toMatchObject({ expenses: -600 });
	});

	it("puts an income-kind category that spends on the expense side, where it lowered income to zero", async () => {
		const account = await openOwn(august);
		const salaire = await ownCategory("Salaire", { kind: "income" });
		const primes = await ownCategory("Primes", { kind: "income" });
		await spend(account.id, "50,00", salaire);
		await spend(account.id, "-50,00", primes);

		const data = await cashFlowOf("2026-09");

		expect(data).toMatchObject({
			income: 5000,
			expenses: -5000,
			lines: {
				income: [line(salaire, "Salaire", 5000)],
				expense: [line(primes, "Primes", -5000)],
			},
		});
	});

	it("is zero with empty lines for a month without counted rows", async () => {
		await openOwn(august);

		await expect(cashFlowOf("2026-02")).resolves.toEqual({
			month: "2026-02",
			from: "2026-02-01",
			to: "2026-02-28",
			currency: "EUR",
			income: 0,
			expenses: 0,
			lines: { income: [], expense: [] },
			leftOut: [],
		});
	});

	it("refuses a month that does not exist, or none", async () => {
		await refusedReport("?month=2026-13", "invalid_format");
		await refusedReport("?month=2026-9", "invalid_format");
		await refusedReport("", "invalid_type");
	});
});
