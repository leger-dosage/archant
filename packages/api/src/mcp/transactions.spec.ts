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

/** Sure's `create_transaction` answer, read as the line with its flag and message. */
const created = z
	.strictObject({
		success: z.literal(true),
		created: z.boolean(),
		transaction: z.strictObject({
			id: z.string(),
			entry_id: z.string(),
			name: z.string(),
			date: z.string(),
			amount: z.string(),
			amount_formatted: z.string(),
			currency: z.string(),
			type: z.enum(["income", "expense"]),
			notes: z.string().nullable(),
			category: ref.nullable(),
			merchant: ref.nullable(),
			tags: z.array(ref),
		}),
		message: z.string(),
	})
	.transform(({ created: flag, transaction, message }) => ({
		...transaction,
		created: flag,
		message,
	}));

/** Sure's keys for each answer, in Sure's order. */
const ITEM_KEYS = [
	"id",
	"name",
	"date",
	"amount",
	"currency",
	"formatted_amount",
	"classification",
	"account",
	"notes",
	"category",
	"merchant",
	"tags",
	"is_transfer",
];
const CREATED_KEYS = [
	"id",
	"entry_id",
	"name",
	"date",
	"amount",
	"amount_formatted",
	"currency",
	"type",
	"notes",
	"category",
	"merchant",
	"tags",
];
const DELETED_KEYS = [
	"id",
	"entry_id",
	"account_id",
	"name",
	"date",
	"amount",
	"amount_formatted",
	"currency",
	"type",
];

const record = z.record(z.string(), z.unknown());

/** The keys of an object of an answer, in their order. */
const keysOf = (value: unknown) => Object.keys(record.parse(value));

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

/** The account's ledger amounts, in minor units, most recent first. */
async function ledgerAmounts(accountId: string) {
	const page = await sendOwn("GET", `/api/accounts/${accountId}/transactions`);

	return z
		.object({ data: z.object({ items: z.array(z.object({ amount: z.number() })) }) })
		.parse(page)
		.data.items.map((item) => item.amount);
}

async function merchantId(name: string) {
	const merchant = await sendOwn("POST", "/api/merchants", { name });

	return z.object({ data: z.object({ id: z.string() }) }).parse(merchant).data.id;
}

/** Sure's `error(key, message)` answer. */
const sure = (error: string, message: string) => ({ success: false, error, message });

describe("create_transaction", () => {
	it("records a line as the sheet does, in Sure's sign, the rule matching its label setting its category", async () => {
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
			amount: "23.40",
			notes: "Espèces",
		});

		expect(result.isError, errorText(result)).toBeUndefined();
		expect(keysOf(result.structuredContent)).toEqual([
			"success",
			"created",
			"transaction",
			"message",
		]);
		expect(keysOf(result.structuredContent?.transaction)).toEqual(CREATED_KEYS);
		const line = created.parse(result.structuredContent);
		expect(line).toEqual({
			id: line.id,
			entry_id: line.id,
			name: "Marché du samedi",
			date: "2026-09-19",
			amount: "23.4",
			amount_formatted: "23,40 €",
			currency: "EUR",
			type: "expense",
			notes: "Espèces",
			category: { id: market, name: "Marché" },
			merchant: null,
			tags: [],
			created: true,
			message: "Created Marché du samedi (23,40 € on 2026-09-19).",
		});
		await expect(ledgerAmounts(account.id)).resolves.toEqual([-2340]);
		await expect(balanceOf(tools, account.id)).resolves.toBe("1476.6");
		await expect(calls()).resolves.toEqual([
			{ tool: "create_transaction", outcome: "OK", changedRows: 1 },
			{ tool: "get_accounts", outcome: "OK", changedRows: 0 },
		]);
	});

	it("sets and locks the category, merchant and tags it is given, which the matching rule leaves alone", async () => {
		const account = await checking();
		const market = await ownCategory("Marché");
		const gifts = await ownCategory("Cadeaux");
		const florist = await merchantId("Fleuriste");
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
			amount: 30,
			category_id: gifts,
			merchant_id: florist,
			tag_ids: [birthday, birthday],
		});

		const line = created.parse(result.structuredContent);
		expect(line).toMatchObject({
			category: { id: gifts, name: "Cadeaux" },
			merchant: { id: florist, name: "Fleuriste" },
			tags: [{ id: birthday, name: "Anniversaire" }],
		});
		// Locked as an edit by the owner: applying the rule leaves it alone too.
		await sendOwn("POST", "/api/rules/apply", {});
		await expect(tools.read("get_transaction", { id: line.id })).resolves.toMatchObject({
			structuredContent: { category: "Cadeaux" },
		});
	});

	it("accepts the account's currency in any case, and a blank one as the account's, as Sure", async () => {
		const account = await checking();
		const tools = await assistants();

		const lower = await tools.write("create_transaction", {
			account_id: account.id,
			date: "2026-09-18",
			name: "Boulangerie",
			amount: "1.00",
			currency: "eur",
		});
		const blank = await tools.write("create_transaction", {
			account_id: account.id,
			date: "2026-09-18",
			name: "Boulangerie",
			amount: "1.00",
			currency: " ",
		});

		expect(created.parse(lower.structuredContent).currency).toBe("EUR");
		expect(created.parse(blank.structuredContent).currency).toBe("EUR");
	});

	it("reads a number or a decimal string in Sure's sign, positive money out, type deciding the sign when given", async () => {
		const account = await checking();
		const tools = await assistants();
		const line = async (args: Record<string, unknown>) =>
			created.parse(
				(
					await tools.write("create_transaction", {
						account_id: account.id,
						date: "2026-09-18",
						name: "Ligne",
						...args,
					})
				).structuredContent,
			);

		const expense = await line({ amount: 12.5 });
		expect(await ledgerAmounts(account.id)).toEqual([-1250]);
		const income = await line({ amount: 12.5, type: "income" });
		const outflow = await line({ amount: "-8.00", type: "outflow" });
		const inflow = await line({ amount: "-3", type: "inflow" });
		const refund = await line({ amount: "-20.10" });

		expect(expense).toMatchObject({
			amount: "12.5",
			amount_formatted: "12,50 €",
			type: "expense",
		});
		expect(income).toMatchObject({
			amount: "-12.5",
			amount_formatted: "-12,50 €",
			type: "income",
		});
		expect(outflow).toMatchObject({ amount: "8.0", type: "expense" });
		expect(inflow).toMatchObject({ amount: "-3.0", type: "income" });
		expect(refund).toMatchObject({ amount: "-20.1", type: "income" });
		expect((await ledgerAmounts(account.id)).toSorted((a, b) => a - b)).toEqual([
			-1250, -800, 300, 1250, 2010,
		]);
	});

	it("takes Sure's call as it is, user_modified included, which changes nothing", async () => {
		const account = await checking();
		const tools = await assistants();

		const result = await tools.write("create_transaction", {
			account_id: account.id,
			date: "2026-09-18",
			name: "Roche",
			amount: 2194.15,
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
			amount: "2194.15",
			created: true,
		});
		expect(created.parse(plain.structuredContent)).toMatchObject({ amount: "2194.15" });
		expect(await calls()).toEqual([
			{ tool: "create_transaction", outcome: "OK", changedRows: 1 },
			{ tool: "create_transaction", outcome: "OK", changedRows: 1 },
		]);
	});

	it("refuses each field with Sure's key and message, writing nothing", async () => {
		const account = await checking();
		const tools = await assistants();
		const line = {
			account_id: account.id,
			date: "2026-09-18",
			name: "Boulangerie",
			amount: "1.00",
		};
		const refusal = async (args: Record<string, unknown>) =>
			answerOf(await tools.write("create_transaction", { ...line, ...args }));

		await expect(refusal({ account_id: "nope" })).resolves.toEqual(
			sure("account_not_found", "No account found with that ID that this user can write to."),
		);
		await expect(refusal({ date: "18/09/2026", amount: "douze" })).resolves.toEqual(
			sure("invalid_date", "date must be an ISO 8601 date (YYYY-MM-DD)."),
		);
		await expect(refusal({ date: undefined })).resolves.toEqual(
			sure("invalid_date", "date must be an ISO 8601 date (YYYY-MM-DD)."),
		);
		await expect(refusal({ amount: "douze", name: " " })).resolves.toEqual(
			sure("invalid_amount", "amount must be a number."),
		);
		await expect(refusal({ amount: undefined })).resolves.toEqual(
			sure("invalid_amount", "amount must be a number."),
		);
		// A cent's fraction the account's currency cannot hold.
		await expect(refusal({ amount: "12.345" })).resolves.toEqual(
			sure("invalid_amount", "amount must be a number."),
		);
		await expect(refusal({ name: " " })).resolves.toEqual(
			sure("invalid_name", "name is required."),
		);
		await expect(refusal({ name: undefined })).resolves.toEqual(
			sure("invalid_name", "name is required."),
		);
		await expect(refusal({ currency: "ABC" })).resolves.toEqual(
			sure("invalid_currency", "currency must be a valid ISO 4217 code."),
		);
		await expect(refusal({ currency: "USD" })).resolves.toEqual(
			sure("invalid_currency", "currency must be the account's currency, EUR."),
		);
		await expect(refusal({ category_id: "nope" })).resolves.toEqual(
			sure("invalid_category", "category_id does not belong to the user's family."),
		);
		await expect(refusal({ merchant_id: "nope" })).resolves.toEqual(
			sure("invalid_merchant", "merchant_id is not available to the user's family."),
		);
		await expect(refusal({ tag_ids: ["nope"] })).resolves.toEqual(
			sure("invalid_tags", "One or more tag_ids do not belong to the user's family."),
		);
		// The sheet's own checks keep the generic shape.
		await expect(refusal({ date: "2026-01-10" })).resolves.toEqual(
			sure("validation_error", "The request is invalid; date not_after_opening_date"),
		);
		await expect(refusal({ external_id: "row-1", source: "csv:2026" })).resolves.toMatchObject({
			error: "source invalid_format",
		});
		await expect(transactionCount(account.id)).resolves.toBe(0);
		expect((await calls()).map((call) => call.outcome)).toEqual([
			"NOT_FOUND",
			...Array.from({ length: 14 }, () => "VALIDATION_ERROR"),
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
			amount: "45.00",
			external_id: "row-4",
		};

		const first = created.parse((await tools.write("create_transaction", line)).structuredContent);
		const again = created.parse(
			(await tools.write("create_transaction", { ...line, amount: "99.00" })).structuredContent,
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
		expect(again).toEqual({
			...first,
			created: false,
			message: "Transaction already exists for this external_id; returned the existing one.",
		});
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
			amount: "45.00",
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
			amount: "1.00",
		});

		expect(response.status).toBe(403);
		await expect(transactionCount(account.id)).resolves.toBe(0);
		await expect(calls()).resolves.toEqual([
			{ tool: "create_transaction", outcome: "INSUFFICIENT_SCOPE", changedRows: 0 },
		]);
	});
});

describe("delete_transaction", () => {
	it("deletes the line whose values still match, its amount in Sure's sign, moving the balance back", async () => {
		const account = await checking();
		const id = await postOwn(account.id, {
			date: "2026-09-10",
			label: "Courses",
			amount: "-12,50",
		});
		const tools = await assistants();

		const result = await tools.write("delete_transaction", {
			id,
			account_id: account.id,
			date: "2026-09-10",
			amount: "12.50",
		});

		expect(result.isError, errorText(result)).toBeUndefined();
		expect(keysOf(result.structuredContent)).toEqual([
			"success",
			"deleted",
			"transaction",
			"message",
		]);
		expect(keysOf(result.structuredContent?.transaction)).toEqual(DELETED_KEYS);
		expect(result.structuredContent).toEqual({
			success: true,
			deleted: true,
			transaction: {
				id,
				entry_id: id,
				account_id: account.id,
				name: "Courses",
				date: "2026-09-10",
				amount: "12.5",
				amount_formatted: "12,50 €",
				currency: "EUR",
				type: "expense",
			},
			message: "Deleted Courses (12,50 € on 2026-09-10).",
		});
		await expect(transactionCount(account.id)).resolves.toBe(0);
		await expect(balanceOf(tools, account.id)).resolves.toBe("1500.0");
		await expect(calls()).resolves.toEqual([
			{ tool: "delete_transaction", outcome: "OK", changedRows: 1 },
			{ tool: "get_accounts", outcome: "OK", changedRows: 0 },
		]);
	});

	it("refuses an amount it cannot read, such as a French comma, deleting nothing", async () => {
		const account = await checking();
		const income = await postOwn(account.id, {
			date: "2026-09-10",
			label: "Remboursement",
			amount: "12,50",
		});
		const tools = await assistants();

		const result = await tools.write("delete_transaction", {
			id: income,
			account_id: account.id,
			date: "2026-09-10",
			amount: "12,50",
		});

		expect(answerOf(result)).toEqual(sure("invalid_amount", "amount must be a number."));
		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(calls()).resolves.toEqual([
			{ tool: "delete_transaction", outcome: "VALIDATION_ERROR", changedRows: 0 },
		]);
	});

	it("deletes an income from its amount negated, as a decimal string", async () => {
		const account = await checking();
		const id = await postOwn(account.id, {
			date: "2026-09-10",
			label: "Remboursement",
			amount: "12,50",
		});
		const tools = await assistants();

		const result = await tools.write("delete_transaction", {
			id,
			account_id: account.id,
			date: "2026-09-10",
			amount: "-12.50",
		});

		expect(result.structuredContent).toMatchObject({
			transaction: { amount: "-12.5", type: "income" },
		});
		await expect(transactionCount(account.id)).resolves.toBe(0);
	});

	it("deletes an income from its amount negated, a number as well as a string", async () => {
		const account = await checking();
		const id = await postOwn(account.id, {
			date: "2026-09-10",
			label: "Remboursement",
			amount: "12,50",
		});
		const tools = await assistants();

		const result = await tools.write("delete_transaction", {
			id,
			account_id: account.id,
			date: "2026-09-10",
			amount: -12.5,
		});

		expect(result.structuredContent).toMatchObject({
			transaction: { amount: "-12.5", amount_formatted: "-12,50 €", type: "income" },
			message: "Deleted Remboursement (-12,50 € on 2026-09-10).",
		});
		await expect(transactionCount(account.id)).resolves.toBe(0);
	});

	it("keeps a line whose amount or sign changed since, naming what differs and never its value", async () => {
		const account = await checking();
		const id = await postOwn(account.id, {
			date: "2026-09-10",
			label: "Courses",
			amount: "-12,50",
		});
		const tools = await assistants();

		const sign = await tools.write("delete_transaction", {
			id,
			account_id: account.id,
			date: "2026-09-10",
			amount: "-12.50",
		});
		await sendOwn("PATCH", `/api/transactions/${id}`, { amount: "-125,00" });
		const changed = await tools.write("delete_transaction", {
			id,
			account_id: account.id,
			date: "2026-09-10",
			amount: "12.50",
		});
		const elsewhere = await tools.write("delete_transaction", {
			id,
			account_id: "another",
			date: "2026-09-11",
			amount: "125.00",
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
			amount: "125.00",
		});

		expect(answerOf(sign)).toEqual({
			success: false,
			error: "transaction_changed",
			message: "The transaction changed since it was shown; changed amount",
		});
		expect(changed.isError).toBe(true);
		expect(answerOf(changed)).toEqual(answerOf(sign));
		expect(errorText(elsewhere)).toContain("; changed account_id,date");
		expect(answerOf(unreadable)).toEqual(sure("invalid_amount", "amount must be a number."));
		expect(answerOf(unknown)).toEqual({
			success: false,
			error: "not_found",
			message: "No transaction with id 'nope' in an account you can write to.",
		});
		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(calls()).resolves.toEqual([
			{ tool: "delete_transaction", outcome: "TRANSACTION_CHANGED", changedRows: 0 },
			{ tool: "delete_transaction", outcome: "TRANSACTION_CHANGED", changedRows: 0 },
			{ tool: "delete_transaction", outcome: "TRANSACTION_CHANGED", changedRows: 0 },
			{ tool: "delete_transaction", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "delete_transaction", outcome: "NOT_FOUND", changedRows: 0 },
		]);
	});

	it("refuses a split's line alone as Sure's split_child, and deletes a split's parent with its lines", async () => {
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
			amount: "60.00",
		});
		const whole = await tools.write("delete_transaction", {
			id: parent,
			account_id: account.id,
			date: "2026-09-05",
			amount: "100.00",
		});

		expect(answerOf(line)).toEqual({
			success: false,
			error: "split_child",
			message:
				"Split child transactions cannot be deleted individually. Delete the split parent instead.",
		});
		expect(whole.structuredContent).toMatchObject({ deleted: true, transaction: { id: parent } });
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
			structuredContent: { is_transfer: true, transfer: { counterpart_transaction_id: outflow } },
		});

		const result = await tools.write("delete_transaction", {
			id: outflow,
			account_id: account.id,
			date: "2026-09-10",
			amount: "500.00",
		});

		expect(result.structuredContent).toMatchObject({ transaction: { id: outflow } });
		await expect(transactionCount(account.id)).resolves.toBe(0);
		await expect(tools.read("get_transaction", { id: inflow })).resolves.toMatchObject({
			structuredContent: { id: inflow, is_transfer: false, transfer: null },
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
		await expect(tools.read("get_transaction", { id })).resolves.toMatchObject({
			structuredContent: { source: { kind: "bank", connector: "enable-banking" } },
		});

		const result = await tools.write("delete_transaction", {
			id,
			account_id: account.id,
			date: "2026-09-12",
			amount: "32.10",
		});

		expect(result.structuredContent).toMatchObject({ deleted: true, transaction: { id } });
		expect(result.structuredContent).not.toHaveProperty("bank_will_not_resend");
		await expect(transactionCount(account.id)).resolves.toBe(0);
		await expect(resync()).resolves.toMatchObject({ created: [expect.any(String)] });
		await expect(transactionCount(account.id)).resolves.toBe(1);
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
			amount: "120.00",
		});

		expect(response.status).toBe(403);
		await expect(transactionCount(account.id)).resolves.toBe(1);
		await expect(calls()).resolves.toEqual([
			{ tool: "delete_transaction", outcome: "INSUFFICIENT_SCOPE", changedRows: 0 },
		]);
	});
});

describe("get_transactions and get_transaction in Sure's fields", () => {
	it("lists each line as Sure's, its amount positive, its references by name, with Sure's totals", async () => {
		const account = await checking();
		const dollars = await openOwn({ ...pinned, name: "Dollars", currency: "USD" });
		const food = await ownCategory("Alimentation");
		const bakery = await merchantId("Boulangerie Dupain");
		const holidays = await idOf("Vacances");
		const bread = await postOwn(account.id, {
			date: "2026-09-10",
			label: "Pain",
			amount: "-12,50",
		});
		await postOwn(account.id, { date: "2026-09-11", label: "Salaire", amount: "2 000,00" });
		await postOwn(dollars.id, { date: "2026-09-12", label: "Hotel", amount: "-80,00" });
		await sendOwn("PATCH", `/api/transactions/${bread}`, {
			categoryId: food,
			merchantId: bakery,
			tagIds: [holidays],
			notes: "Croissants",
		});
		const tools = await assistants();

		const result = await tools.read("get_transactions", { order: "asc" });

		expect(result.isError, errorText(result)).toBeUndefined();
		expect(keysOf(result.structuredContent)).toEqual([
			"transactions",
			"total_results",
			"page",
			"page_size",
			"total_pages",
			"total_income",
			"total_expenses",
		]);
		const page = z
			.object({ transactions: z.array(record) })
			.loose()
			.parse(result.structuredContent);
		expect(page.transactions.map(keysOf)).toEqual([ITEM_KEYS, ITEM_KEYS, ITEM_KEYS]);
		expect(page).toEqual({
			transactions: [
				{
					id: bread,
					name: "Pain",
					date: "2026-09-10",
					amount: "12.5",
					currency: "EUR",
					formatted_amount: "12,50 €",
					classification: "expense",
					account: "Compte courant",
					notes: "Croissants",
					category: "Alimentation",
					merchant: "Boulangerie Dupain",
					tags: ["Vacances"],
					is_transfer: false,
				},
				expect.objectContaining({
					name: "Salaire",
					amount: "2000.0",
					formatted_amount: "2 000,00 €",
					classification: "income",
					category: null,
					merchant: null,
					tags: [],
				}),
				expect.objectContaining({
					name: "Hotel",
					amount: "80.0",
					currency: "USD",
					formatted_amount: "80,00 $",
					account: "Dollars",
				}),
			],
			total_results: 3,
			page: 1,
			page_size: 50,
			total_pages: 1,
			// The dollar line is left out until exchange rates exist (AD-6).
			total_income: "2 000,00 €",
			total_expenses: "12,50 €",
		});
	});

	it("gives a transaction in full: the item, its account id, exclusion, source and transfer with its status", async () => {
		const account = await checking();
		const livret = await openOwn({ name: "Livret A", subtype: "savings", openingBalance: "0" });
		const outflow = await postOwn(account.id, {
			date: "2026-09-10",
			label: "VIR LIVRET A",
			amount: "-500,00",
		});
		const inflow = await postOwn(livret.id, {
			date: "2026-09-10",
			label: "VIR COMPTE COURANT",
			amount: "500,00",
		});
		const tools = await assistants();

		const result = await tools.read("get_transaction", { id: outflow });
		const { transfer } = z
			.object({ transfer: z.object({ id: z.string() }) })
			.parse(result.structuredContent);

		expect(keysOf(result.structuredContent)).toEqual([
			...ITEM_KEYS,
			"account_id",
			"excluded",
			"source",
			"transfer",
		]);
		expect(result.structuredContent).toEqual({
			id: outflow,
			name: "VIR LIVRET A",
			date: "2026-09-10",
			amount: "500.0",
			currency: "EUR",
			formatted_amount: "500,00 €",
			classification: "expense",
			account: "Compte courant",
			notes: null,
			category: null,
			merchant: null,
			tags: [],
			is_transfer: true,
			account_id: account.id,
			excluded: false,
			source: { kind: "manual" },
			transfer: {
				id: transfer.id,
				kind: "internal_move",
				status: "pending",
				counterpart_transaction_id: inflow,
				counterpart_account: { id: livret.id, name: "Livret A" },
			},
		});
	});
});

describe("update_transaction in Sure's fields", () => {
	it("answers the line as Sure's, its references as { id, name }, with Sure's message", async () => {
		const account = await checking();
		const food = await ownCategory("Alimentation");
		const bakery = await merchantId("Boulangerie Dupain");
		const holidays = await idOf("Vacances");
		const id = await postOwn(account.id, { date: "2026-09-10", label: "Pain", amount: "-2,40" });
		const tools = await assistants();

		const result = await tools.write("update_transaction", {
			id,
			name: "Pain de campagne",
			notes: "Samedi",
			category_id: food,
			merchant_id: bakery,
			tag_ids: [holidays],
		});

		expect(keysOf(result.structuredContent)).toEqual(["success", "transaction", "message"]);
		expect(result.structuredContent).toEqual({
			success: true,
			transaction: {
				id,
				name: "Pain de campagne",
				date: "2026-09-10",
				notes: "Samedi",
				category: { id: food, name: "Alimentation" },
				merchant: { id: bakery, name: "Boulangerie Dupain" },
				tags: [{ id: holidays, name: "Vacances" }],
			},
			message: "Transaction 'Pain de campagne' updated.",
		});
		expect(keysOf(result.structuredContent?.transaction)).toEqual([
			"id",
			"name",
			"date",
			"notes",
			"category",
			"merchant",
			"tags",
		]);
	});

	it("refuses with Sure's keys: an unknown id, no field, and ids naming nothing, writing nothing", async () => {
		const account = await checking();
		const id = await postOwn(account.id, { date: "2026-09-10", label: "Pain", amount: "-2,40" });
		const tools = await assistants();
		const refusal = async (args: Record<string, unknown>) =>
			answerOf(await tools.write("update_transaction", args));

		await expect(refusal({ id: "nope" })).resolves.toEqual({
			success: false,
			error: "not_found",
			message: "Transaction with id 'nope' not found.",
		});
		await expect(refusal({ id: "nope", notes: "x" })).resolves.toMatchObject({
			error: "not_found",
		});
		await expect(refusal({ id })).resolves.toEqual({
			success: false,
			error: "no_changes",
			message: "Provide at least one field to update.",
		});
		await expect(refusal({ id, category_id: "nope" })).resolves.toEqual({
			success: false,
			error: "invalid_category",
			message: "category_id does not belong to the user's family.",
		});
		await expect(refusal({ id, merchant_id: "nope" })).resolves.toMatchObject({
			error: "invalid_merchant",
		});
		await expect(refusal({ id, tag_ids: ["nope"] })).resolves.toMatchObject({
			error: "invalid_tags",
		});
		await expect(calls()).resolves.toEqual([
			{ tool: "update_transaction", outcome: "NOT_FOUND", changedRows: 0 },
			{ tool: "update_transaction", outcome: "NOT_FOUND", changedRows: 0 },
			{ tool: "update_transaction", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "update_transaction", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "update_transaction", outcome: "VALIDATION_ERROR", changedRows: 0 },
			{ tool: "update_transaction", outcome: "VALIDATION_ERROR", changedRows: 0 },
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
		transactions: z.array(z.object({ name: z.string() }).loose()),
		total_results: z.number(),
		page: z.number(),
		page_size: z.number(),
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
						notes: "à vérifier",
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

			return {
				names: page.transactions.map((item) => item.name),
				total: page.total_results,
				page: page.page,
				pageSize: page.page_size,
			};
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

	it("compares the absolute amount as Sure's amount_operator does, reading amount as Ruby's to_f", async () => {
		const list = await household();

		const equal = await list({ amount: "12.50", amount_operator: "equal" });
		const signed = await list({ amount: "-12.50", amount_operator: "equal" });
		const number = await list({ amount: 12.5, amount_operator: "equal" });
		// `to_f` stops at the comma: "12,50" reads 12, within a cent of none.
		const comma = await list({ amount: "12,50", amount_operator: "equal" });
		const less = await list({ amount: "12.50", amount_operator: "less" });
		const greater = await list({ amount: "12.50", amount_operator: "greater" });
		const word = await list({ amount: "douze", amount_operator: "greater" });

		expect(equal.names.toSorted()).toEqual(["COURSES", "COURSES BIS", "REMBOURSEMENT"]);
		expect(equal.total).toBe(3);
		expect(signed.names).toEqual(equal.names);
		expect(number.names).toEqual(equal.names);
		expect(comma).toMatchObject({ names: [], total: 0 });
		expect(less.names.toSorted()).toEqual(["CAFE", "REMBOURSEMENT"]);
		expect(greater.names.toSorted()).toEqual(["CB EN ATTENTE", "COURSES BIS", "LOYER", "SALAIRE"]);
		expect(word.total).toBe(7);
	});

	it("ignores an amount without its operator, an operator without its amount, and a blank amount", async () => {
		const list = await household();

		await expect(list({ amount: "12.50" })).resolves.toMatchObject({ total: 7 });
		await expect(list({ amount_operator: "less" })).resolves.toMatchObject({ total: 7 });
		await expect(list({ amount: " ", amount_operator: "less" })).resolves.toMatchObject({
			total: 7,
		});
	});

	it("keeps pending or confirmed lines by Sure's statuses, both meaning every line", async () => {
		const list = await household();

		const pending = await list({ statuses: ["pending"] });
		const confirmed = await list({ statuses: ["confirmed"] });
		const both = await list({ statuses: ["confirmed", "pending"] });
		const largestBooked = await list({ statuses: ["confirmed"], sort_by: "amount", page_size: 2 });

		expect(pending).toMatchObject({ names: ["CB EN ATTENTE"], total: 1 });
		expect(confirmed.total).toBe(6);
		expect(confirmed.names).not.toContain("CB EN ATTENTE");
		expect(both.total).toBe(7);
		expect(largestBooked).toMatchObject({ names: ["SALAIRE", "LOYER"], total: 6 });
	});

	it("filters by types, search and dates, as Sure's", async () => {
		const list = await household();

		const income = await list({ types: ["income"] });
		const searched = await list({ search: "courses" });
		const notes = await list({ search: "vérifier" });
		const dated = await list({ start_date: "2026-09-10", end_date: "2026-09-12" });

		expect(income.names.toSorted()).toEqual(["REMBOURSEMENT", "SALAIRE"]);
		expect(searched.names.toSorted()).toEqual(["COURSES", "COURSES BIS"]);
		expect(notes.names).toEqual(["CB EN ATTENTE"]);
		expect(dated.names).toEqual(["COURSES", "CAFE"]);
	});

	it("clamps the page and its size as Sure's, and refuses a status or a filter Sure lacks", async () => {
		const list = await household();
		const tools = await assistants();

		await expect(list({ page_size: 500, page: 0 })).resolves.toMatchObject({
			page: 1,
			pageSize: 100,
			total: 7,
		});
		await expect(list({ page_size: 2, page: "2" })).resolves.toMatchObject({
			names: ["COURSES BIS", "COURSES"],
			page: 2,
			pageSize: 2,
		});
		const status = await tools.read("get_transactions", { statuses: ["booked"] });
		const bounds = await tools.read("get_transactions", {
			amount_min: "1",
			category_ids: ["none"],
		});

		expect(errorText(status)).toContain("statuses.0 ");
		expect(errorText(bounds)).toContain("unrecognized_keys");
	});
});
