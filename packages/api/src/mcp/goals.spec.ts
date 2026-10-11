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
import {
	READ_WRITE,
	answerOf,
	callTool,
	connect,
	mcp,
	registerClient,
} from "../testing/assistant.ts";
import { TEST_ORIGIN, buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

// Stories 26.3 and 27.14. The clock stands at 2026-09-21; each test has a
// household of its own, through `ownDatabase`, so its goals are the only ones
// there.

let db: TempDatabase["db"];

/** Sure's `Money#format`, its spaces non-breaking. */
const money = (text: string) => text.replaceAll(" ", " ");

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

const CREATED_KEYS = [
	"success",
	"goal_id",
	"name",
	"target_amount_formatted",
	"currency",
	"target_date",
	"url",
	"linked_account_names",
	"message",
];

const GOAL_KEYS = [
	"goal_id",
	"name",
	"target_amount_formatted",
	"currency",
	"target_date",
	"url",
	"linked_account_names",
	"notes",
	"kind",
	"target_months",
	"status",
	"progress_percent",
	"current_balance",
	"remaining_amount",
	"monthly_target_amount",
	"pace",
	"earmarks",
];

const created = z.object({ goal_id: z.string() }).passthrough();

const listed = z.object({
	goals: z.array(z.record(z.string(), z.unknown())),
	total_results: z.number(),
	page: z.number(),
	page_size: z.number(),
	total_pages: z.number(),
});

/** What the interface's own routes read, for the same household. */
async function fromRoutes(path: string) {
	const response = await buildApp(db).request(path);

	return z.object({ data: z.unknown() }).parse(await response.json()).data;
}

const storedGoal = z.object({
	targetAmount: z.number(),
	color: z.string(),
	icon: z.string().nullable(),
	accounts: z.array(z.object({ name: z.string(), allocatedAmount: z.number().nullable() })),
});

/** Moves a goal through one of its events, as « Objectifs »' menu does. */
async function send(id: string, event: string) {
	return buildApp(db).request(`/api/goals/${id}/${event}`, { method: "POST" });
}

async function goalRows() {
	return db.select({ id: goals.id }).from(goals);
}

/** A refusal's JSON body, its keys in order. */
function refusalOf(result: {
	isError?: boolean | undefined;
	content: readonly { text: string }[];
}) {
	expect(result.isError).toBe(true);

	return z.record(z.string(), z.unknown()).parse(answerOf(result));
}

describe("create_goal", () => {
	it("creates a goal from Sure's parameters, an account by its exact name, and answers Sure's keys", async () => {
		await household();
		await savings("1 500,00");
		const tools = await assistants();

		const result = await tools.write("create_goal", {
			name: " Vacances ",
			target_amount: 5000,
			target_date: "2027-06-30",
			linked_account_names: [" Livret A "],
			notes: "Grèce",
		});
		const answer = created.parse(result.structuredContent);
		const url = `${TEST_ORIGIN}/goals/${answer.goal_id}`;

		expect(Object.keys(result.structuredContent ?? {})).toEqual(CREATED_KEYS);
		expect(answer).toEqual({
			success: true,
			goal_id: answer.goal_id,
			name: "Vacances",
			target_amount_formatted: money("5 000,00 €"),
			currency: "EUR",
			target_date: "2027-06-30",
			url,
			linked_account_names: ["Livret A"],
			message: `Created goal 'Vacances' (target ${money("5 000,00 €")}). View it at ${url}.`,
		});
		const stored = storedGoal.parse(await fromRoutes(`/api/goals/${answer.goal_id}`));

		expect(stored.targetAmount).toBe(500_000);
		expect(stored.accounts).toEqual([
			expect.objectContaining({ name: "Livret A", allocatedAmount: null }),
		]);
		expect(CATEGORY_COLORS).toContain(stored.color);
		expect(stored.icon).toBeNull();
		expect(await calls()).toEqual([{ tool: "create_goal", outcome: "OK", changedRows: 1 }]);
	});

	it("reads a decimal string, ignores an unreadable date and reserves each earmark from its account", async () => {
		await household();
		await savings("3 000");
		await savings("1 000", { name: "LDDS" });
		const tools = await assistants();

		const answer = created.parse(
			(
				await tools.write("create_goal", {
					name: "Voiture",
					target_amount: "8000.5",
					target_date: "bientôt",
					linked_account_names: ["LDDS", "Livret A"],
					earmarks: { "Livret A": 2000, LDDS: "-5", Inconnu: 100 },
				})
			).structuredContent,
		);

		expect(answer).toMatchObject({
			target_amount_formatted: money("8 000,50 €"),
			target_date: null,
			linked_account_names: ["LDDS", "Livret A"],
		});
		const stored = storedGoal.parse(await fromRoutes(`/api/goals/${answer.goal_id}`));

		expect(stored.targetAmount).toBe(800_050);
		expect(stored.accounts).toEqual([
			expect.objectContaining({ name: "LDDS", allocatedAmount: null }),
			expect.objectContaining({ name: "Livret A", allocatedAmount: 200_000 }),
		]);
	});

	it("creates a reserve of six months of expenses, Archant's own kind, its target the one it stores", async () => {
		await household();
		const checking = await savings("100 000", { name: "Compte courant", subtype: "checking" });
		await postOwn(checking.id, { date: "2026-06-10", label: "Courses", amount: "-2 000" });
		await postOwn(checking.id, { date: "2026-07-10", label: "Courses", amount: "-1 000" });
		await postOwn(checking.id, { date: "2026-08-10", label: "Courses", amount: "-3 000" });
		await savings("3 000");
		const tools = await assistants();

		const answer = created.parse(
			(
				await tools.write("create_goal", {
					name: "Urgences",
					kind: "maintained",
					target_months: 6,
					linked_account_names: ["Livret A"],
				})
			).structuredContent,
		);

		expect(answer).toMatchObject({
			target_amount_formatted: money("12 000,00 €"),
			target_date: null,
		});
		const stored = storedGoal.parse(await fromRoutes(`/api/goals/${answer.goal_id}`));

		expect(stored.targetAmount).toBe(1_200_000);
	});

	it("refuses in Sure's order and words, writing nothing", async () => {
		await household();
		await savings("1 000");
		const tools = await assistants();
		const accounts = ["Livret A"];

		const nameless = refusalOf(
			await tools.write("create_goal", {
				name: " ",
				target_amount: 0,
				linked_account_names: [],
			}),
		);
		const targetless = refusalOf(
			await tools.write("create_goal", {
				name: "Vacances",
				target_amount: "abc",
				linked_account_names: [],
			}),
		);
		const reserveWithout = refusalOf(
			await tools.write("create_goal", {
				name: "Urgences",
				kind: "maintained",
				linked_account_names: accounts,
			}),
		);
		const none = refusalOf(
			await tools.write("create_goal", { name: "Vacances", target_amount: 100 }),
		);
		const available = [
			{
				name: "Livret A",
				currency: "EUR",
				free_to_earmark: money("1 000,00 €"),
				claimed_in_full: false,
			},
		];

		expect(nameless).toEqual({
			success: false,
			error: "name_required",
			message: "Please provide a name for the goal.",
		});
		expect(targetless).toEqual({
			success: false,
			error: "target_amount_invalid",
			message: "Target amount must be greater than zero.",
		});
		expect(reserveWithout.error).toBe("target_amount_invalid");
		expect(Object.keys(none)).toEqual(["success", "error", "message", "available_accounts"]);
		expect(none).toEqual({
			success: false,
			error: "no_linked_accounts",
			message: "Please specify at least one Depository account to link to this goal.",
			available_accounts: available,
		});
		await expect(goalRows()).resolves.toEqual([]);
		expect(await calls()).toEqual(
			Array.from({ length: 4 }, () => ({
				tool: "create_goal",
				outcome: "VALIDATION_ERROR",
				changedRows: 0,
			})),
		);
	});

	it("refuses a name no fundable account holds, case and a loan included, naming it with the available accounts", async () => {
		await household();
		await savings("1 000");
		await openOwn({ ...mortgage, openingDate: "2025-01-01" });
		const tools = await assistants();

		const refusal = refusalOf(
			await tools.write("create_goal", {
				name: "Vacances",
				target_amount: 100,
				linked_account_names: ["livret a", "Prêt immobilier"],
			}),
		);

		expect(Object.keys(refusal)).toEqual([
			"success",
			"error",
			"message",
			"unknown_names",
			"available_accounts",
		]);
		expect(refusal).toMatchObject({
			error: "unknown_accounts",
			message: "Some account names didn't match the user's Depository accounts.",
			unknown_names: ["livret a", "Prêt immobilier"],
			available_accounts: [expect.objectContaining({ name: "Livret A" })],
		});
		await expect(goalRows()).resolves.toEqual([]);
	});

	it("refuses a name two accounts share, writing nothing", async () => {
		await household();
		await savings("1 000");
		await savings("1 000");
		const tools = await assistants();

		const refusal = refusalOf(
			await tools.write("create_goal", {
				name: "Vacances",
				target_amount: 100,
				linked_account_names: ["Livret A"],
			}),
		);

		expect(Object.keys(refusal)).toEqual([
			"success",
			"error",
			"message",
			"ambiguous_names",
			"available_accounts",
		]);
		expect(refusal).toEqual({
			success: false,
			error: "ambiguous_accounts",
			message: "Multiple accounts share a name. Ask the user which one to use.",
			ambiguous_names: ["Livret A"],
			available_accounts: [
				{
					name: "Livret A",
					currency: "EUR",
					free_to_earmark: money("1 000,00 €"),
					claimed_in_full: false,
				},
				{
					name: "Livret A",
					currency: "EUR",
					free_to_earmark: money("1 000,00 €"),
					claimed_in_full: false,
				},
			],
		});
		await expect(goalRows()).resolves.toEqual([]);
	});

	it("refuses accounts in two currencies with Sure's sentence", async () => {
		await household();
		await savings("1 000");
		await savings("1 000", { name: "Savings", currency: "USD" });
		const tools = await assistants();

		const refusal = refusalOf(
			await tools.write("create_goal", {
				name: "Vacances",
				target_amount: 100,
				linked_account_names: ["Livret A", "Savings"],
			}),
		);

		expect(refusal).toEqual({
			success: false,
			error: "currency_mismatch",
			message: "All linked accounts must share the same currency. Found: EUR, USD.",
		});
		await expect(goalRows()).resolves.toEqual([]);
	});

	it("refuses an account another goal claims in full until an earmark reserves part of it", async () => {
		await household();
		await savings("1 000");
		await savings("400", { name: "LDDS" });
		const tools = await assistants();
		await tools.write("create_goal", {
			name: "Travaux",
			target_amount: 1000,
			linked_account_names: ["Livret A"],
		});
		await tools.write("create_goal", {
			name: "Vélo",
			target_amount: 500,
			linked_account_names: ["LDDS"],
			earmarks: { LDDS: 150 },
		});
		const before = await goalRows();

		const refusal = refusalOf(
			await tools.write("create_goal", {
				name: "Vacances",
				target_amount: 300,
				linked_account_names: ["Livret A"],
			}),
		);

		expect(Object.keys(refusal)).toEqual([
			"success",
			"error",
			"message",
			"claimed_account_names",
			"available_accounts",
		]);
		expect(refusal).toEqual({
			success: false,
			error: "account_claimed_in_full",
			message:
				"Another goal already claims Livret A in full. Ask the user how much to reserve from it, then pass it in `earmarks`.",
			claimed_account_names: ["Livret A"],
			available_accounts: [
				{
					name: "LDDS",
					currency: "EUR",
					free_to_earmark: money("250,00 €"),
					claimed_in_full: false,
				},
				{
					name: "Livret A",
					currency: "EUR",
					free_to_earmark: money("0,00 €"),
					claimed_in_full: true,
				},
			],
		});
		await expect(goalRows()).resolves.toEqual(before);

		const earmarked = await tools.write("create_goal", {
			name: "Vacances",
			target_amount: 300,
			linked_account_names: ["Livret A"],
			earmarks: { "Livret A": 300 },
		});

		expect(earmarked.isError).toBeUndefined();
	});

	it("refuses Archant's own checks as Sure's validation_failed, a reserve's date among them", async () => {
		await household();
		await savings("1 000");
		await savings("1 000", { name: "Savings", currency: "USD" });
		const tools = await assistants();

		const dated = refusalOf(
			await tools.write("create_goal", {
				name: "Urgences",
				kind: "maintained",
				target_amount: 1000,
				target_date: "2027-06-30",
				linked_account_names: ["Livret A"],
			}),
		);
		const foreign = refusalOf(
			await tools.write("create_goal", {
				name: "Urgences",
				kind: "maintained",
				target_months: 6,
				linked_account_names: ["Savings"],
			}),
		);
		const oneOff = refusalOf(
			await tools.write("create_goal", {
				name: "Vacances",
				target_amount: 1000,
				target_months: 3,
				linked_account_names: ["Livret A"],
			}),
		);
		const both = refusalOf(
			await tools.write("create_goal", {
				name: "Urgences",
				kind: "maintained",
				target_amount: 1000,
				target_months: 6,
				linked_account_names: ["Livret A"],
			}),
		);
		const tooLong = refusalOf(
			await tools.write("create_goal", {
				name: "V".repeat(101),
				target_amount: 1000,
				linked_account_names: ["Livret A"],
			}),
		);

		expect(dated).toEqual({
			success: false,
			error: "validation_failed",
			message: "Target date can't be set on a reserve you maintain",
		});
		expect(foreign.message).toBe(
			"Months of expenses only apply to accounts in the reporting currency",
		);
		expect(oneOff.message).toBe(
			"Only a reserve you maintain can have a target set in months of expenses.",
		);
		expect(both).toEqual({
			success: false,
			error: "validation_failed",
			message: "Give target_amount or target_months, not both",
		});
		expect(tooLong).toEqual({
			success: false,
			error: "validation_failed",
			message: "Name is too long (maximum is 100 characters)",
		});
		await expect(goalRows()).resolves.toEqual([]);
	});

	it("links an account named twice once, as Sure's where(name: names)", async () => {
		await household();
		await savings("1 000");
		const tools = await assistants();

		const answer = created.parse(
			(
				await tools.write("create_goal", {
					name: "Vacances",
					target_amount: 1000,
					linked_account_names: ["Livret A", " Livret A "],
				})
			).structuredContent,
		);

		expect(answer).toMatchObject({ linked_account_names: ["Livret A"] });
		expect(storedGoal.parse(await fromRoutes(`/api/goals/${answer.goal_id}`)).accounts).toEqual([
			expect.objectContaining({ name: "Livret A", allocatedAmount: null }),
		]);
	});

	it("frees an account a completed or archived goal took whole, while a paused one still claims it", async () => {
		await household();
		await savings("1 000");
		const tools = await assistants();
		const whole = { target_amount: 1000, linked_account_names: ["Livret A"] };
		const goalOn = async (name: string) =>
			created.parse((await tools.write("create_goal", { name, ...whole })).structuredContent)
				.goal_id;

		await send(await goalOn("Fini"), "complete");
		await send(await goalOn("Archivé"), "archive");
		const paused = await goalOn("En pause");

		await send(paused, "pause");
		const blocked = refusalOf(await tools.write("create_goal", { name: "Encore", ...whole }));

		expect(blocked).toMatchObject({
			error: "account_claimed_in_full",
			available_accounts: [
				{
					name: "Livret A",
					currency: "EUR",
					free_to_earmark: money("0,00 €"),
					claimed_in_full: true,
				},
			],
		});

		await send(paused, "archive");
		const none = refusalOf(
			await tools.write("create_goal", { name: "Sans compte", target_amount: 1000 }),
		);
		const freed = await tools.write("create_goal", { name: "Encore", ...whole });

		expect(none).toMatchObject({
			available_accounts: [
				{
					name: "Livret A",
					currency: "EUR",
					free_to_earmark: money("1 000,00 €"),
					claimed_in_full: false,
				},
			],
		});
		expect(freed.isError).toBeUndefined();
	});

	it("refuses an argument the input does not take as Sure's FunctionToolCaller", async () => {
		await household();
		const tools = await assistants();

		const result = await tools.write("create_goal", {
			name: "Vacances",
			target_amount: 1000,
			accounts: [{ account_id: "a" }],
		});

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toMatch(/^\{"error":"[^"]*unrecognized_keys/u);
		await expect(goalRows()).resolves.toEqual([]);
	});
});

describe("get_goals", () => {
	it("gives each goal as /goals sorts them, create_goal's keys then Sure's figures, a page at a time", async () => {
		await household();
		await savings("200");
		await savings("300", { name: "LDDS" });
		await savings("50", { name: "Livret jeune" });
		const tools = await assistants();
		const create = async (args: Record<string, unknown>) =>
			created.parse((await tools.write("create_goal", args)).structuredContent);
		const vacances = await create({
			name: "Vacances",
			target_amount: 1000,
			target_date: "2026-10-21",
			linked_account_names: ["Livret A"],
		});
		await create({
			name: "Vélo",
			target_amount: 500,
			linked_account_names: ["LDDS"],
			earmarks: { LDDS: 120 },
			notes: "Route",
		});
		const finished = await create({
			name: "Fini",
			target_amount: 1000,
			linked_account_names: ["Livret jeune"],
		});
		await buildApp(db).request(`/api/goals/${finished.goal_id}/complete`, { method: "POST" });
		await db.delete(assistantCalls);

		const read = listed.parse((await tools.read("get_goals")).structuredContent);
		const routes = z.array(z.object({ id: z.string() })).parse(await fromRoutes("/api/goals"));

		expect(read.goals.map((goal) => goal.goal_id)).toEqual(routes.map((goal) => goal.id));
		expect(read).toMatchObject({ total_results: 3, page: 1, page_size: 50, total_pages: 1 });
		const first = read.goals.find((goal) => goal.name === "Vacances");

		expect(Object.keys(first ?? {})).toEqual(GOAL_KEYS);
		expect(first).toEqual({
			goal_id: vacances.goal_id,
			name: "Vacances",
			target_amount_formatted: money("1 000,00 €"),
			currency: "EUR",
			target_date: "2026-10-21",
			url: `${TEST_ORIGIN}/goals/${vacances.goal_id}`,
			linked_account_names: ["Livret A"],
			notes: null,
			kind: "one_off",
			target_months: null,
			status: "behind",
			progress_percent: 20,
			current_balance: money("200,00 €"),
			remaining_amount: money("800,00 €"),
			monthly_target_amount: money("800,00 €"),
			pace: money("0,00 €"),
			earmarks: {},
		});
		expect(read.goals.find((goal) => goal.name === "Vélo")).toMatchObject({
			notes: "Route",
			status: "no_target_date",
			current_balance: money("120,00 €"),
			monthly_target_amount: null,
			earmarks: { LDDS: money("120,00 €") },
		});
		expect(read.goals.find((goal) => goal.name === "Fini")).toMatchObject({
			status: "completed",
			progress_percent: 100,
		});

		const second = listed.parse(
			(await tools.read("get_goals", { page: 2, page_size: 2 })).structuredContent,
		);

		expect(second).toMatchObject({ total_results: 3, page: 2, page_size: 2, total_pages: 2 });
		expect(second.goals.map((goal) => goal.goal_id)).toEqual([routes[2]?.id]);
		expect(await calls()).toEqual([
			{ tool: "get_goals", outcome: "OK", changedRows: 0 },
			{ tool: "get_goals", outcome: "OK", changedRows: 0 },
		]);
	});

	it("gives a paused goal Sure's display status, and one empty page for a household without any", async () => {
		await household();
		const tools = await assistants();

		await expect(tools.read("get_goals")).resolves.toMatchObject({
			structuredContent: { goals: [], total_results: 0, page: 1, page_size: 50, total_pages: 1 },
		});

		await savings("200");
		const goal = created.parse(
			(
				await tools.write("create_goal", {
					name: "Vacances",
					target_amount: 1000,
					linked_account_names: ["Livret A"],
				})
			).structuredContent,
		);
		await buildApp(db).request(`/api/goals/${goal.goal_id}/pause`, { method: "POST" });

		const read = listed.parse((await tools.read("get_goals")).structuredContent);

		expect(read.goals[0]).toMatchObject({ status: "paused" });
	});
});

describe("a read token", () => {
	it("is refused create_goal with 403 insufficient_scope, recorded, nothing written", async () => {
		await household();
		await savings("1 000");
		const tools = await assistants();

		const response = await tools.refused("create_goal", {
			name: "Vacances",
			target_amount: 1000,
			linked_account_names: ["Livret A"],
		});

		expect(response.status).toBe(403);
		expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
		await expect(goalRows()).resolves.toEqual([]);
		expect(await calls()).toEqual([
			{ tool: "create_goal", outcome: "INSUFFICIENT_SCOPE", changedRows: 0 },
		]);
	});
});
