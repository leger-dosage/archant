import type { TempDatabase } from "../testing/temp-database.ts";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { toMinorUnits } from "@archant/data/money";
import { assistantCalls } from "@archant/data/schema/assistant-calls";
import { bankConnections } from "@archant/data/schema/bank-connections";

import { createLogger } from "../lib/logger.ts";
import { ingest } from "../services/ledger/ingest.ts";
import {
	openOwn,
	ownCategory,
	ownDatabase,
	pinned,
	postOwn,
	sendOwn,
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
import { buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

// Story 26.4. The clock stands at 2026-09-21; each test has a household of
// its own, through `ownDatabase`, so its transactions are the only ones there.

let db: TempDatabase["db"];

/** A checking account opened on 2026-01-10 at 1 500,00. */
async function checking() {
	db = (await ownDatabase()).db;

	return openOwn({ ...pinned, name: "Compte courant" });
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

const ref = z.object({ id: z.string(), name: z.string() });

const detail = z.object({
	id: z.string(),
	date: z.string(),
	name: z.string(),
	amount: z.string(),
	currency: z.string(),
	classification: z.enum(["income", "expense"]),
	account: ref,
	category: ref.nullable(),
	merchant: ref.nullable(),
	tags: z.array(ref),
	notes: z.string().nullable(),
	transfer: z.object({ id: z.string() }).loose().nullable(),
	source: z.object({ kind: z.string() }).loose(),
});

/** Sure's `{ created, transaction }`, read as the line with its flag. */
const created = z
	.strictObject({ created: z.boolean(), transaction: detail })
	.transform(({ created: flag, transaction }) => ({ ...transaction, created: flag }));

const deleted = z.object({
	deleted: z.literal(true),
	transaction: detail,
	deleted_count: z.number(),
});

const errorText = (result: Awaited<ReturnType<typeof callTool>>) =>
	z.array(z.object({ text: z.string() })).parse(result.content)[0]?.text ?? "";

async function idOf(name: string) {
	const tag = await sendOwn("POST", "/api/tags", { name });

	return z.object({ data: z.object({ id: z.string() }) }).parse(tag).data.id;
}

/** The account's transactions as its page counts them. */
async function transactionCount(accountId: string) {
	const page = await sendOwn("GET", `/api/accounts/${accountId}/transactions`);

	return z.object({ data: z.object({ total: z.number() }) }).parse(page).data.total;
}

async function balanceOf(tools: Awaited<ReturnType<typeof assistants>>, accountId: string) {
	const result = await tools.read("get_accounts");
	const accounts = z
		.object({ accounts: z.array(z.object({ id: z.string(), balance: z.string() }).loose()) })
		.parse(result.structuredContent).accounts;

	return accounts.find((account) => account.id === accountId)?.balance;
}

/** A line a bank synced onto the account, and a sync that sends it again. */
async function bankLine(accountId: string) {
	const connectionId = crypto.randomUUID();
	await db.insert(bankConnections).values({
		id: connectionId,
		connector: "enable-banking",
		institutionName: "Banque Test",
		country: "FR",
		status: "active",
		createdAt: 0,
		updatedAt: 0,
	});
	const resync = async () =>
		ingest(
			{ db, timeZone: "Europe/Paris" },
			accountId,
			{
				transactions: [
					{
						externalId: "EB-26-4",
						date: "2026-09-12",
						amount: toMinorUnits(-3_210),
						currency: "EUR",
						label: "CARREFOUR",
						reference: null,
						notes: null,
						pending: false,
					},
				],
				balance: null,
				rejected: [],
			},
			{ connectionId, missesFrom: null },
			{ origin: "sync" },
		);
	const [id] = (await resync()).created;

	if (id === undefined) {
		throw new Error("The bank line was expected to be created.");
	}

	return { id, resync };
}

describe("create_transaction", () => {
	it("records a line as the sheet does, the rule matching its label setting its category", async () => {
		const account = await checking();
		const market = await ownCategory("Marché");
		await sendOwn("POST", "/api/rules", {
			conditions: [{ conditionType: "transaction_name", operator: "like", value: "marché" }],
			actions: [{ actionType: "set_transaction_category", value: market }],
		});
		const tools = await assistants();

		const result = await tools.write("create_transaction", {
			account_id: account.id,
			date: "2026-09-19",
			name: "Marché du samedi",
			amount: "-23.40",
			notes: "Espèces",
		});

		expect(result.isError, errorText(result)).toBeUndefined();
		const line = created.parse(result.structuredContent);
		expect(line).toMatchObject({
			date: "2026-09-19",
			name: "Marché du samedi",
			amount: "-23.40",
			currency: "EUR",
			classification: "expense",
			account: { id: account.id, name: account.name },
			category: { id: market, name: "Marché" },
			notes: "Espèces",
			source: { kind: "manual" },
			created: true,
		});
		await expect(tools.read("get_transaction", { id: line.id })).resolves.toMatchObject({
			structuredContent: { id: line.id, category: { id: market } },
		});
		await expect(balanceOf(tools, account.id)).resolves.toBe("1476.6");
		await expect(calls()).resolves.toEqual([
			{ tool: "create_transaction", outcome: "OK", changedRows: 1 },
			{ tool: "get_transaction", outcome: "OK", changedRows: 0 },
			{ tool: "get_accounts", outcome: "OK", changedRows: 0 },
		]);
	});

	it("sets and locks the category and tags it is given, which the matching rule leaves alone", async () => {
		const account = await checking();
		const market = await ownCategory("Marché");
		const gifts = await ownCategory("Cadeaux");
		const birthday = await idOf("Anniversaire");
		await sendOwn("POST", "/api/rules", {
			conditions: [{ conditionType: "transaction_name", operator: "like", value: "fleurs" }],
			actions: [{ actionType: "set_transaction_category", value: market }],
		});
		const tools = await assistants();

		const result = await tools.write("create_transaction", {
			account_id: account.id,
			date: "2026-09-18",
			name: "Fleurs",
			amount: "-30.00",
			category_id: gifts,
			tag_ids: [birthday, birthday],
		});

		const line = created.parse(result.structuredContent);
		expect(line).toMatchObject({
			category: { id: gifts, name: "Cadeaux" },
			tags: [{ id: birthday, name: "Anniversaire" }],
		});
		// Locked as an edit by the owner: applying the rule leaves it alone too.
		await sendOwn("POST", "/api/rules/apply", {});
		await expect(tools.read("get_transaction", { id: line.id })).resolves.toMatchObject({
			structuredContent: { category: { id: gifts } },
		});
	});

	it("accepts the account's currency in any case, as Sure upcases it", async () => {
		const account = await checking();
		const tools = await assistants();

		const result = await tools.write("create_transaction", {
			account_id: account.id,
			date: "2026-09-18",
			name: "Boulangerie",
			amount: "-1.00",
			currency: "eur",
		});

		expect(created.parse(result.structuredContent).currency).toBe("EUR");
	});

	it("takes the sign from type and the size from amount, as Sure's", async () => {
		const account = await checking();
		const tools = await assistants();

		const expense = await tools.write("create_transaction", {
			account_id: account.id,
			date: "2026-09-18",
			name: "Boulangerie",
			amount: "12.50",
			type: "expense",
		});
		const income = await tools.write("create_transaction", {
			account_id: account.id,
			date: "2026-09-18",
			name: "Remboursement",
			amount: "-8.00",
			type: "inflow",
		});

		expect(created.parse(expense.structuredContent).amount).toBe("-12.50");
		expect(created.parse(income.structuredContent).amount).toBe("8.00");
	});

	it("takes Sure's call as it is, user_modified included, which changes nothing", async () => {
		const account = await checking();
		const tools = await assistants();

		const result = await tools.write("create_transaction", {
			account_id: account.id,
			date: "2026-09-18",
			name: "Roche",
			amount: "2194.15",
			type: "expense",
			user_modified: true,
		});
		const plain = await tools.write("create_transaction", {
			account_id: account.id,
			date: "2026-09-18",
			name: "Roche",
			amount: "2194.15",
			type: "expense",
			user_modified: false,
		});

		expect(created.parse(result.structuredContent)).toMatchObject({
			name: "Roche",
			amount: "-2194.15",
			created: true,
		});
		expect(created.parse(plain.structuredContent)).toMatchObject({ amount: "-2194.15" });
		expect(await calls()).toEqual([
			{ tool: "create_transaction", outcome: "OK", changedRows: 1 },
			{ tool: "create_transaction", outcome: "OK", changedRows: 1 },
		]);
	});

	it("refuses each invalid field with its path and code, writing nothing", async () => {
		const account = await checking();
		const tools = await assistants();

		const fields = await tools.write("create_transaction", {
			account_id: account.id,
			date: "2026-09-18",
			name: " ",
			amount: "12,345",
		});
		const category = await tools.write("create_transaction", {
			account_id: account.id,
			date: "2026-09-18",
			name: "Boulangerie",
			amount: "-1.00",
			category_id: "nope",
		});
		const currency = await tools.write("create_transaction", {
			account_id: account.id,
			date: "2026-09-18",
			name: "Boulangerie",
			amount: "-1.00",
			currency: "USD",
		});
		const opening = await tools.write("create_transaction", {
			account_id: account.id,
			date: "2026-01-10",
			name: "Boulangerie",
			amount: "-1.00",
		});
		const unknown = await tools.write("create_transaction", {
			account_id: "nope",
			date: "2026-09-18",
			name: "Boulangerie",
			amount: "-1.00",
		});

		expect(fields.isError).toBe(true);
		expect(errorText(fields)).toContain("name too_small");
		expect(errorText(fields)).toContain("amount invalid_amount");
		expect(errorText(category)).toContain("category_id invalid_value");
		expect(errorText(currency)).toContain("currency currency_mismatch");
		expect(errorText(opening)).toContain("date not_after_opening_date");
		expect(errorText(unknown)).toContain('"error":"not_found"');
		const colon = await tools.write("create_transaction", {
			account_id: account.id,
			date: "2026-09-18",
			name: "Boulangerie",
			amount: "-1.00",
			external_id: "row-1",
			source: "csv:2026",
		});
		expect(errorText(colon)).toContain("source invalid_format");
		await expect(transactionCount(account.id)).resolves.toBe(0);
		await expect(calls()).resolves.toEqual([
			{ tool: "create_transaction", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "create_transaction", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "create_transaction", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "create_transaction", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "create_transaction", outcome: "NOT_FOUND", changedRows: 0 },
			{ tool: "create_transaction", outcome: "VALIDATION_ERROR", changedRows: 0 },
		]);
	});

	it("records a line once for one external_id and source, returning it again with created false", async () => {
		const account = await checking();
		const other = await openOwn({ ...pinned, name: "Livret" });
		const tools = await assistants();
		const line = {
			account_id: account.id,
			date: "2026-09-15",
			name: "Relevé ligne 4",
			amount: "-45.00",
			external_id: "row-4",
		};

		const first = created.parse((await tools.write("create_transaction", line)).structuredContent);
		const again = created.parse(
			(await tools.write("create_transaction", { ...line, amount: "-99.00" })).structuredContent,
		);
		const otherSource = created.parse(
			(await tools.write("create_transaction", { ...line, source: "csv-2026-09" }))
				.structuredContent,
		);
		const otherAccount = created.parse(
			(await tools.write("create_transaction", { ...line, account_id: other.id }))
				.structuredContent,
		);

		expect(first.created).toBe(true);
		expect(again).toEqual({ ...first, created: false });
		expect(otherSource.created).toBe(true);
		expect(otherAccount.created).toBe(true);
		await expect(transactionCount(account.id)).resolves.toBe(2);
		await expect(calls()).resolves.toEqual([
			{ tool: "create_transaction", outcome: "OK", changedRows: 1 },
			{ tool: "create_transaction", outcome: "OK", changedRows: 0 },
			{ tool: "create_transaction", outcome: "OK", changedRows: 1 },
			{ tool: "create_transaction", outcome: "OK", changedRows: 1 },
		]);

		await tools.write("delete_transaction", {
			id: first.id,
			account_id: account.id,
			date: "2026-09-15",
			amount: "-45.00",
		});
		const recreated = created.parse(
			(await tools.write("create_transaction", line)).structuredContent,
		);
		expect(recreated.created).toBe(true);
		expect(recreated.id).not.toBe(first.id);
	});

	it("is refused to a read-only token, which never lists it", async () => {
		const account = await checking();
		const tools = await assistants();

		const response = await tools.refused("create_transaction", {
			account_id: account.id,
			date: "2026-09-18",
			name: "Boulangerie",
			amount: "-1.00",
		});

		expect(response.status).toBe(403);
		await expect(transactionCount(account.id)).resolves.toBe(0);
		await expect(calls()).resolves.toEqual([
			{ tool: "create_transaction", outcome: "INSUFFICIENT_SCOPE", changedRows: 0 },
		]);
	});
});

describe("delete_transaction", () => {
	it("deletes the line whose values still match, moving the balance back", async () => {
		const account = await checking();
		const id = await postOwn(account.id, {
			date: "2026-09-10",
			label: "Courses",
			amount: "-120,00",
		});
		const tools = await assistants();

		const result = await tools.write("delete_transaction", {
			id,
			account_id: account.id,
			date: "2026-09-10",
			amount: "-120.00",
		});

		expect(result.isError, errorText(result)).toBeUndefined();
		expect(deleted.parse(result.structuredContent)).toMatchObject({
			deleted: true,
			transaction: {
				id,
				date: "2026-09-10",
				name: "Courses",
				amount: "-120.00",
				currency: "EUR",
				account: { id: account.id },
				source: { kind: "manual" },
			},
			deleted_count: 1,
		});
		await expect(transactionCount(account.id)).resolves.toBe(0);
		await expect(balanceOf(tools, account.id)).resolves.toBe("1500.0");
		await expect(calls()).resolves.toEqual([
			{ tool: "delete_transaction", outcome: "OK", changedRows: 1 },
			{ tool: "get_accounts", outcome: "OK", changedRows: 0 },
		]);
	});

	it("keeps a line whose amount changed since, naming what differs and never its value", async () => {
		const account = await checking();
		const id = await postOwn(account.id, {
			date: "2026-09-10",
			label: "Courses",
			amount: "-120,00",
		});
		await sendOwn("PATCH", `/api/transactions/${id}`, { amount: "-125,00" });
		const tools = await assistants();

		const changed = await tools.write("delete_transaction", {
			id,
			account_id: account.id,
			date: "2026-09-10",
			amount: "-120.00",
		});
		const elsewhere = await tools.write("delete_transaction", {
			id,
			account_id: "another",
			date: "2026-09-11",
			amount: "-125.00",
		});
		const unreadable = await tools.write("delete_transaction", {
			id,
			account_id: account.id,
			date: "2026-09-10",
			amount: "cent",
		});
		const unknown = await tools.write("delete_transaction", {
			id: "nope",
			account_id: account.id,
			date: "2026-09-10",
			amount: "-120.00",
		});

		expect(changed.isError).toBe(true);
		expect(answerOf(changed)).toEqual({
			success: false,
			error: "transaction_changed",
			message: "The transaction changed since it was shown; changed amount",
		});
		expect(errorText(elsewhere)).toContain("; changed account_id,date");
		expect(errorText(unreadable)).toContain("amount invalid_amount");
		expect(errorText(unknown)).toContain('"error":"not_found"');
		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(calls()).resolves.toEqual([
			{ tool: "delete_transaction", outcome: "TRANSACTION_CHANGED", changedRows: 0 },
			{ tool: "delete_transaction", outcome: "TRANSACTION_CHANGED", changedRows: 0 },
			{ tool: "delete_transaction", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "delete_transaction", outcome: "NOT_FOUND", changedRows: 0 },
		]);
	});

	it("refuses a split's line alone, and deletes a split's parent with its lines", async () => {
		const account = await checking();
		const parent = await postOwn(account.id, {
			date: "2026-09-05",
			label: "HYPERMARCHE",
			amount: "-100,00",
		});
		const split = z
			.object({ data: z.object({ children: z.array(z.object({ id: z.string() })) }) })
			.parse(
				await sendOwn("POST", `/api/transactions/${parent}/split`, {
					lines: [
						{ label: "Alimentation", amount: "-60,00", categoryId: null },
						{ label: "Maison", amount: "-40,00", categoryId: null },
					],
				}),
			);
		const [food] = split.data.children;
		const tools = await assistants();

		const line = await tools.write("delete_transaction", {
			id: food?.id,
			account_id: account.id,
			date: "2026-09-05",
			amount: "-60.00",
		});
		const whole = await tools.write("delete_transaction", {
			id: parent,
			account_id: account.id,
			date: "2026-09-05",
			amount: "-100.00",
		});

		expect(errorText(line)).toMatch(/^\{"success":false,"error":"transaction_split"/u);
		expect(deleted.parse(whole.structuredContent).deleted_count).toBe(3);
		await expect(transactionCount(account.id)).resolves.toBe(0);
		await expect(calls()).resolves.toEqual([
			{ tool: "delete_transaction", outcome: "TRANSACTION_SPLIT", changedRows: 0 },
			{ tool: "delete_transaction", outcome: "OK", changedRows: 3 },
		]);
	});

	it("deletes a transfer side with its transfer, the other side a standard transaction again", async () => {
		const account = await checking();
		const livret = await openOwn({ name: "Livret A", subtype: "savings", openingBalance: "0" });
		const outflow = await postOwn(account.id, {
			date: "2026-09-10",
			label: "VIR LIVRET A",
			amount: "-500,00",
		});
		const inflow = await postOwn(livret.id, {
			date: "2026-09-13",
			label: "VIR COMPTE COURANT",
			amount: "500,00",
		});
		const tools = await assistants();
		await expect(tools.read("get_transaction", { id: inflow })).resolves.toMatchObject({
			structuredContent: { transfer: { counterpart_transaction_id: outflow } },
		});

		const result = await tools.write("delete_transaction", {
			id: outflow,
			account_id: account.id,
			date: "2026-09-10",
			amount: "-500.00",
		});

		expect(deleted.parse(result.structuredContent)).toMatchObject({
			transaction: { transfer: { counterpart_transaction_id: inflow } },
			deleted_count: 1,
		});
		await expect(transactionCount(account.id)).resolves.toBe(0);
		await expect(tools.read("get_transaction", { id: inflow })).resolves.toMatchObject({
			structuredContent: { id: inflow, transfer: null },
		});
		await expect(calls()).resolves.toEqual([
			{ tool: "get_transaction", outcome: "OK", changedRows: 0 },
			{ tool: "delete_transaction", outcome: "OK", changedRows: 1 },
			{ tool: "get_transaction", outcome: "OK", changedRows: 0 },
		]);
	});

	it("deletes a bank line that the next sync listing it brings back, as Sure does", async () => {
		const account = await checking();
		const { id, resync } = await bankLine(account.id);
		const tools = await assistants();

		const result = await tools.write("delete_transaction", {
			id,
			account_id: account.id,
			date: "2026-09-12",
			amount: "-32.10",
		});

		expect(deleted.parse(result.structuredContent)).toMatchObject({
			transaction: { id, source: { kind: "bank", connector: "enable-banking" } },
			deleted_count: 1,
		});
		expect(result.structuredContent).not.toHaveProperty("bank_will_not_resend");
		await expect(transactionCount(account.id)).resolves.toBe(0);
		await expect(resync()).resolves.toMatchObject({ created: [expect.any(String)] });
		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(calls()).resolves.toEqual([
			{ tool: "delete_transaction", outcome: "OK", changedRows: 1 },
		]);
	});

	it("is refused to a read-only token, deleting nothing", async () => {
		const account = await checking();
		const id = await postOwn(account.id, {
			date: "2026-09-10",
			label: "Courses",
			amount: "-120,00",
		});
		const tools = await assistants();

		const response = await tools.refused("delete_transaction", {
			id,
			account_id: account.id,
			date: "2026-09-10",
			amount: "-120.00",
		});

		expect(response.status).toBe(403);
		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(calls()).resolves.toEqual([
			{ tool: "delete_transaction", outcome: "INSUFFICIENT_SCOPE", changedRows: 0 },
		]);
	});
});

describe("get_transactions by Sure's names", () => {
	const names = z.object({ transactions: z.array(z.object({ name: z.string() }).loose()) });
	const labelsOf = async (tools: Awaited<ReturnType<typeof assistants>>, args: object) => {
		const result = await tools.read("get_transactions", args);

		expect(result.isError, errorText(result)).toBeUndefined();

		return names
			.parse(result.structuredContent)
			.transactions.map((item) => item.name)
			.toSorted();
	};

	it("filters by exact account, category, merchant and tag names, as Sure's filters do", async () => {
		const account = await checking();
		const savings = await openOwn({ ...pinned, name: "Livret A", subtype: "savings" });
		const food = await ownCategory("Alimentation");
		const bakery = z
			.object({ data: z.object({ id: z.string() }) })
			.parse(await sendOwn("POST", "/api/merchants", { name: "Boulangerie Dupain" })).data.id;
		const holidays = await idOf("Vacances");
		const bread = await postOwn(account.id, { date: "2026-09-10", label: "Pain", amount: "-2,40" });
		const hotel = await postOwn(account.id, {
			date: "2026-09-11",
			label: "Hôtel",
			amount: "-90,00",
		});
		await postOwn(account.id, { date: "2026-09-12", label: "Divers", amount: "-5,00" });
		await postOwn(savings.id, { date: "2026-09-13", label: "Intérêts", amount: "3,00" });
		await sendOwn("PATCH", `/api/transactions/${bread}`, {
			categoryId: food,
			merchantId: bakery,
		});
		await sendOwn("PATCH", `/api/transactions/${hotel}`, { tagIds: [holidays] });
		const tools = await assistants();

		await expect(labelsOf(tools, { accounts: ["Livret A"] })).resolves.toEqual(["Intérêts"]);
		await expect(labelsOf(tools, { categories: ["Alimentation"] })).resolves.toEqual(["Pain"]);
		await expect(labelsOf(tools, { merchants: ["Boulangerie Dupain"] })).resolves.toEqual(["Pain"]);
		await expect(labelsOf(tools, { tags: ["Vacances"] })).resolves.toEqual(["Hôtel"]);
		// Sure's sentinel and the name Archant shows both stand for uncategorised.
		await expect(
			labelsOf(tools, { accounts: ["Compte courant"], categories: ["Uncategorized"] }),
		).resolves.toEqual(["Divers", "Hôtel"]);
		await expect(labelsOf(tools, { categories: ["Sans catégorie"] })).resolves.toEqual([
			"Divers",
			"Hôtel",
			"Intérêts",
		]);
	});

	it("matches nothing for a name nothing holds, and narrows an id filter by a name", async () => {
		const account = await checking();
		const savings = await openOwn({ ...pinned, name: "Livret A", subtype: "savings" });
		await postOwn(account.id, { date: "2026-09-10", label: "Pain", amount: "-2,40" });
		await postOwn(savings.id, { date: "2026-09-13", label: "Intérêts", amount: "3,00" });
		const tools = await assistants();

		await expect(labelsOf(tools, { accounts: ["Compte joint"] })).resolves.toEqual([]);
		await expect(labelsOf(tools, { categories: ["alimentation"] })).resolves.toEqual([]);
		await expect(
			labelsOf(tools, { account_ids: [account.id, savings.id], accounts: ["Livret A"] }),
		).resolves.toEqual(["Intérêts"]);
		await expect(
			labelsOf(tools, { account_ids: [account.id], accounts: ["Livret A"] }),
		).resolves.toEqual([]);
	});

	it("groups by label under the same names, and keeps the bulk filter to ids", async () => {
		const account = await checking();
		const food = await ownCategory("Alimentation");
		const bread = await postOwn(account.id, { date: "2026-09-10", label: "Pain", amount: "-2,40" });
		await postOwn(account.id, { date: "2026-09-11", label: "Divers", amount: "-5,00" });
		await sendOwn("PATCH", `/api/transactions/${bread}`, { categoryId: food });
		const tools = await assistants();

		const grouped = await tools.read("group_transactions_by_label", {
			categories: ["Alimentation"],
		});
		const bulk = await tools.write("bulk_update_transactions", {
			filter: { accounts: ["Compte courant"] },
			expected_count: 2,
			patch: { excluded: true },
		});

		expect(grouped.structuredContent).toMatchObject({
			groups: [{ label: "Pain", categories: [{ id: food, name: "Alimentation" }] }],
			group_count: 1,
		});
		expect(errorText(bulk)).toContain("filter.accounts unrecognized_keys");
	});
});

describe("get_transactions sorted and filtered as Sure's", () => {
	const listed = z.object({
		transactions: z.array(z.object({ name: z.string(), pending: z.boolean() }).loose()),
		total_results: z.number(),
	});

	/**
	 * Six booked lines and one the bank has not booked yet, on 2026-09-15:
	 * three of them within a cent of 12,50.
	 */
	async function household() {
		const account = await checking();
		const lines: [string, string, string][] = [
			["2026-09-01", "LOYER", "-800,00"],
			["2026-09-05", "SALAIRE", "2 500,00"],
			["2026-09-10", "CAFE", "-3,50"],
			["2026-09-12", "COURSES", "-12,50"],
			["2026-09-13", "COURSES BIS", "-12,51"],
			["2026-09-14", "REMBOURSEMENT", "12,49"],
		];

		await lines.reduce(async (previous, [date, label, amount]) => {
			await previous;
			await postOwn(account.id, { date, label, amount });
		}, Promise.resolve());

		const connectionId = crypto.randomUUID();
		await db.insert(bankConnections).values({
			id: connectionId,
			connector: "enable-banking",
			institutionName: "Banque Test",
			country: "FR",
			status: "active",
			createdAt: 0,
			updatedAt: 0,
		});
		await ingest(
			{ db, timeZone: "Europe/Paris" },
			account.id,
			{
				transactions: [
					{
						externalId: "EB-PENDING",
						date: "2026-09-15",
						amount: toMinorUnits(-4_000),
						currency: "EUR",
						label: "CB EN ATTENTE",
						reference: null,
						notes: null,
						pending: true,
					},
				],
				balance: null,
				rejected: [],
			},
			{ connectionId, missesFrom: null },
			{ origin: "sync" },
		);

		const tools = await assistants();

		return async (args: object) => {
			const result = await tools.read("get_transactions", args);

			expect(result.isError, errorText(result)).toBeUndefined();

			const page = listed.parse(result.structuredContent);

			return { names: page.transactions.map((item) => item.name), total: page.total_results };
		};
	}

	it("orders by date either way, and by absolute amount, ties by date, as Sure's", async () => {
		const list = await household();

		const newest = await list({});
		const oldest = await list({ order: "asc" });
		const largest = await list({ sort_by: "amount" });
		const smallest = await list({ sort_by: "amount", order: "asc" });

		expect(newest.names).toEqual([
			"CB EN ATTENTE",
			"REMBOURSEMENT",
			"COURSES BIS",
			"COURSES",
			"CAFE",
			"SALAIRE",
			"LOYER",
		]);
		expect(oldest.names).toEqual(newest.names.toReversed());
		expect(largest.names).toEqual([
			"SALAIRE",
			"LOYER",
			"CB EN ATTENTE",
			"COURSES BIS",
			"COURSES",
			"REMBOURSEMENT",
			"CAFE",
		]);
		expect(smallest.names).toEqual(largest.names.toReversed());
	});

	it("compares the absolute amount as Sure's amount_operator does, within a cent for equal", async () => {
		const list = await household();

		const equal = await list({ amount: "12.50", amount_operator: "equal" });
		const signed = await list({ amount: "-12,50", amount_operator: "equal" });
		const less = await list({ amount: "12.50", amount_operator: "less" });
		const greater = await list({ amount: "12.50", amount_operator: "greater" });
		const bounded = await list({ amount: "12.50", amount_operator: "greater", amount_max: "100" });

		expect(equal.names.toSorted()).toEqual(["COURSES", "COURSES BIS", "REMBOURSEMENT"]);
		expect(equal.total).toBe(3);
		expect(signed.names).toEqual(equal.names);
		expect(less.names.toSorted()).toEqual(["CAFE", "REMBOURSEMENT"]);
		expect(greater.names.toSorted()).toEqual(["CB EN ATTENTE", "COURSES BIS", "LOYER", "SALAIRE"]);
		expect(bounded.names.toSorted()).toEqual(["CB EN ATTENTE", "COURSES BIS"]);
	});

	it("keeps pending or confirmed lines by Sure's statuses, both meaning every line", async () => {
		const list = await household();

		const pending = await list({ statuses: ["pending"] });
		const confirmed = await list({ statuses: ["confirmed"] });
		const both = await list({ statuses: ["confirmed", "pending"] });
		const largestBooked = await list({ statuses: ["confirmed"], sort_by: "amount", page_size: 2 });

		expect(pending).toEqual({ names: ["CB EN ATTENTE"], total: 1 });
		expect(confirmed.total).toBe(6);
		expect(confirmed.names).not.toContain("CB EN ATTENTE");
		expect(both.total).toBe(7);
		expect(largestBooked).toEqual({ names: ["SALAIRE", "LOYER"], total: 6 });
	});

	it("refuses an amount without its operator, an operator without its amount, and a bad amount", async () => {
		await checking();
		const tools = await assistants();

		const alone = await tools.read("get_transactions", { amount: "12.50" });
		const operator = await tools.read("get_transactions", { amount_operator: "less" });
		const bad = await tools.read("get_transactions", { amount: "douze", amount_operator: "less" });
		const status = await tools.read("get_transactions", { statuses: ["booked"] });

		expect(errorText(alone)).toContain("amount_operator required");
		expect(errorText(operator)).toContain("amount required");
		expect(errorText(bad)).toContain("amount invalid_amount");
		expect(errorText(status)).toContain("statuses.0 ");
	});
});
