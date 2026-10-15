import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createLogger } from "../lib/logger.ts";
import { openOwn, ownDatabase, pea, sendOwn, template, useSignedInApp } from "../testing/app.ts";
import { callTool, connect, registerClient } from "../testing/assistant.ts";
import { buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

// The clock stands at 2026-09-21; each test has a household of its own.

const holding = z.strictObject({
	ticker: z.string().nullable(),
	name: z.string(),
	quantity: z.number(),
	price: z.number(),
	currency: z.string(),
	amount: z.number(),
	formatted_amount: z.string(),
	weight: z.union([z.string(), z.number()]),
	average_cost: z.number().nullable(),
	formatted_average_cost: z.string().nullable(),
	account: z.string(),
	date: z.string(),
});

const holdings = z.strictObject({
	holdings: z.array(holding),
	total_results: z.number(),
	page: z.number(),
	page_size: z.number(),
	total_pages: z.number(),
	total_value: z.string(),
});

/** Sure's `Money#format` in French, with its non-breaking spaces. */
const euros = (text: string) => `${text.replaceAll(" ", "\u00A0")}\u00A0€`;

const tradeBody = z.object({ data: z.object({ security: z.object({ id: z.string() }) }) });

/** Buys, or sells, `quantity` at `price`, on 2026-09-10 unless told, answering the security's id. */
async function buy(
	accountId: string,
	security: Record<string, string | null>,
	quantity: string,
	price: string,
	trade: { side?: "buy" | "sell"; date?: string; fee?: string } = {},
) {
	const body = await sendOwn("POST", `/api/accounts/${accountId}/trades`, {
		side: trade.side ?? "buy",
		security,
		date: trade.date ?? "2026-09-10",
		quantity,
		price,
		fee: trade.fee ?? "0",
	});

	return tradeBody.parse(body).data.security.id;
}

const airLiquide = {
	source: "listing",
	ticker: "AI.PA",
	mic: "XPAR",
	name: "Air Liquide",
	currency: "EUR",
	provider: "yahoo",
};

/**
 * Two PEA-like accounts holding Air Liquide, one a fund typed by hand too, an
 * inactive one, a brokerage account in dollars, and a checking account.
 */
async function portfolio() {
	const { db } = await ownDatabase();
	const opened = { ...pea, openingBalance: "10 000,00", openingDate: "2026-09-01" };
	const alice = await openOwn({ ...opened, name: "PEA Alice" });
	const brokerage = await openOwn({ ...opened, name: "Compte-titres", subtype: "brokerage" });
	const old = await openOwn({ ...opened, name: "Ancien PEA" });
	const dollars = await openOwn({
		...opened,
		name: "Courtier US",
		subtype: "brokerage",
		currency: "USD",
	});
	await openOwn({ name: "Compte courant", openingDate: "2026-09-01" });

	const airLiquideId = await buy(alice.id, airLiquide, "10", "150");
	const fundId = await buy(
		alice.id,
		{ source: "manual", name: "Fonds euros", isin: "FR0010315770" },
		"5",
		"100",
	);
	await buy(brokerage.id, { source: "known", id: airLiquideId }, "20", "150");
	await buy(old.id, { source: "known", id: fundId }, "1", "1000");
	await sendOwn("PATCH", `/api/accounts/${old.id}`, { active: false });
	await buy(
		dollars.id,
		{ ...airLiquide, ticker: "AAPL", mic: "XNAS", name: "Apple", currency: "USD" },
		"3",
		"200",
	);

	return {
		accounts: { alice, brokerage, old, dollars },
		airLiquideId,
		read: await reader(db),
	};
}

/** `get_holdings` through the MCP handler, with a read token of the household. */
async function reader(db: Awaited<ReturnType<typeof ownDatabase>>["db"]) {
	const auth = createTestAuth(db);
	const app = buildTestApp(db, createLogger("silent"), auth);
	const session = withSession(buildTestApp(db, createLogger("silent"), auth), template.cookie);
	const token = (await connect(session, app, await registerClient(app))).access_token;

	return (args: unknown) => callTool(app, token, "get_holdings", args);
}

const read = async (tools: { read: Awaited<ReturnType<typeof reader>> }, args: unknown) =>
	holdings.parse((await tools.read(args)).structuredContent);

/** One investment account opened on 2026-03-01 with `openingBalance`, and its reader. */
async function single(openingBalance: string, currency: "EUR" | "JPY" = "EUR") {
	const { db } = await ownDatabase();
	const account = await openOwn({ ...pea, openingBalance, currency, openingDate: "2026-03-01" });

	return { account, read: await reader(db) };
}

const fund = (name: string) => ({ source: "manual", name });

describe("get_holdings", () => {
	it("lists every active investment account's holdings by value, Sure's fields exactly", async () => {
		const tools = await portfolio();

		const result = await read(tools, { page: 1 });

		expect(Object.keys(result)).toEqual([
			"holdings",
			"total_results",
			"page",
			"page_size",
			"total_pages",
			"total_value",
		]);
		expect(result.holdings.map((row) => [row.account, row.name, row.amount, row.currency])).toEqual(
			[
				["Compte-titres", "Air Liquide", 3000, "EUR"],
				["PEA Alice", "Air Liquide", 1500, "EUR"],
				["Courtier US", "Apple", 600, "USD"],
				["PEA Alice", "Fonds euros", 500, "EUR"],
			],
		);
		expect(Object.keys(result.holdings[1] ?? {})).toEqual([
			"ticker",
			"name",
			"quantity",
			"price",
			"currency",
			"amount",
			"formatted_amount",
			"weight",
			"average_cost",
			"formatted_average_cost",
			"account",
			"date",
		]);
		expect(result.holdings[1]).toEqual({
			ticker: "AI.PA",
			name: "Air Liquide",
			quantity: 10,
			price: 150,
			currency: "EUR",
			amount: 1500,
			formatted_amount: euros("1 500,00"),
			// 1 500,00 of the account's 10 000,00 balance, as Rails writes a `BigDecimal`.
			weight: "15.0",
			average_cost: 150,
			formatted_average_cost: euros("150,00"),
			account: "PEA Alice",
			date: "2026-09-21",
		});
		expect(result.holdings[2]?.formatted_amount).toBe("600,00\u00A0$");
		expect(result).toMatchObject({
			total_results: 4,
			page: 1,
			page_size: 50,
			total_pages: 1,
			// The dollars are left out: there are no exchange rates (AD-6).
			total_value: euros("5 000,00"),
		});
		expect(result.holdings.map((row) => row.account)).not.toContain("Ancien PEA");
	});

	it("narrows by ticker, case aside, and by account name or id, as Sure's filters", async () => {
		const tools = await portfolio();
		const { brokerage, old } = tools.accounts;

		const byTicker = await read(tools, { page: 1, securities: ["ai.pa"] });
		const byName = await read(tools, { page: 1, accounts: ["PEA Alice"] });
		const byId = await read(tools, { page: 1, account_ids: [brokerage.id] });
		const narrowed = await read(tools, {
			page: 1,
			accounts: ["PEA Alice"],
			account_ids: [brokerage.id],
		});
		const inactive = await read(tools, { page: 1, account_ids: [old.id] });

		expect(byTicker.holdings.map((row) => row.account)).toEqual(["Compte-titres", "PEA Alice"]);
		expect(byTicker).toMatchObject({ total_results: 2, total_value: euros("4 500,00") });
		expect(byName.holdings.map((row) => row.name)).toEqual(["Air Liquide", "Fonds euros"]);
		expect(byName.total_value).toBe(euros("2 000,00"));
		expect(byId.holdings.map((row) => row.amount)).toEqual([3000]);
		expect(narrowed).toMatchObject({ holdings: [], total_results: 0, total_value: euros("0,00") });
		expect(inactive.total_results).toBe(0);
	});

	it("lists a security sold out at its last held quantity and day, counted in total_value", async () => {
		const tools = await single("10 000,00");
		const fundId = await buy(tools.account.id, fund("Fonds vendu"), "10", "150", {
			date: "2026-03-02",
		});
		await buy(tools.account.id, { source: "known", id: fundId }, "10", "150", {
			side: "sell",
			date: "2026-06-01",
		});
		await buy(tools.account.id, fund("Fonds gardé"), "2", "100");

		const result = await read(tools, { page: 1 });

		expect(
			result.holdings.map(({ name, quantity, amount, date }) => ({ name, quantity, amount, date })),
		).toEqual([
			{ name: "Fonds vendu", quantity: 10, amount: 1500, date: "2026-05-31" },
			{ name: "Fonds gardé", quantity: 2, amount: 200, date: "2026-09-21" },
		]);
		// Sure sums the query it lists: the sold-out row counts.
		expect(result.total_value).toBe(euros("1 700,00"));
	});

	it("lists a position sold below zero at its last quantity, which is not zero, as Sure's `qty <> 0`", async () => {
		const tools = await single("10 000,00");
		const fundId = await buy(tools.account.id, fund("Fonds"), "10", "150", { date: "2026-03-02" });
		await buy(tools.account.id, { source: "known", id: fundId }, "15", "150", {
			side: "sell",
			date: "2026-06-01",
		});

		const result = await read(tools, { page: 1 });

		expect(result.holdings).toMatchObject([
			{
				name: "Fonds",
				quantity: -5,
				amount: -750,
				weight: "-7.5",
				average_cost: null,
				date: "2026-09-21",
			},
		]);
	});

	it("writes weight as Sure's Holding#weight: two decimals as text, 1 on a zero balance, 0 on a zero amount", async () => {
		const third = await single("750,00");
		await buy(third.account.id, fund("Un tiers"), "1", "250");
		const whole = await single("150,00");
		await buy(whole.account.id, fund("Tout"), "1", "150");
		const zero = await single("0,00");
		await buy(zero.account.id, fund("Sans solde"), "10", "150");
		const negative = await single("-400,00");
		await buy(negative.account.id, fund("Découvert"), "1", "100");
		const half = await single("800,00");
		await buy(half.account.id, fund("Un huitième"), "1", "100");
		const tiny = await single("-100 000,00");
		await buy(tiny.account.id, fund("Un centime"), "1", "0,01");
		const free = await single("500,00");
		await buy(free.account.id, fund("Gratuit"), "5", "0");

		const weights = await Promise.all(
			[third, whole, zero, negative, half, tiny, free].map(async (tools) =>
				(await read(tools, { page: 1 })).holdings.map((row) => row.weight),
			),
		);

		// The last: -0.00001 rounds to zero, and `BigDecimal` keeps its sign.
		// A free share is held at a zero amount: Sure's early `0`, a JSON number.
		expect(weights).toEqual([["33.33"], ["100.0"], [1], ["-25.0"], ["12.5"], ["-0.0"], [0]]);
	});

	it("gives the average cost with each buy's fee, formatted rounded half up to the cent", async () => {
		const tools = await single("10 000,00");
		await buy(tools.account.id, fund("Avec frais"), "3", "100", { fee: "1,00" });

		const [row] = (await read(tools, { page: 1 })).holdings;

		expect(row).toMatchObject({
			average_cost: 100.333333,
			formatted_average_cost: euros("100,33"),
			amount: 300,
			formatted_amount: euros("300,00"),
		});

		const up = await single("10 000,00");
		await buy(up.account.id, fund("Frais arrondis"), "3", "100", { fee: "2,00" });
		const yen = await single("100 000", "JPY");
		await buy(yen.account.id, fund("Fonds en yens"), "3", "3", { fee: "2" });

		const [rounded] = (await read(up, { page: 1 })).holdings;
		const [whole] = (await read(yen, { page: 1 })).holdings;

		expect(rounded).toMatchObject({
			average_cost: 100.666667,
			formatted_average_cost: euros("100,67"),
		});
		// No minor unit: 3.666667 ¥ rounds half up to 4 ¥.
		expect(whole).toMatchObject({
			currency: "JPY",
			average_cost: 3.666667,
			formatted_average_cost: "4\u00A0¥",
			amount: 9,
			formatted_amount: "9\u00A0¥",
		});
	});

	it("answers Sure's page fields past the last page, and refuses a call without a page", async () => {
		const tools = await portfolio();

		const past = await read(tools, { page: 2 });
		const missing = await tools.read({});

		expect(past).toMatchObject({ holdings: [], total_results: 4, page: 2, total_pages: 1 });
		expect(missing.isError).toBe(true);
		expect(missing.content[0]?.text).toMatch(/^\{"error":"page invalid_type","hint":/u);
	});
});
