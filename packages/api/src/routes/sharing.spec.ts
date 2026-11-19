import type { TestApp } from "../testing/auth.ts";

import { eq } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import { z } from "zod";

import { users } from "@archant/data/schema/auth";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { buildApp, expense, temp, useSignedInApp, valid } from "../testing/app.ts";
import { addTestUser, buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

let member: TestApp;
let guest: TestApp;
let memberId: string;
let guestId: string;

beforeAll(async () => {
	const auth = createTestAuth(temp.db);
	const app = buildTestApp(temp.db, undefined, auth);
	member = withSession(
		buildTestApp(temp.db, undefined, auth),
		await addTestUser(app, auth, "member"),
	);
	guest = withSession(buildTestApp(temp.db, undefined, auth), await addTestUser(app, auth));
	const list = await temp.db.select().from(users);
	memberId = list.find((row) => row.role === "member")!.id;
	guestId = list.find((row) => row.role === "guest")!.id;
});

function send(app: TestApp, method: string, path: string, body?: unknown) {
	return app.request(path, {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

async function expectStatus(response: Response | Promise<Response>, status: number) {
	const result = await response;
	expect(result.status, await result.clone().text()).toBe(status);
	return result;
}

async function create(app: TestApp, path: string, input: unknown) {
	const result = await expectStatus(send(app, "POST", path, input), 201);
	return z.object({ data: z.object({ id: z.string() }) }).parse(await result.json()).data.id;
}

it("isolates private accounts and applies account permissions to direct, aggregate and bulk requests", async () => {
	const admin = buildApp();
	const preference = "/api/preferences";
	await expectStatus(send(admin, "PATCH", preference, { defaultAccountSharing: "private" }), 200);
	const accountId = await create(admin, "/api/accounts", { ...valid, name: "Private account" });
	const account = `/api/accounts/${accountId}`;
	const entryId = await create(admin, `${account}/transactions`, {
		...expense,
		label: "Private ledger row",
	});
	const entry = `/api/transactions/${entryId}`;
	const category = await create(admin, "/api/categories", {
		name: "Private category in report",
		icon: "tag",
		parentId: null,
	});
	await expectStatus(send(admin, "PATCH", entry, { categoryId: category }), 200);
	const ruleId = await create(admin, "/api/rules", {
		name: "Rule for the private account",
		conditions: [{ conditionType: "transaction_account", operator: "=", value: accountId }],
		actions: [{ actionType: "set_transaction_name", value: "Name from rule" }],
	});
	const rule = `/api/rules/${ruleId}`;
	const share = (userId: string, permission: string | null) =>
		send(admin, "PUT", `${account}/sharing`, { userId, permission });

	await expectStatus(member.request(account), 404);
	await expectStatus(member.request(`${account}/balances`), 404);
	await expectStatus(member.request(`${entry}/attachments`), 404);
	await expectStatus(member.request(`${entry}/transfer-candidates`), 404);
	expect(await (await member.request("/api/rules")).text()).not.toContain(ruleId);
	await expectStatus(member.request(`${rule}/preview`), 404);
	await expectStatus(send(member, "POST", `${rule}/apply`), 404);
	await expectStatus(send(member, "DELETE", rule), 404);
	await expectStatus(send(member, "PATCH", entry, { notes: "Refused" }), 404);
	await expectStatus(send(member, "DELETE", `/api/categories/${category}`), 403);
	const list = await member.request("/api/transactions?q=Private");
	expect(await list.text()).not.toContain("Private ledger row");
	const totals = await member.request("/api/transactions/totals?q=Private");
	await expect(totals.json()).resolves.toMatchObject({ data: { total: 0 } });
	const report = await member.request("/api/reports/net-worth");
	await expect(report.json()).resolves.toMatchObject({ data: { netWorth: 0 } });
	await expectStatus(member.request("/api/export"), 403);
	const exportPath = "/api/reports/export?periodType=monthly&startDate=2026-09-01";
	const privateReport = await expectStatus(member.request(exportPath), 200);
	expect(await privateReport.text()).not.toContain("Private category in report");

	await expectStatus(share(memberId, "read_only"), 200);
	await expectStatus(member.request(`${account}/balances`), 200);
	await expectStatus(member.request(`${rule}/preview`), 200);
	const visibleReport = await expectStatus(member.request(exportPath), 200);
	expect(await visibleReport.text()).toContain("Private category in report");
	await expectStatus(send(member, "PATCH", entry, { notes: "Read only" }), 403);
	await expectStatus(share(memberId, "read_write"), 200);
	await expectStatus(send(member, "PATCH", entry, { notes: "Annotation" }), 200);
	await expectStatus(
		send(member, "POST", "/api/transactions/bulk-update", {
			ids: [entryId],
			patch: { notes: "Annotations" },
		}),
		200,
	);
	await expectStatus(
		send(member, "POST", "/api/transactions/bulk-delete", { ids: [entryId] }),
		400,
	);
	await expectStatus(send(member, "PATCH", entry, { amount: "-10" }), 403);
	await expectStatus(send(member, "POST", `${account}/transactions`, expense), 403);
	await expectStatus(
		send(member, "PUT", `${account}/sharing`, { userId: guestId, permission: "read_only" }),
		403,
	);

	await expectStatus(share(memberId, "full_control"), 200);
	await expectStatus(send(member, "PATCH", entry, { amount: "-10" }), 200);
	await expectStatus(
		send(member, "PATCH", `${account}/finance-inclusion`, { includeInFinances: false }),
		200,
	);
	const excluded = await member.request("/api/reports/net-worth");
	await expect(excluded.json()).resolves.toMatchObject({ data: { netWorth: 0 } });
	const excludedReport = await expectStatus(member.request(exportPath), 200);
	expect(await excludedReport.text()).not.toContain("Private category in report");
	const readable = await member.request("/api/transactions/totals?q=Private");
	await expect(readable.json()).resolves.toMatchObject({ data: { total: 1 } });
	await expectStatus(share(guestId, "full_control"), 200);
	await expectStatus(guest.request(account), 200);
	await expectStatus(send(guest, "PATCH", entry, { notes: "Guest" }), 403);
	await expectStatus(share(memberId, null), 200);
	await expectStatus(member.request(account), 404);
	await expectStatus(send(admin, "DELETE", account), 200);
});

it("keeps personal actuals and plans tied to the owner across budget share permissions", async () => {
	const admin = buildApp();
	await expectStatus(
		send(admin, "PATCH", "/api/preferences", {
			personalBudgets: true,
			defaultAccountSharing: "shared",
		}),
		200,
	);
	const own = await create(admin, "/api/accounts", { ...valid, name: "Owner" });
	const other = await create(member, "/api/accounts", { ...valid, name: "Member" });
	await create(admin, `/api/accounts/${own}/transactions`, { ...expense, amount: "-10" });
	await create(member, `/api/accounts/${other}/transactions`, { ...expense, amount: "-20" });
	const { id: ownerId } = (await temp.db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.role, "admin"))
		.get())!;
	const budget = "/api/budgets/2026-09";
	const sharedPlan = `${budget}?owner=shared`;
	const ownerPlan = `${budget}?owner=${ownerId}`;
	const save = (app: TestApp, path: string, budgetedSpending: string) =>
		send(app, "PUT", path, { budgetedSpending, expectedIncome: "0" });
	const grant = (permission: string | null) =>
		send(admin, "PUT", "/api/budgets/sharing", { userId: memberId, permission });

	await expectStatus(save(admin, budget, "100"), 200);
	await expectStatus(save(member, budget, "200"), 200);
	await expectStatus(save(admin, sharedPlan, "300"), 200);
	const envelope = await create(admin, "/api/categories", {
		name: "Envelope used only in a personal plan",
		icon: "tag",
		parentId: null,
	});
	await expectStatus(
		send(admin, "PUT", `${budget}/categories/${envelope}`, { budgetedSpending: "25" }),
		200,
	);
	await expectStatus(member.request(ownerPlan), 404);
	await expectStatus(send(member, "DELETE", `/api/categories/${envelope}`), 403);
	const personal = await member.request(budget);
	await expect(personal.json()).resolves.toMatchObject({
		data: { ownerId: memberId, budgetedSpending: 20_000, actual: { spending: 2_000 } },
	});
	await expectStatus(grant("read_only"), 200);
	await expectStatus(send(member, "DELETE", `/api/categories/${envelope}`), 403);
	const grantAccount = (permission: string | null) =>
		send(admin, "PUT", `/api/accounts/${own}/sharing`, { userId: memberId, permission });
	await expectStatus(grantAccount(null), 200);
	const readonly = await member.request(ownerPlan);
	await expect(readonly.json()).resolves.toMatchObject({
		data: {
			ownerId,
			canWrite: false,
			canReadTransactions: false,
			budgetedSpending: 10_000,
			actual: { spending: 1_000 },
		},
	});
	const transactions = (id: string) =>
		member.request(`/api/transactions/totals?budgetOwner=${id}&from=2026-09-01&to=2026-09-30`);
	await expect((await transactions(ownerId)).json()).resolves.toMatchObject({ data: { total: 0 } });
	await expectStatus(grantAccount("read_only"), 200);
	await expect((await transactions(ownerId)).json()).resolves.toMatchObject({ data: { total: 1 } });
	await expectStatus(save(member, ownerPlan, "400"), 403);
	await expectStatus(grant("read_write"), 200);
	await expectStatus(save(member, ownerPlan, "400"), 200);
	await expectStatus(send(member, "DELETE", `/api/categories/${envelope}`), 200);
	const editable = await admin.request(budget);
	await expect(editable.json()).resolves.toMatchObject({
		data: { ownerId, budgetedSpending: 40_000, actual: { spending: 1_000 } },
	});
	const shared = await member.request(sharedPlan);
	await expect(shared.json()).resolves.toMatchObject({
		data: { ownerId: null, budgetedSpending: 30_000, actual: { spending: 3_000 } },
	});
	await expectStatus(grant(null), 200);
	await expectStatus(member.request(ownerPlan), 404);
});

it("detects recurring payments on editable accounts without changing other accounts", async () => {
	const admin = buildApp();
	await expectStatus(
		send(admin, "PATCH", "/api/preferences", { defaultAccountSharing: "private" }),
		200,
	);
	const openingDate = "2026-07-01";
	const own = await create(member, "/api/accounts", { ...valid, name: "Editable", openingDate });
	const hidden = await create(admin, "/api/accounts", { ...valid, name: "Hidden", openingDate });
	const accounts = [
		[member, own],
		[admin, hidden],
	] as const;
	const dates = ["2026-07-05", "2026-08-05", "2026-09-05"];
	await accounts
		.flatMap(([app, id]) => dates.map((date) => ({ app, id, date })))
		.reduce(
			(previous, { app, id, date }) =>
				previous.then(() =>
					create(app, `/api/accounts/${id}/transactions`, {
						...expense,
						date,
						label: "Membership",
					}),
				),
			Promise.resolve(""),
		);
	const detection = await expectStatus(send(member, "POST", "/api/recurring/detect"), 200);
	await expect(detection.json()).resolves.toEqual({ data: { detected: 1 } });
	const stored = await temp.db
		.select({ accountId: recurringTransactions.accountId })
		.from(recurringTransactions)
		.where(eq(recurringTransactions.label, "Membership"));
	expect(stored).toEqual([{ accountId: own }]);
	await expectStatus(send(member, "POST", "/api/recurring/cleanup"), 200);
});

it("applies immediate rules only where their author and the writer can edit", async () => {
	const admin = buildApp();
	const accountId = await create(member, "/api/accounts", { ...valid, name: "Member's account" });
	const account = `/api/accounts/${accountId}`;
	const categoryId = await create(admin, "/api/categories", {
		name: "Immediate classification",
		icon: "tag",
		parentId: null,
	});
	const tagId = await create(member, "/api/tags", { name: "Immediate prefix", color: "#6b7280" });
	const conditions = [
		{ conditionType: "transaction_name", operator: "like", value: "Immediate scope" },
	];
	await create(member, "/api/rules", {
		enabled: true,
		conditions,
		actions: [{ actionType: "set_transaction_tags", value: tagId }],
	});
	await create(admin, "/api/rules", {
		enabled: true,
		applyImmediately: true,
		conditions,
		actions: [{ actionType: "set_transaction_category", value: categoryId }],
	});
	const post = (label: string) =>
		expectStatus(send(member, "POST", `${account}/transactions`, { ...expense, label }), 201);
	await expect((await post("Immediate scope before share")).json()).resolves.toMatchObject({
		data: { categoryId: null, tagIds: [] },
	});
	const ownerId = (await temp.db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.role, "admin"))
		.get())!.id;
	await expectStatus(
		send(member, "PUT", `${account}/sharing`, { userId: ownerId, permission: "full_control" }),
		200,
	);
	await expect((await post("Immediate scope after share")).json()).resolves.toMatchObject({
		data: { categoryId, tagIds: [tagId] },
	});
});
