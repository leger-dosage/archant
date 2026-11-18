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
	targetMode: z.string(),
	targetMonths: z.number().nullable(),
	monthlyExpenses: z.number().nullable(),
	currency: z.string(),
	targetDate: z.string().nullable(),
	color: z.string(),
	icon: z.string(),
	notes: z.string().nullable(),
	state: z.string(),
	kind: z.string(),
	completedAt: z.number().nullable(),
	saved: z.number(),
	consumedAmount: z.number(),
	progressAmount: z.number(),
	remaining: z.number(),
	percent: z.number(),
	monthlyNeeded: z.number().nullable(),
	pace: z.number().nullable(),
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

/** Fires `event` on a goal, as the page's menu does, and answers the goal. */
async function fire(id: string, event: string) {
	const { status, body: answer } = await send("POST", `/api/goals/${id}/${event}`);

	expect(status, JSON.stringify(answer)).toBe(200);

	return z.object({ data: goal }).parse(answer).data;
}

/** A refused event's status and error, with its params. */
async function refusal(id: string, event: string) {
	const { status, body: answer } = await send("POST", `/api/goals/${id}/${event}`);

	return {
		status,
		error: errorBody
			.extend({
				error: errorBody.shape.error.extend({
					params: z.record(z.string(), z.string()).optional(),
				}),
			})
			.parse(answer).error,
	};
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
		["a colour that is not #rrggbb", { color: "bleu" }, [{ path: "color", code: "invalid_value" }]],
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
		).resolves.toMatchObject({ remaining: 40_000, monthlyNeeded: 40_000, status: "pace_unknown" });
	});

	it("is reached, at 100 %, once saved meets the target", async () => {
		const account = await savings("1 200");

		await expect(
			create("Vacances", [{ accountId: account.id }], { targetDate: "2027-01-01" }),
		).resolves.toMatchObject({ saved: 120_000, remaining: 0, percent: 100, status: "reached" });
	});

	it("reads the pace from the booked transactions in the last 90 days, and sorts behind goals first", async () => {
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

	it("counts inflows but leaves out a recent opening balance", async () => {
		const account = await savings("900", { openingDate: "2026-09-01" });
		await postOwn(account.id, { date: "2026-09-10", label: "Virement", amount: "300" });

		await expect(create("Vacances", [{ accountId: account.id }])).resolves.toMatchObject({
			saved: 120_000,
			pace: 10_000,
		});
	});

	it("nets internal transfers and skips pending, excluded and future entries", async () => {
		const first = await savings("500");
		const second = await savings("500", { name: "LDDS", openingDate: "2026-08-01" });
		await postOwn(first.id, { date: "2026-08-10", label: "Transfer out", amount: "-300" });
		await postOwn(second.id, { date: "2026-08-10", label: "Transfer in", amount: "300" });
		const excluded = await postOwn(first.id, {
			date: "2026-09-01",
			label: "Excluded",
			amount: "90",
		});
		await sendOwn("PATCH", `/api/transactions/${excluded}`, { excluded: true });
		const pending = await postOwn(second.id, {
			date: "2026-09-10",
			label: "Pending",
			amount: "120",
		});
		await (
			await own()
		).db.run(sql`update transactions set pending = 1 where entry_id = ${pending}`);
		await postOwn(second.id, { date: "2026-10-01", label: "Future", amount: "150" });
		await sendOwn("POST", `/api/accounts/${first.id}/snapshots`, {
			date: "2026-09-20",
			balance: "600",
		});

		await expect(
			create(
				"Voyage",
				[
					{ accountId: first.id, allocatedAmount: "100" },
					{ accountId: second.id, allocatedAmount: "100" },
				],
				{ targetDate: "2026-10-21" },
			),
		).resolves.toMatchObject({ pace: 0, status: "behind" });
	});

	it("uses the year-old balance and removes excluded flows from valuation-based pace", async () => {
		const account = await savings("400");
		const excluded = await postOwn(account.id, {
			date: "2026-03-01",
			label: "Excluded",
			amount: "120",
		});
		await sendOwn("PATCH", `/api/transactions/${excluded}`, { excluded: true });
		await sendOwn("POST", `/api/accounts/${account.id}/snapshots`, {
			date: "2026-09-20",
			balance: "1 720",
		});

		await expect(
			create("Voyage", [{ accountId: account.id }], {
				targetAmount: "1 820",
				targetDate: "2026-10-21",
			}),
		).resolves.toMatchObject({ saved: 172_000, pace: 10_000, status: "on_track" });
	});

	it("uses the full annual change when a valuation has no excluded flows", async () => {
		const account = await savings("400");
		await sendOwn("POST", `/api/accounts/${account.id}/snapshots`, {
			date: "2026-09-20",
			balance: "1 600",
		});

		await expect(
			create("Voyage", [{ accountId: account.id }], {
				targetAmount: "1 700",
				targetDate: "2026-10-21",
			}),
		).resolves.toMatchObject({ saved: 160_000, pace: 10_000, status: "on_track" });
	});

	it("requires a year of history for a valuation and reports unknown pace for mixed evidence", async () => {
		const fresh = await savings("500", { openingDate: "2026-03-01" });
		const measured = await savedInto("LDDS");
		await sendOwn("POST", `/api/accounts/${fresh.id}/snapshots`, {
			date: "2026-09-20",
			balance: "800",
		});

		await expect(
			create("Voyage", [{ accountId: fresh.id }, measured], {
				targetAmount: "4 500",
				targetDate: "2026-10-21",
			}),
		).resolves.toMatchObject({ saved: 380_000, pace: null, status: "pace_unknown" });
	});

	it("counts older booked and included transactions as a measured zero without a recent valuation", async () => {
		const account = await savings("400");
		await postOwn(account.id, { date: "2026-02-01", label: "Old deposit", amount: "600" });

		await expect(
			create("Voyage", [{ accountId: account.id }], {
				targetAmount: "1 800",
				targetDate: "2026-10-21",
			}),
		).resolves.toMatchObject({ saved: 100_000, pace: 0, status: "behind" });
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

	it("keeps counting a linked account deactivated since", async () => {
		const closed = await savings("400");
		const open = await savings("600", { name: "LDDS" });
		await postOwn(closed.id, { date: "2026-09-01", label: "Deposit", amount: "300" });
		await postOwn(open.id, { date: "2026-09-01", label: "Deposit", amount: "60" });
		const created = await create("Vacances", [
			{ accountId: closed.id },
			{ accountId: open.id, allocatedAmount: "100" },
		]);
		await sendOwn("PATCH", `/api/accounts/${closed.id}`, { active: false });

		const [read] = await list();

		expect(read).toMatchObject({ id: created.id, saved: 80_000, pace: 12_000 });
		// By name: « LDDS » before « Livret A ».
		expect(read?.accounts).toEqual([
			expect.objectContaining({ accountId: open.id, active: true, share: 10_000 }),
			expect.objectContaining({
				accountId: closed.id,
				active: false,
				balance: 70_000,
				share: 70_000,
			}),
		]);
		const kept = await send(
			"PUT",
			`/api/goals/${created.id}`,
			body("Voyage", [{ accountId: closed.id }, { accountId: open.id, allocatedAmount: "100" }]),
		);
		expect(kept).toMatchObject({ status: 200, body: { data: { name: "Voyage", saved: 80_000 } } });
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
		await expect(rejection(body("Travaux", [{ accountId: account.id }]))).resolves.toMatchObject({
			fields: [{ path: "accounts.0.allocatedAmount", code: "whole_balance_taken" }],
		});
	});

	it("renames a released goal whose account another goal took whole since, checking only new links", async () => {
		const account = await savings("1 000");
		const other = await savings("500", { name: "LDDS" });
		const archived = await create("Ancien", [{ accountId: account.id }]);
		await sendOwn("POST", `/api/goals/${archived.id}/archive`);
		await create("Travaux", [{ accountId: account.id }]);
		await create("Voyage", [{ accountId: other.id }]);

		const { status } = await send(
			"PUT",
			`/api/goals/${archived.id}`,
			body("Ancien projet", [{ accountId: account.id }]),
		);

		expect(status).toBe(200);
		await expect(
			rejection(
				body("Ancien projet", [{ accountId: account.id }, { accountId: other.id }]),
				"PUT",
				`/api/goals/${archived.id}`,
			),
		).resolves.toMatchObject({
			fields: [{ path: "accounts.1.allocatedAmount", code: "whole_balance_taken" }],
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

const NOW = Date.parse("2026-09-21T10:00:00Z");

/** Every goal row of the test's own database. */
async function goalRows() {
	return (await own()).db.all(sql`select * from goals`);
}

describe("a goal's lifecycle", () => {
	it("completes a goal, freezing what it saved and when, and lets its account go", async () => {
		const account = await savings("450");
		const created = await create("Vélo", [{ accountId: account.id }], {
			targetDate: "2027-01-01",
		});

		const completed = await fire(created.id, "complete");

		expect(completed).toMatchObject({
			state: "completed",
			saved: 45_000,
			remaining: 55_000,
			percent: 100,
			status: "reached",
			completedAt: NOW,
		});
		// Released: another goal takes the account whole, and the balance moves.
		const taking = await create("Voyage", [{ accountId: account.id }]);
		await postOwn(account.id, { date: "2026-09-20", label: "Virement", amount: "250" });
		const goals = new Map((await list()).map((read) => [read.id, read]));

		expect(goals.get(created.id)).toMatchObject({ saved: 45_000, percent: 100 });
		expect(goals.get(taking.id)?.saved).toBe(70_000);
	});

	it("archives a completed goal still at its frozen amount, then reopens it to the live one", async () => {
		const account = await savings("450");
		const created = await create("Vélo", [{ accountId: account.id }]);
		await fire(created.id, "complete");
		await postOwn(account.id, { date: "2026-09-20", label: "Virement", amount: "550" });

		await expect(fire(created.id, "archive")).resolves.toMatchObject({
			state: "archived",
			saved: 45_000,
			completedAt: NOW,
		});
		await expect(fire(created.id, "restore")).resolves.toMatchObject({
			state: "active",
			saved: 100_000,
			completedAt: null,
		});
		await fire(created.id, "complete");
		await expect(fire(created.id, "reopen")).resolves.toMatchObject({
			state: "active",
			saved: 100_000,
			completedAt: null,
			status: "reached",
		});
		const rows = await (
			await own()
		).db.all(sql`select completed_amount as amount, completed_at as at from goals`);

		expect(rows).toEqual([{ amount: null, at: null }]);
	});

	it("archives an active goal without freezing anything", async () => {
		const account = await savings("300");
		const created = await create("Vélo", [{ accountId: account.id }]);

		await expect(fire(created.id, "archive")).resolves.toMatchObject({
			state: "archived",
			saved: 30_000,
			completedAt: null,
		});
	});

	it("refuses to restore a goal whose whole account another goal has taken since, naming it", async () => {
		const account = await savings("1 000");
		const other = await savings("200", { name: "LDDS" });
		const archived = await create("Ancien", [{ accountId: other.id }, { accountId: account.id }]);
		await fire(archived.id, "archive");
		await create("Travaux", [{ accountId: account.id }]);

		await expect(refusal(archived.id, "restore")).resolves.toEqual({
			status: 409,
			error: {
				code: "GOAL_ACCOUNT_TAKEN",
				message: "Another goal now takes whole an account this goal takes whole.",
				params: { accountId: account.id },
			},
		});
		await expect(send("GET", `/api/goals/${archived.id}`)).resolves.toMatchObject({
			body: { data: { state: "archived" } },
		});
	});

	it("refuses to reopen a completed goal on the same terms, but not for a fixed amount", async () => {
		const account = await savings("1 000");
		const whole = await create("Vélo", [{ accountId: account.id }]);
		const fixed = await create("Piscine", [{ accountId: account.id, allocatedAmount: "100" }]);
		await fire(whole.id, "complete");
		await fire(fixed.id, "complete");
		await create("Travaux", [{ accountId: account.id }]);

		await expect(refusal(whole.id, "reopen")).resolves.toMatchObject({
			status: 409,
			error: { code: "GOAL_ACCOUNT_TAKEN", params: { accountId: account.id } },
		});
		await expect(fire(fixed.id, "reopen")).resolves.toMatchObject({ state: "active" });
	});

	it("keeps a paused goal's accounts, and resumes it", async () => {
		const account = await savings("1 000");
		const created = await create("Vélo", [{ accountId: account.id }]);

		await expect(fire(created.id, "pause")).resolves.toMatchObject({
			state: "paused",
			saved: 100_000,
			completedAt: null,
		});
		await expect(rejection(body("Voyage", [{ accountId: account.id }]))).resolves.toMatchObject({
			fields: [{ path: "accounts.0.allocatedAmount", code: "whole_balance_taken" }],
		});
		await expect(fire(created.id, "resume")).resolves.toMatchObject({ state: "active" });
		await fire(created.id, "pause");
		await expect(fire(created.id, "complete")).resolves.toMatchObject({
			state: "completed",
			completedAt: NOW,
		});
	});

	it.each([
		["resume", "an active goal", null],
		["reopen", "an active goal", null],
		["complete", "an archived goal", "archive"],
		["pause", "a completed goal", "complete"],
		["restore", "a paused goal", "pause"],
	])("refuses to %s %s, writing nothing", async (event, _label, before) => {
		const account = await savings("300");
		const created = await create("Vélo", [{ accountId: account.id }]);
		if (before !== null) {
			await fire(created.id, before);
		}
		const kept = await goalRows();

		const { status, error } = await refusal(created.id, event);

		expect(status).toBe(409);
		expect(error.code).toBe("GOAL_STATE_INVALID");
		await expect(goalRows()).resolves.toEqual(kept);
	});

	it("never completes a reserve", async () => {
		const account = await savings("300");
		const created = await create("Réserve", [{ accountId: account.id }], { kind: "maintained" });
		const kept = await goalRows();

		await expect(refusal(created.id, "complete")).resolves.toMatchObject({
			status: 409,
			error: { code: "GOAL_STATE_INVALID" },
		});
		await expect(goalRows()).resolves.toEqual(kept);
		await expect(fire(created.id, "archive")).resolves.toMatchObject({ state: "archived" });
	});

	it("refuses an unknown event, and an event on an unknown goal", async () => {
		const account = await savings("300");
		const created = await create("Vélo", [{ accountId: account.id }]);

		await expect(refusal(created.id, "explode")).resolves.toMatchObject({
			status: 400,
			error: { code: "VALIDATION_ERROR", fields: [{ path: "event", code: "invalid_value" }] },
		});
		await expect(refusal("unknown", "pause")).resolves.toMatchObject({
			status: 404,
			error: { code: "NOT_FOUND" },
		});
		await expect(refusal("unknown", "complete")).resolves.toMatchObject({
			status: 404,
			error: { code: "NOT_FOUND" },
		});
	});

	it("still edits and deletes a goal in any state", async () => {
		const account = await savings("300");
		const created = await create("Vélo", [{ accountId: account.id }]);
		await fire(created.id, "complete");

		const { status } = await send(
			"PUT",
			`/api/goals/${created.id}`,
			body("Vélo électrique", [{ accountId: account.id }]),
		);

		expect(status).toBe(200);
		await expect(send("DELETE", `/api/goals/${created.id}`)).resolves.toMatchObject({
			status: 200,
		});
	});

	it("lists active goals by status, then paused, completed and archived ones", async () => {
		const account = await savings("1 000");
		const names = ["Archivé", "Terminé", "En pause", "Actif"];
		const [archived, completed, paused] = await Promise.all(
			names.map(async (name) =>
				create(name, [{ accountId: account.id, allocatedAmount: "10" }], { targetAmount: "100" }),
			),
		);
		await fire(archived?.id ?? "", "archive");
		await fire(completed?.id ?? "", "complete");
		await fire(paused?.id ?? "", "pause");

		expect((await list()).map((read) => read.name)).toEqual([
			"Actif",
			"En pause",
			"Terminé",
			"Archivé",
		]);
	});
});

/** A current account opened long ago, spending `amount` on each `date`, one after the other. */
async function spent(lines: readonly (readonly [string, string])[]) {
	const account = await savings("100 000", { name: "Compte courant", subtype: "checking" });

	// One after the other: each is an `immediate` ledger write.
	return lines.reduce(
		async (previous, [date, amount]) => [
			...(await previous),
			await postOwn(account.id, { date, label: "Courses", amount }),
		],
		Promise.resolve<string[]>([]),
	);
}

/** 2 000, 1 000 and 3 000 spent in the three months before September: a median of 2 000. */
const THREE_MONTHS = [
	["2026-06-10", "-2 000"],
	["2026-07-10", "-1 000"],
	["2026-08-10", "-3 000"],
] as const;

const reserve = (months: string) => ({
	kind: "maintained",
	targetMode: "months_of_expenses",
	targetMonths: months,
	targetAmount: "",
});

async function storedTargets() {
	return (await own()).db.all(
		sql`select target_amount as amount, target_mode as mode, target_months as months, target_date as date from goals`,
	);
}

describe("a reserve", () => {
	it("aims for its months times the median monthly expenses, read again as they move", async () => {
		await spent(THREE_MONTHS);
		const account = await savings("3 000");

		const created = await create("Urgences", [{ accountId: account.id }], {
			...reserve("6"),
			targetDate: "2027-06-30",
		});

		expect(created).toMatchObject({
			kind: "maintained",
			targetMode: "months_of_expenses",
			targetMonths: 6,
			targetAmount: 1_200_000,
			monthlyExpenses: 200_000,
			targetDate: null,
			saved: 300_000,
			remaining: 900_000,
			monthlyNeeded: null,
			status: "depleted",
		});
		await expect(storedTargets()).resolves.toEqual([
			{ amount: 1_200_000, mode: "months_of_expenses", months: 6, date: null },
		]);

		// A month of 5 000 before them: the median of four is 2 500.
		await spent([["2026-05-10", "-5 000"]]);

		await expect(list()).resolves.toMatchObject([
			{ targetAmount: 1_500_000, monthlyExpenses: 250_000 },
		]);
		// Read, never written.
		await expect(storedTargets()).resolves.toMatchObject([{ amount: 1_200_000 }]);
	});

	it("reads this month's expenses, as Sure's median, and refuses months of expenses without any", async () => {
		const [only = ""] = await spent([["2026-09-10", "-9 000"]]);
		const account = await savings("3 000");

		// The current month counts, where it was refused before a complete month spent.
		await expect(
			create("Réserve", [{ accountId: account.id, allocatedAmount: "10" }], reserve("2")),
		).resolves.toMatchObject({ targetAmount: 1_800_000, monthlyExpenses: 900_000 });
		await sendOwn("PATCH", `/api/transactions/${only}`, { oneTime: true });

		await expect(
			rejection(body("Urgences", [{ accountId: account.id }], reserve("6"))),
		).resolves.toEqual({
			code: "VALIDATION_ERROR",
			message: "The request is invalid.",
			fields: [{ path: "targetMonths", code: "no_expenses" }],
		});
		// The first goal and its link alone.
		await expect(goalCount()).resolves.toBe(2);
	});

	it("refuses months of expenses for accounts outside the reporting currency", async () => {
		await spent(THREE_MONTHS);
		const dollars = await savings("3 000", { currency: "USD" });

		await expect(
			rejection(body("Urgences", [{ accountId: dollars.id }], reserve("6"))),
		).resolves.toMatchObject({
			fields: [{ path: "targetMonths", code: "not_reporting_currency" }],
		});
		await expect(goalCount()).resolves.toBe(0);
	});

	it("keeps the target last computed once the median is gone", async () => {
		const ids = await spent(THREE_MONTHS);
		const account = await savings("3 000");
		await create("Urgences", [{ accountId: account.id }], reserve("6"));

		await Promise.all(
			ids.map(async (id) => sendOwn("PATCH", `/api/transactions/${id}`, { excluded: true })),
		);

		await expect(list()).resolves.toMatchObject([
			{ targetAmount: 1_200_000, monthlyExpenses: null, targetMonths: 6, status: "depleted" },
		]);
	});

	it("keeps its stored target when renamed after the median is gone, and refuses new months", async () => {
		const ids = await spent(THREE_MONTHS);
		const account = await savings("3 000");
		const created = await create("Urgences", [{ accountId: account.id }], reserve("6"));
		await Promise.all(
			ids.map(async (id) => sendOwn("PATCH", `/api/transactions/${id}`, { excluded: true })),
		);

		const renamed = await send(
			"PUT",
			`/api/goals/${created.id}`,
			body("Épargne de précaution", [{ accountId: account.id }], reserve("6")),
		);

		expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
		await expect(storedTargets()).resolves.toEqual([
			{ amount: 1_200_000, mode: "months_of_expenses", months: 6, date: null },
		]);
		await expect(
			rejection(
				body("Épargne de précaution", [{ accountId: account.id }], reserve("3")),
				"PUT",
				`/api/goals/${created.id}`,
			),
		).resolves.toMatchObject({ fields: [{ path: "targetMonths", code: "no_expenses" }] });
	});

	it("is created in months without any amount", async () => {
		await spent(THREE_MONTHS);
		const account = await savings("3 000");
		const json = {
			name: "Urgences",
			kind: "maintained",
			targetMode: "months_of_expenses",
			targetMonths: "6",
			targetDate: null,
			color: "#27a644",
			icon: "piggy-bank",
			notes: null,
			accounts: [{ accountId: account.id, allocatedAmount: "" }],
		};

		const { status, body: answer } = await send("POST", "/api/goals", json);

		expect(status, JSON.stringify(answer)).toBe(201);
		expect(z.object({ data: goal }).parse(answer).data.targetAmount).toBe(1_200_000);
	});

	it("is funded once its share covers a fixed target, depleted below it, and sorts with goals behind", async () => {
		const a = await savedInto("Livret A");
		const b = await savedInto("LDDS");
		const thin = await savings("300", { name: "Livret jeune" });
		const full = await savings("1 000", { name: "CEL" });
		const fixedReserve = { kind: "maintained", targetMode: "fixed", targetAmount: "800" };

		// 30 days ahead: 1 000 left is on track, 2 000 left is behind.
		await create("Vacances", [a], { targetAmount: "4 000", targetDate: "2026-10-21" });
		await create("Travaux", [b], { targetAmount: "5 000", targetDate: "2026-10-21" });
		await create("Urgences", [{ accountId: thin.id }], fixedReserve);
		const funded = await create("Abri", [{ accountId: full.id }], fixedReserve);

		expect(funded).toMatchObject({
			targetAmount: 80_000,
			targetMode: "fixed",
			targetMonths: null,
			monthlyExpenses: null,
			remaining: 0,
			percent: 100,
			status: "funded",
		});
		expect((await list()).map((item) => [item.name, item.status])).toEqual([
			["Travaux", "behind"],
			["Urgences", "depleted"],
			["Vacances", "on_track"],
			["Abri", "funded"],
		]);
	});

	it("counts in the dashboard's totals, never as behind", async () => {
		const account = await savings("300");
		await create("Urgences", [{ accountId: account.id }], {
			kind: "maintained",
			targetAmount: "800",
		});

		const { body: answer } = await send("GET", "/api/goals/summary");

		expect(answer).toMatchObject({ data: { count: 1, saved: 30_000, target: 80_000, behind: 0 } });
	});

	it.each([
		[
			"a one-off goal in months",
			{ targetMode: "months_of_expenses", targetMonths: "6" },
			[{ path: "targetMode", code: "reserve_only" }],
		],
		["no months", reserve(""), [{ path: "targetMonths", code: "invalid_months" }]],
		["zero months", reserve("0"), [{ path: "targetMonths", code: "invalid_months" }]],
		["121 months", reserve("121"), [{ path: "targetMonths", code: "invalid_months" }]],
		["half a month", reserve("1,5"), [{ path: "targetMonths", code: "invalid_months" }]],
		["an unknown kind", { kind: "reserve" }, [{ path: "kind", code: "invalid_value" }]],
		["an unknown mode", { targetMode: "weekly" }, [{ path: "targetMode", code: "invalid_value" }]],
	])("refuses %s", async (_label, overrides, fields) => {
		await expect(
			rejection({ ...body("Urgences", [{ accountId: "a" }]), ...overrides }),
		).resolves.toMatchObject({ code: "VALIDATION_ERROR", fields });
	});

	it("reports the months beside every other field's error", async () => {
		const { fields } = await rejection({ ...body("  ", []), ...reserve("0") });

		expect(fields).toEqual(
			expect.arrayContaining([
				{ path: "name", code: "too_small" },
				{ path: "accounts", code: "no_account" },
				{ path: "targetMonths", code: "invalid_months" },
			]),
		);
	});

	it("reads only the field its mode uses", async () => {
		await spent(THREE_MONTHS);
		const account = await savings("3 000");
		const other = await savings("100", { name: "LDDS" });

		await expect(
			create("Urgences", [{ accountId: account.id }], { ...reserve("1"), targetAmount: "abc" }),
		).resolves.toMatchObject({ targetAmount: 200_000 });
		await expect(
			create("Vacances", [{ accountId: other.id }], { targetMonths: "abc" }),
		).resolves.toMatchObject({ targetAmount: 100_000, targetMode: "fixed", targetMonths: null });
	});

	it("turns an active goal into a reserve, dropping its date, but not a completed or archived one", async () => {
		const account = await savings("300");
		const other = await savings("200", { name: "LDDS" });
		const active = await create("Urgences", [{ accountId: account.id }], {
			targetDate: "2027-06-30",
		});
		const archived = await create("Ancien", [{ accountId: other.id }]);
		await fire(archived.id, "archive");

		const { status, body: answer } = await send(
			"PUT",
			`/api/goals/${active.id}`,
			body("Urgences", [{ accountId: account.id }], {
				kind: "maintained",
				targetDate: "2027-06-30",
			}),
		);

		expect(status).toBe(200);
		expect(z.object({ data: goal }).parse(answer).data).toMatchObject({
			kind: "maintained",
			targetDate: null,
			status: "depleted",
		});
		const kept = await goalRows();
		await expect(
			rejection(
				body("Ancien", [{ accountId: other.id }], { kind: "maintained" }),
				"PUT",
				`/api/goals/${archived.id}`,
			),
		).resolves.toEqual({
			code: "VALIDATION_ERROR",
			message: "The request is invalid.",
			fields: [{ path: "kind", code: "kind_locked" }],
		});
		await expect(goalRows()).resolves.toEqual(kept);
		// Its other fields still change.
		await expect(
			send("PUT", `/api/goals/${archived.id}`, body("Ancien projet", [{ accountId: other.id }])),
		).resolves.toMatchObject({ status: 200 });
	});

	it("turns a paused goal into a reserve", async () => {
		const account = await savings("300");
		const paused = await create("Vélo", [{ accountId: account.id }]);
		await fire(paused.id, "pause");

		const { status, body: answer } = await send(
			"PUT",
			`/api/goals/${paused.id}`,
			body("Vélo", [{ accountId: account.id }], { kind: "maintained" }),
		);

		expect(status, JSON.stringify(answer)).toBe(200);
		expect(z.object({ data: goal }).parse(answer).data).toMatchObject({
			kind: "maintained",
			state: "paused",
		});
	});

	it("keeps a completed goal's kind", async () => {
		const account = await savings("300");
		const completed = await create("Vélo", [{ accountId: account.id }]);
		await fire(completed.id, "complete");

		await expect(
			rejection(
				body("Vélo", [{ accountId: account.id }], { kind: "maintained" }),
				"PUT",
				`/api/goals/${completed.id}`,
			),
		).resolves.toMatchObject({ fields: [{ path: "kind", code: "kind_locked" }] });
	});

	it("stores a new product when a reserve in months is saved again", async () => {
		await spent(THREE_MONTHS);
		const account = await savings("3 000");
		const created = await create("Urgences", [{ accountId: account.id }], reserve("6"));

		const { status } = await send(
			"PUT",
			`/api/goals/${created.id}`,
			body("Urgences", [{ accountId: account.id }], reserve("3")),
		);

		expect(status).toBe(200);
		await expect(storedTargets()).resolves.toEqual([
			{ amount: 600_000, mode: "months_of_expenses", months: 3, date: null },
		]);
	});
});

const history = z.object({
	data: z.object({
		currency: z.string(),
		from: z.string(),
		to: z.string(),
		points: z.array(z.object({ date: z.string(), saved: z.number() })),
	}),
});

async function historyOf(id: string) {
	const { status, body: answer } = await send("GET", `/api/goals/${id}/history`);

	expect(status, JSON.stringify(answer)).toBe(200);

	return history.parse(answer).data;
}

describe("a goal's history", () => {
	it("scales the whole historical balance by today's backing ratio", async () => {
		// 500 on 2026-06-23, 1 000 today, another goal taking 300 first.
		const account = await savings("500", { openingDate: "2026-06-23" });
		await postOwn(account.id, { date: "2026-09-21", label: "Virement", amount: "500" });
		const created = await create("Vélo", [{ accountId: account.id }]);
		await create("Piscine", [{ accountId: account.id, allocatedAmount: "300" }]);

		const read = await historyOf(created.id);

		expect(read).toMatchObject({ currency: "EUR", from: "2026-06-23", to: "2026-09-21" });
		expect(read.points).toHaveLength(91);
		expect(read.points.at(0)).toEqual({ date: "2026-06-23", saved: 35_000 });
		expect(read.points.at(-1)).toEqual({ date: "2026-09-21", saved: 70_000 });
	});

	it("includes the history of a deactivated linked account", async () => {
		const recent = await savings("200", { openingDate: "2026-09-01" });
		const later = await savings("100", { name: "LDDS", openingDate: "2026-09-10" });
		const closed = await savings("900", { name: "Livret jeune", openingDate: "2026-01-01" });
		const created = await create("Vélo", [
			{ accountId: recent.id },
			{ accountId: later.id },
			{ accountId: closed.id },
		]);
		await sendOwn("PATCH", `/api/accounts/${closed.id}`, { active: false });

		const read = await historyOf(created.id);

		expect(read.from).toBe("2026-06-23");
		expect(read.points.at(0)?.saved).toBe(90_000);
		expect(read.points.find((point) => point.date === "2026-09-01")?.saved).toBe(110_000);
		expect(read.points.at(-1)?.saved).toBe(120_000);
	});

	it("answers NOT_FOUND for an unknown goal", async () => {
		const { status } = await send("GET", "/api/goals/unknown/history");

		expect(status).toBe(404);
	});
});

describe("the goals' overview", () => {
	it("reads both contribution windows and counts only active goals with a measured pace", async () => {
		const behind = await savings("0");
		await postOwn(behind.id, { date: "2026-08-22", label: "Current deposit", amount: "200" });
		await postOwn(behind.id, { date: "2026-08-21", label: "Prior deposit", amount: "100" });
		await postOwn(behind.id, { date: "2026-09-22", label: "Future deposit", amount: "700" });
		await postOwn(behind.id, { date: "2026-07-22", label: "Older deposit", amount: "400" });
		await create("Voyage", [{ accountId: behind.id }], { targetDate: "2026-10-21" });

		const onTrack = await savings("800");
		await postOwn(onTrack.id, { date: "2026-09-21", label: "Deposit", amount: "150" });
		await create("Vélo", [{ accountId: onTrack.id }], {
			targetAmount: "950",
			targetDate: "2026-10-21",
		});
		await create("Réserve", [{ accountId: onTrack.id, allocatedAmount: "25" }], {
			kind: "maintained",
		});

		const pauseAccount = await savings("0");
		await postOwn(pauseAccount.id, { date: "2026-07-01", label: "Old deposit", amount: "10" });
		const paused = await create("En pause", [{ accountId: pauseAccount.id }], {
			targetDate: "2026-10-21",
		});
		await fire(paused.id, "pause");
		const unknown = await savings("200");
		await create("Rythme inconnu", [{ accountId: unknown.id }], { targetDate: "2026-10-21" });
		const reached = await savings("1200");
		await create("Atteint", [{ accountId: reached.id }], { targetDate: "2026-10-21" });
		const open = await savings("0");
		await create("Libre", [{ accountId: open.id }]);
		const released = await savings("0");
		await postOwn(released.id, { date: "2026-09-01", label: "Withdrawal", amount: "-50" });
		const excluded = await postOwn(released.id, {
			date: "2026-09-02",
			label: "Excluded",
			amount: "90",
		});
		await sendOwn("PATCH", `/api/transactions/${excluded}`, { excluded: true });
		const pending = await postOwn(released.id, {
			date: "2026-09-03",
			label: "Pending",
			amount: "120",
		});
		await (
			await own()
		).db.run(sql`update transactions set pending = 1 where entry_id = ${pending}`);
		const completed = await create("Terminé", [{ accountId: released.id }]);
		await fire(completed.id, "complete");
		const archived = await create("Archivé", [{ accountId: released.id }]);
		await fire(archived.id, "archive");

		const { status, body: answer } = await send("GET", "/api/goals/overview");

		expect(status).toBe(200);
		const { goals } = z.object({ data: z.object({ goals: z.array(goal) }) }).parse(answer).data;
		expect(goals.map(({ name, status: pace }) => [name, pace])).toEqual(
			expect.arrayContaining([
				["Voyage", "behind"],
				["Vélo", "on_track"],
				["Rythme inconnu", "pace_unknown"],
			]),
		);
		expect(answer).toMatchObject({
			data: {
				indicators: {
					currency: "EUR",
					contributed: 30_000,
					priorContribution: 10_000,
					monthlyNeeded: 30_000,
					behind: 1,
					onTrack: 1,
					tracked: 2,
					paceUnknown: 1,
				},
			},
		});
	});

	it("leaves foreign amounts out while counting those goals' pace", async () => {
		const dollars = await savings("0", { name: "Dollar savings", currency: "USD" });
		await postOwn(dollars.id, { date: "2026-09-01", label: "Deposit", amount: "100" });
		await create("Voyage", [{ accountId: dollars.id }], { targetDate: "2026-10-21" });

		await expect(send("GET", "/api/goals/overview")).resolves.toMatchObject({
			status: 200,
			body: {
				data: {
					indicators: {
						currency: "EUR",
						contributed: 0,
						contributionLeftOut: [{ name: "Dollar savings" }],
						monthlyNeeded: 0,
						monthlyLeftOut: [{ name: "Voyage" }],
						behind: 1,
						tracked: 1,
					},
				},
			},
		});
	});
});

describe("the goals' summary", () => {
	it("sums the goals holding their money in the reporting currency, naming the others", async () => {
		const first = await savings("200");
		const second = await savings("300", { name: "LDDS" });
		const dollars = await savings("100", { currency: "USD" });
		const done = await savings("50", { name: "Livret jeune" });
		await create("Vacances", [{ accountId: first.id }], {
			targetDate: "2026-10-21",
		});
		await create("Vélo", [{ accountId: second.id }], { targetAmount: "500" });
		const voyage = await create("Voyage", [{ accountId: dollars.id }]);
		const finished = await create("Fini", [{ accountId: done.id }]);
		await fire(finished.id, "complete");

		const { status, body: answer } = await send("GET", "/api/goals/summary");

		expect(status).toBe(200);
		expect(answer).toMatchObject({
			data: {
				currency: "EUR",
				count: 3,
				saved: 50_000,
				target: 150_000,
				behind: 0,
				paceUnknown: 1,
				leftOut: [{ id: voyage.id, name: "Voyage" }],
			},
		});
		expect(
			z
				.object({ data: z.object({ goals: z.array(goal) }) })
				.parse(answer)
				.data.goals.map((item) => item.name),
		).toEqual(["Vacances", "Vélo", "Voyage"]);
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

		const events = ["pause", "resume", "complete", "archive", "restore", "reopen"];
		const answers = await Promise.all([
			send("POST", "/api/goals", body("Travaux", [{ accountId, allocatedAmount: "1" }]), viewer()),
			send("PUT", `/api/goals/${id}`, body("Voyage", [{ accountId }]), viewer()),
			send("DELETE", `/api/goals/${id}`, undefined, viewer()),
			send("GET", `/api/goals/${id}/outflows`, undefined, viewer()),
			send("POST", `/api/goals/${id}/consume`, { amount: "100" }, viewer()),
			send("POST", `/api/goals/${id}/pledges`, { accountId, amount: "50" }, viewer()),
			send("POST", `/api/goals/${id}/pledges/pledge/extend`, undefined, viewer()),
			send("DELETE", `/api/goals/${id}/pledges/pledge`, undefined, viewer()),
			...events.map(async (event) =>
				send("POST", `/api/goals/${id}/${event}`, undefined, viewer()),
			),
		]);

		expect(answers.map((answer) => answer.status)).toEqual(Array(14).fill(403));
		expect(new Set(answers.map((answer) => errorBody.parse(answer.body).error.code))).toEqual(
			new Set(["FORBIDDEN"]),
		);
		await expect(sharedGoalRows()).resolves.toEqual(before);
		await expect(send("GET", `/api/goals/${id}`, undefined, viewer())).resolves.toMatchObject({
			status: 200,
			body: { data: { id, saved: 100_000 } },
		});
		await expect(
			send("GET", `/api/goals/${id}/history`, undefined, viewer()),
		).resolves.toMatchObject({ status: 200 });
		await expect(send("GET", "/api/goals/summary", undefined, viewer())).resolves.toMatchObject({
			status: 200,
		});
	});
});

const consume = (id: string, input: unknown) => send("POST", `/api/goals/${id}/consume`, input);
const outflows = (id: string) => send("GET", `/api/goals/${id}/outflows`);

async function refused(id: string, input: unknown, reason: string) {
	expect(await consume(id, input)).toMatchObject({
		status: 409,
		body: { error: { code: "GOAL_SPEND_REFUSED", params: { reason } } },
	});
}

describe("goal consumption", () => {
	it("suggests the three newest eligible debits and rechecks eligibility on claim", async () => {
		const account = await savings("3 000");
		const other = await savings("1 000");
		const holiday = await create("Holiday", [{ accountId: account.id }]);
		const debit = (date: string, amount: string, label: string) =>
			postOwn(account.id, { date, amount, label });
		const borderline = await debit("2026-06-23", "-100", "90 days old");
		const first = await debit("2026-09-20", "-100", "Newest");
		const second = await debit("2026-09-19", "-100", "Second");
		const third = await debit("2026-09-18", "-100", "Third");
		const old = await debit("2026-06-22", "-100", "Too old");
		const small = await debit("2026-09-21", "-99,99", "Too small");
		const positive = await debit("2026-09-21", "100", "Deposit");
		const future = await debit("2026-09-22", "-100", "Future");
		const pending = await debit("2026-09-21", "-110", "Pending");
		const excluded = await debit("2026-09-21", "-120", "Excluded");
		const unlinked = await postOwn(other.id, {
			date: "2026-09-20",
			amount: "-100",
			label: "Other",
		});
		const { db } = await own();
		await db.run(sql`update transactions set pending = 1 where entry_id = ${pending}`);
		await send("PATCH", `/api/transactions/${excluded}`, { excluded: true });

		expect(await outflows(holiday.id)).toMatchObject({
			status: 200,
			body: { data: [{ id: first }, { id: second }, { id: third }] },
		});
		await Promise.all(
			[old, small, positive, future, pending, excluded, unlinked, "missing"].map(async (entryId) =>
				refused(holiday.id, { entryId }, "transaction_not_found"),
			),
		);
		expect(await consume(holiday.id, { entryId: first })).toMatchObject({ status: 200 });
		expect(await outflows(holiday.id)).toMatchObject({
			body: { data: [{ id: second }, { id: third }, { id: borderline }] },
		});
	});

	it("refuses invalid spending and rolls back a claim when the earmark is too small", async () => {
		const account = await savings("2 000");
		const other = await savings("500");
		const links = [{ accountId: account.id, allocatedAmount: "50" }, { accountId: other.id }];
		const holiday = await create("Holiday", links);
		const emergency = await create("Reserve", [{ accountId: account.id, allocatedAmount: "200" }], {
			kind: "maintained",
		});
		const entryId = await postOwn(account.id, {
			date: "2026-09-20",
			amount: "-100",
			label: "Train",
		});

		await refused(emergency.id, { amount: "10" }, "maintained");
		expect(await outflows(emergency.id)).toMatchObject({ body: { data: [] } });
		await refused(holiday.id, { amount: "0" }, "non_positive");
		await refused(holiday.id, { amount: "garbage" }, "non_positive");
		await refused(holiday.id, { amount: "10" }, "account_required");
		await refused(holiday.id, { amount: "10", accountId: "other" }, "account_not_linked");
		await refused(holiday.id, { amount: "1001", accountId: account.id }, "exceeds_target");
		await refused(holiday.id, { amount: "600", accountId: other.id }, "exceeds_earmark");
		await refused(holiday.id, { entryId }, "exceeds_earmark");
		expect(await outflows(holiday.id)).toMatchObject({ body: { data: [{ id: entryId }] } });
		expect(await send("GET", `/api/goals/${holiday.id}`)).toMatchObject({
			body: {
				data: {
					consumedAmount: 0,
					accounts: [{ allocatedAmount: 5_000 }, { allocatedAmount: null }],
				},
			},
		});
		expect(await consume(holiday.id, { entryId, amount: "1" })).toMatchObject({ status: 400 });
		expect(await consume("missing", { amount: "1" })).toMatchObject({ status: 404 });
		await fire(holiday.id, "pause");
		await refused(holiday.id, { amount: "10", accountId: account.id }, "not_active");
		expect(await outflows(holiday.id)).toMatchObject({ body: { data: [] } });

		const orphanAccount = await savings("500");
		const orphan = await create("Orphan", [{ accountId: orphanAccount.id }]);
		expect(await send("DELETE", `/api/accounts/${orphanAccount.id}`)).toMatchObject({
			status: 200,
		});
		await refused(orphan.id, { amount: "10" }, "no_linked_account");
	});

	it("keeps spending when restored from a direct archive and when the source debit is deleted", async () => {
		const account = await savings("1 000");
		const links = [{ accountId: account.id, allocatedAmount: "400" }];
		const holiday = await create("Holiday", links);
		const entryId = await postOwn(account.id, {
			date: "2026-09-20",
			amount: "-120",
			label: "Train",
		});

		expect(await consume(holiday.id, { entryId })).toMatchObject({ status: 200 });
		expect(await send("DELETE", `/api/transactions/${entryId}`)).toMatchObject({ status: 200 });
		expect(await fire(holiday.id, "archive")).toMatchObject({ consumedAmount: 12_000 });
		expect(await fire(holiday.id, "restore")).toMatchObject({
			consumedAmount: 12_000,
			progressAmount: 40_000,
		});
		expect(
			await send(
				"PUT",
				`/api/goals/${holiday.id}`,
				body("Holiday", links, { targetAmount: "100" }),
			),
		).toMatchObject({
			status: 400,
			body: { error: { fields: [{ path: "targetAmount", code: "below_consumed" }] } },
		});
		expect(
			await send("PUT", `/api/goals/${holiday.id}`, body("Holiday", links, { kind: "maintained" })),
		).toMatchObject({
			status: 400,
			body: { error: { fields: [{ path: "kind", code: "kind_locked_once_consumed" }] } },
		});
	});

	it("counts spending on a whole balance through completion and starts a new lifecycle on reopening", async () => {
		const account = await savings("1 000");
		const holiday = await create("Holiday", [{ accountId: account.id }]);

		expect(await consume(holiday.id, { amount: "200" })).toMatchObject({
			status: 200,
			body: {
				data: {
					saved: 80_000,
					consumedAmount: 20_000,
					progressAmount: 100_000,
					remaining: 0,
					percent: 100,
					accounts: [{ allocatedAmount: 80_000 }],
				},
			},
		});
		expect(await fire(holiday.id, "complete")).toMatchObject({
			saved: 80_000,
			progressAmount: 100_000,
		});
		expect(await fire(holiday.id, "archive")).toMatchObject({ progressAmount: 100_000 });
		expect(await fire(holiday.id, "restore")).toMatchObject({
			progressAmount: 80_000,
			consumedAmount: 0,
		});
	});

	it("claims a debit from a deactivated funding account while retaining pace and scaled history", async () => {
		const account = await savings("500", { openingDate: "2026-06-23" });
		await postOwn(account.id, { date: "2026-09-10", amount: "300", label: "Deposit" });
		const entryId = await postOwn(account.id, {
			date: "2026-09-20",
			amount: "-100",
			label: "Train",
		});
		const holiday = await create("Holiday", [{ accountId: account.id, allocatedAmount: "500" }]);
		await sendOwn("PATCH", `/api/accounts/${account.id}`, { active: false });
		expect(await outflows(holiday.id)).toMatchObject({ body: { data: [{ id: entryId }] } });

		expect(await consume(holiday.id, { entryId })).toMatchObject({
			status: 200,
			body: { data: { pace: holiday.pace, saved: 40_000, progressAmount: 50_000 } },
		});
		const { points } = await historyOf(holiday.id);
		expect(points.at(0)).toEqual({ date: "2026-06-23", saved: 28_571 });
		expect(points.at(-1)).toEqual({ date: "2026-09-21", saved: 40_000 });
	});

	it("claims one booked outflow only once across concurrent and repeated requests", async () => {
		const account = await savings("2 000");
		const link = { accountId: account.id, allocatedAmount: "500" };
		const first = await create("Holiday", [link]);
		const second = await create("Weekend", [link]);
		const debit = await postOwn(account.id, { date: "2026-09-20", amount: "-100", label: "Train" });

		expect(await outflows(first.id)).toMatchObject({
			status: 200,
			body: { data: [{ id: debit }] },
		});
		const responses = await Promise.all([
			consume(first.id, { entryId: debit }),
			consume(second.id, { entryId: debit }),
		]);
		expect(responses.map(({ status }) => status).toSorted((left, right) => left - right)).toEqual([
			200, 409,
		]);
		const winner = responses[0]?.status === 200 ? first : second;
		const loser = winner.id === first.id ? second : first;
		expect(await consume(winner.id, { entryId: debit })).toMatchObject({
			status: 409,
			body: { error: { params: { reason: "transaction_already_claimed" } } },
		});
		expect(await send("GET", `/api/goals/${winner.id}`)).toMatchObject({
			body: { data: { consumedAmount: 10_000, accounts: [{ allocatedAmount: 40_000 }] } },
		});
		expect(await send("GET", `/api/goals/${loser.id}`)).toMatchObject({
			body: { data: { consumedAmount: 0, accounts: [{ allocatedAmount: 50_000 }] } },
		});
		expect(await outflows(loser.id)).toMatchObject({ status: 200, body: { data: [] } });
		await fire(winner.id, "complete");
		expect(await fire(winner.id, "reopen")).toMatchObject({ consumedAmount: 0 });
		await refused(winner.id, { entryId: debit }, "transaction_already_claimed");
	});
});
