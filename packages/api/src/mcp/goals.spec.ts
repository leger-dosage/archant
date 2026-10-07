import type { TempDatabase } from "../testing/temp-database.ts";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CATEGORY_COLORS } from "@archant/data/category-presets";
import { assistantCalls } from "@archant/data/schema/assistant-calls";
import { goals } from "@archant/data/schema/goals";

import { createLogger } from "../lib/logger.ts";
import {
	buildApp,
	mortgage,
	openOwn,
	ownDatabase,
	postOwn,
	template,
	useSignedInApp,
} from "../testing/app.ts";
import { READ_WRITE, callTool, connect, mcp, registerClient } from "../testing/assistant.ts";
import { TEST_ORIGIN, buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

// Story 26.3. The clock stands at 2026-09-21; each test has a household of
// its own, through `ownDatabase`, so its goals are the only ones there.

let db: TempDatabase["db"];

/** A savings account opened long ago at `balance`, in the test's own database. */
async function savings(balance: string, overrides: Record<string, unknown> = {}) {
	return openOwn({
		name: "Livret A",
		subtype: "savings",
		openingBalance: balance,
		openingDate: "2025-01-01",
		...overrides,
	});
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

async function household() {
	db = (await ownDatabase()).db;
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

const goal = z.object({
	id: z.string(),
	name: z.string(),
	kind: z.string(),
	state: z.string(),
	status: z.string(),
	currency: z.string(),
	target_amount: z.string(),
	target_mode: z.string(),
	target_months: z.number().nullable(),
	monthly_expenses: z.string().nullable(),
	target_date: z.string().nullable(),
	saved: z.string(),
	remaining: z.string(),
	percent: z.number(),
	monthly_needed: z.string().nullable(),
	notes: z.string().nullable(),
	accounts: z.array(
		z.object({
			account: z.object({ id: z.string(), name: z.string() }),
			allocated_amount: z.string().nullable(),
			share: z.string(),
		}),
	),
});

/** What create_goal answers: the goal, its id named as Sure's, and its page. */
const createdGoal = goal.omit({ id: true }).extend({
	goal_id: z.string(),
	url: z.string(),
	linked_account_names: z.array(z.string()),
});

const overview = z.object({
	goals: z.array(goal),
	totals: z.object({
		currency: z.string(),
		count: z.number(),
		saved: z.string(),
		target: z.string(),
		behind: z.number(),
		left_out: z.array(z.object({ id: z.string(), name: z.string() })),
	}),
});

async function goalsOf(tools: Awaited<ReturnType<typeof assistants>>) {
	return overview.parse((await tools.read("get_goals")).structuredContent);
}

/** What the interface's own routes read, for the same household. */
async function fromRoutes(path: string) {
	const response = await buildApp(db).request(path);

	return z.object({ data: z.unknown() }).parse(await response.json()).data;
}

async function goalRows() {
	return db.select({ id: goals.id }).from(goals);
}

describe("get_goals", () => {
	it("gives every goal as /goals sorts them, then the dashboard card's totals in the reporting currency", async () => {
		await household();
		const first = await savings("200");
		const second = await savings("300", { name: "LDDS" });
		const dollars = await savings("100", { currency: "USD" });
		const done = await savings("50", { name: "Livret jeune" });
		const tools = await assistants();
		const create = async (args: Record<string, unknown>) =>
			createdGoal.parse((await tools.write("create_goal", args)).structuredContent);
		await create({
			name: "Vacances",
			target_amount: "1000.00",
			target_date: "2026-10-21",
			accounts: [{ account_id: first.id }],
		});
		await create({
			name: "Vélo",
			target_amount: "500.00",
			accounts: [{ account_id: second.id, allocated_amount: "120.00" }],
		});
		const voyage = await create({
			name: "Voyage",
			target_amount: "1000.00",
			accounts: [{ account_id: dollars.id }],
		});
		const finished = await create({
			name: "Fini",
			target_amount: "1000.00",
			accounts: [{ account_id: done.id }],
		});
		await buildApp(db).request(`/api/goals/${finished.goal_id}/complete`, { method: "POST" });
		await db.delete(assistantCalls);

		const read = await goalsOf(tools);
		const listed = z.array(z.object({ id: z.string() })).parse(await fromRoutes("/api/goals"));

		expect(read.goals.map((item) => item.id)).toEqual(listed.map((item) => item.id));
		expect(read.goals.find((item) => item.name === "Vacances")).toMatchObject({
			kind: "one_off",
			state: "active",
			status: "behind",
			currency: "EUR",
			target_amount: "1000.00",
			target_mode: "fixed",
			target_months: null,
			monthly_expenses: null,
			target_date: "2026-10-21",
			saved: "200.00",
			remaining: "800.00",
			percent: 20,
			monthly_needed: "800.00",
			notes: null,
			accounts: [
				{ account: { id: first.id, name: "Livret A" }, allocated_amount: null, share: "200.00" },
			],
		});
		expect(read.goals.find((item) => item.name === "Vélo")?.accounts).toEqual([
			{ account: { id: second.id, name: "LDDS" }, allocated_amount: "120.00", share: "120.00" },
		]);
		expect(read.goals.find((item) => item.name === "Fini")).toMatchObject({
			state: "completed",
			status: "reached",
		});
		expect(read.totals).toEqual({
			currency: "EUR",
			count: 3,
			saved: "320.00",
			target: "1500.00",
			behind: 1,
			left_out: [{ id: voyage.goal_id, name: "Voyage" }],
		});
		const card = z
			.object({ count: z.number(), saved: z.number(), target: z.number(), behind: z.number() })
			.parse(await fromRoutes("/api/goals/summary"));

		expect(card).toEqual({ count: 3, saved: 32_000, target: 150_000, behind: 1 });
		expect(await calls()).toEqual([{ tool: "get_goals", outcome: "OK", changedRows: 0 }]);
	});

	it("answers no goal and empty totals for a household without any", async () => {
		await household();
		const tools = await assistants();

		await expect(goalsOf(tools)).resolves.toEqual({
			goals: [],
			totals: { currency: "EUR", count: 0, saved: "0.00", target: "0.00", behind: 0, left_out: [] },
		});
	});
});

describe("create_goal", () => {
	it("creates an active one-off goal as « Nouvel objectif » does, with a swatch drawn as the dialog draws it and no icon, as Sure's", async () => {
		await household();
		const account = await savings("1 500,00");
		const tools = await assistants();

		const result = await tools.write("create_goal", {
			name: " Vacances ",
			target_amount: "2000.00",
			target_date: "2027-06-30",
			notes: "Grèce",
			accounts: [{ account_id: account.id }],
		});

		const created = createdGoal.parse(result.structuredContent);

		expect(created).toMatchObject({
			name: "Vacances",
			kind: "one_off",
			state: "active",
			currency: "EUR",
			target_amount: "2000.00",
			target_mode: "fixed",
			target_date: "2027-06-30",
			saved: "1500.00",
			remaining: "500.00",
			notes: "Grèce",
			accounts: [
				{ account: { id: account.id, name: "Livret A" }, allocated_amount: null, share: "1500.00" },
			],
		});
		expect(result.structuredContent).toMatchObject({
			url: `${TEST_ORIGIN}/goals/${created.goal_id}`,
			linked_account_names: ["Livret A"],
		});
		const stored = z
			.object({ color: z.string(), icon: z.string().nullable() })
			.parse(await fromRoutes(`/api/goals/${created.goal_id}`));

		expect(CATEGORY_COLORS).toContain(stored.color);
		expect(stored.icon).toBeNull();
		const { goal_id: id, url: _url, linked_account_names: _names, ...listed } = created;

		expect((await goalsOf(tools)).goals).toEqual([{ id, ...listed }]);
		expect(await calls()).toEqual([
			{ tool: "create_goal", outcome: "OK", changedRows: 1 },
			{ tool: "get_goals", outcome: "OK", changedRows: 0 },
		]);
	});

	it("holds a fixed amount of an account", async () => {
		await household();
		const account = await savings("1 000");
		const tools = await assistants();

		const created = createdGoal.parse(
			(
				await tools.write("create_goal", {
					name: "Voiture",
					target_amount: "5000.00",
					accounts: [{ account_id: account.id, allocated_amount: "300.00" }],
				})
			).structuredContent,
		);

		expect(created.accounts).toEqual([
			{
				account: { id: account.id, name: "Livret A" },
				allocated_amount: "300.00",
				share: "300.00",
			},
		]);
	});

	it("creates a reserve of months of expenses, with no date", async () => {
		await household();
		const checking = await savings("100 000", { name: "Compte courant", subtype: "checking" });
		await postOwn(checking.id, { date: "2026-06-10", label: "Courses", amount: "-2 000" });
		await postOwn(checking.id, { date: "2026-07-10", label: "Courses", amount: "-1 000" });
		await postOwn(checking.id, { date: "2026-08-10", label: "Courses", amount: "-3 000" });
		const account = await savings("3 000");
		const tools = await assistants();

		const result = await tools.write("create_goal", {
			name: "Urgences",
			kind: "maintained",
			target_months: 6,
			accounts: [{ account_id: account.id }],
		});

		expect(createdGoal.parse(result.structuredContent)).toMatchObject({
			kind: "maintained",
			target_mode: "months_of_expenses",
			target_months: 6,
			monthly_expenses: "2000.00",
			target_amount: "12000.00",
			target_date: null,
			saved: "3000.00",
			monthly_needed: null,
			status: "depleted",
		});
	});

	it("refuses an account in another currency and a second whole-balance link, naming each field, writing nothing", async () => {
		await household();
		const euros = await savings("1 000");
		const dollars = await savings("1 000", { name: "Savings", currency: "USD" });
		const taken = await savings("1 000", { name: "LDDS" });
		const tools = await assistants();
		await tools.write("create_goal", {
			name: "Travaux",
			target_amount: "1000.00",
			accounts: [{ account_id: taken.id }],
		});
		await db.delete(assistantCalls);
		const before = await goalRows();

		const currency = await tools.write("create_goal", {
			name: "Vacances",
			target_amount: "1000.00",
			accounts: [{ account_id: euros.id }, { account_id: dollars.id }],
		});
		const whole = await tools.write("create_goal", {
			name: "Vacances",
			target_amount: "1000.00",
			accounts: [{ account_id: taken.id }],
		});

		expect(currency.isError).toBe(true);
		expect(currency.content[0]?.text).toMatch(/^VALIDATION_ERROR:/);
		expect(currency.content[0]?.text).toContain(
			'"path":"accounts.1.account_id","code":"currency_mismatch"',
		);
		expect(whole.content[0]?.text).toContain(
			'"path":"accounts.0.allocated_amount","code":"whole_balance_taken"',
		);
		await expect(goalRows()).resolves.toEqual(before);
		expect(await calls()).toEqual([
			{ tool: "create_goal", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "create_goal", outcome: "VALIDATION_ERROR", changedRows: 0 },
		]);
	});

	it("refuses a loan, no account and months of expenses outside the reporting currency", async () => {
		await household();
		const loan = await openOwn({ ...mortgage, openingDate: "2025-01-01" });
		const dollars = await savings("1 000", { name: "Savings", currency: "USD" });
		const tools = await assistants();

		const debt = await tools.write("create_goal", {
			name: "Vacances",
			target_amount: "1000.00",
			accounts: [{ account_id: loan.id }],
		});
		const empty = await tools.write("create_goal", {
			name: "Vacances",
			target_amount: "1000.00",
			accounts: [],
		});
		const foreign = await tools.write("create_goal", {
			name: "Urgences",
			kind: "maintained",
			target_months: 6,
			accounts: [{ account_id: dollars.id }],
		});

		expect(debt.content[0]?.text).toContain('"path":"accounts.0.account_id","code":"not_fundable"');
		expect(empty.content[0]?.text).toContain('"path":"accounts","code":"no_account"');
		expect(foreign.content[0]?.text).toContain(
			'"path":"target_months","code":"not_reporting_currency"',
		);
		await expect(goalRows()).resolves.toEqual([]);
	});

	it("refuses both targets or none, months for a one-off goal and a reserve's date, before any write", async () => {
		await household();
		const account = await savings("1 000");
		const tools = await assistants();
		const accounts = [{ account_id: account.id }];

		const both = await tools.write("create_goal", {
			name: "Vacances",
			kind: "maintained",
			target_amount: "1000.00",
			target_months: 3,
			accounts,
		});
		const none = await tools.write("create_goal", { name: "Vacances", accounts });
		const months = await tools.write("create_goal", {
			name: "Vacances",
			target_months: 3,
			accounts,
		});
		const dated = await tools.write("create_goal", {
			name: "Urgences",
			kind: "maintained",
			target_amount: "1000.00",
			target_date: "2027-06-30",
			accounts,
		});
		const sureShaped = await tools.write("create_goal", {
			name: "Vacances",
			target_amount: 1000,
			linked_account_names: ["Livret A"],
			accounts,
		});

		expect(both.content[0]?.text).toContain('"path":"target_months","code":"one_target_only"');
		expect(none.content[0]?.text).toContain('"path":"target_amount","code":"target_required"');
		expect(months.content[0]?.text).toContain('"path":"target_months","code":"reserve_only"');
		expect(dated.content[0]?.text).toContain('"path":"target_date","code":"reserve_has_no_date"');
		expect(sureShaped.content[0]?.text).toMatch(/^VALIDATION_ERROR:.*"path":"target_amount"/);
		expect(sureShaped.content[0]?.text).toContain('"path":"linked_account_names"');
		await expect(goalRows()).resolves.toEqual([]);
	});
});

describe("a read token", () => {
	it("is refused create_goal with 403 insufficient_scope, recorded, nothing written", async () => {
		await household();
		const account = await savings("1 000");
		const tools = await assistants();

		const response = await tools.refused("create_goal", {
			name: "Vacances",
			target_amount: "1000.00",
			accounts: [{ account_id: account.id }],
		});

		expect(response.status).toBe(403);
		expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
		await expect(goalRows()).resolves.toEqual([]);
		expect(await calls()).toEqual([
			{ tool: "create_goal", outcome: "INSUFFICIENT_SCOPE", changedRows: 0 },
		]);
	});
});
