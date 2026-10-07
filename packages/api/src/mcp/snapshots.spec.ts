import type { TempDatabase } from "../testing/temp-database.ts";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { assistantCalls } from "@archant/data/schema/assistant-calls";

import { createLogger } from "../lib/logger.ts";
import {
	buildApp,
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
	entry_id: z.string(),
	date: z.string(),
	amount: z.string(),
	computed: z.string(),
	gap: z.string(),
});

const accountRef = z.object({ id: z.string(), name: z.string(), currency: z.string() });

const valuation = z.object({
	entry_id: z.string(),
	account: accountRef,
	date: z.string(),
	kind: z.enum(["opening_anchor", "reconciliation", "current_anchor"]),
	amount: z.string(),
	computed: z.string().nullable(),
	gap: z.string().nullable(),
	notes: z.string().nullable(),
});

const valuations = z.object({
	valuations: z.array(valuation),
	page: z.number(),
	page_size: z.number(),
	total_results: z.number(),
	total_pages: z.number(),
});

const recordedValuation = snapshot.extend({
	account: accountRef,
	replaced_existing: z.boolean(),
	provenance: z.object({
		source: z.string(),
		citation: z.string(),
		estimated: z.boolean(),
		grade: z.enum(["A", "B", "C"]).nullable(),
	}),
});

const accountsWithSeries = z.object({
	accounts: z.array(
		z
			.object({
				id: z.string(),
				balance: z.string(),
				historical_balances: z.object({
					points: z.array(z.object({ date: z.string(), balance: z.string() })),
				}),
			})
			.loose(),
	),
});

/** The account's balance today and on `date`, as get_accounts' series gives them. */
async function balancesOf(tools: Awaited<ReturnType<typeof assistants>>, id: string, date: string) {
	const result = await tools.read("get_accounts", {
		include_balance_series: true,
		series_period: "3M",
	});
	const account = accountsWithSeries
		.parse(result.structuredContent)
		.accounts.find((candidate) => candidate.id === id);

	return {
		today: account?.balance,
		onDate: account?.historical_balances.points.find((point) => point.date === date)?.balance,
	};
}

/** The account's snapshots, the « Soldes » tab's, without its opening balance. */
async function snapshotsOf(tools: Awaited<ReturnType<typeof assistants>>, accountId: string) {
	const { valuations: items } = valuations.parse(
		(await tools.read("get_valuations", { account_id: accountId })).structuredContent,
	);
	const snapshots = items.filter((item) => item.kind === "reconciliation");

	return { items: snapshots, total: snapshots.length };
}

describe("get_valuations", () => {
	it("lists an account's valuations, its opening balance included, latest first, with each snapshot's computed balance and gap", async () => {
		const account = await checking();
		const tools = await assistants();
		await tools.write("record_valuation", {
			account_id: account.id,
			date: "2026-03-05",
			amount: "2000.00",
			source: "Relevé de compte (grade: A)",
		});
		await tools.write("record_valuation", {
			account_id: account.id,
			date: "2026-04-01",
			amount: "1990.00",
			source: "Relevé de compte (grade: A)",
		});
		await db.delete(assistantCalls);

		const first = await tools.read("get_valuations", { account_id: account.id });
		const second = await tools.read("get_valuations", { account_id: account.id, page: 2 });

		const { valuations: items, ...paging } = valuations.parse(first.structuredContent);

		const of = { account: { id: account.id, name: "Compte courant", currency: "EUR" } };

		expect(items.map(({ entry_id: _id, ...item }) => item)).toEqual([
			{
				...of,
				date: "2026-04-01",
				kind: "reconciliation",
				amount: "1990.00",
				computed: "2000.00",
				gap: "-10.00",
				notes: "Relevé de compte (grade: A)",
			},
			{
				...of,
				date: "2026-03-05",
				kind: "reconciliation",
				amount: "2000.00",
				computed: "1380.00",
				gap: "620.00",
				notes: "Relevé de compte (grade: A)",
			},
			{
				...of,
				date: "2026-01-10",
				kind: "opening_anchor",
				amount: "1500.00",
				computed: null,
				gap: null,
				notes: null,
			},
		]);
		expect(paging).toEqual({ page: 1, page_size: 50, total_results: 3, total_pages: 1 });
		expect(valuations.parse(second.structuredContent)).toEqual({
			valuations: [],
			page: 2,
			page_size: 50,
			total_results: 3,
			total_pages: 1,
		});
		expect(await calls()).toEqual([
			{ tool: "get_valuations", outcome: "OK", changedRows: 0 },
			{ tool: "get_valuations", outcome: "OK", changedRows: 0 },
		]);
	});

	it("lists every active account's valuations without an account, as Sure's, between two dates", async () => {
		const account = await checking();
		const loan = await openOwn({ ...mortgage, name: "Prêt immobilier" });
		const tools = await assistants();
		await tools.write("record_valuation", {
			account_id: account.id,
			date: "2026-03-05",
			amount: "2000.00",
			source: "Relevé de compte (grade: A)",
		});
		await db.delete(assistantCalls);

		const all = valuations.parse((await tools.read("get_valuations")).structuredContent);
		const march = valuations.parse(
			(await tools.read("get_valuations", { start_date: "2026-03-01", end_date: "2026-03-31" }))
				.structuredContent,
		);

		expect(
			all.valuations.map((item) => ({ account_name: item.account.name, kind: item.kind })),
		).toEqual(
			expect.arrayContaining([
				{ account_name: "Compte courant", kind: "reconciliation" },
				{ account_name: "Compte courant", kind: "opening_anchor" },
				{ account_name: "Prêt immobilier", kind: "opening_anchor" },
			]),
		);
		expect(all.valuations.map(({ date }) => date)).toEqual(
			all.valuations
				.map(({ date }) => date)
				.toSorted()
				.toReversed(),
		);
		expect(all.valuations.some((item) => item.account.id === loan.id)).toBe(true);
		expect(march.valuations.map(({ date, kind }) => ({ date, kind }))).toEqual([
			{ date: "2026-03-05", kind: "reconciliation" },
		]);
		expect(await calls()).toEqual([
			{ tool: "get_valuations", outcome: "OK", changedRows: 0 },
			{ tool: "get_valuations", outcome: "OK", changedRows: 0 },
		]);
	});

	it("refuses an end date before the start date", async () => {
		await checking();
		const tools = await assistants();

		const refused = await tools.read("get_valuations", {
			start_date: "2026-04-01",
			end_date: "2026-03-01",
		});

		expect(refused.isError).toBe(true);
		expect(refused.content[0]?.text).toContain('"path":"end_date","code":"before_start_date"');
	});
});

describe("record_valuation", () => {
	it("sets the balance from its date, the transactions after it following, with one row recorded", async () => {
		const account = await checking();
		await postOwn(account.id, { date: "2026-09-01", label: "Pain", amount: "-20,00" });
		const tools = await assistants();

		const result = await tools.write("record_valuation", {
			account_id: account.id,
			date: "2026-08-15",
			amount: "2500.00",
			source: "Relevé de compte (grade: A)",
		});

		const { entry_id: _id, ...recorded } = recordedValuation.parse(result.structuredContent);

		expect(recorded).toEqual({
			account: { id: account.id, name: "Compte courant", currency: "EUR" },
			date: "2026-08-15",
			amount: "2500.00",
			computed: "1380.00",
			gap: "1120.00",
			replaced_existing: false,
			provenance: {
				source: "Relevé de compte (grade: A)",
				citation: "Relevé de compte",
				estimated: false,
				grade: "A",
			},
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
					account_id: account.id,
					date: "2026-08-15",
					amount: "2500.00",
					source: "Relevé de compte (grade: A)",
				})
			).structuredContent,
		);

		const second = recordedValuation.parse(
			(
				await tools.write("record_valuation", {
					account_id: account.id,
					date: "2026-08-15",
					amount: "2450.00",
					source: "Relevé de compte (grade: A)",
				})
			).structuredContent,
		);

		expect(second).toMatchObject({
			entry_id: first.entry_id,
			amount: "2450.00",
			replaced_existing: true,
		});
		expect(await snapshotsOf(tools, account.id)).toMatchObject({
			items: [{ entry_id: first.entry_id, amount: "2450.00" }],
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
			account_id: account.id,
			date: "2026-01-10",
			amount: "1.00",
			source: "Relevé de compte (grade: A)",
		});
		const tomorrow = await tools.write("record_valuation", {
			account_id: account.id,
			date: "2026-09-22",
			amount: "1.00",
			source: "Relevé de compte (grade: A)",
		});
		const badAmount = await tools.write("record_valuation", {
			account_id: account.id,
			date: "2026-08-15",
			amount: "12,345",
			source: "Relevé de compte (grade: A)",
		});

		expect(opening.isError).toBe(true);
		expect(opening.content[0]?.text).toMatch(/^VALIDATION_ERROR:/);
		expect(opening.content[0]?.text).toContain('"path":"date","code":"not_after_opening_date"');
		expect(tomorrow.content[0]?.text).toContain('"path":"date","code":"date_in_future"');
		expect(badAmount.content[0]?.text).toContain('"path":"amount","code":"invalid_amount"');
		expect((await snapshotsOf(tools, account.id)).total).toBe(0);
		expect(await calls()).toEqual([
			{ tool: "record_valuation", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "record_valuation", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "record_valuation", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "get_valuations", outcome: "OK", changedRows: 0 },
		]);
	});

	it("refuses a number as amount, writing nothing", async () => {
		const account = await checking();
		const tools = await assistants();

		const numeric = await tools.write("record_valuation", {
			account_id: account.id,
			date: "2026-08-15",
			amount: 2500,
			source: "Relevé de compte (grade: A)",
		});

		expect(numeric.content[0]?.text).toMatch(/^VALIDATION_ERROR:.*"path":"amount"/);
		expect((await snapshotsOf(tools, account.id)).total).toBe(0);
	});

	it("stores the cited source in the snapshot's notes and answers its provenance, as Sure's", async () => {
		const account = await checking();
		const tools = await assistants();

		const result = await tools.write("record_valuation", {
			account_id: account.id,
			date: "2026-08-15",
			amount: "2500.00",
			source: "estimated: linear interpolation over 2026-07 / 2026-09 statements (grade: C)",
		});

		expect(recordedValuation.parse(result.structuredContent).provenance).toEqual({
			source: "estimated: linear interpolation over 2026-07 / 2026-09 statements (grade: C)",
			citation: "linear interpolation over 2026-07 / 2026-09 statements",
			estimated: true,
			grade: "C",
		});
		expect((await snapshotsOf(tools, account.id)).items).toMatchObject([
			{ notes: "estimated: linear interpolation over 2026-07 / 2026-09 statements (grade: C)" },
		]);
	});

	it("keeps the owner's note and appends a changed source on a replace, never stacking the same one", async () => {
		const account = await checking();
		const tools = await assistants();
		const first = recordedValuation.parse(
			(
				await tools.write("record_valuation", {
					account_id: account.id,
					date: "2026-08-15",
					amount: "2500.00",
					source: "Relevé d'août (grade: A)",
				})
			).structuredContent,
		);
		// The owner's edit in the « Soldes » dialog.
		await buildApp(db).request(`/api/snapshots/${first.entry_id}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ notes: "Vérifié avec le conseiller\n\nRelevé d'août (grade: A)" }),
		});

		await tools.write("record_valuation", {
			account_id: account.id,
			date: "2026-08-15",
			amount: "2450.00",
			source: "Relevé d'août (grade: A)",
		});
		const same = (await snapshotsOf(tools, account.id)).items[0]?.notes;
		await tools.write("record_valuation", {
			account_id: account.id,
			date: "2026-08-15",
			amount: "2460.00",
			source: "Relevé rectifié d'août (grade: A)",
		});
		const revised = (await snapshotsOf(tools, account.id)).items[0]?.notes;

		expect(same).toBe("Vérifié avec le conseiller\n\nRelevé d'août (grade: A)");
		expect(revised).toBe(
			"Vérifié avec le conseiller\n\nRelevé d'août (grade: A)\n\nRelevé rectifié d'août (grade: A)",
		);
	});

	it("refuses a missing, blank or ungraded estimated source on source, writing nothing", async () => {
		const account = await checking();
		const tools = await assistants();
		const base = { account_id: account.id, date: "2026-08-15", amount: "2500.00" };

		const missing = await tools.write("record_valuation", base);
		const blank = await tools.write("record_valuation", { ...base, source: "  " });
		const ungraded = await tools.write("record_valuation", {
			...base,
			source: "estimated: from a spreadsheet",
		});
		const unknown = await tools.write("record_valuation", {
			...base,
			source: "Relevé (grade: D)",
		});

		expect(missing.content[0]?.text).toMatch(/^VALIDATION_ERROR:.*"path":"source"/);
		expect(blank.content[0]?.text).toContain('"path":"source","code":"source_required"');
		expect(ungraded.content[0]?.text).toContain('"path":"source","code":"estimate_without_grade"');
		expect(unknown.content[0]?.text).toContain('"path":"source","code":"unknown_grade"');
		expect((await snapshotsOf(tools, account.id)).total).toBe(0);
	});

	it("records what a loan still owes as a positive balance", async () => {
		db = (await ownDatabase()).db;
		const loan = await openOwn({ ...pinned, ...mortgage });
		const tools = await assistants();

		await tools.write("record_valuation", {
			account_id: loan.id,
			date: "2026-09-01",
			amount: "175000.00",
			source: "Relevé de compte (grade: A)",
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

		const read = await tools.read("get_valuations", { account_id: "nothing" });
		const written = await tools.write("record_valuation", {
			account_id: "nothing",
			date: "2026-08-15",
			amount: "1.00",
			source: "Relevé de compte (grade: A)",
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
			account_id: account.id,
			date: "2026-08-15",
			amount: "2500.00",
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
