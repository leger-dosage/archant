import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
	balanceOf,
	balanceOnDay,
	buildApp,
	errorBody,
	openAccount,
	pea,
	postTransaction,
	request,
	temp,
	useSignedInApp,
} from "../testing/app.ts";
import { insertSecurity } from "../testing/prices.ts";

useSignedInApp();

const tradeBody = z.object({
	data: z
		.object({
			id: z.string(),
			security: z
				.object({
					id: z.string(),
					name: z.string(),
					ticker: z.string().nullable(),
					mic: z.string().nullable(),
					isin: z.string().nullable(),
				})
				.nullable(),
		})
		.passthrough(),
});

const accounts = () => testClient(buildApp()).api.accounts;

async function openPea() {
	return openAccount({ ...pea, openingDate: "2026-09-01" });
}

/** A listing of its own: the file's tests share one database, and a ticker is unique per venue. */
async function newSecurity(fields: Parameters<typeof insertSecurity>[1] = {}) {
	return insertSecurity(
		temp.db,
		{ ticker: `MC${crypto.randomUUID().slice(0, 8)}.PA`, ...fields },
		{ held: false },
	);
}

const lvmh = (id: string) => ({ source: "known" as const, id });

const buyBody = (securityId: string, overrides: Record<string, unknown> = {}) => ({
	side: "buy" as const,
	security: lvmh(securityId),
	date: "2026-09-10",
	quantity: "10",
	price: "612,40",
	fee: "2,50",
	...overrides,
});

async function postTrade(accountId: string, body: unknown) {
	return request("POST", `/api/accounts/${accountId}/trades`, body);
}

async function recorded(accountId: string, body: unknown) {
	const { status, body: answer } = await postTrade(accountId, body);

	expect(status, JSON.stringify(answer)).toBe(201);

	return tradeBody.parse(answer).data;
}

describe("POST /api/accounts/:id/trades", () => {
	it("records a buy, answers it with its numbers as decimal strings, and moves the balance", async () => {
		const account = await openPea();
		const securityId = await newSecurity({ ticker: "MCBUY.PA" });

		const response = await accounts()[":id"].trades.$post({
			param: { id: account.id },
			json: buyBody(securityId),
		});

		expect(response.status).toBe(201);
		const { data } = await response.json();
		expect(data).toEqual({
			id: data.id,
			accountId: account.id,
			date: "2026-09-10",
			side: "buy",
			quantity: "10",
			price: "612.4",
			fee: 250,
			amount: -612_650,
			currency: "EUR",
			security: {
				id: securityId,
				name: "LVMH",
				ticker: "MCBUY.PA",
				mic: "XPAR",
				isin: "FR0000121014",
			},
			convertedFrom: null,
		});
		await expect(balanceOnDay(account.id, "2026-09-09")).resolves.toBe(2_500_000);
		// The cash less the buy, the 10 shares at its price on top.
		await expect(balanceOf(account.id)).resolves.toBe(2_500_000 - 612_650 + 612_400);
	});

	it("records a sale of what is held, and refuses one above it with QUANTITY_UNAVAILABLE", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		await recorded(account.id, buyBody(securityId));

		const sale = await recorded(
			account.id,
			buyBody(securityId, {
				side: "sell",
				date: "2026-09-12",
				quantity: "4",
				price: "650",
				fee: "0",
			}),
		);
		const { status, body } = await postTrade(
			account.id,
			buyBody(securityId, { side: "sell", date: "2026-09-14", quantity: "6,5", fee: "0" }),
		);

		expect(sale).toMatchObject({ side: "sell", quantity: "4", amount: 260_000 });
		expect(status).toBe(409);
		expect(errorBody.parse(body).error).toEqual({
			code: "QUANTITY_UNAVAILABLE",
			message: "The account would sell more than it holds.",
		});
		// The 6 shares left at the sale's 650 €.
		await expect(balanceOf(account.id)).resolves.toBe(2_500_000 - 612_650 + 260_000 + 390_000);
	});

	it("creates a security typed by hand, and reuses it for the same ISIN", async () => {
		const account = await openPea();
		const manual = { source: "manual", isin: "fr0010 315770", name: "  Fonds euros  " };

		const first = await recorded(account.id, buyBody("", { security: manual }));
		const second = await recorded(account.id, buyBody("", { security: manual }));

		expect(first.security).toEqual({
			id: second.security?.id,
			name: "Fonds euros",
			ticker: null,
			mic: null,
			isin: "FR0010315770",
		});
		expect(second.id).not.toBe(first.id);
	});

	it("creates a listing from the search, its ticker upper-cased", async () => {
		const account = await openPea();
		const listing = {
			source: "listing",
			ticker: "ai.pa",
			mic: "XPAR",
			name: "Air Liquide",
			currency: "EUR",
			provider: "yahoo",
		};

		const trade = await recorded(account.id, buyBody("", { security: listing }));

		expect(trade.security).toMatchObject({ ticker: "AI.PA", mic: "XPAR", isin: null });
	});

	it("refuses a known security in another currency on the security", async () => {
		const account = await openPea();
		const dollars = await newSecurity({ currency: "USD" });

		const { status, body } = await postTrade(account.id, buyBody(dollars));

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "security", code: "currency_mismatch" },
		]);
	});

	it("refuses a trade on an account that is not an investment one", async () => {
		const account = await openAccount();
		const securityId = await newSecurity();

		const { status, body } = await postTrade(account.id, buyBody(securityId));

		expect(status).toBe(409);
		expect(errorBody.parse(body).error.code).toBe("NOT_AN_INVESTMENT_ACCOUNT");
	});

	it("answers NOT_FOUND for an unknown account", async () => {
		const { status } = await postTrade("nope", buyBody("nope"));

		expect(status).toBe(404);
	});

	it.each([
		[{ quantity: "0" }, "quantity", "invalid_quantity"],
		[{ quantity: "-1" }, "quantity", "invalid_quantity"],
		[{ quantity: "1,2345678" }, "quantity", "invalid_quantity"],
		[{ price: "abc" }, "price", "invalid_price"],
		[{ price: "-1" }, "price", "invalid_price"],
		[{ fee: "1,234" }, "fee", "invalid_amount"],
		[{ fee: "-1" }, "fee", "negative_amount"],
		[{ date: "10/09/2026" }, "date", "invalid_format"],
		[{ date: "2026-09-01" }, "date", "not_after_opening_date"],
		[{ date: "2026-09-22" }, "date", "date_in_future"],
		[{ quantity: "100 000", price: "1 000 000" }, "quantity", "too_big"],
		[
			{ security: { source: "manual", isin: "FR0000121015", name: "LVMH" } },
			"security.isin",
			"invalid_isin",
		],
		[{ security: { source: "manual", name: " " } }, "security.name", "too_small"],
	])("refuses %j on %s with %s", async (overrides, path, code) => {
		const account = await openPea();
		const securityId = await newSecurity();

		const { status, body } = await postTrade(account.id, buyBody(securityId, overrides));

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path, code }]);
	});

	it("refuses a body without a security, before reading the account", async () => {
		const { status, body } = await postTrade("nope", { ...buyBody(""), security: null });

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "security", code: "invalid_type" },
		]);
	});
});

describe("GET /api/accounts/:id/trades", () => {
	it("lists an account's trades most recent first, a page at a time", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		const older = await recorded(account.id, buyBody(securityId, { date: "2026-09-05" }));
		const newer = await recorded(account.id, buyBody(securityId, { date: "2026-09-08" }));

		const response = await accounts()[":id"].trades.$get({
			param: { id: account.id },
			query: { page: "1", pageSize: "1" },
		});

		expect(response.status).toBe(200);
		const { data } = await response.json();
		expect(data).toMatchObject({ page: 1, pageSize: 1, total: 2 });
		expect(data.items.map((item) => item.id)).toEqual([newer.id]);
		const second = await (
			await accounts()[":id"].trades.$get({
				param: { id: account.id },
				query: { page: "2", pageSize: "1" },
			})
		).json();
		expect(second.data.items.map((item) => item.id)).toEqual([older.id]);
	});

	it("narrows the page to one security when asked", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		const other = await newSecurity();
		const kept = await recorded(account.id, buyBody(securityId));
		await recorded(account.id, buyBody(other));

		const response = await accounts()[":id"].trades.$get({
			param: { id: account.id },
			query: { securityId },
		});

		const { data } = await response.json();
		expect(data).toMatchObject({ total: 1 });
		expect(data.items.map((item) => item.id)).toEqual([kept.id]);
	});

	it("answers an empty page for an account with no trade, and NOT_FOUND for none", async () => {
		const account = await openAccount();

		const { status, body } = await request("GET", `/api/accounts/${account.id}/trades`);
		const missing = await request("GET", "/api/accounts/nope/trades");

		expect(status).toBe(200);
		expect(body).toEqual({ data: { items: [], page: 1, pageSize: 50, total: 0 } });
		expect(missing.status).toBe(404);
	});
});

describe("PATCH /api/trades/:id", () => {
	it("changes the side, date, quantity, price and fee, and recomputes from the earlier date", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		await recorded(account.id, buyBody(securityId, { date: "2026-09-05" }));
		const trade = await recorded(account.id, buyBody(securityId, { date: "2026-09-10" }));

		const response = await testClient(buildApp()).api.trades[":id"].$patch({
			param: { id: trade.id },
			json: { side: "sell", date: "2026-09-08", quantity: "2,5", price: "700", fee: "1" },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({
			id: trade.id,
			date: "2026-09-08",
			side: "sell",
			quantity: "2.5",
			price: "700",
			fee: 100,
			amount: 174_900,
		});
		// The 7.5 shares left at the sale's 700 €.
		await expect(balanceOnDay(account.id, "2026-09-08")).resolves.toBe(
			2_500_000 - 612_650 + 174_900 + 525_000,
		);
	});

	it("refuses an edit that leaves a later sale short, and an invalid number", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		const bought = await recorded(account.id, buyBody(securityId, { date: "2026-09-05" }));
		await recorded(account.id, buyBody(securityId, { side: "sell", date: "2026-09-08", fee: "0" }));

		const short = await request("PATCH", `/api/trades/${bought.id}`, { quantity: "5" });
		const invalid = await request("PATCH", `/api/trades/${bought.id}`, { price: "x" });

		expect(short.status).toBe(409);
		expect(errorBody.parse(short.body).error.code).toBe("QUANTITY_UNAVAILABLE");
		expect(invalid.status).toBe(400);
		expect(errorBody.parse(invalid.body).error.fields).toEqual([
			{ path: "price", code: "invalid_price" },
		]);
	});

	it("never takes a security", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		const trade = await recorded(account.id, buyBody(securityId));

		const { status, body } = await request("PATCH", `/api/trades/${trade.id}`, {
			security: lvmh(securityId),
		});

		// The key is dropped before the service: the trade is unchanged.
		expect(status).toBe(200);
		expect(body).toMatchObject({ data: { security: { id: securityId } } });
	});

	it("answers NOT_FOUND for an unknown trade", async () => {
		const { status } = await request("PATCH", "/api/trades/nope", { fee: "1" });

		expect(status).toBe(404);
	});
});

describe("DELETE /api/trades/:id", () => {
	it("deletes a trade and recomputes from its date", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		const trade = await recorded(account.id, buyBody(securityId));

		const response = await testClient(buildApp()).api.trades[":id"].$delete({
			param: { id: trade.id },
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ data: { id: trade.id } });
		await expect(balanceOf(account.id)).resolves.toBe(2_500_000);
	});

	it("refuses to delete a buy a later sale needs", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		const bought = await recorded(account.id, buyBody(securityId, { date: "2026-09-05" }));
		await recorded(account.id, buyBody(securityId, { side: "sell", date: "2026-09-08", fee: "0" }));

		const { status, body } = await request("DELETE", `/api/trades/${bought.id}`);

		expect(status).toBe(409);
		expect(errorBody.parse(body).error.code).toBe("QUANTITY_UNAVAILABLE");
	});
});

const dividendBody = (securityId: string, overrides: Record<string, unknown> = {}) => ({
	side: "dividend" as const,
	security: lvmh(securityId),
	date: "2026-09-15",
	amount: "12,34",
	...overrides,
});

/** The cash of the account's balance on `date`, as its positions read it. */
async function cashOf(accountId: string) {
	const { body } = await request("GET", `/api/accounts/${accountId}/holdings`);

	return z.object({ data: z.object({ cash: z.number() }) }).parse(body).data.cash;
}

describe("dividends and interest", () => {
	it("records a dividend on a held security and interest on cash, each moving cash only", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		await recorded(account.id, buyBody(securityId));
		const before = await balanceOf(account.id);

		const paid = await recorded(account.id, dividendBody(securityId));
		const interest = await recorded(account.id, {
			side: "interest",
			security: null,
			date: "2026-09-16",
			amount: "3",
		});

		expect(paid).toMatchObject({
			side: "dividend",
			quantity: "0",
			price: "0",
			fee: 0,
			amount: 1234,
			security: { id: securityId },
			convertedFrom: null,
		});
		expect(interest).toMatchObject({ side: "interest", amount: 300, security: null });
		await expect(balanceOf(account.id)).resolves.toBe(before + 1234 + 300);
		await expect(cashOf(account.id)).resolves.toBe(2_500_000 - 612_650 + 1234 + 300);
	});

	it.each([
		[{ amount: "0" }, "amount", "not_positive"],
		[{ amount: "-1" }, "amount", "not_positive"],
		[{ amount: "abc" }, "amount", "invalid_amount"],
		[{ security: null }, "security", "too_small"],
	])("refuses %j on %s with %s", async (overrides, path, code) => {
		const account = await openPea();
		const securityId = await newSecurity();
		await recorded(account.id, buyBody(securityId));

		const { status, body } = await postTrade(account.id, dividendBody(securityId, overrides));

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path, code }]);
	});

	it("refuses a security the account never bought with not_held, and a listing", async () => {
		const account = await openPea();
		const securityId = await newSecurity();

		const notHeld = await postTrade(account.id, dividendBody(securityId));
		const listing = await postTrade(
			account.id,
			dividendBody(securityId, {
				security: { source: "manual", name: "Fonds" },
			}),
		);

		expect(notHeld.status).toBe(400);
		expect(errorBody.parse(notHeld.body).error.fields).toEqual([
			{ path: "security", code: "not_held" },
		]);
		expect(listing.status).toBe(400);
	});

	it("edits an income's amount and date, and refuses a buy's figures on it", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		await recorded(account.id, buyBody(securityId));
		const paid = await recorded(account.id, dividendBody(securityId));

		const edited = await request("PATCH", `/api/trades/${paid.id}`, {
			date: "2026-09-12",
			amount: "20",
		});
		const side = await request("PATCH", `/api/trades/${paid.id}`, { side: "buy" });
		const amount = await request("PATCH", `/api/trades/${paid.id}`, { amount: "0" });

		expect(edited.status).toBe(200);
		expect(edited.body).toMatchObject({ data: { date: "2026-09-12", amount: 2000 } });
		expect(errorBody.parse(side.body).error.fields).toEqual([
			{ path: "side", code: "invalid_value" },
		]);
		expect(errorBody.parse(amount.body).error.fields).toEqual([
			{ path: "amount", code: "not_positive" },
		]);
	});
});

const convertBody = (securityId: string, overrides: Record<string, unknown> = {}) => ({
	side: "buy" as const,
	security: lvmh(securityId),
	quantity: "10",
	price: "612,40",
	...overrides,
});

async function lineOf(accountId: string, amount: string, date = "2026-09-10") {
	const { status, body } = await postTransaction(accountId, {
		date,
		label: "ACHAT LVMH",
		amount,
	});

	expect(status, JSON.stringify(body)).toBe(201);

	return z.object({ data: z.object({ id: z.string() }) }).parse(body).data.id;
}

describe("POST /api/transactions/:id/trade", () => {
	it("converts a buy line into a trade of its date and amount, the rest its fee, and hides the line", async () => {
		const account = await openPea();
		const securityId = await newSecurity();
		const line = await lineOf(account.id, "-6 126,50");
		const balance = await balanceOf(account.id);
		const cash = await cashOf(account.id);

		const response = await testClient(buildApp()).api.transactions[":id"].trade.$post({
			param: { id: line },
			json: convertBody(securityId),
		});

		expect(response.status).toBe(201);
		expect((await response.json()).data).toMatchObject({
			accountId: account.id,
			date: "2026-09-10",
			side: "buy",
			quantity: "10",
			price: "612.4",
			fee: 250,
			amount: -612_650,
			convertedFrom: { id: line, label: "ACHAT LVMH" },
		});
		// The cash keeps the line's money; the 10 shares are now valued beside it.
		await expect(cashOf(account.id)).resolves.toBe(cash);
		await expect(balanceOf(account.id)).resolves.toBe(balance + 612_400);
		const list = await request("GET", `/api/accounts/${account.id}/transactions`);
		expect(JSON.stringify(list.body)).not.toContain(line);
		const transaction = await request("GET", `/api/transactions/${line}/split`);
		expect(transaction.status).toBe(404);
	});

	it.each([
		["a fee below zero", "-6 000", {}, "price", "amount_mismatch"],
		["a buy of money in", "50", {}, "side", "sign_mismatch"],
		["no quantity", "-6 126,50", { quantity: "0" }, "quantity", "invalid_quantity"],
		["no price", "-6 126,50", { price: "x" }, "price", "invalid_price"],
		["a dividend on cash", "50", { side: "dividend", security: null }, "security", "too_small"],
	])("refuses %s", async (_name, amount, overrides, path, code) => {
		const account = await openPea();
		const securityId = await newSecurity();
		const line = await lineOf(account.id, amount);

		const { status, body } = await request(
			"POST",
			`/api/transactions/${line}/trade`,
			convertBody(securityId, overrides),
		);

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path, code }]);
	});

	it("converts a line into interest on cash, and undoes it when the trade goes", async () => {
		const account = await openPea();
		const line = await lineOf(account.id, "3");
		const balance = await balanceOf(account.id);

		const { status, body } = await request("POST", `/api/transactions/${line}/trade`, {
			side: "interest",
			security: null,
		});
		const trade = tradeBody.parse(body).data;
		const undone = await request("DELETE", `/api/trades/${trade.id}`);

		expect(status).toBe(201);
		expect(undone.status).toBe(200);
		await expect(balanceOf(account.id)).resolves.toBe(balance);
		const list = await request("GET", `/api/accounts/${account.id}/transactions`);
		expect(JSON.stringify(list.body)).toContain(line);
	});

	it("refuses a line already converted with NOT_CONVERTIBLE, and one of another account", async () => {
		const account = await openPea();
		const current = await openAccount();
		const securityId = await newSecurity();
		const line = await lineOf(account.id, "-6 126,50");
		const elsewhere = await lineOf(current.id, "-6 126,51");
		await request("POST", `/api/transactions/${line}/trade`, convertBody(securityId));

		const again = await request("POST", `/api/transactions/${line}/trade`, {
			side: "interest",
			security: null,
		});
		const other = await request("POST", `/api/transactions/${elsewhere}/trade`, {
			side: "interest",
			security: null,
		});
		const unknown = await request("POST", "/api/transactions/nope/trade", {
			side: "interest",
			security: null,
		});

		expect(again.status).toBe(409);
		expect(errorBody.parse(again.body).error.code).toBe("NOT_CONVERTIBLE");
		expect(other.status).toBe(409);
		expect(errorBody.parse(other.body).error.code).toBe("NOT_AN_INVESTMENT_ACCOUNT");
		expect(unknown.status).toBe(404);
	});

	it("refuses a body of the wrong shape before reading the line", async () => {
		const { status, body } = await request("POST", "/api/transactions/nope/trade", {
			side: "fee",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.code).toBe("VALIDATION_ERROR");
	});
});
