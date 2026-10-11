import type { TempDatabase } from "../testing/temp-database.ts";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { assistantCalls } from "@archant/data/schema/assistant-calls";

import { daysBetween } from "../domain/dates.ts";
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

const accountRef = z.strictObject({ id: z.string(), name: z.string(), currency: z.string() });

const valuation = z.strictObject({
	entry_id: z.string(),
	account: accountRef,
	date: z.string(),
	amount: z.string(),
	amount_formatted: z.string(),
	kind: z.enum(["opening_anchor", "reconciliation", "current_anchor"]),
	notes: z.string().nullable(),
});

const valuations = z.strictObject({
	valuations: z.array(valuation),
	page: z.number(),
	page_size: z.number(),
	total_results: z.number(),
	total_pages: z.number(),
});

const recordedValuation = z.strictObject({
	success: z.literal(true),
	entry_id: z.string(),
	account: accountRef,
	date: z.string(),
	amount: z.string(),
	amount_formatted: z.string(),
	replaced_existing: z.boolean(),
	provenance: z.strictObject({
		source: z.string(),
		citation: z.string(),
		estimated: z.boolean(),
		grade: z.enum(["A", "B", "C"]).nullable(),
	}),
	message: z.string(),
});

/** Sure's `Money#format` in French, with its non-breaking spaces. */
const euros = (text: string) => `${text.replaceAll(" ", "\u00A0")}\u00A0€`;

/** The answer's text, parsed: a refusal's whole body. */
const bodyOf = (result: { content: { text?: string }[] }) =>
	z.unknown().parse(JSON.parse(result.content[0]?.text ?? "null"));

const accountsWithSeries = z.object({
	accounts: z.array(
		z
			.object({
				id: z.string(),
				balance: z.string(),
				historical_balances: z.object({ start_date: z.string(), values: z.array(z.number()) }),
			})
			.loose(),
	),
});

/** The account's balance today and on `date`, as get_accounts' series gives them. */
async function balancesOf(tools: Awaited<ReturnType<typeof assistants>>, id: string, date: string) {
	const result = await tools.read("get_accounts", {
		include_balance_series: true,
		series_period: "last_90_days",
	});
	const account = accountsWithSeries
		.parse(result.structuredContent)
		.accounts.find((candidate) => candidate.id === id);
	// One value a day from the series' first day: the period is under a year.
	const days =
		account === undefined ? -1 : daysBetween(account.historical_balances.start_date, date);

	return { today: account?.balance, onDate: account?.historical_balances.values[days] };
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
	it("lists an account's valuations, its opening balance included, latest first, Sure's fields exactly", async () => {
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

		expect(Object.keys(first.structuredContent ?? {})).toEqual([
			"valuations",
			"total_results",
			"page",
			"page_size",
			"total_pages",
		]);
		expect(Object.keys(items[0] ?? {})).toEqual([
			"entry_id",
			"account",
			"date",
			"amount",
			"amount_formatted",
			"kind",
			"notes",
		]);
		expect(items.map(({ entry_id: _id, ...item }) => item)).toEqual([
			{
				...of,
				date: "2026-04-01",
				amount: "1990.0",
				amount_formatted: euros("1 990,00"),
				kind: "reconciliation",
				notes: "Relevé de compte (grade: A)",
			},
			{
				...of,
				date: "2026-03-05",
				amount: "2000.0",
				amount_formatted: euros("2 000,00"),
				kind: "reconciliation",
				notes: "Relevé de compte (grade: A)",
			},
			{
				...of,
				date: "2026-01-10",
				amount: "1500.0",
				amount_formatted: euros("1 500,00"),
				kind: "opening_anchor",
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

	it("refuses a reversed range or a malformed date with Sure's invalid_date, without success", async () => {
		await checking();
		const tools = await assistants();

		const reversed = await tools.read("get_valuations", {
			start_date: "2026-04-01",
			end_date: "2026-03-01",
		});
		const malformed = await tools.read("get_valuations", { end_date: "31/03/2026" });
		const impossible = await tools.read("get_valuations", { start_date: "2026-02-30" });

		expect(reversed.isError).toBe(true);
		expect(bodyOf(reversed)).toEqual({
			error: "invalid_date",
			message: "start_date must be on or before end_date.",
		});
		for (const refused of [malformed, impossible]) {
			expect(bodyOf(refused)).toEqual({
				error: "invalid_date",
				message: "Dates must be valid and in YYYY-MM-DD format.",
			});
		}
		expect(await calls()).toEqual([
			{ tool: "get_valuations", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "get_valuations", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "get_valuations", outcome: "VALIDATION_ERROR", changedRows: 0 },
		]);
	});

	it("reads blank dates as none and a page below 1 as the first, as Sure's", async () => {
		const account = await checking();
		const tools = await assistants();

		const result = valuations.parse(
			(
				await tools.read("get_valuations", {
					account_id: account.id,
					start_date: "",
					end_date: " ",
					page: 0,
				})
			).structuredContent,
		);

		expect(result).toMatchObject({ page: 1, total_results: 1 });
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

		expect(Object.keys(result.structuredContent ?? {})).toEqual([
			"success",
			"entry_id",
			"account",
			"date",
			"amount",
			"amount_formatted",
			"replaced_existing",
			"provenance",
			"message",
		]);
		expect(recorded).toEqual({
			success: true,
			account: { id: account.id, name: "Compte courant", currency: "EUR" },
			date: "2026-08-15",
			amount: "2500.0",
			amount_formatted: euros("2 500,00"),
			replaced_existing: false,
			provenance: {
				source: "Relevé de compte (grade: A)",
				citation: "Relevé de compte",
				estimated: false,
				grade: "A",
			},
			message: `Recorded ${euros("2 500,00")} for Compte courant on 2026-08-15, cited as: Relevé de compte (grade: A).`,
		});
		await expect(balancesOf(tools, account.id, "2026-08-15")).resolves.toEqual({
			today: "2480.0",
			onDate: 2500,
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
			amount: "2450.0",
			replaced_existing: true,
		});
		expect(await snapshotsOf(tools, account.id)).toMatchObject({
			items: [{ entry_id: first.entry_id, amount: "2450.0" }],
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
			amount: "12.345",
			source: "Relevé de compte (grade: A)",
		});

		expect(opening.isError).toBe(true);
		expect(opening.content[0]?.text).toMatch(/^\{"success":false,"error":"validation_error"/u);
		expect(opening.content[0]?.text).toContain("date not_after_opening_date");
		expect(tomorrow.content[0]?.text).toContain("date date_in_future");
		expect(badAmount.content[0]?.text).toContain("amount invalid_amount");
		expect((await snapshotsOf(tools, account.id)).total).toBe(0);
		expect(await calls()).toEqual([
			{ tool: "record_valuation", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "record_valuation", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "record_valuation", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "get_valuations", outcome: "OK", changedRows: 0 },
		]);
	});

	it("reads a JSON number amount through its decimal text, as Sure's", async () => {
		db = (await ownDatabase()).db;
		const loan = await openOwn({ ...pinned, ...mortgage });
		const tools = await assistants();

		const result = await tools.write("record_valuation", {
			account_id: loan.id,
			date: "2026-09-01",
			amount: 175000.5,
			source: "Tableau d'amortissement (grade: A)",
		});

		expect(recordedValuation.parse(result.structuredContent)).toMatchObject({
			amount: "175000.5",
			amount_formatted: euros("175 000,50"),
		});
		expect((await snapshotsOf(tools, loan.id)).items).toMatchObject([{ amount: "175000.5" }]);
		const stored = await buildApp(db).request(`/api/accounts/${loan.id}/snapshots`);
		expect(
			z
				.object({ data: z.object({ items: z.array(z.object({ balance: z.number() })) }) })
				.parse(await stored.json()).data.items[0]?.balance,
		).toBe(17_500_050);
	});

	it("refuses with Sure's keys in Sure's order: citation, date, amount, then account", async () => {
		const account = await checking();
		const tools = await assistants();
		const good = {
			account_id: account.id,
			date: "2026-08-15",
			amount: "2500.00",
			source: "Relevé de compte (grade: A)",
		};

		const everything = await tools.write("record_valuation", {
			account_id: "nothing",
			date: "15/08/2026",
			amount: "beaucoup",
			source: "",
		});
		const date = await tools.write("record_valuation", {
			...good,
			account_id: "nothing",
			date: "15/08/2026",
			amount: "beaucoup",
		});
		const missingDate = await tools.write("record_valuation", {
			account_id: account.id,
			amount: "2500.00",
			source: good.source,
		});
		const amount = await tools.write("record_valuation", {
			...good,
			account_id: "nothing",
			amount: "12,50",
		});
		const unknown = await tools.write("record_valuation", { ...good, account_id: "nothing" });

		expect(bodyOf(everything)).toEqual({
			success: false,
			error: "invalid_source_citation",
			message:
				'source citation is required. Every recorded value must cite its source, in the grammar: ["estimated: "] citation [" (grade: A|B|C)"].',
		});
		expect(bodyOf(date)).toEqual({
			success: false,
			error: "invalid_date",
			message: "date must be an ISO 8601 date (YYYY-MM-DD).",
		});
		expect(bodyOf(missingDate)).toEqual({
			success: false,
			error: "invalid_date",
			message: "date must be an ISO 8601 date (YYYY-MM-DD).",
		});
		expect(bodyOf(amount)).toEqual({
			success: false,
			error: "invalid_amount",
			message: "amount must be a number.",
		});
		expect(bodyOf(unknown)).toEqual({
			success: false,
			error: "account_not_found",
			message: "No account found with that ID that this user can write to.",
		});
		expect((await snapshotsOf(tools, account.id)).total).toBe(0);
		expect((await calls()).map(({ outcome }) => outcome)).toEqual([
			"VALIDATION_ERROR",
			"VALIDATION_ERROR",
			"VALIDATION_ERROR",
			"VALIDATION_ERROR",
			"NOT_FOUND",
			"OK",
		]);
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

	it("refuses each source outside the grammar with Sure's invalid_source_citation and its reason, writing nothing", async () => {
		const account = await checking();
		const tools = await assistants();
		const base = { account_id: account.id, date: "2026-08-15", amount: "2500.00" };
		const grammar = '["estimated: "] citation [" (grade: A|B|C)"]';
		const cases = [
			[undefined, "source citation is required"],
			["  ", "source citation is required"],
			["x".repeat(501), "source citation must be 500 characters or fewer"],
			[
				"Estimated: interpolated (grade: C)",
				'estimated values must start with the exact prefix "estimated: "',
			],
			["Relevé (grade: D)", 'reliability grade must be one of A, B, C (got "D")'],
			["Relevé\n2026-08-15", `source citation does not match ${grammar}`],
			["ab (grade: A)", "source citation must name the document it came from"],
			[
				"estimated: from a spreadsheet",
				'estimated values must carry a reliability grade, e.g. "estimated: ... (grade: C)"',
			],
		] as const;

		const refusals = await Promise.all(
			cases.map(async ([source]) =>
				bodyOf(await tools.write("record_valuation", { ...base, source })),
			),
		);

		expect(refusals).toEqual(
			cases.map(([, reason]) => ({
				success: false,
				error: "invalid_source_citation",
				message: `${reason}. Every recorded value must cite its source, in the grammar: ${grammar}.`,
			})),
		);
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
			balance: "175000.0",
		});
	});
});

describe("an unknown account", () => {
	it("answers not_found to get_valuations and Sure's account_not_found to record_valuation, writing nothing", async () => {
		await checking();
		const tools = await assistants();

		const read = await tools.read("get_valuations", { account_id: "nothing" });
		const written = await tools.write("record_valuation", {
			account_id: "nothing",
			date: "2026-08-15",
			amount: "1.00",
			source: "Relevé de compte (grade: A)",
		});

		expect(read.content[0]?.text).toContain('"error":"not_found"');
		expect(written.content[0]?.text).toContain('"error":"account_not_found"');
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
