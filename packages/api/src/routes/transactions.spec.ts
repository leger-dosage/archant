import type { NormalizedTransaction } from "../domain/statement.ts";
import type { Auth } from "../services/auth.ts";

import { sql } from "drizzle-orm";
import { testClient } from "hono/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { toMinorUnits } from "@archant/data/money";
import { bankConnections } from "@archant/data/schema/bank-connections";

import { createLogger } from "../lib/logger.ts";
import { ingest } from "../services/ledger/ingest.ts";
import {
	balanceOf,
	buildApp,
	categorise,
	category,
	createCategory,
	createMerchant,
	createTag,
	errorBody,
	expense,
	importBody,
	linkMerchant,
	listBody,
	listItem,
	listOwn,
	listed,
	mortgage,
	openAccount,
	pea,
	openOwn,
	own,
	ownCategory,
	ownDatabase,
	ownRequest,
	postOwn,
	postTransaction,
	request,
	tagAll,
	tagList,
	temp,
	template,
	totalsBody,
	totalsOwn,
	uniqueCategory,
	useSignedInApp,
} from "../testing/app.ts";
import { addViewer, buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

/** The list's rows of one account, as the interface reads them. */
const listedOf = async (accountId: string) =>
	listBody.parse((await request("GET", `/api/transactions?account=${accountId}`)).body).data.items;

/** A PEA's dividend, labelled by the activity label tests. */
const dividend = { date: "2026-09-10", label: "Dividende", amount: "12,00" };

/** The locked fields, in the order they were first locked. */
const locksOf = async (id: string) => {
	const row = await temp.db.get<{ locked: string }>(
		sql`select (select json_group_array(key) from json_each(locked_fields)) as locked from transactions where entry_id = ${id}`,
	);

	return row === undefined ? undefined : z.array(z.string()).parse(JSON.parse(row.locked));
};

describe("PATCH /api/transactions/:id", () => {
	it("moves and changes a transaction, and the balance follows", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const response = await testClient(buildApp()).api.transactions[":id"].$patch({
			param: { id: data.id },
			json: { date: "2026-09-05", amount: "-50,00" },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({
			date: "2026-09-05",
			amount: -5000,
			label: "Boulangerie",
		});
		await expect(balanceOf(account.id)).resolves.toBe(118456);
	});

	it("clears notes sent blank", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, { ...expense, notes: "Pain" });
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const { body } = await request("PATCH", `/api/transactions/${data.id}`, { notes: " " });

		expect(body).toMatchObject({ data: { notes: null } });
	});

	it("takes a move onto the opening date or before it, and refuses one before 1900", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		await expect(
			request("PATCH", `/api/transactions/${data.id}`, { date: "2026-09-01" }),
		).resolves.toMatchObject({ status: 200, body: { data: { date: "2026-09-01" } } });
		await expect(
			request("PATCH", `/api/transactions/${data.id}`, { date: "2026-08-20" }),
		).resolves.toMatchObject({ status: 200, body: { data: { date: "2026-08-20" } } });

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			date: "0026-08-20",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "date", code: "date_too_early" }]);
	});

	it("refuses an invalid amount", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			amount: "abc",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "amount", code: "invalid_amount" },
		]);
	});

	it("excludes a transaction from reports and leaves the balance alone", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const response = await testClient(buildApp()).api.transactions[":id"].$patch({
			param: { id: data.id },
			json: { excluded: true },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({ excluded: true, amount: -4290 });
		await expect(balanceOf(account.id)).resolves.toBe(123456 - 4290);
	});

	it("marks a transaction one-time, Sure's `one_time` kind, and the list reads it back", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			oneTime: true,
		});

		expect(status).toBe(200);
		expect(body).toMatchObject({ data: { oneTime: true, excluded: false, amount: -4290 } });
		await expect(listedOf(account.id)).resolves.toMatchObject([{ id: data.id, oneTime: true }]);
		// No new lock: no sync, import or rule writes it. Those three come from the creation.
		await expect(locksOf(data.id)).resolves.toEqual(["date", "amount", "label"]);
		await expect(balanceOf(account.id)).resolves.toBe(123456 - 4290);
	});

	it("refuses an exclusion that is not a boolean", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			excluded: "yes",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields?.[0]?.path).toBe("excluded");
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		const { status } = await request("PATCH", "/api/transactions/nope", { label: "x" });

		expect(status).toBe(404);
	});

	it("sets and clears a category, leaving the balance alone", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		const groceries = await createCategory(uniqueCategory("Courses"));
		const client = testClient(buildApp()).api.transactions[":id"];

		const set = await client.$patch({ param: { id: data.id }, json: { categoryId: groceries.id } });

		expect(set.status).toBe(200);
		expect((await set.json()).data).toMatchObject({ categoryId: groceries.id, amount: -4290 });
		await expect(balanceOf(account.id)).resolves.toBe(123456 - 4290);

		const cleared = await client.$patch({ param: { id: data.id }, json: { categoryId: null } });

		expect((await cleared.json()).data).toMatchObject({ categoryId: null });
	});

	it("locks a category set by hand, and leaves an unchanged one unlocked", async () => {
		const account = await openAccount();
		const set = z
			.object({ data: z.object({ id: z.string() }) })
			.parse((await postTransaction(account.id, expense)).body).data.id;
		const unchanged = z
			.object({ data: z.object({ id: z.string() }) })
			.parse((await postTransaction(account.id, expense)).body).data.id;
		const groceries = await createCategory(uniqueCategory("Courses"));
		await request("PATCH", `/api/transactions/${set}`, { categoryId: groceries.id });
		// The sheet sends the category it shows, whatever else it saves.
		await request("PATCH", `/api/transactions/${unchanged}`, {
			categoryId: null,
			label: "Autre",
		});

		// A transaction typed by hand starts with its date, amount and label locked.
		await expect(locksOf(set)).resolves.toEqual(["date", "amount", "label", "category"]);
		await expect(locksOf(unchanged)).resolves.toEqual(["date", "amount", "label"]);
	});

	it("refuses an unknown category and writes nothing", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			categoryId: "x",
			label: "Autre",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "categoryId", code: "invalid_value" }],
		});
		// An empty patch answers the transaction as it stands.
		const after = await request("PATCH", `/api/transactions/${data.id}`, {});
		expect(after.body).toMatchObject({ data: { label: "Boulangerie", categoryId: null } });
	});

	it.each([
		["investment_contribution", pea, 400],
		["internal_move", { name: "Livret A", subtype: "savings", openingBalance: "0" }, 200],
	] as const)("answers a category on a %s's inflow with %s", async (kind, into, status) => {
		const checking = await openOwn({ name: "Compte courant" });
		const other = await openOwn(into);
		await postOwn(checking.id, { date: "2026-09-12", label: "VERSEMENT", amount: "-500,00" });
		const inflow = await postOwn(other.id, {
			date: "2026-09-12",
			label: "RECU",
			amount: "500,00",
		});
		const { items } = await listed("");
		expect(items.find((item) => item.id === inflow)?.transfer?.kind).toBe(kind);
		const savings = await ownCategory("Épargne");

		const response = await ownRequest("PATCH", `/api/transactions/${inflow}`, {
			categoryId: savings,
		});

		expect(response.status).toBe(status);
		if (status === 400) {
			expect(errorBody.parse(response.body).error).toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path: "categoryId", code: "set_on_outflow" }],
			});
		}
	});

	it("refuses a category on a loan payment's inflow, which shows its outflow's, and sets it on the outflow", async () => {
		const checking = await openOwn({ name: "Compte courant" });
		const loan = await openOwn(mortgage);
		const payment = await postOwn(checking.id, {
			date: "2026-09-12",
			label: "ECHEANCE PRET",
			amount: "-1 200,00",
		});
		const repaid = await postOwn(loan.id, {
			date: "2026-09-12",
			label: "ECHEANCE",
			amount: "1 200,00",
		});
		const housing = await ownCategory("Prêt immo");

		const onOutflow = await ownRequest("PATCH", `/api/transactions/${payment}`, {
			categoryId: housing,
		});
		const onInflow = await ownRequest("PATCH", `/api/transactions/${repaid}`, {
			categoryId: housing,
			label: "Autre",
		});

		expect(onOutflow.status).toBe(200);
		expect(onInflow.status).toBe(400);
		expect(errorBody.parse(onInflow.body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "categoryId", code: "set_on_outflow" }],
		});
		// Refused whole: the label sent beside it is not saved either.
		await expect(
			ownRequest("PATCH", `/api/transactions/${repaid}`, { label: "Échéance" }),
		).resolves.toMatchObject({
			status: 200,
			body: { data: { label: "Échéance", categoryId: null } },
		});

		const { items } = await listed("");
		expect(items.find((item) => item.id === repaid)?.transfer).toMatchObject({
			kind: "loan_payment",
			counterpartCategoryId: housing,
		});
		expect(items.find((item) => item.id === payment)?.transfer).toMatchObject({
			counterpartCategoryId: null,
		});
	});

	it("sets and clears a merchant, locking it and leaving the balance alone", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		const carrefour = await createMerchant(uniqueCategory("Carrefour"));
		const client = testClient(buildApp()).api.transactions[":id"];

		const set = await client.$patch({ param: { id: data.id }, json: { merchantId: carrefour.id } });

		expect(set.status).toBe(200);
		expect((await set.json()).data).toMatchObject({ merchantId: carrefour.id, amount: -4290 });
		await expect(balanceOf(account.id)).resolves.toBe(123456 - 4290);

		const cleared = await client.$patch({ param: { id: data.id }, json: { merchantId: null } });

		expect((await cleared.json()).data).toMatchObject({ merchantId: null });
		await expect(
			temp.db.get(
				sql`select (select json_group_array(key) from json_each(locked_fields)) as locked from transactions where entry_id = ${data.id}`,
			),
		).resolves.toEqual({ locked: '["date","amount","label","merchant"]' });
	});

	it("refuses an unknown merchant and writes nothing", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			merchantId: "x",
			label: "Autre",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "merchantId", code: "invalid_value" }],
		});
		const after = await request("PATCH", `/api/transactions/${data.id}`, {});
		expect(after.body).toMatchObject({ data: { label: "Boulangerie", merchantId: null } });
	});

	it("sets, replaces and clears tags, locking them and leaving the balance alone", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		const holidays = await createTag(uniqueCategory("Vacances"));
		const work = await createTag(uniqueCategory("Travaux"));
		const client = testClient(buildApp()).api.transactions[":id"];

		const set = await client.$patch({
			param: { id: data.id },
			json: { tagIds: [holidays.id, work.id, holidays.id] },
		});

		expect(set.status).toBe(200);
		const setData = (await set.json()).data;
		expect(setData).toMatchObject({ amount: -4290 });
		expect(setData.tagIds.toSorted()).toEqual([holidays.id, work.id].toSorted());
		await expect(balanceOf(account.id)).resolves.toBe(123456 - 4290);

		const replaced = await client.$patch({ param: { id: data.id }, json: { tagIds: [work.id] } });

		expect((await replaced.json()).data).toMatchObject({ tagIds: [work.id] });

		const cleared = await client.$patch({ param: { id: data.id }, json: { tagIds: [] } });

		expect((await cleared.json()).data).toMatchObject({ tagIds: [] });
		await expect(
			temp.db.get(
				sql`select (select json_group_array(key) from json_each(locked_fields)) as locked from transactions where entry_id = ${data.id}`,
			),
		).resolves.toEqual({ locked: '["date","amount","label","tags"]' });
	});

	it("refuses an unknown tag and writes nothing", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		const holidays = await createTag(uniqueCategory("Vacances"));

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			tagIds: [holidays.id, "x"],
			label: "Autre",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "tagIds", code: "invalid_value" }],
		});
		const after = await request("PATCH", `/api/transactions/${data.id}`, {});
		expect(after.body).toMatchObject({ data: { label: "Boulangerie", tagIds: [] } });
	});

	it("refuses more tags than the cap and writes nothing", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			tagIds: Array.from({ length: 21 }, (_, index) => `t${index}`),
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields?.[0]?.path).toBe("tagIds");
		const after = await request("PATCH", `/api/transactions/${data.id}`, {});
		expect(after.body).toMatchObject({ data: { tagIds: [] } });
	});
});

/** The labels the list holds for `query`, in label order. */
const labels = async (query: string) =>
	(await listed(query)).items.map((item) => item.label).toSorted();

describe("GET /api/transactions", () => {
	it("lists every account's transactions, most recent first, with the account's name", async () => {
		const checking = await openOwn();
		const card = await openOwn({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: "0",
		});
		await [checking, card, checking, card, checking, card].reduce(
			async (previous, account, index) => {
				await previous;
				await postOwn(account.id, {
					...expense,
					date: `2026-09-${String(index + 2).padStart(2, "0")}`,
					label: `L${index}`,
				});
			},
			Promise.resolve(),
		);

		const data = await listed("");

		expect(data.items.map((item) => item.label)).toEqual(["L5", "L4", "L3", "L2", "L1", "L0"]);
		expect(data).toMatchObject({ page: 1, pageSize: 50, total: 6 });
		expect(data.items[0]).toMatchObject({
			accountName: "Carte",
			accountType: "credit_card",
			excluded: false,
			recurring: false,
		});
		expect(data.items[1]).toMatchObject({ accountName: "Compte joint", accountType: "depository" });
	});

	it("combines account, start date and text in the label or the notes", async () => {
		const checking = await openOwn();
		const card = await openOwn({ name: "Carte", type: "credit_card", subtype: null });
		await postOwn(checking.id, { ...expense, date: "2026-09-02", label: "Carrefour" });
		await postOwn(checking.id, { ...expense, date: "2026-09-03", label: "CB CARREFOUR" });
		await postOwn(checking.id, {
			...expense,
			date: "2026-09-04",
			label: "Épicerie",
			notes: "Carrefour",
		});
		await postOwn(checking.id, { ...expense, date: "2026-09-05", label: "Boulangerie" });
		await postOwn(card.id, { ...expense, date: "2026-09-05", label: "Carrefour" });

		const data = await listed(`?account=${checking.id}&from=2026-09-03&q=carre`);

		expect(data.items.map((item) => item.label)).toEqual(["Épicerie", "CB CARREFOUR"]);
		expect(data.total).toBe(2);
	});

	it("takes several accounts", async () => {
		const checking = await openOwn();
		const savings = await openOwn({ name: "Livret", subtype: "savings" });
		const other = await openOwn({ name: "Autre" });
		await postOwn(checking.id, { ...expense, label: "A" });
		await postOwn(savings.id, { ...expense, label: "B" });
		await postOwn(other.id, { ...expense, label: "C" });

		const data = await listed(`?account=${checking.id}&account=${savings.id}`);

		expect(data.items.map((item) => item.label).toSorted()).toEqual(["A", "B"]);
	});

	it("filters on the status, both or none being no filter, the totals following", async () => {
		const account = await openOwn();
		await syncOwn(account.id, [
			bankLine(-320, { label: "En attente", pending: true }),
			bankLine(-4290, { label: "Comptabilisée" }),
		]);
		await postOwn(account.id, { ...expense, label: "Saisie", amount: "-10,00" });

		const pending = await listed("?status=pending");
		const confirmed = await listed("?status=confirmed");

		expect(pending.items.map((item) => item.label)).toEqual(["En attente"]);
		expect(pending).toMatchObject({ total: 1, sum: { amount: -320, expense: -320 } });
		expect(confirmed.items.map((item) => item.label).toSorted()).toEqual([
			"Comptabilisée",
			"Saisie",
		]);
		expect(confirmed).toMatchObject({ total: 2, sum: { amount: -5290 } });
		await expect(listed("?status=confirmed&status=pending")).resolves.toMatchObject({
			total: 3,
			sum: { amount: -5610 },
		});
		await expect(listed("")).resolves.toMatchObject({ total: 3 });
	});

	it("compares one amount with the absolute value, `equal` within a cent", async () => {
		const account = await openOwn();
		await postOwn(account.id, { ...expense, label: "A", amount: "-42,90" });
		await postOwn(account.id, { ...expense, label: "B", amount: "42,91" });
		await postOwn(account.id, { ...expense, label: "C", amount: "42,92" });
		await postOwn(account.id, { ...expense, label: "D", amount: "-42,88" });

		await expect(labels("?amount=42,90&amountOperator=equal")).resolves.toEqual(["A", "B"]);
		await expect(labels("?amount=42.9&amountOperator=equal")).resolves.toEqual(["A", "B"]);
		await expect(labels("?amount=-42,90&amountOperator=equal")).resolves.toEqual(["A", "B"]);
		await expect(labels("?amount=42,89&amountOperator=equal")).resolves.toEqual(["A", "D"]);
		await expect(labels("?amount=42,90")).resolves.toEqual(["A", "B", "C", "D"]);
		await expect(labels("?amount=42,90&amountOperator=greater")).resolves.toEqual(["B", "C"]);
		await expect(labels("?amount=42,91&amountOperator=less")).resolves.toEqual(["A", "D"]);
		await expect(labels("?amount=42,899&amountOperator=greater")).resolves.toEqual(["A", "B", "C"]);
		await expect(labels("?amount=0&amountOperator=less")).resolves.toEqual([]);
		await expect(labels("?amountOperator=greater")).resolves.toEqual(["A", "B", "C", "D"]);
		await expect(listed("?amount=42,90&amountOperator=greater")).resolves.toMatchObject({
			total: 2,
			sum: { amount: 8583, income: 8583, expense: 0 },
		});
	});

	it("matches a % in the text literally", async () => {
		const account = await openOwn();
		await postOwn(account.id, { ...expense, label: "Remise 50%" });
		await postOwn(account.id, { ...expense, label: "Remise 500" });

		const data = await listed(`?q=${encodeURIComponent("50%")}`);

		expect(data.items.map((item) => item.label)).toEqual(["Remise 50%"]);
	});

	it("totals the reporting currency, excluded rows included, and counts the others", async () => {
		const account = await openOwn();
		const dollars = await openOwn({ name: "Dollars", currency: "USD", openingBalance: "0" });
		const excluded = await postOwn(account.id, { ...expense, amount: "-42,90" });
		await buildApp(own?.db).request(`/api/transactions/${excluded}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ excluded: true }),
		});
		await postOwn(account.id, { ...expense, amount: "100,00" });
		await postOwn(dollars.id, { ...expense, amount: "-10.00" });

		const data = await listed("");

		expect(data.sum).toEqual({
			amount: 5710,
			income: 10000,
			expense: -4290,
			currency: "EUR",
			skippedCount: 1,
		});
		expect(data.total).toBe(3);
		expect(data.items.find((item) => item.id === excluded)?.excluded).toBe(true);
		await expect(listed("?direction=expense")).resolves.toMatchObject({
			sum: { amount: -4290, income: 0, expense: -4290, skippedCount: 1 },
		});
	});

	it("filters on a parent category, its children included", async () => {
		const account = await openOwn();
		const client = testClient(buildApp(own?.db)).api;
		const parent = await (await client.categories.$post({ json: category("Logement") })).json();
		const child = await (
			await client.categories.$post({ json: category("Loyer", { parentId: parent.data.id }) })
		).json();
		const other = await (await client.categories.$post({ json: category("Loisirs") })).json();
		const onParent = await postOwn(account.id, { ...expense, label: "Travaux" });
		const onChild = await postOwn(account.id, { ...expense, label: "Loyer" });
		const onOther = await postOwn(account.id, { ...expense, label: "Cinéma" });
		await postOwn(account.id, { ...expense, label: "Virement" });
		await [
			[onParent, parent.data.id],
			[onChild, child.data.id],
			[onOther, other.data.id],
		].reduce(async (previous, [id = "", categoryId = ""]) => {
			await previous;
			await client.transactions[":id"].$patch({ param: { id }, json: { categoryId } });
		}, Promise.resolve());

		const data = await listed(`?category=${parent.data.id}`);

		expect(data.items.map((item) => item.label).toSorted()).toEqual(["Loyer", "Travaux"]);
		expect(data.sum).toEqual({
			amount: -8580,
			income: 0,
			expense: -8580,
			currency: "EUR",
			skippedCount: 0,
		});
		await expect(listed(`?category=${child.data.id}`)).resolves.toMatchObject({ total: 1 });
	});

	it("filters on « Sans catégorie » and a category together, and matches nothing for an unknown one", async () => {
		const account = await openOwn();
		const client = testClient(buildApp(own?.db)).api;
		const leisure = await (await client.categories.$post({ json: category("Loisirs") })).json();
		const onLeisure = await postOwn(account.id, { ...expense, label: "Cinéma" });
		await postOwn(account.id, { ...expense, label: "Virement" });
		await client.transactions[":id"].$patch({
			param: { id: onLeisure },
			json: { categoryId: leisure.data.id },
		});

		const data = await listed(`?category=none&category=${leisure.data.id}`);
		const uncategorised = await listed("?category=none");

		expect(data.items.map((item) => item.label).toSorted()).toEqual(["Cinéma", "Virement"]);
		expect(uncategorised.items.map((item) => item.label)).toEqual(["Virement"]);
		expect(uncategorised.items[0]?.categoryId).toBeNull();
		await expect(listed("?category=nope")).resolves.toMatchObject({ items: [], total: 0 });
	});

	it("filters on merchants, ORed, with the count and the sum to match", async () => {
		const account = await openOwn();
		const client = testClient(buildApp(own?.db)).api;
		const merchantOf = async (name: string) =>
			(await (await client.merchants.$post({ json: { name } })).json()).data.id;
		const carrefour = await merchantOf("Carrefour");
		const lidl = await merchantOf("Lidl");
		const fnac = await merchantOf("Fnac");
		const rows = [
			[await postOwn(account.id, { ...expense, label: "CB CARREFOUR 1234" }), carrefour],
			[await postOwn(account.id, { ...expense, label: "LIDL" }), lidl],
			[await postOwn(account.id, { ...expense, label: "FNAC" }), fnac],
		];
		await postOwn(account.id, { ...expense, label: "Virement" });
		await rows.reduce(async (previous, [id = "", merchantId = ""]) => {
			await previous;
			await client.transactions[":id"].$patch({ param: { id }, json: { merchantId } });
		}, Promise.resolve());

		const data = await listed(`?merchant=${carrefour}&merchant=${lidl}`);

		expect(data.items.map((item) => item.label).toSorted()).toEqual(["CB CARREFOUR 1234", "LIDL"]);
		expect(new Set(data.items.map((item) => item.merchantId))).toEqual(new Set([carrefour, lidl]));
		expect(data.total).toBe(2);
		expect(data.sum).toEqual({
			amount: -8580,
			income: 0,
			expense: -8580,
			currency: "EUR",
			skippedCount: 0,
		});
		await expect(listed("?merchant=nope")).resolves.toMatchObject({ items: [], total: 0 });
	});

	it("filters on tags, ORed, listing and counting a row with both tags once", async () => {
		const account = await openOwn();
		const client = testClient(buildApp(own?.db)).api;
		const tagOf = async (name: string) =>
			(await (await client.tags.$post({ json: { name } })).json()).data.id;
		const holidays = await tagOf("Vacances");
		const work = await tagOf("Travaux");
		const other = await tagOf("Autre");
		const rows: [string, string[]][] = [
			[await postOwn(account.id, { ...expense, label: "Hôtel" }), [holidays, work]],
			[await postOwn(account.id, { ...expense, label: "Train" }), [holidays]],
			[await postOwn(account.id, { ...expense, label: "Livre" }), [other]],
		];
		await postOwn(account.id, { ...expense, label: "Virement" });
		await rows.reduce(async (previous, [id, tagIds]) => {
			await previous;
			await client.transactions[":id"].$patch({ param: { id }, json: { tagIds } });
		}, Promise.resolve());

		const data = await listed(`?tag=${holidays}&tag=${work}`);

		expect(data.items.map((item) => item.label).toSorted()).toEqual(["Hôtel", "Train"]);
		expect(data.total).toBe(2);
		expect(data.sum).toEqual({
			amount: -8580,
			income: 0,
			expense: -8580,
			currency: "EUR",
			skippedCount: 0,
		});
		await expect(listed("?tag=nope")).resolves.toMatchObject({ items: [], total: 0 });
	});

	it("refuses an empty tag, and more tags than the cap", async () => {
		await ownDatabase();
		const query = Array.from({ length: 101 }, (_, index) => `tag=t${index}`).join("&");

		const responses = await Promise.all([listOwn(`?${query}`), listOwn("?tag=")]);

		for (const { status, body } of responses) {
			expect(status).toBe(400);
			expect(errorBody.parse(body).error.fields?.[0]?.path).toMatch(/^tag/u);
		}
	});

	it("refuses an empty merchant, and more merchants than the cap", async () => {
		await ownDatabase();
		const query = Array.from({ length: 101 }, (_, index) => `merchant=m${index}`).join("&");

		const responses = await Promise.all([listOwn(`?${query}`), listOwn("?merchant=")]);

		for (const { status, body } of responses) {
			expect(status).toBe(400);
			expect(errorBody.parse(body).error.fields?.[0]?.path).toMatch(/^merchant/u);
		}
	});

	it("refuses more categories than the cap", async () => {
		await ownDatabase();
		const query = Array.from({ length: 101 }, (_, index) => `category=c${index}`).join("&");

		const { status, body } = await listOwn(`?${query}`);

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields?.[0]?.path).toBe("category");
	});

	it("answers an empty page for an unknown account", async () => {
		const account = await openOwn();
		await postOwn(account.id, expense);

		const data = await listed("?account=nope");

		expect(data).toMatchObject({ items: [], total: 0 });
		expect(data.sum).toEqual({
			amount: 0,
			income: 0,
			expense: 0,
			currency: "EUR",
			skippedCount: 0,
		});
	});

	it("pages", async () => {
		const account = await openOwn();
		await postOwn(account.id, { ...expense, date: "2026-09-03", label: "A" });
		await postOwn(account.id, { ...expense, date: "2026-09-02", label: "B" });

		const data = await listed("?page=2&pageSize=1");

		expect(data.items.map((item) => item.label)).toEqual(["B"]);
		expect(data).toMatchObject({ page: 2, pageSize: 1, total: 2 });
	});

	it.each([
		["?from=2026-09-10&to=2026-09-01", "to", "before_from"],
		["?amount=abc", "amount", "invalid_amount"],
		["?amount=5-", "amount", "invalid_amount"],
		["?amount=1234567890123456", "amount", "invalid_amount"],
		["?amount=5&amountOperator=between", "amountOperator", "invalid_value"],
		["?status=booked", "status", "invalid_union"],
		["?from=10/09/2026", "from", "invalid_format"],
	])("refuses %s, on the page and on the totals alike", async (query, path, code) => {
		await ownDatabase();

		const answers = await Promise.all([listOwn(query), totalsOwn(query)]);

		for (const { status, body } of answers) {
			expect(status).toBe(400);
			expect(errorBody.parse(body).error).toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path, code }],
			});
		}
	});

	it("adds the parents of the page's split children, whatever the filter and the page", async () => {
		const account = await openOwn();
		const client = testClient(buildApp(own?.db)).api;
		const food = await (await client.categories.$post({ json: category("Courses") })).json();
		const parent = await postOwn(account.id, { ...expense, label: "HYPER", amount: "-100,00" });
		await postOwn(account.id, { ...expense, date: "2026-09-02", label: "Seule" });
		const split = await ownRequest("POST", `/api/transactions/${parent}/split`, {
			lines: [
				{ label: "Fruits", amount: "-60,00", categoryId: food.data.id },
				{ label: "Savon", amount: "-40,00", categoryId: null },
			],
		});
		expect(split.status).toBe(201);

		const all = await listed("");
		const filtered = await listed(`?category=${food.data.id}`);
		const [first, second] = await Promise.all([
			listed("?pageSize=1"),
			listed("?page=2&pageSize=1"),
		]);
		const unsplit = await listed("?q=Seule");

		expect(all.items.map((item) => [item.label, item.parentEntryId, item.splitParent])).toEqual([
			["Savon", parent, false],
			["Fruits", parent, false],
			["Seule", null, false],
		]);
		expect(all.splitParents).toMatchObject([
			{ id: parent, label: "HYPER", amount: -10000, excluded: true, splitParent: true },
		]);
		expect(filtered.items.map((item) => item.label)).toEqual(["Fruits"]);
		expect(filtered.splitParents.map((item) => item.id)).toEqual([parent]);
		expect(filtered).toMatchObject({ total: 1, sum: { amount: -6000 } });
		expect([first.splitParents, second.splitParents].map((rows) => rows.length)).toEqual([1, 1]);
		expect(unsplit.splitParents).toEqual([]);
	});

	it("types its query for the interface's client", async () => {
		const account = await openOwn();
		await postOwn(account.id, expense);

		const response = await testClient(buildApp(own?.db)).api.transactions.$get({
			query: {
				account: [account.id],
				category: ["none"],
				status: ["confirmed"],
				amount: "1",
				amountOperator: "greater",
				q: "boul",
			},
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data.items[0]?.accountName).toBe("Compte joint");
	});
});

describe("GET /api/transactions/totals", () => {
	it("counts and sums every matching row, whatever the page", async () => {
		const account = await openOwn();
		await postOwn(account.id, { ...expense, date: "2026-09-03", amount: "-10,00" });
		await postOwn(account.id, { ...expense, date: "2026-09-02", amount: "25,00" });

		const first = await totalsOwn("?pageSize=1");
		const second = await totalsOwn("?page=2&pageSize=1");

		expect(first).toEqual(second);
		expect(totalsBody.parse(first.body).data).toEqual({
			total: 2,
			sum: { amount: 1500, income: 2500, expense: -1000, currency: "EUR", skippedCount: 0 },
		});
	});

	it("answers zero for a filter that matches nothing", async () => {
		await openOwn();

		const { body } = await totalsOwn("?merchant=nope");

		expect(totalsBody.parse(body).data).toEqual({
			total: 0,
			sum: { amount: 0, income: 0, expense: 0, currency: "EUR", skippedCount: 0 },
		});
	});

	it("types its query for the interface's client", async () => {
		const account = await openOwn();
		await postOwn(account.id, expense);

		const response = await testClient(buildApp(own?.db)).api.transactions.totals.$get({
			query: { account: [account.id], direction: ["expense"] },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data.total).toBe(1);
	});
});

describe("DELETE /api/transactions/:id", () => {
	it("deletes the transaction and puts the balance back", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const response = await testClient(buildApp()).api.transactions[":id"].$delete({
			param: { id: data.id },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ data: { id: data.id } });
		await expect(balanceOf(account.id)).resolves.toBe(123456);
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		const { status, body } = await request("DELETE", "/api/transactions/nope");

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
	});
});

async function anchorOf(accountId: string) {
	// Raw on purpose: only the ledger may import the entries table (AD-2).
	const [anchor] = await temp.db.all<{ id: string; date: string; amount: number }>(
		sql`select id, date, amount from entries where account_id = ${accountId} and valuation_kind = 'opening_anchor'`,
	);

	if (anchor === undefined) {
		throw new Error("The account has no opening anchor.");
	}

	return anchor;
}

describe("the opening anchor", () => {
	it("cannot be deleted as a transaction", async () => {
		const account = await openAccount();
		const anchor = await anchorOf(account.id);

		const { status, body } = await request("DELETE", `/api/transactions/${anchor.id}`);

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
		await expect(anchorOf(account.id)).resolves.toEqual(anchor);
		await expect(balanceOf(account.id)).resolves.toBe(123456);
	});

	it("cannot be edited as a transaction", async () => {
		const account = await openAccount();
		const anchor = await anchorOf(account.id);

		const { status, body } = await request("PATCH", `/api/transactions/${anchor.id}`, {
			amount: "0",
			date: "2026-09-10",
		});

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
		await expect(anchorOf(account.id)).resolves.toEqual(anchor);
		await expect(balanceOf(account.id)).resolves.toBe(123456);
	});
	it("cannot be edited or deleted as a snapshot", async () => {
		const account = await openAccount();
		const anchor = await anchorOf(account.id);

		const patched = await request("PATCH", `/api/snapshots/${anchor.id}`, {
			date: "2026-09-10",
			balance: "0",
		});
		const deleted = await request("DELETE", `/api/snapshots/${anchor.id}`);

		expect(patched.status).toBe(404);
		expect(errorBody.parse(patched.body).error.code).toBe("NOT_FOUND");
		expect(deleted.status).toBe(404);
		expect(errorBody.parse(deleted.body).error.code).toBe("NOT_FOUND");
		await expect(anchorOf(account.id)).resolves.toEqual(anchor);
		await expect(balanceOf(account.id)).resolves.toBe(123456);
	});
});

// Story 4.5: bulk edit.

async function transactionIds(accountId: string) {
	const rows = await temp.db.all<{ id: string }>(
		sql`select id from entries where account_id = ${accountId} and kind = 'transaction' order by id`,
	);

	return rows.map((row) => row.id);
}

async function rowsOf(accountId: string) {
	return temp.db.all<{
		category: string | null;
		origin: string | null;
		merchant: string | null;
		excluded: number;
		locked: string;
		tags: string | null;
	}>(
		sql`select t.category_id as category, t.category_origin as origin, t.merchant_id as merchant, t.excluded as excluded, (select json_group_array(key) from json_each(t.locked_fields)) as locked, (select group_concat(tag_id) from (select tag_id from taggings where transaction_id = t.entry_id order by tag_id)) as tags from transactions t join entries e on e.id = t.entry_id where e.account_id = ${accountId} order by e.id`,
	);
}

async function openWith(count: number) {
	const account = await openAccount();

	await Array.from({ length: count }, (_, index) => index).reduce(async (previous, index) => {
		await previous;
		await postTransaction(account.id, { ...expense, label: `Opération ${index}` });
	}, Promise.resolve());

	return { account, ids: await transactionIds(account.id) };
}

const manualLocks = '["date","amount","label"';

describe("POST /api/transactions/bulk-update", () => {
	it("sets a category on the given ids without moving the balance", async () => {
		const { account, ids } = await openWith(3);
		const groceries = await createCategory(uniqueCategory("Courses"));

		const response = await testClient(buildApp()).api.transactions["bulk-update"].$post({
			json: { ids, patch: { categoryId: groceries.id } },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ data: { updated: 3, changed: 3 } });
		const rows = await rowsOf(account.id);
		expect(rows.map((row) => [row.category, row.origin, row.locked])).toEqual(
			ids.map(() => [groceries.id, "user", `${manualLocks},"category"]`]),
		);
		await expect(balanceOf(account.id)).resolves.toBe(123456 - 3 * 4290);
	});

	it("clears a merchant, adds a tag and excludes, locking each", async () => {
		const { account, ids } = await openWith(2);
		const merchant = await createMerchant(uniqueCategory("Carrefour"));
		const kept = await createTag(uniqueCategory("Vacances"));
		const added = await createTag(uniqueCategory("Travaux"));
		await linkMerchant(account.id, merchant.id);
		await tagAll(account.id, [kept.id]);

		await [{ merchantId: null }, { addTagIds: [added.id] }, { excluded: true }].reduce(
			async (previous, patch) => {
				await previous;
				const { status } = await request("POST", "/api/transactions/bulk-update", { ids, patch });

				expect(status).toBe(200);
			},
			Promise.resolve(),
		);

		const rows = await rowsOf(account.id);
		expect(rows).toEqual(
			ids.map(() => ({
				category: null,
				origin: null,
				merchant: null,
				excluded: 1,
				locked: `${manualLocks},"merchant","tags","excluded"]`,
				tags: [kept.id, added.id].toSorted().join(","),
			})),
		);
	});

	it("updates every row the filter matches, refusing a page in the filter", async () => {
		const { account, ids } = await openWith(3);
		const groceries = await createCategory(uniqueCategory("Courses"));

		await expect(
			request("POST", "/api/transactions/bulk-update", {
				filter: { account: account.id, category: "none", pageSize: "1" },
				patch: { categoryId: groceries.id },
			}),
		).resolves.toMatchObject({
			status: 400,
			body: { error: { fields: [{ path: "filter.pageSize", code: "unrecognized_keys" }] } },
		});
		await expect(
			request("POST", "/api/transactions/bulk-update", {
				filter: { account: account.id, category: "none" },
				patch: { categoryId: groceries.id },
			}),
		).resolves.toEqual({ status: 200, body: { data: { updated: 3, changed: 3 } } });
		expect((await rowsOf(account.id)).map((row) => row.category)).toEqual(
			ids.map(() => groceries.id),
		);
	});

	it("selects by status and by amount the rows the list counts", async () => {
		await ownDatabase();
		const account = await openOwn();
		await syncOwn(account.id, [
			bankLine(-4290, { label: "En attente", pending: true }),
			bankLine(-1200, { label: "Comptabilisée" }),
		]);
		await postOwn(account.id, { ...expense, label: "Saisie", amount: "42,91" });
		const update = (filter: Record<string, unknown>) =>
			ownRequest("POST", "/api/transactions/bulk-update", {
				filter: { account: account.id, ...filter },
				patch: { excluded: true },
			});

		await expect(update({ status: "pending" })).resolves.toMatchObject({
			body: { data: { updated: 1 } },
		});
		await expect(update({ amount: "42,90", amountOperator: "equal" })).resolves.toMatchObject({
			body: { data: { updated: 2 } },
		});
		await expect(update({ amount: "42,90", amountOperator: "less" })).resolves.toMatchObject({
			body: { data: { updated: 1 } },
		});
	});

	it("reads a parent category in the filter as its children too", async () => {
		const { account } = await openWith(2);
		const parent = await createCategory(uniqueCategory("Maison"));
		const child = await createCategory(uniqueCategory("Travaux"), { parentId: parent.id });
		await categorise(account.id, child.id);

		await expect(
			request("POST", "/api/transactions/bulk-update", {
				filter: { account: [account.id], category: [parent.id] },
				patch: { excluded: true },
			}),
		).resolves.toMatchObject({ body: { data: { updated: 2 } } });
	});

	it("answers 0 when the filter matches nothing", async () => {
		const { account } = await openWith(1);

		await expect(
			request("POST", "/api/transactions/bulk-update", {
				filter: { account: account.id, q: "introuvable" },
				patch: { excluded: true },
			}),
		).resolves.toEqual({ status: 200, body: { data: { updated: 0, changed: 0 } } });
	});

	it.each([
		[
			"an unknown id",
			"ids",
			"invalid_value",
			(ids: string[]) => ({ ids: [...ids, "nope"], patch: { excluded: true } }),
		],
		[
			"an unknown category",
			"patch.categoryId",
			"invalid_value",
			(ids: string[]) => ({ ids, patch: { categoryId: "nope" } }),
		],
		[
			"an unknown merchant",
			"patch.merchantId",
			"invalid_value",
			(ids: string[]) => ({ ids, patch: { merchantId: "nope" } }),
		],
		[
			"an unknown tag",
			"patch.addTagIds",
			"invalid_value",
			(ids: string[]) => ({ ids, patch: { addTagIds: ["nope"] } }),
		],
		[
			"ids and a filter",
			"selection",
			"ids_or_filter",
			(ids: string[]) => ({ ids, filter: {}, patch: { excluded: true } }),
		],
		["an empty patch", "patch", "empty_patch", (ids: string[]) => ({ ids, patch: {} })],
	])("writes nothing for %s", async (_label, path, code, bodyOf) => {
		const { account, ids } = await openWith(2);
		const before = await rowsOf(account.id);

		const { status, body: response } = await request(
			"POST",
			"/api/transactions/bulk-update",
			bodyOf(ids),
		);

		expect(status).toBe(400);
		expect(errorBody.parse(response).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path, code }],
		});
		await expect(rowsOf(account.id)).resolves.toEqual(before);
	});

	it("refuses a selection with neither ids nor a filter", async () => {
		const { status, body } = await request("POST", "/api/transactions/bulk-update", {
			patch: { excluded: true },
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "selection", code: "ids_or_filter" },
		]);
	});
});

describe("POST /api/transactions/bulk-delete", () => {
	it("deletes rows over two accounts with their taggings and puts both balances back", async () => {
		const first = await openWith(2);
		const second = await openWith(1);
		const tag = await createTag(uniqueCategory("Vacances"));
		await tagAll(second.account.id, [tag.id]);

		const response = await testClient(buildApp()).api.transactions["bulk-delete"].$post({
			json: { ids: [...first.ids, ...second.ids] },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ data: { deleted: 3 } });
		await expect(transactionIds(first.account.id)).resolves.toEqual([]);
		await expect(transactionIds(second.account.id)).resolves.toEqual([]);
		await expect(balanceOf(first.account.id)).resolves.toBe(123456);
		await expect(balanceOf(second.account.id)).resolves.toBe(123456);
		expect((await tagList()).find((item) => item.id === tag.id)?.transactionCount).toBe(0);
	});

	it("deletes every row the filter matches", async () => {
		const { account } = await openWith(3);

		await expect(
			request("POST", "/api/transactions/bulk-delete", { filter: { account: account.id } }),
		).resolves.toEqual({ status: 200, body: { data: { deleted: 3 } } });
		await expect(balanceOf(account.id)).resolves.toBe(123456);
	});

	it("deletes nothing when an id names no transaction", async () => {
		const { account, ids } = await openWith(2);

		const { status, body } = await request("POST", "/api/transactions/bulk-delete", {
			ids: [...ids, "nope"],
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "ids", code: "invalid_value" }]);
		await expect(transactionIds(account.id)).resolves.toEqual(ids);
	});
});

// Story 10.6: merge or dismiss a possible duplicate.

/** One OFX line of −10,00 on the 5th. */
const tollOfx = () =>
	new TextEncoder().encode(
		"<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKTRANLIST>\n<STMTTRN><DTPOSTED>20260905<TRNAMT>-10.00<FITID>T1<NAME>PEAGE</STMTTRN>\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
	);

async function importToll(accountId: string) {
	const app = buildApp(own?.db);
	const form = new FormData();
	form.append("file", new File([tollOfx()], "releve.ofx"));
	const uploadResponse = await app.request(`/api/accounts/${accountId}/imports`, {
		method: "POST",
		body: form,
	});
	const { data } = importBody.parse(await uploadResponse.json());
	const response = await app.request(`/api/imports/${data.id}/confirm`, { method: "POST" });

	expect(response.status).toBe(200);

	return data.groups;
}

/** −10,00 typed by hand on the 4th and the 6th, then the OFX line of the 5th: a tie. */
async function tie() {
	const account = await openOwn({ name: "Compte courant" });
	const first = await postOwn(account.id, {
		date: "2026-09-04",
		label: "Péage A",
		amount: "-10",
	});
	const second = await postOwn(account.id, {
		date: "2026-09-06",
		label: "Péage B",
		amount: "-10",
	});
	await importToll(account.id);
	const flagged = (await listed("")).items.find((item) => item.possibleDuplicate)?.id ?? "";

	return { account, first, second, flagged };
}

describe("possible duplicates", () => {
	const candidateList = z.object({
		data: z.array(
			z.object({
				id: z.string(),
				date: z.string(),
				label: z.string(),
				amount: z.number(),
				currency: z.string(),
				accountId: z.string(),
				accountName: z.string(),
			}),
		),
	});

	const itemBody = z.object({
		data: listItem.omit({
			accountName: true,
			accountType: true,
			recurring: true,
			splitParent: true,
		}),
	});

	it("flags the tie, lists its candidates, and merges it into the one picked", async () => {
		const { account, first, second, flagged } = await tie();

		const candidates = await ownRequest("GET", `/api/transactions/${flagged}/duplicate-candidates`);

		expect(candidates.status).toBe(200);
		// Equally near and created in the same millisecond here: sorted by date to compare.
		expect(
			candidateList.parse(candidates.body).data.toSorted((a, b) => a.date.localeCompare(b.date)),
		).toEqual([
			{
				id: first,
				date: "2026-09-04",
				label: "Péage A",
				amount: -1000,
				currency: "EUR",
				accountId: account.id,
				accountName: "Compte courant",
			},
			expect.objectContaining({ id: second }),
		]);

		const merged = await ownRequest("POST", `/api/transactions/${flagged}/merge`, { into: first });

		expect(merged.status).toBe(200);
		expect(itemBody.parse(merged.body).data).toMatchObject({
			id: first,
			label: "Péage A",
			possibleDuplicate: false,
		});
		expect(merged.body).toMatchObject({ data: { source: { kind: "import", format: "ofx" } } });
		const { items } = await listed("");
		expect(items.map((item) => item.id).toSorted()).toEqual([first, second].toSorted());
		const detail = await ownRequest("GET", `/api/accounts/${account.id}`);
		expect(detail.body).toMatchObject({ data: { balance: 123456 - 2000 } });
		// Its line is known now: importing the file again adds nothing.
		const again = await importToll(account.id);
		expect(again.present).toEqual([expect.objectContaining({ entryId: first })]);
	});

	it("dismisses the flag, and importing the file again never raises it", async () => {
		const { account, flagged } = await tie();

		const dismissed = await ownRequest("POST", `/api/transactions/${flagged}/dismiss-duplicate`);

		expect(dismissed.status).toBe(200);
		expect(itemBody.parse(dismissed.body).data).toMatchObject({
			id: flagged,
			possibleDuplicate: false,
		});
		const candidates = await ownRequest("GET", `/api/transactions/${flagged}/duplicate-candidates`);
		expect(candidateList.parse(candidates.body).data).toEqual([]);
		const again = await importToll(account.id);
		expect(again.present).toEqual([expect.objectContaining({ entryId: flagged })]);
		expect((await listed("")).items.some((item) => item.possibleDuplicate)).toBe(false);
	});

	it("refuses a candidate outside the list, then a duplicate already resolved", async () => {
		const { first, flagged } = await tie();
		const other = await openOwn({ name: "Livret" });
		const elsewhere = await postOwn(other.id, {
			date: "2026-09-05",
			label: "Péage",
			amount: "-10",
		});

		const refused = await ownRequest("POST", `/api/transactions/${flagged}/merge`, {
			into: elsewhere,
		});

		expect(refused.status).toBe(400);
		expect(errorBody.parse(refused.body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "into", code: "not_a_candidate" }],
		});
		const missing = await ownRequest("POST", `/api/transactions/${flagged}/merge`, {});
		expect(missing.status).toBe(400);
		expect(errorBody.parse(missing.body).error.fields?.[0]?.path).toBe("into");

		await ownRequest("POST", `/api/transactions/${flagged}/dismiss-duplicate`);
		const resolved = await ownRequest("POST", `/api/transactions/${flagged}/merge`, {
			into: first,
		});

		expect(resolved.status).toBe(409);
		expect(errorBody.parse(resolved.body).error.code).toBe("DUPLICATE_RESOLVED");
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		await openOwn();

		const responses = await Promise.all([
			ownRequest("GET", "/api/transactions/nope/duplicate-candidates"),
			ownRequest("POST", "/api/transactions/nope/merge", { into: "other" }),
			ownRequest("POST", "/api/transactions/nope/dismiss-duplicate"),
		]);

		expect(responses.map(({ status }) => status)).toEqual([404, 404, 404]);
		expect(responses.map(({ body }) => errorBody.parse(body).error.code)).toEqual([
			"NOT_FOUND",
			"NOT_FOUND",
			"NOT_FOUND",
		]);
	});

	it("guards the three routes with the session and the origin check", async () => {
		const database = await ownDatabase();
		const anonymous = buildTestApp(database.db, createLogger("silent"));
		const foreign = withSession(buildTestApp(database.db, createLogger("silent")), template.cookie);
		const sameOrigin = { origin: "http://localhost:5173" };
		const attacker = { origin: "https://attacker.example" };

		const responses = await Promise.all([
			anonymous.request("/api/transactions/t1/duplicate-candidates"),
			anonymous.request("/api/transactions/t1/merge", {
				method: "POST",
				headers: { "content-type": "application/json", ...sameOrigin },
				body: JSON.stringify({ into: "t2" }),
			}),
			anonymous.request("/api/transactions/t1/dismiss-duplicate", {
				method: "POST",
				headers: sameOrigin,
			}),
			foreign.request("/api/transactions/t1/merge", {
				method: "POST",
				headers: { "content-type": "text/plain", ...attacker },
				body: JSON.stringify({ into: "t2" }),
			}),
			foreign.request("/api/transactions/t1/dismiss-duplicate", {
				method: "POST",
				headers: attacker,
			}),
		]);

		expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 403, 403]);
	});
});

const connectionOf = new Map<string, string>();

/**
 * Writes `lines` into `accountId` as a sync of its own connection, in the
 * running test's database: only a sync's keys sit on a pending entry.
 */
async function syncOwn(accountId: string, lines: NormalizedTransaction[]) {
	const db = own?.db ?? temp.db;
	const connectionId = connectionOf.get(accountId) ?? crypto.randomUUID();

	if (!connectionOf.has(accountId)) {
		connectionOf.set(accountId, connectionId);
		await db.insert(bankConnections).values({
			id: connectionId,
			connector: "enable-banking",
			institutionName: "Banque Test",
			country: "FR",
			status: "active",
			createdAt: 0,
			updatedAt: 0,
		});
	}

	const result = await ingest(
		{ db, timeZone: "Europe/Paris" },
		accountId,
		{ transactions: lines, balance: null, rejected: [] },
		{ connectionId },
		{ origin: "sync" },
	);

	return result.created;
}

const bankLine = (amount: number, overrides: Partial<NormalizedTransaction> = {}) => ({
	externalId: crypto.randomUUID(),
	date: "2026-09-04",
	amount: toMinorUnits(amount),
	currency: "EUR",
	label: "LE BISTROT PARIS",
	reference: null,
	notes: null,
	pending: false,
	merchant: "Le Bistrot",
	...overrides,
});

/** A pending -20,00 on the 3rd, and its booked -23,00 on the 4th, synced apart. */
async function tip() {
	await ownDatabase();
	const account = await openOwn({ name: "Compte courant" });
	const [pending = ""] = await syncOwn(account.id, [
		bankLine(-2000, { date: "2026-09-03", pending: true, label: "LE BISTROT PARIS CB" }),
	]);
	const [booked = ""] = await syncOwn(account.id, [bankLine(-2300)]);

	return { account, pending, booked };
}

describe("pending duplicates", () => {
	const candidate = z.object({
		id: z.string(),
		date: z.string(),
		label: z.string(),
		amount: z.number(),
		currency: z.string(),
		accountId: z.string(),
		accountName: z.string(),
	});
	const page = z.object({
		data: z.strictObject({ candidates: z.array(candidate), hasMore: z.boolean() }),
	});
	const itemBody = z.object({
		data: z.object({
			id: z.string(),
			date: z.string(),
			pending: z.boolean(),
			postedMatch: z.object({ id: z.string(), confidence: z.enum(["medium", "low"]) }).nullable(),
		}),
	});

	it("shows the suggestion on the row and names its line, then merges it", async () => {
		const { account, pending, booked } = await tip();

		expect((await listed("")).items.find((item) => item.id === pending)).toMatchObject({
			postedMatch: { id: booked, confidence: "medium" },
		});
		const match = await ownRequest("GET", `/api/transactions/${pending}/posted-match`);
		expect(match.status).toBe(200);
		expect(z.object({ data: candidate }).parse(match.body).data).toEqual({
			id: booked,
			date: "2026-09-04",
			label: "LE BISTROT PARIS",
			amount: -2300,
			currency: "EUR",
			accountId: account.id,
			accountName: "Compte courant",
		});

		const merged = await ownRequest("POST", `/api/transactions/${pending}/merge-pending`, {
			into: booked,
		});

		expect(merged.status).toBe(200);
		expect(itemBody.parse(merged.body).data).toMatchObject({
			id: booked,
			date: "2026-09-03",
			pending: false,
			postedMatch: null,
		});
		expect((await listed("")).items.map((item) => item.id)).toEqual([booked]);
		const gone = await ownRequest("GET", `/api/transactions/${pending}/posted-match`);
		expect(errorBody.parse(gone.body).error.code).toBe("NOT_FOUND");
	});

	it("dismisses the suggestion for good", async () => {
		const { pending } = await tip();

		const dismissed = await ownRequest("POST", `/api/transactions/${pending}/dismiss-posted-match`);
		const again = await ownRequest("POST", `/api/transactions/${pending}/dismiss-posted-match`);

		expect([dismissed.status, again.status]).toEqual([200, 200]);
		expect(itemBody.parse(again.body).data.postedMatch).toBeNull();
		const match = await ownRequest("GET", `/api/transactions/${pending}/posted-match`);
		expect(match.body).toEqual({ data: null });
	});

	it("lists the booked lines ten at a time, and refuses a page below zero", async () => {
		const { account, pending, booked } = await tip();
		const more = await syncOwn(
			account.id,
			Array.from({ length: 10 }, (_, index) => bankLine(-100 - index, { label: `LIGNE ${index}` })),
		);

		const first = await ownRequest("GET", `/api/transactions/${pending}/pending-merge-candidates`);
		const second = await ownRequest(
			"GET",
			`/api/transactions/${pending}/pending-merge-candidates?offset=10`,
		);
		const negative = await ownRequest(
			"GET",
			`/api/transactions/${pending}/pending-merge-candidates?offset=-1`,
		);

		expect(page.parse(first.body).data.candidates).toHaveLength(10);
		expect(page.parse(first.body).data.hasMore).toBe(true);
		expect(page.parse(second.body).data.hasMore).toBe(false);
		expect(
			[...page.parse(first.body).data.candidates, ...page.parse(second.body).data.candidates]
				.map(({ id }) => id)
				.toSorted(),
		).toEqual([booked, ...more].toSorted());
		expect(negative.status).toBe(400);
	});

	it("refuses a line outside the candidates, then an entry no longer pending", async () => {
		const { account, pending, booked } = await tip();
		const other = await openOwn({ name: "Livret" });
		const [elsewhere = ""] = await syncOwn(other.id, [bankLine(-2300)]);

		const refused = await ownRequest("POST", `/api/transactions/${pending}/merge-pending`, {
			into: elsewhere,
		});

		expect(refused.status).toBe(400);
		expect(errorBody.parse(refused.body).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "into", code: "not_a_candidate" }],
		});

		await syncOwn(account.id, [bankLine(-2000, { date: "2026-09-05" })]);
		// Booked at its own amount, the entry shows its suggestion no more.
		expect((await listed("")).items.find((item) => item.id === pending)).toMatchObject({
			postedMatch: null,
		});
		const match = await ownRequest("GET", `/api/transactions/${pending}/posted-match`);
		expect(match.body).toEqual({ data: null });
		const resolved = await ownRequest("POST", `/api/transactions/${pending}/merge-pending`, {
			into: booked,
		});

		expect(resolved.status).toBe(409);
		expect(errorBody.parse(resolved.body).error.code).toBe("DUPLICATE_RESOLVED");
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		await ownDatabase();

		const responses = await Promise.all([
			ownRequest("GET", "/api/transactions/nope/posted-match"),
			ownRequest("GET", "/api/transactions/nope/pending-merge-candidates"),
			ownRequest("POST", "/api/transactions/nope/merge-pending", { into: "other" }),
			ownRequest("POST", "/api/transactions/nope/dismiss-posted-match"),
		]);

		expect(responses.map(({ body }) => errorBody.parse(body).error.code)).toEqual([
			"NOT_FOUND",
			"NOT_FOUND",
			"NOT_FOUND",
			"NOT_FOUND",
		]);
	});
});

/** A -100,00 expense on an account of its own. */
async function newExpense() {
	const account = await openAccount();
	const created = await postTransaction(account.id, { ...expense, amount: "-100,00" });
	const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

	return { account, id: data.id };
}

describe("/api/transactions/:id/split", () => {
	const splitBody = z.object({
		data: z.object({
			parent: z.object({ id: z.string(), excluded: z.boolean(), parentEntryId: z.null() }),
			children: z.array(
				z.object({
					id: z.string(),
					label: z.string(),
					amount: z.number(),
					categoryId: z.string().nullable(),
					tagIds: z.array(z.string()),
					parentEntryId: z.string(),
				}),
			),
		}),
	});

	it("splits a transaction, reads it from a child, edits it and undoes it, the balance never moving", async () => {
		const { account, id } = await newExpense();
		const food = await createCategory(uniqueCategory("Alimentation"));
		const tag = await createTag(uniqueCategory("Reçu"));
		const balance = await balanceOf(account.id);

		const created = await request("POST", `/api/transactions/${id}/split`, {
			lines: [
				{ label: "Alimentation", amount: "-60,00", categoryId: food.id, tagIds: [tag.id] },
				{ label: "Maison", amount: "-40", categoryId: null, notes: " " },
			],
		});
		const split = splitBody.parse(created.body).data;
		const [first, second] = split.children;

		expect(created.status).toBe(201);
		expect(split.parent).toMatchObject({ id, excluded: true });
		expect(split.children).toMatchObject([
			{
				label: "Alimentation",
				amount: -6000,
				categoryId: food.id,
				tagIds: [tag.id],
				parentEntryId: id,
			},
			{ label: "Maison", amount: -4000, categoryId: null, tagIds: [], parentEntryId: id },
		]);
		await expect(balanceOf(account.id)).resolves.toBe(balance);

		const read = await request("GET", `/api/transactions/${second?.id ?? ""}/split`);
		expect(splitBody.parse(read.body).data).toEqual(split);

		const edited = await request("PUT", `/api/transactions/${id}/split`, {
			lines: [
				{ id: first?.id, label: "Fruits", amount: "-70,00", categoryId: food.id },
				{ label: "Savon", amount: "-30,00", categoryId: null },
			],
		});
		const after = splitBody.parse(edited.body).data;

		expect(edited.status).toBe(200);
		// Sorted: the clock is frozen, so creation alone does not order them here.
		expect(after.children.toSorted((a, b) => a.label.localeCompare(b.label))).toMatchObject([
			{ id: first?.id, label: "Fruits", amount: -7000, tagIds: [tag.id] },
			{ label: "Savon", amount: -3000 },
		]);
		expect(after.children.map((child) => child.id)).not.toContain(second?.id);

		const undone = await request("DELETE", `/api/transactions/${first?.id ?? ""}/split`);

		expect(undone.status).toBe(200);
		expect(undone.body).toMatchObject({ data: { id, excluded: false, parentEntryId: null } });
		await expect(balanceOf(account.id)).resolves.toBe(balance);
		expect((await request("GET", `/api/transactions/${id}/split`)).status).toBe(404);
	});

	it("refuses lines that do not sum to the transaction, and a bad amount on its line", async () => {
		const { id } = await newExpense();

		const off = await request("POST", `/api/transactions/${id}/split`, {
			lines: [
				{ label: "A", amount: "-60,00", categoryId: null },
				{ label: "B", amount: "-39,99", categoryId: null },
			],
		});
		const malformed = await request("POST", `/api/transactions/${id}/split`, {
			lines: [{ label: " ", amount: "douze", categoryId: null }],
		});
		const empty = await request("POST", `/api/transactions/${id}/split`, { lines: [] });

		expect(off.status).toBe(400);
		expect(errorBody.parse(off.body).error.fields).toEqual([
			{ path: "lines", code: "split_sum_mismatch" },
		]);
		expect(errorBody.parse(malformed.body).error.fields).toEqual(
			expect.arrayContaining([
				{ path: "lines.0.label", code: "too_small" },
				{ path: "lines.0.amount", code: "invalid_amount" },
			]),
		);
		expect(errorBody.parse(empty.body).error.fields).toEqual([
			{ path: "lines", code: "too_small" },
		]);
		expect((await request("GET", `/api/transactions/${id}/split`)).status).toBe(404);
	});

	it("answers NOT_SPLITTABLE for a split's child, and TRANSACTION_SPLIT for a child's amount or delete", async () => {
		const { id } = await newExpense();
		const created = await request("POST", `/api/transactions/${id}/split`, {
			lines: [{ label: "Tout", amount: "-100,00", categoryId: null }],
		});
		const [child] = splitBody.parse(created.body).data.children;
		const childId = child?.id ?? "";

		const again = await request("POST", `/api/transactions/${childId}/split`, {
			lines: [{ label: "Tout", amount: "-100,00", categoryId: null }],
		});
		const patched = await request("PATCH", `/api/transactions/${childId}`, { amount: "-1,00" });
		const deleted = await request("DELETE", `/api/transactions/${childId}`);
		const relabelled = await request("PATCH", `/api/transactions/${childId}`, { label: "Courses" });

		expect([again.status, patched.status, deleted.status]).toEqual([409, 409, 409]);
		expect(errorBody.parse(again.body).error.code).toBe("NOT_SPLITTABLE");
		expect(errorBody.parse(patched.body).error.code).toBe("TRANSACTION_SPLIT");
		expect(errorBody.parse(deleted.body).error.code).toBe("TRANSACTION_SPLIT");
		expect(relabelled.body).toMatchObject({ data: { label: "Courses", parentEntryId: id } });
	});

	it("answers NOT_FOUND for an unknown transaction", async () => {
		const lines = { lines: [{ label: "Tout", amount: "-1,00", categoryId: null }] };
		const responses = await Promise.all([
			request("GET", "/api/transactions/nope/split"),
			request("POST", "/api/transactions/nope/split", lines),
			request("PUT", "/api/transactions/nope/split", lines),
			request("DELETE", "/api/transactions/nope/split"),
		]);

		expect(responses.map(({ status }) => status)).toEqual([404, 404, 404, 404]);
	});

	it("types its routes for the interface's client", async () => {
		const { id } = await newExpense();
		const client = testClient(buildApp()).api.transactions[":id"].split;

		const response = await client.$post({
			param: { id },
			json: { lines: [{ label: "Tout", amount: "-100,00", categoryId: null }] },
		});

		expect(response.status).toBe(201);
		await expect(client.$get({ param: { id } })).resolves.toMatchObject({ status: 200 });
	});
});

describe("POST /api/transactions/:id/unlock", () => {
	const unlockedBody = z.object({
		data: z.object({
			id: z.string(),
			categoryId: z.string().nullable(),
			lockedFields: z.record(z.string(), z.unknown()),
		}),
	});

	it("clears every lock at once, keeps the category's origin, and lets a rule reach the row", async () => {
		const account = await openAccount();
		const leisure = await createCategory(uniqueCategory("Loisirs"));
		const groceries = await createCategory(uniqueCategory("Courses"));
		const created = await postTransaction(account.id, { ...expense, label: "CB ZEPHYR HALLES" });
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		await request("PATCH", `/api/transactions/${data.id}`, { categoryId: leisure.id });
		await expect(locksOf(data.id)).resolves.toEqual(["date", "amount", "label", "category"]);

		const { status, body } = await request("POST", `/api/transactions/${data.id}/unlock`);

		expect(status).toBe(200);
		expect(unlockedBody.parse(body).data).toEqual({
			id: data.id,
			categoryId: leisure.id,
			lockedFields: {},
		});
		await expect(locksOf(data.id)).resolves.toEqual([]);
		await expect(
			temp.db.get(
				sql`select category_origin as origin from transactions where entry_id = ${data.id}`,
			),
		).resolves.toEqual({ origin: "user" });

		const rule = z.object({ data: z.object({ id: z.string() }) }).parse(
			(
				await request("POST", "/api/rules", {
					conditions: [{ conditionType: "transaction_name", operator: "like", value: "zephyr" }],
					actions: [{ actionType: "set_transaction_category", value: groceries.id }],
				})
			).body,
		).data;
		const applied = await request("POST", `/api/rules/${rule.id}/apply`);

		expect(applied.status).toBe(200);
		await expect(listedOf(account.id)).resolves.toMatchObject([
			{ id: data.id, categoryId: groceries.id },
		]);
	});

	it("answers NOT_FOUND for an unknown transaction, and 401 signed out", async () => {
		const unknown = await request("POST", "/api/transactions/nope/unlock");

		expect(unknown.status).toBe(404);
		expect(errorBody.parse(unknown.body).error.code).toBe("NOT_FOUND");

		const anonymous = await buildTestApp(temp.db, createLogger("silent")).request(
			"/api/transactions/nope/unlock",
			{ method: "POST", headers: { origin: "http://localhost:5173" } },
		);

		expect(anonymous.status).toBe(401);
	});
});

describe("a viewer and a one-time or labelled transaction", () => {
	let viewerCookie: string;
	let auth: Auth;
	const silent = createLogger("silent");

	// One viewer sign-in for the block: Better Auth allows three per ten seconds.
	beforeAll(async () => {
		auth = createTestAuth(temp.db, silent);
		viewerCookie = await addViewer(buildTestApp(temp.db, silent, auth), auth);
	});

	it("is refused FORBIDDEN by `viewerReadOnly`, nothing written", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		const viewer = withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

		const edit = await viewer.request(`/api/transactions/${data.id}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ oneTime: true }),
		});

		expect(edit.status).toBe(403);
		expect(errorBody.parse(await edit.json()).error.code).toBe("FORBIDDEN");
		await expect(listedOf(account.id)).resolves.toMatchObject([{ id: data.id, oneTime: false }]);
	});

	it("refuses a viewer's unlock FORBIDDEN, every lock kept", async () => {
		const account = await openAccount();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		const viewer = withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

		const unlock = await viewer.request(`/api/transactions/${data.id}/unlock`, { method: "POST" });

		expect(unlock.status).toBe(403);
		expect(errorBody.parse(await unlock.json()).error.code).toBe("FORBIDDEN");
		await expect(locksOf(data.id)).resolves.toEqual(["date", "amount", "label"]);
	});

	it("refuses a viewer's activity label FORBIDDEN by `viewerReadOnly`, nothing written", async () => {
		const account = await openAccount(pea);
		const created = await postTransaction(account.id, dividend);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		const viewer = withSession(buildTestApp(temp.db, silent, auth), viewerCookie);

		const edit = await viewer.request(`/api/transactions/${data.id}`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ investmentActivityLabel: "Dividend" }),
		});

		expect(edit.status).toBe(403);
		expect(errorBody.parse(await edit.json()).error.code).toBe("FORBIDDEN");
		await expect(locksOf(data.id)).resolves.toEqual(["date", "amount", "label"]);
		// Read raw: `listItem` strips what it does not name.
		const list = await request("GET", `/api/transactions?account=${account.id}`);
		expect(list.body).toMatchObject({
			data: { items: [{ id: data.id, investmentActivityLabel: null }] },
		});
	});
});

describe("PATCH /api/transactions/:id and the investment activity label", () => {
	it("labels a PEA line, locks the label, returns it in every read and moves no balance", async () => {
		const account = await openAccount(pea);
		const created = await postTransaction(account.id, dividend);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		const before = await balanceOf(account.id);

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			investmentActivityLabel: "Dividend",
		});

		expect(status).toBe(200);
		expect(body).toMatchObject({ data: { investmentActivityLabel: "Dividend", amount: 1200 } });
		await expect(locksOf(data.id)).resolves.toEqual([
			"date",
			"amount",
			"label",
			"investmentActivityLabel",
		]);
		// Read raw: `listItem` strips what it does not name.
		const list = await request("GET", `/api/transactions?account=${account.id}`);
		expect(list.body).toMatchObject({
			data: { items: [{ id: data.id, investmentActivityLabel: "Dividend" }] },
		});
		await expect(balanceOf(account.id)).resolves.toBe(before);
	});

	it("clears the label with null", async () => {
		const account = await openAccount(pea);
		const created = await postTransaction(account.id, dividend);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);
		await request("PATCH", `/api/transactions/${data.id}`, { investmentActivityLabel: "Dividend" });

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			investmentActivityLabel: null,
		});

		expect(status).toBe(200);
		expect(body).toMatchObject({ data: { investmentActivityLabel: null } });
		await expect(locksOf(data.id)).resolves.toContain("investmentActivityLabel");
	});

	it("refuses a value outside Sure's list on its field, nothing written", async () => {
		const account = await openAccount(pea);
		const created = await postTransaction(account.id, dividend);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const { status, body } = await request("PATCH", `/api/transactions/${data.id}`, {
			investmentActivityLabel: "Gift",
		});

		expect(status).toBe(400);
		const { error } = errorBody.parse(body);
		expect(error.code).toBe("VALIDATION_ERROR");
		expect(error.fields?.map((field) => field.path)).toEqual(["investmentActivityLabel"]);
		await expect(locksOf(data.id)).resolves.toEqual(["date", "amount", "label"]);
	});
});
