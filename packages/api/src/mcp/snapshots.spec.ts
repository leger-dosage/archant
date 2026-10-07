import type { TempDatabase } from "../testing/temp-database.ts";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { assistantCalls } from "@archant/data/schema/assistant-calls";

import { createLogger } from "../lib/logger.ts";
import {
	mortgage,
	openOwn,
	ownDatabase,
	pinned,
	postOwn,
	template,
	useSignedInApp,
} from "../testing/app.ts";
import { READ_WRITE, callTool, connect, mcp, registerClient } from "../testing/assistant.ts";
import { buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

// Story 26.2. The clock stands at 2026-09-21; each test has a household of
// its own, through `ownDatabase`, so its snapshots are the only ones there.

let db: TempDatabase["db"];

/** A checking account opened on 2026-01-10 at 1 500,00, with −120,00 on 2026-03-02. */
async function checking() {
	db = (await ownDatabase()).db;
	const account = await openOwn({ ...pinned, name: "Compte courant" });
	await postOwn(account.id, { date: "2026-03-02", label: "Courses", amount: "-120,00" });

	return account;
}

/** A read-only and a read-write assistant of the household, its calls recorded from here. */
async function assistants() {
	const auth = createTestAuth(db);
	const app = buildTestApp(db, createLogger("silent"), auth);
	const session = withSession(buildTestApp(db, createLogger("silent"), auth), template.cookie);
	const reader = (await connect(session, app, await registerClient(app))).access_token;
	const author = (await connect(session, app, await registerClient(app), READ_WRITE)).access_token;
	await db.delete(assistantCalls);

	return {
		read: (name: string, args: unknown = {}) => callTool(app, reader, name, args),
		write: (name: string, args: unknown = {}) => callTool(app, author, name, args),
		refused: (name: string, args: unknown = {}) =>
			mcp(app, reader, "tools/call", { name, arguments: args }),
	};
}

function calls() {
	return db
		.select({
			tool: assistantCalls.tool,
			outcome: assistantCalls.outcome,
			changedRows: assistantCalls.changedRows,
		})
		.from(assistantCalls);
}

const snapshot = z.object({
	id: z.string(),
	date: z.string(),
	balance: z.string(),
	computed: z.string(),
	gap: z.string(),
	currency: z.string(),
});

const valuations = z.object({
	items: z.array(snapshot),
	page: z.number(),
	pageSize: z.number(),
	total: z.number(),
});

const recordedValuation = snapshot.extend({ accountId: z.string(), replacedExisting: z.boolean() });

const accountsWithSeries = z.object({
	accounts: z.array(
		z
			.object({
				id: z.string(),
				balance: z.string(),
				balanceSeries: z.object({
					points: z.array(z.object({ date: z.string(), balance: z.string() })),
				}),
			})
			.loose(),
	),
});

/** The account's balance today and on `date`, as get_accounts' series gives them. */
async function balancesOf(tools: Awaited<ReturnType<typeof assistants>>, id: string, date: string) {
	const result = await tools.read("get_accounts", { includeBalanceSeries: true, period: "3M" });
	const account = accountsWithSeries
		.parse(result.structuredContent)
		.accounts.find((candidate) => candidate.id === id);

	return {
		today: account?.balance,
		onDate: account?.balanceSeries.points.find((point) => point.date === date)?.balance,
	};
}

async function snapshotsOf(tools: Awaited<ReturnType<typeof assistants>>, accountId: string) {
	return valuations.parse((await tools.read("get_valuations", { accountId })).structuredContent);
}

describe("get_valuations", () => {
	it("lists the « Soldes » tab's snapshots, latest first, with computed balance and gap", async () => {
		const account = await checking();
		const tools = await assistants();
		await tools.write("record_valuation", {
			accountId: account.id,
			date: "2026-03-05",
			balance: "2000.00",
		});
		await tools.write("record_valuation", {
			accountId: account.id,
			date: "2026-04-01",
			balance: "1990.00",
		});
		await db.delete(assistantCalls);

		const first = await tools.read("get_valuations", { accountId: account.id });
		const second = await tools.read("get_valuations", { accountId: account.id, page: 2 });

		const { items, ...paging } = valuations.parse(first.structuredContent);

		expect(items.map(({ id: _id, ...item }) => item)).toEqual([
			{
				date: "2026-04-01",
				balance: "1990.00",
				computed: "2000.00",
				gap: "-10.00",
				currency: "EUR",
			},
			{
				date: "2026-03-05",
				balance: "2000.00",
				computed: "1380.00",
				gap: "620.00",
				currency: "EUR",
			},
		]);
		expect(paging).toEqual({ page: 1, pageSize: 50, total: 2 });
		expect(valuations.parse(second.structuredContent)).toEqual({
			items: [],
			page: 2,
			pageSize: 50,
			total: 2,
		});
		expect(await calls()).toEqual([
			{ tool: "get_valuations", outcome: "OK", changedRows: 0 },
			{ tool: "get_valuations", outcome: "OK", changedRows: 0 },
		]);
	});
});

describe("record_valuation", () => {
	it("sets the balance from its date, the transactions after it following, with one row recorded", async () => {
		const account = await checking();
		await postOwn(account.id, { date: "2026-09-01", label: "Pain", amount: "-20,00" });
		const tools = await assistants();

		const result = await tools.write("record_valuation", {
			accountId: account.id,
			date: "2026-08-15",
			balance: "2500.00",
		});

		const { id: _id, ...recorded } = recordedValuation.parse(result.structuredContent);

		expect(recorded).toEqual({
			accountId: account.id,
			date: "2026-08-15",
			balance: "2500.00",
			computed: "1380.00",
			gap: "1120.00",
			currency: "EUR",
			replacedExisting: false,
		});
		await expect(balancesOf(tools, account.id, "2026-08-15")).resolves.toEqual({
			today: "2480.00",
			onDate: "2500.00",
		});
		expect((await calls())[0]).toEqual({
			tool: "record_valuation",
			outcome: "OK",
			changedRows: 1,
		});
	});

	it("replaces the snapshot of the same date, keeping its id", async () => {
		const account = await checking();
		const tools = await assistants();
		const first = recordedValuation.parse(
			(
				await tools.write("record_valuation", {
					accountId: account.id,
					date: "2026-08-15",
					balance: "2500.00",
				})
			).structuredContent,
		);

		const second = recordedValuation.parse(
			(
				await tools.write("record_valuation", {
					accountId: account.id,
					date: "2026-08-15",
					balance: "2450.00",
				})
			).structuredContent,
		);

		expect(second).toMatchObject({ id: first.id, balance: "2450.00", replacedExisting: true });
		expect(await snapshotsOf(tools, account.id)).toMatchObject({
			items: [{ id: first.id, balance: "2450.00" }],
			total: 1,
		});
		expect(await calls()).toEqual([
			{ tool: "record_valuation", outcome: "OK", changedRows: 1 },
			{ tool: "record_valuation", outcome: "OK", changedRows: 1 },
			{ tool: "get_valuations", outcome: "OK", changedRows: 0 },
		]);
	});

	it("refuses the opening date, tomorrow and an amount the currency cannot hold, writing nothing", async () => {
		const account = await checking();
		const tools = await assistants();

		const opening = await tools.write("record_valuation", {
			accountId: account.id,
			date: "2026-01-10",
			balance: "1.00",
		});
		const tomorrow = await tools.write("record_valuation", {
			accountId: account.id,
			date: "2026-09-22",
			balance: "1.00",
		});
		const badAmount = await tools.write("record_valuation", {
			accountId: account.id,
			date: "2026-08-15",
			balance: "12,345",
		});

		expect(opening.isError).toBe(true);
		expect(opening.content[0]?.text).toMatch(/^VALIDATION_ERROR:/);
		expect(opening.content[0]?.text).toContain('"path":"date","code":"not_after_opening_date"');
		expect(tomorrow.content[0]?.text).toContain('"path":"date","code":"date_in_future"');
		expect(badAmount.content[0]?.text).toContain('"path":"balance","code":"invalid_amount"');
		expect((await snapshotsOf(tools, account.id)).total).toBe(0);
		expect(await calls()).toEqual([
			{ tool: "record_valuation", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "record_valuation", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "record_valuation", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "get_valuations", outcome: "OK", changedRows: 0 },
		]);
	});

	it("refuses Sure's shape, a number as amount and a source citation, writing nothing", async () => {
		const account = await checking();
		const tools = await assistants();

		const sureShaped = await tools.write("record_valuation", {
			accountId: account.id,
			date: "2026-08-15",
			balance: "2500.00",
			source: "Statement 2026-08-15 (grade: A)",
		});
		const numeric = await tools.write("record_valuation", {
			accountId: account.id,
			date: "2026-08-15",
			balance: 2500,
		});

		expect(sureShaped.content[0]?.text).toMatch(/^VALIDATION_ERROR:/);
		expect(numeric.content[0]?.text).toMatch(/^VALIDATION_ERROR:.*"path":"balance"/);
		expect((await snapshotsOf(tools, account.id)).total).toBe(0);
	});

	it("records what a loan still owes as a positive balance", async () => {
		db = (await ownDatabase()).db;
		const loan = await openOwn({ ...pinned, ...mortgage });
		const tools = await assistants();

		await tools.write("record_valuation", {
			accountId: loan.id,
			date: "2026-09-01",
			balance: "175000.00",
		});

		const result = await tools.read("get_accounts");
		const accounts = z
			.object({
				accounts: z.array(
					z.object({ id: z.string(), classification: z.string(), balance: z.string() }).loose(),
				),
			})
			.parse(result.structuredContent).accounts;

		expect(accounts.find((account) => account.id === loan.id)).toMatchObject({
			classification: "liability",
			balance: "175000.00",
		});
	});
});

describe("an unknown account", () => {
	it("answers NOT_FOUND to both tools, writing nothing", async () => {
		await checking();
		const tools = await assistants();

		const read = await tools.read("get_valuations", { accountId: "nothing" });
		const written = await tools.write("record_valuation", {
			accountId: "nothing",
			date: "2026-08-15",
			balance: "1.00",
		});

		expect(read.content[0]?.text).toMatch(/^NOT_FOUND:/);
		expect(written.content[0]?.text).toMatch(/^NOT_FOUND:/);
		expect(await calls()).toEqual([
			{ tool: "get_valuations", outcome: "NOT_FOUND", changedRows: 0 },
			{ tool: "record_valuation", outcome: "NOT_FOUND", changedRows: 0 },
		]);
	});
});

describe("a read token", () => {
	it("is refused record_valuation with 403 insufficient_scope, recorded, nothing written", async () => {
		const account = await checking();
		const tools = await assistants();

		const response = await tools.refused("record_valuation", {
			accountId: account.id,
			date: "2026-08-15",
			balance: "2500.00",
		});

		expect(response.status).toBe(403);
		expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
		expect((await snapshotsOf(tools, account.id)).total).toBe(0);
		expect(await calls()).toEqual([
			{ tool: "record_valuation", outcome: "INSUFFICIENT_SCOPE", changedRows: 0 },
			{ tool: "get_valuations", outcome: "OK", changedRows: 0 },
		]);
	});
});
