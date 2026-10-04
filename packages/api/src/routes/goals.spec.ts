import type { Auth } from "../services/auth.ts";
import type { TestApp } from "../testing/auth.ts";

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createLogger } from "../lib/logger.ts";
import {
	buildApp,
	errorBody,
	mortgage,
	openOwn,
	own as ownDb,
	ownDatabase,
	postOwn,
	sendOwn,
	temp,
	template,
	useSignedInApp,
} from "../testing/app.ts";
import { addViewer, buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

// The clock is 2026-09-21 10:00 UTC, noon in Europe/Paris.

const silent = createLogger("silent");

let auth: Auth;
let viewerCookie: string;

// One Better Auth and one viewer sign-in for the file: the limit allows three per ten seconds.
beforeAll(async () => {
	auth = createTestAuth(temp.db, silent);
	viewerCookie = await addViewer(buildTestApp(temp.db, silent, auth), auth);
});

const share = z.object({
	accountId: z.string(),
	name: z.string(),
	balance: z.number(),
	active: z.boolean(),
	allocatedAmount: z.number().nullable(),
	share: z.number(),
});

const goal = z.object({
	id: z.string(),
	name: z.string(),
	targetAmount: z.number(),
	currency: z.string(),
	targetDate: z.string().nullable(),
	color: z.string(),
	icon: z.string(),
	notes: z.string().nullable(),
	state: z.string(),
	kind: z.string(),
	saved: z.number(),
	remaining: z.number(),
	percent: z.number(),
	monthlyNeeded: z.number().nullable(),
	pace: z.number(),
	status: z.string(),
	accounts: z.array(share),
});

type Link = { accountId: string; allocatedAmount?: string };

const body = (name: string, links: Link[], overrides: Record<string, unknown> = {}) => ({
	name,
	targetAmount: "1 000",
	targetDate: null,
	color: "#27a644",
	icon: "piggy-bank",
	notes: null,
	accounts: links.map((link) => ({ allocatedAmount: "", ...link })),
	...overrides,
});

async function send(method: string, path: string, json?: unknown, app?: TestApp) {
	const response = await (app ?? buildApp((await own()).db)).request(path, {
		method,
		headers: { "content-type": "application/json" },
		...(json === undefined ? {} : { body: JSON.stringify(json) }),
	});

	return { status: response.status, body: z.unknown().parse(await response.json()) };
}

/** The test's own database, opened on first use. */
async function own() {
	return ownDb ?? ownDatabase();
}

async function create(name: string, links: Link[], overrides: Record<string, unknown> = {}) {
	const { status, body: answer } = await send("POST", "/api/goals", body(name, links, overrides));

	expect(status, JSON.stringify(answer)).toBe(201);

	return z.object({ data: goal }).parse(answer).data;
}

async function list() {
	const { status, body: answer } = await send("GET", "/api/goals");

	expect(status).toBe(200);

	return z.object({ data: z.array(goal) }).parse(answer).data;
}

/** A savings account opened long ago at `balance`, in the test's own database. */
async function savings(balance: string, overrides: Record<string, unknown> = {}) {
	await own();

	return openOwn({
		name: "Livret A",
		subtype: "savings",
		openingBalance: balance,
		openingDate: "2025-01-01",
		...overrides,
	});
}

/** A savings account opened at 0 that received 3 000 on 2026-08-01, as a link. */
async function savedInto(name: string) {
	const account = await savings("0", { name });
	await postOwn(account.id, { date: "2026-08-01", label: "Virement", amount: "3 000" });

	return { accountId: account.id };
}

async function rejection(json: unknown, method = "POST", path = "/api/goals") {
	const { status, body: answer } = await send(method, path, json);

	expect(status).toBe(400);

	return errorBody.parse(answer).error;
}

async function goalCount() {
	const rows = await (
		await own()
	).db.all<{ count: number }>(
		sql`select (select count(*) from goals) + (select count(*) from goal_accounts) as count`,
	);

	return rows[0]?.count;
}

describe("goals", () => {
	it("creates an active one-off goal in its first account's currency, and reads it back", async () => {
		const account = await savings("1 500,00", { currency: "USD" });

		const created = await create("  Vacances  ", [{ accountId: account.id }], {
			targetAmount: "2 000,50",
			targetDate: "2027-06-30",
			notes: " Grèce ",
		});

		expect(created).toMatchObject({
			name: "Vacances",
			targetAmount: 200_050,
			currency: "USD",
			targetDate: "2027-06-30",
			color: "#27a644",
			icon: "piggy-bank",
			notes: "Grèce",
			state: "active",
			kind: "one_off",
			saved: 150_000,
			remaining: 50_050,
			percent: 74,
			accounts: [
				{ accountId: account.id, name: "Livret A", balance: 150_000, allocatedAmount: null },
			],
		});
		const read = await send("GET", `/api/goals/${created.id}`);

		expect(read.status).toBe(200);
		expect(z.object({ data: goal }).parse(read.body).data).toEqual(created);
	});

	it("takes fixed amounts first and gives a whole-balance link the rest", async () => {
		const account = await savings("1 000");
		const fixed = await create("Voiture", [{ accountId: account.id, allocatedAmount: "300" }]);
		const whole = await create("Travaux", [{ accountId: account.id }]);

		const goals = await list();

		expect(goals.find((item) => item.id === fixed.id)?.accounts).toEqual([
			expect.objectContaining({ allocatedAmount: 30_000, share: 30_000, balance: 100_000 }),
		]);
		expect(goals.find((item) => item.id === whole.id)?.saved).toBe(70_000);
	});

	it("scales fixed amounts above the balance down in proportion", async () => {
		const account = await savings("500");
		await create("Voiture", [{ accountId: account.id, allocatedAmount: "300" }]);
		await create("Travaux", [{ accountId: account.id, allocatedAmount: "700" }]);

		const saved = Object.fromEntries((await list()).map((item) => [item.name, item.saved]));

		expect(saved).toEqual({ Voiture: 15_000, Travaux: 35_000 });
	});

	it("backs nothing from an overdrawn account", async () => {
		const account = await savings("-50", { subtype: "checking" });
		const created = await create("Vacances", [{ accountId: account.id }]);

		expect(created).toMatchObject({ saved: 0, remaining: 100_000, percent: 0 });
	});

	it("refuses a second whole-balance link on one account, writing nothing", async () => {
		const account = await savings("1 000");
		await create("Travaux", [{ accountId: account.id }]);
		const before = await goalCount();

		await expect(rejection(body("Vacances", [{ accountId: account.id }]))).resolves.toEqual({
			code: "VALIDATION_ERROR",
			message: "The request is invalid.",
			fields: [{ path: "accounts.0.allocatedAmount", code: "whole_balance_taken" }],
		});
		await expect(goalCount()).resolves.toBe(before);
		// A fixed amount on that account is another goal's to take.
		await create("Vacances", [{ accountId: account.id, allocatedAmount: "100" }]);
	});

	it("refuses an account that cannot back the goal, naming each", async () => {
		const checking = await savings("1 000", { subtype: "checking" });
		const loan = await openOwn({ ...mortgage, openingDate: "2025-01-01" });
		const closed = await savings("200");
		await sendOwn("PATCH", `/api/accounts/${closed.id}`, { active: false });
		const dollars = await savings("300", { currency: "USD" });
		const home = await openOwn({
			name: "Maison",
			type: "property",
			subtype: "apartment",
			openingBalance: "100 000",
			openingDate: "2025-01-01",
		});
		const pea = await openOwn({
			name: "PEA",
			type: "investment",
			subtype: "pea",
			openingBalance: "100",
			openingDate: "2025-01-01",
		});

		await expect(
			rejection(
				body("Vacances", [
					{ accountId: checking.id },
					{ accountId: loan.id },
					{ accountId: closed.id },
					{ accountId: dollars.id },
					{ accountId: "unknown" },
					{ accountId: home.id },
					{ accountId: pea.id },
				]),
			),
		).resolves.toMatchObject({
			fields: [
				{ path: "accounts.1.accountId", code: "not_fundable" },
				{ path: "accounts.2.accountId", code: "not_fundable" },
				{ path: "accounts.3.accountId", code: "currency_mismatch" },
				{ path: "accounts.4.accountId", code: "not_fundable" },
				{ path: "accounts.5.accountId", code: "not_fundable" },
			],
		});
		await expect(goalCount()).resolves.toBe(0);
	});

	it.each([
		["no account", { accounts: [] }, [{ path: "accounts", code: "no_account" }]],
		[
			"an account twice",
			{
				accounts: [
					{ accountId: "a", allocatedAmount: "" },
					{ accountId: "a", allocatedAmount: "10" },
				],
			},
			[{ path: "accounts.1.accountId", code: "duplicate_account" }],
		],
		["a zero target", { targetAmount: "0" }, [{ path: "targetAmount", code: "not_positive" }]],
		[
			"an unreadable target",
			{ targetAmount: "12,345" },
			[{ path: "targetAmount", code: "invalid_amount" }],
		],
		["a blank target", { targetAmount: " " }, [{ path: "targetAmount", code: "invalid_amount" }]],
		[
			"a negative fixed amount",
			{ accounts: [{ accountId: "a", allocatedAmount: "-1" }] },
			[{ path: "accounts.0.allocatedAmount", code: "negative_amount" }],
		],
		["a blank name", { name: "  " }, [{ path: "name", code: "too_small" }]],
		["a name over 100 characters", { name: "x".repeat(101) }, [{ path: "name", code: "too_long" }]],
		[
			"notes over 1 000 characters",
			{ notes: "x".repeat(1001) },
			[{ path: "notes", code: "too_long" }],
		],
		[
			"an unknown date",
			{ targetDate: "2027-02-30" },
			[{ path: "targetDate", code: "invalid_format" }],
		],
		["a colour off the swatches", { color: "#000000" }, [{ path: "color", code: "invalid_value" }]],
		["an unknown icon", { icon: "rocket" }, [{ path: "icon", code: "invalid_value" }]],
	])("refuses %s", async (_label, overrides, fields) => {
		await expect(
			rejection({ ...body("Vacances", [{ accountId: "a" }]), ...overrides }),
		).resolves.toMatchObject({ code: "VALIDATION_ERROR", fields });
	});

	it("refuses a body of the wrong shape before reading it", async () => {
		await expect(rejection({ name: "Vacances" })).resolves.toMatchObject({
			code: "VALIDATION_ERROR",
		});
	});

	it("has no monthly amount without a date, and asks for all that remains once it has passed", async () => {
		const first = await savings("200");
		const second = await savings("600", { name: "LDDS" });

		await expect(create("Réserve", [{ accountId: first.id }])).resolves.toMatchObject({
			saved: 20_000,
			monthlyNeeded: null,
			status: "no_target_date",
		});
		await expect(
			create("Vacances", [{ accountId: second.id }], { targetDate: "2026-09-01" }),
		).resolves.toMatchObject({ remaining: 40_000, monthlyNeeded: 40_000, status: "behind" });
	});

	it("is reached, at 100 %, once saved meets the target", async () => {
		const account = await savings("1 200");

		await expect(
			create("Vacances", [{ accountId: account.id }], { targetDate: "2027-01-01" }),
		).resolves.toMatchObject({ saved: 120_000, remaining: 0, percent: 100, status: "reached" });
	});

	it("reads the pace from the linked balances' last 90 days, and sorts behind goals first", async () => {
		// Each account gained 3 000 within the last 90 days: 1 000 a month.
		const a = await savedInto("Livret A");
		const b = await savedInto("LDDS");
		const c = await savedInto("Livret jeune");

		// 30 days ahead: 1 000 left is 1 000 a month, 2 000 left is 2 000.
		await create("Vacances", [a], {
			targetAmount: "4 000",
			targetDate: "2026-10-21",
		});
		await create("Travaux", [b], {
			targetAmount: "5 000",
			targetDate: "2026-10-21",
		});
		await create("Anniversaire", [c], { targetAmount: "5 000" });
		await create("Atteint", [c], {
			targetAmount: "10",
			accounts: [{ accountId: c.accountId, allocatedAmount: "10" }],
		});

		const goals = await list();

		expect(goals.map((item) => [item.name, item.status, item.pace, item.monthlyNeeded])).toEqual([
			["Travaux", "behind", 100_000, 200_000],
			["Vacances", "on_track", 100_000, 100_000],
			["Anniversaire", "no_target_date", 100_000, null],
			["Atteint", "reached", 100_000, null],
		]);
	});

	it("starts the pace at the opening date of an account opened since", async () => {
		const account = await savings("900", { openingDate: "2026-09-01" });
		await postOwn(account.id, { date: "2026-09-10", label: "Virement", amount: "300" });

		await expect(create("Vacances", [{ accountId: account.id }])).resolves.toMatchObject({
			saved: 120_000,
			pace: 10_000,
		});
	});

	it("replaces a goal's fields and links, keeping its currency", async () => {
		const first = await savings("1 000");
		const second = await savings("400", { name: "LDDS" });
		const dollars = await savings("300", { currency: "USD" });
		const created = await create("Vacances", [{ accountId: first.id }]);

		const { status, body: answer } = await send(
			"PUT",
			`/api/goals/${created.id}`,
			body("Voyage", [{ accountId: second.id, allocatedAmount: "250" }], {
				targetAmount: "3 000",
				targetDate: "2027-01-01",
				color: "#4ea7fc",
				icon: "plane",
				notes: "Japon",
			}),
		);

		expect(status).toBe(200);
		expect(z.object({ data: goal }).parse(answer).data).toMatchObject({
			id: created.id,
			name: "Voyage",
			targetAmount: 300_000,
			currency: "EUR",
			targetDate: "2027-01-01",
			color: "#4ea7fc",
			icon: "plane",
			notes: "Japon",
			saved: 25_000,
			accounts: [{ accountId: second.id, allocatedAmount: 25_000, share: 25_000 }],
		});
		await expect(
			rejection(body("Voyage", [{ accountId: dollars.id }]), "PUT", `/api/goals/${created.id}`),
		).resolves.toMatchObject({
			fields: [{ path: "accounts.0.accountId", code: "currency_mismatch" }],
		});
	});

	it("keeps a goal's own whole-balance link when it is edited", async () => {
		const account = await savings("1 000");
		const created = await create("Vacances", [{ accountId: account.id }]);

		const { status } = await send(
			"PUT",
			`/api/goals/${created.id}`,
			body("Vacances d'été", [{ accountId: account.id }]),
		);

		expect(status).toBe(200);
	});

	it("deletes a goal and its links, leaving the account", async () => {
		const account = await savings("1 000");
		const created = await create("Vacances", [{ accountId: account.id }]);

		await expect(send("DELETE", `/api/goals/${created.id}`)).resolves.toEqual({
			status: 200,
			body: { data: { id: created.id } },
		});
		await expect(goalCount()).resolves.toBe(0);
		await expect(list()).resolves.toEqual([]);
		await expect(send("GET", `/api/accounts/${account.id}`)).resolves.toMatchObject({
			status: 200,
		});
	});

	it("counts nothing from a linked account deactivated since, and keeps showing it", async () => {
		const closed = await savings("400");
		const open = await savings("600", { name: "LDDS" });
		const created = await create("Vacances", [
			{ accountId: closed.id },
			{ accountId: open.id, allocatedAmount: "100" },
		]);
		await sendOwn("PATCH", `/api/accounts/${closed.id}`, { active: false });

		const [read] = await list();

		expect(read).toMatchObject({ id: created.id, saved: 10_000, pace: 0 });
		// By name: « LDDS » before « Livret A ».
		expect(read?.accounts).toEqual([
			expect.objectContaining({ accountId: open.id, active: true, share: 10_000 }),
			expect.objectContaining({ accountId: closed.id, active: false, balance: 40_000, share: 0 }),
		]);
	});

	it("lets a released goal's accounts go, while a paused one keeps them", async () => {
		const account = await savings("1 000");
		const archived = await create("Ancien", [{ accountId: account.id }]);
		const paused = await create("En pause", [{ accountId: account.id, allocatedAmount: "300" }]);
		const db = (await own()).db;
		await db.run(sql`update goals set state = 'archived' where id = ${archived.id}`);

		// The archived goal's whole link no longer blocks another.
		const taking = await create("Vacances", [{ accountId: account.id }]);
		await db.run(sql`update goals set state = 'paused' where id = ${paused.id}`);
		const goals = new Map((await list()).map((read) => [read.id, read]));

		expect(goals.get(taking.id)?.saved).toBe(70_000);
		expect(goals.get(paused.id)?.saved).toBe(30_000);
		// A released goal still reads what it would back beside the goals holding theirs.
		expect(goals.get(archived.id)?.saved).toBe(70_000);
		// A paused goal's whole link still blocks one.
		await db.run(
			sql`update goal_accounts set allocated_amount = null where goal_id = ${paused.id}`,
		);
		await expect(
			rejection(body("Travaux", [{ accountId: account.id }]), "PUT", `/api/goals/${archived.id}`),
		).resolves.toMatchObject({
			fields: [{ path: "accounts.0.allocatedAmount", code: "whole_balance_taken" }],
		});
	});

	it("refuses an edit that takes whole an account another goal takes whole", async () => {
		const account = await savings("1 000");
		const other = await savings("500", { name: "LDDS" });
		await create("Travaux", [{ accountId: account.id }]);
		const created = await create("Vacances", [{ accountId: other.id }]);

		await expect(
			rejection(
				body("Vacances", [{ accountId: other.id }, { accountId: account.id }]),
				"PUT",
				`/api/goals/${created.id}`,
			),
		).resolves.toMatchObject({
			fields: [{ path: "accounts.1.allocatedAmount", code: "whole_balance_taken" }],
		});
	});

	it("takes its currency from the first account that may back it", async () => {
		const dollars = await savings("300", { currency: "USD" });

		await expect(
			rejection(body("Voyage", [{ accountId: "unknown" }, { accountId: dollars.id }])),
		).resolves.toMatchObject({
			fields: [{ path: "accounts.0.accountId", code: "not_fundable" }],
		});
		await expect(
			create("Voyage", [{ accountId: dollars.id }], { targetAmount: "1 000.50" }),
		).resolves.toMatchObject({ currency: "USD", targetAmount: 100_050 });
	});

	it.each([
		["GET", undefined],
		["PUT", body("Vacances", [{ accountId: "a" }])],
		["DELETE", undefined],
	])("answers NOT_FOUND to %s on an unknown goal", async (method, json) => {
		const { status, body: answer } = await send(method, "/api/goals/unknown", json);

		expect(status).toBe(404);
		expect(errorBody.parse(answer).error).toEqual({
			code: "NOT_FOUND",
			message: "No goal has this id.",
		});
	});
});

const admin = (): TestApp => withSession(buildTestApp(temp.db, silent, auth), template.cookie);
const viewer = (): TestApp => withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

/** Every goal and link of the shared database, side by side. */
async function sharedGoalRows() {
	return temp.db.all(sql`select * from goals left join goal_accounts on goal_id = id`);
}

describe("a viewer", () => {
	it("reads goals, and is refused FORBIDDEN on every write, nothing written", async () => {
		const opened = await send(
			"POST",
			"/api/accounts",
			{
				name: "Livret A",
				type: "depository",
				subtype: "savings",
				currency: "EUR",
				openingBalance: "1 000",
				openingDate: "2026-01-01",
			},
			admin(),
		);
		const accountId = z.object({ data: z.object({ id: z.string() }) }).parse(opened.body).data.id;
		const created = await send("POST", "/api/goals", body("Vacances", [{ accountId }]), admin());
		const { id } = z.object({ data: goal }).parse(created.body).data;
		const before = await sharedGoalRows();

		const answers = await Promise.all([
			send("POST", "/api/goals", body("Travaux", [{ accountId, allocatedAmount: "1" }]), viewer()),
			send("PUT", `/api/goals/${id}`, body("Voyage", [{ accountId }]), viewer()),
			send("DELETE", `/api/goals/${id}`, undefined, viewer()),
		]);

		expect(answers.map((answer) => answer.status)).toEqual([403, 403, 403]);
		expect(answers.map((answer) => errorBody.parse(answer.body).error.code)).toEqual([
			"FORBIDDEN",
			"FORBIDDEN",
			"FORBIDDEN",
		]);
		await expect(sharedGoalRows()).resolves.toEqual(before);
		await expect(send("GET", `/api/goals/${id}`, undefined, viewer())).resolves.toMatchObject({
			status: 200,
			body: { data: { id, saved: 100_000 } },
		});
	});
});
