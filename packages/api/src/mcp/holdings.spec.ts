import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createLogger } from "../lib/logger.ts";
import { openOwn, ownDatabase, pea, sendOwn, template, useSignedInApp } from "../testing/app.ts";
import { callTool, connect, registerClient } from "../testing/assistant.ts";
import { buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

// The clock stands at 2026-09-21; each test has a household of its own.

const holding = z.object({
	ticker: z.string().nullable(),
	name: z.string(),
	quantity: z.string(),
	price: z.string(),
	currency: z.string(),
	amount: z.string(),
	weight: z.string().nullable(),
	average_cost: z.string().nullable(),
	account: z.object({ id: z.string(), name: z.string() }),
	date: z.string(),
	security_id: z.string(),
	isin: z.string().nullable(),
	exchange_mic: z.string().nullable(),
	price_date: z.string(),
	average_cost_locked: z.boolean(),
	book_value: z.string().nullable(),
	gain: z.string().nullable(),
	gain_percent: z.string().nullable(),
});

const holdings = z.strictObject({
	holdings: z.array(holding),
	total_results: z.number(),
	page: z.number(),
	page_size: z.number(),
	total_pages: z.number(),
	total_value: z.string(),
	currency: z.string(),
	left_out_count: z.number(),
	left_out_account_ids: z.array(z.string()),
});

const tradeBody = z.object({ data: z.object({ security: z.object({ id: z.string() }) }) });

/** Buys `quantity` at `price` on 2026-09-10, answering the security's id. */
async function buy(
	accountId: string,
	security: Record<string, string | null>,
	quantity: string,
	price: string,
) {
	const body = await sendOwn("POST", `/api/accounts/${accountId}/trades`, {
		side: "buy",
		security,
		date: "2026-09-10",
		quantity,
		price,
		fee: "0",
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

	const auth = createTestAuth(db);
	const app = buildTestApp(db, createLogger("silent"), auth);
	const session = withSession(buildTestApp(db, createLogger("silent"), auth), template.cookie);
	const token = (await connect(session, app, await registerClient(app))).access_token;

	return {
		accounts: { alice, brokerage, old, dollars },
		airLiquideId,
		read: (args: unknown) => callTool(app, token, "get_holdings", args),
	};
}

const read = async (tools: Awaited<ReturnType<typeof portfolio>>, args: unknown) =>
	holdings.parse((await tools.read(args)).structuredContent);

describe("get_holdings", () => {
	it("lists every active investment account's positions by value, as Sure's", async () => {
		const tools = await portfolio();
		const { alice, brokerage, dollars } = tools.accounts;

		const result = await read(tools, { page: 1 });

		expect(
			result.holdings.map((row) => [row.account.name, row.name, row.amount, row.currency]),
		).toEqual([
			["Compte-titres", "Air Liquide", "3000.00", "EUR"],
			["PEA Alice", "Air Liquide", "1500.00", "EUR"],
			["Courtier US", "Apple", "600.00", "USD"],
			["PEA Alice", "Fonds euros", "500.00", "EUR"],
		]);
		expect(result.holdings[1]).toEqual({
			ticker: "AI.PA",
			name: "Air Liquide",
			quantity: "10",
			price: "150",
			currency: "EUR",
			amount: "1500.00",
			// 1 500,00 of the account's 10 000,00: its cash and its two positions.
			weight: "15",
			average_cost: "150",
			account: { id: alice.id, name: "PEA Alice" },
			date: "2026-09-21",
			security_id: tools.airLiquideId,
			isin: null,
			exchange_mic: "XPAR",
			price_date: "2026-09-10",
			average_cost_locked: false,
			book_value: "1500.00",
			gain: "0.00",
			gain_percent: "0",
		});
		expect(result).toMatchObject({
			total_results: 4,
			page: 1,
			page_size: 50,
			total_pages: 1,
			// The dollars are left out, and named.
			total_value: "5000.00",
			currency: "EUR",
			left_out_count: 1,
			left_out_account_ids: [dollars.id],
		});
		expect(result.holdings.map((row) => row.account.id)).not.toContain(tools.accounts.old.id);
		expect(brokerage.id).not.toBe(alice.id);
	});

	it("narrows by ticker, case aside, and by account name or id, as Sure's filters", async () => {
		const tools = await portfolio();
		const { alice, brokerage, old } = tools.accounts;

		const byTicker = await read(tools, { page: 1, securities: ["ai.pa"] });
		const byName = await read(tools, { page: 1, accounts: ["PEA Alice"] });
		const byId = await read(tools, { page: 1, account_ids: [brokerage.id] });
		const narrowed = await read(tools, {
			page: 1,
			accounts: ["PEA Alice"],
			account_ids: [brokerage.id],
		});
		const inactive = await read(tools, { page: 1, account_ids: [old.id] });

		expect(byTicker.holdings.map((row) => row.account.id)).toEqual([brokerage.id, alice.id]);
		expect(byTicker).toMatchObject({ total_results: 2, total_value: "4500.00", left_out_count: 0 });
		expect(byName.holdings.map((row) => row.name)).toEqual(["Air Liquide", "Fonds euros"]);
		expect(byName.total_value).toBe("2000.00");
		expect(byId.holdings.map((row) => row.amount)).toEqual(["3000.00"]);
		expect(narrowed).toMatchObject({ holdings: [], total_results: 0, total_value: "0.00" });
		expect(inactive.total_results).toBe(0);
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
