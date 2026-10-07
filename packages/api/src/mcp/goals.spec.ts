import type { TempDatabase } from "../testing/temp-database.ts";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CATEGORY_COLORS } from "@archant/data/category-presets";
import { DEFAULT_GOAL_ICON } from "@archant/data/goals";
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
	targetAmount: z.string(),
	targetMode: z.string(),
	targetMonths: z.number().nullable(),
	monthlyExpenses: z.string().nullable(),
	targetDate: z.string().nullable(),
	saved: z.string(),
	remaining: z.string(),
	percent: z.number(),
	monthlyNeeded: z.string().nullable(),
	notes: z.string().nullable(),
	accounts: z.array(
		z.object({
			accountId: z.string(),
			name: z.string(),
			allocatedAmount: z.string().nullable(),
			share: z.string(),
		}),
	),
});

const overview = z.object({
	goals: z.array(goal),
	totals: z.object({
		currency: z.string(),
		count: z.number(),
		saved: z.string(),
		target: z.string(),
		behind: z.number(),
		leftOut: z.array(z.object({ id: z.string(), name: z.string() })),
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
			goal.parse((await tools.write("create_goal", args)).structuredContent);
		await create({
			name: "Vacances",
			targetAmount: "1000.00",
			targetDate: "2026-10-21",
			accounts: [{ accountId: first.id }],
		});
		await create({
			name: "Vélo",
			targetAmount: "500.00",
			accounts: [{ accountId: second.id, allocatedAmount: "120.00" }],
		});
		const voyage = await create({
			name: "Voyage",
			targetAmount: "1000.00",
			accounts: [{ accountId: dollars.id }],
		});
		const finished = await create({
			name: "Fini",
			targetAmount: "1000.00",
			accounts: [{ accountId: done.id }],
		});
		await buildApp(db).request(`/api/goals/${finished.id}/complete`, { method: "POST" });
		await db.delete(assistantCalls);

		const read = await goalsOf(tools);
		const listed = z.array(z.object({ id: z.string() })).parse(await fromRoutes("/api/goals"));

		expect(read.goals.map((item) => item.id)).toEqual(listed.map((item) => item.id));
		expect(read.goals.find((item) => item.name === "Vacances")).toMatchObject({
			kind: "one_off",
			state: "active",
			status: "behind",
			currency: "EUR",
			targetAmount: "1000.00",
			targetMode: "fixed",
			targetMonths: null,
			monthlyExpenses: null,
			targetDate: "2026-10-21",
			saved: "200.00",
			remaining: "800.00",
			percent: 20,
			monthlyNeeded: "800.00",
			notes: null,
			accounts: [{ accountId: first.id, name: "Livret A", allocatedAmount: null, share: "200.00" }],
		});
		expect(read.goals.find((item) => item.name === "Vélo")?.accounts).toEqual([
			{ accountId: second.id, name: "LDDS", allocatedAmount: "120.00", share: "120.00" },
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
			leftOut: [{ id: voyage.id, name: "Voyage" }],
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
			totals: { currency: "EUR", count: 0, saved: "0.00", target: "0.00", behind: 0, leftOut: [] },
		});
	});
});

describe("create_goal", () => {
	it("creates an active one-off goal as « Nouvel objectif » does, with a swatch drawn as the dialog draws it and its icon", async () => {
		await household();
		const account = await savings("1 500,00");
		const tools = await assistants();

		const result = await tools.write("create_goal", {
			name: " Vacances ",
			targetAmount: "2000.00",
			targetDate: "2027-06-30",
			notes: "Grèce",
			accounts: [{ accountId: account.id }],
		});

		const created = goal.parse(result.structuredContent);

		expect(created).toMatchObject({
			name: "Vacances",
			kind: "one_off",
			state: "active",
			currency: "EUR",
			targetAmount: "2000.00",
			targetMode: "fixed",
			targetDate: "2027-06-30",
			saved: "1500.00",
			remaining: "500.00",
			notes: "Grèce",
			accounts: [
				{ accountId: account.id, name: "Livret A", allocatedAmount: null, share: "1500.00" },
			],
		});
		expect(result.structuredContent).toMatchObject({
			url: `${TEST_ORIGIN}/goals/${created.id}`,
		});
		const stored = z
			.object({ color: z.string(), icon: z.string() })
			.parse(await fromRoutes(`/api/goals/${created.id}`));

		expect(CATEGORY_COLORS).toContain(stored.color);
		expect(stored.icon).toBe(DEFAULT_GOAL_ICON);
		expect((await goalsOf(tools)).goals).toEqual([created]);
		expect(await calls()).toEqual([
			{ tool: "create_goal", outcome: "OK", changedRows: 1 },
			{ tool: "get_goals", outcome: "OK", changedRows: 0 },
		]);
	});

	it("holds a fixed amount of an account", async () => {
		await household();
		const account = await savings("1 000");
		const tools = await assistants();

		const created = goal.parse(
			(
				await tools.write("create_goal", {
					name: "Voiture",
					targetAmount: "5000.00",
					accounts: [{ accountId: account.id, allocatedAmount: "300.00" }],
				})
			).structuredContent,
		);

		expect(created.accounts).toEqual([
			{ accountId: account.id, name: "Livret A", allocatedAmount: "300.00", share: "300.00" },
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
			targetMonths: 6,
			accounts: [{ accountId: account.id }],
		});

		expect(goal.parse(result.structuredContent)).toMatchObject({
			kind: "maintained",
			targetMode: "months_of_expenses",
			targetMonths: 6,
			monthlyExpenses: "2000.00",
			targetAmount: "12000.00",
			targetDate: null,
			saved: "3000.00",
			monthlyNeeded: null,
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
			targetAmount: "1000.00",
			accounts: [{ accountId: taken.id }],
		});
		await db.delete(assistantCalls);
		const before = await goalRows();

		const currency = await tools.write("create_goal", {
			name: "Vacances",
			targetAmount: "1000.00",
			accounts: [{ accountId: euros.id }, { accountId: dollars.id }],
		});
		const whole = await tools.write("create_goal", {
			name: "Vacances",
			targetAmount: "1000.00",
			accounts: [{ accountId: taken.id }],
		});

		expect(currency.isError).toBe(true);
		expect(currency.content[0]?.text).toMatch(/^VALIDATION_ERROR:/);
		expect(currency.content[0]?.text).toContain(
			'"path":"accounts.1.accountId","code":"currency_mismatch"',
		);
		expect(whole.content[0]?.text).toContain(
			'"path":"accounts.0.allocatedAmount","code":"whole_balance_taken"',
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
			targetAmount: "1000.00",
			accounts: [{ accountId: loan.id }],
		});
		const empty = await tools.write("create_goal", {
			name: "Vacances",
			targetAmount: "1000.00",
			accounts: [],
		});
		const foreign = await tools.write("create_goal", {
			name: "Urgences",
			kind: "maintained",
			targetMonths: 6,
			accounts: [{ accountId: dollars.id }],
		});

		expect(debt.content[0]?.text).toContain('"path":"accounts.0.accountId","code":"not_fundable"');
		expect(empty.content[0]?.text).toContain('"path":"accounts","code":"no_account"');
		expect(foreign.content[0]?.text).toContain(
			'"path":"targetMonths","code":"not_reporting_currency"',
		);
		await expect(goalRows()).resolves.toEqual([]);
	});

	it("refuses both targets or none, months for a one-off goal and a reserve's date, before any write", async () => {
		await household();
		const account = await savings("1 000");
		const tools = await assistants();
		const accounts = [{ accountId: account.id }];

		const both = await tools.write("create_goal", {
			name: "Vacances",
			kind: "maintained",
			targetAmount: "1000.00",
			targetMonths: 3,
			accounts,
		});
		const none = await tools.write("create_goal", { name: "Vacances", accounts });
		const months = await tools.write("create_goal", {
			name: "Vacances",
			targetMonths: 3,
			accounts,
		});
		const dated = await tools.write("create_goal", {
			name: "Urgences",
			kind: "maintained",
			targetAmount: "1000.00",
			targetDate: "2027-06-30",
			accounts,
		});
		const sureShaped = await tools.write("create_goal", {
			name: "Vacances",
			targetAmount: 1000,
			linked_account_names: ["Livret A"],
			accounts,
		});

		expect(both.content[0]?.text).toContain('"path":"targetMonths","code":"one_target_only"');
		expect(none.content[0]?.text).toContain('"path":"targetAmount","code":"target_required"');
		expect(months.content[0]?.text).toContain('"path":"targetMonths","code":"reserve_only"');
		expect(dated.content[0]?.text).toContain('"path":"targetDate","code":"reserve_has_no_date"');
		expect(sureShaped.content[0]?.text).toMatch(/^VALIDATION_ERROR:.*"path":"targetAmount"/);
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
			targetAmount: "1000.00",
			accounts: [{ accountId: account.id }],
		});

		expect(response.status).toBe(403);
		expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
		await expect(goalRows()).resolves.toEqual([]);
		expect(await calls()).toEqual([
			{ tool: "create_goal", outcome: "INSUFFICIENT_SCOPE", changedRows: 0 },
		]);
	});
});
