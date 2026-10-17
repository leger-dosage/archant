import type { TempDatabase } from "../testing/temp-database.ts";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { assistantCalls } from "@archant/data/schema/assistant-calls";
import { bankAccounts } from "@archant/data/schema/bank-accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";

import { createLogger } from "../lib/logger.ts";
import {
	mortgage,
	openOwn,
	ownDatabase,
	pinned,
	postOwn,
	sendOwn,
	template,
	useSignedInApp,
} from "../testing/app.ts";
import { READ_WRITE, callTool, connect, registerClient } from "../testing/assistant.ts";
import { buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

// Story 27.17. The clock stands at 2026-09-21; each test has a household of
// its own, through `ownDatabase`.

let db: TempDatabase["db"];

/** The matrix's account: opened on 2026-01-10 at 1 500,00, with −120,00 on 2026-01-15. */
async function savings() {
	db = (await ownDatabase()).db;
	const account = await openOwn({ ...pinned, name: "Livret" });
	await postOwn(account.id, { date: "2026-01-15", label: "Retrait", amount: "-120,00" });

	return account;
}

/** A read-write assistant of the household, its calls recorded from here. */
async function assistant() {
	const auth = createTestAuth(db);
	const app = buildTestApp(db, createLogger("silent"), auth);
	const session = withSession(buildTestApp(db, createLogger("silent"), auth), template.cookie);
	const token = (await connect(session, app, await registerClient(app), READ_WRITE)).access_token;
	await db.delete(assistantCalls);

	return (name: string, args: unknown = {}) => callTool(app, token, name, args);
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

/** The answer's text, parsed: a refusal's whole body. */
const bodyOf = (result: { content: { text?: string }[] }) =>
	z.unknown().parse(JSON.parse(result.content[0]?.text ?? "null"));

const point = z.strictObject({ date: z.string(), balance: z.string() });

const answer = z.strictObject({
	success: z.literal(true),
	dry_run: z.literal(true).optional(),
	changed: z.boolean().optional(),
	account: z.strictObject({ id: z.string(), name: z.string(), currency: z.string() }),
	before: point,
	after: point,
	current_balance: z.strictObject({
		changes: z.boolean(),
		by: z.string().optional(),
		reason: z.string(),
	}),
});

const valuations = z.object({
	valuations: z.array(
		z.object({ entry_id: z.string(), date: z.string(), amount: z.string(), kind: z.string() }),
	),
});

const accountsBody = z.object({
	accounts: z.array(z.object({ id: z.string(), balance: z.string() }).loose()),
});

async function openingOf(call: Awaited<ReturnType<typeof assistant>>, accountId: string) {
	const result = await call("get_valuations", { account_id: accountId });

	return valuations
		.parse(result.structuredContent)
		.valuations.find((item) => item.kind === "opening_anchor");
}

async function balanceOf(call: Awaited<ReturnType<typeof assistant>>, accountId: string) {
	const result = await call("get_accounts");

	return accountsBody
		.parse(result.structuredContent)
		.accounts.find((account) => account.id === accountId)?.balance;
}

const MOVES =
	"No later balance update, so the current balance moves by the same amount as the opening balance.";

describe("set_opening_balance", () => {
	it("moves the opening balance and date in place, as Sure's, its answer in Sure's keys", async () => {
		const account = await savings();
		const call = await assistant();
		const anchor = await openingOf(call, account.id);
		await db.delete(assistantCalls);

		const result = await call("set_opening_balance", {
			account_id: account.id,
			balance: 1000,
			date: "2025-12-01",
		});

		expect(Object.keys(result.structuredContent ?? {})).toEqual([
			"success",
			"changed",
			"account",
			"before",
			"after",
			"current_balance",
		]);
		expect(answer.parse(result.structuredContent)).toEqual({
			success: true,
			changed: true,
			account: { id: account.id, name: "Livret", currency: "EUR" },
			before: { date: "2026-01-10", balance: "1500.0" },
			after: { date: "2025-12-01", balance: "1000.0" },
			current_balance: { changes: true, by: "-500.0", reason: MOVES },
		});
		await expect(openingOf(call, account.id)).resolves.toEqual({
			entry_id: anchor?.entry_id,
			date: "2025-12-01",
			amount: "1000.0",
			kind: "opening_anchor",
		});
		await expect(balanceOf(call, account.id)).resolves.toBe("880.0");
		expect((await calls())[0]).toEqual({
			tool: "set_opening_balance",
			outcome: "OK",
			changedRows: 1,
		});
	});

	it("keeps the current date when none is given", async () => {
		const account = await savings();
		const call = await assistant();

		const result = await call("set_opening_balance", { account_id: account.id, balance: "750" });

		expect(answer.parse(result.structuredContent)).toMatchObject({
			after: { date: "2026-01-10", balance: "750.0" },
		});
		await expect(openingOf(call, account.id)).resolves.toMatchObject({
			date: "2026-01-10",
			amount: "750.0",
		});
	});

	it("reports that a later balance update fixes the current balance", async () => {
		const account = await savings();
		const call = await assistant();
		await call("record_valuation", {
			account_id: account.id,
			date: "2026-02-01",
			amount: "2000.00",
			source: "Relevé de compte (grade: A)",
		});

		const result = await call("set_opening_balance", {
			account_id: account.id,
			balance: 1000,
			dry_run: true,
		});

		expect(answer.parse(result.structuredContent).current_balance).toEqual({
			changes: false,
			reason:
				"The balance update on 2026-02-01 fixes the balance from that date, so only the history before it changes.",
		});
	});

	it("records no row when nothing moves, as Sure's saves nothing", async () => {
		const account = await savings();
		const call = await assistant();

		const result = await call("set_opening_balance", {
			account_id: account.id,
			balance: 1500,
			date: "2026-01-10",
		});

		expect(answer.parse(result.structuredContent)).toMatchObject({
			changed: false,
			current_balance: { changes: false, reason: "The opening balance amount is unchanged." },
		});
		expect(await calls()).toEqual([{ tool: "set_opening_balance", outcome: "OK", changedRows: 0 }]);
	});

	it("reports an unchanged amount", async () => {
		const account = await savings();
		const call = await assistant();

		const result = await call("set_opening_balance", {
			account_id: account.id,
			balance: "1500.00",
			date: "2026-01-01",
		});

		expect(answer.parse(result.structuredContent)).toMatchObject({
			changed: true,
			current_balance: { changes: false, reason: "The opening balance amount is unchanged." },
		});
	});

	it("changes nothing on a dry run, and records no row", async () => {
		const account = await savings();
		const call = await assistant();

		const result = await call("set_opening_balance", {
			account_id: account.id,
			balance: 0,
			date: "2025-12-01",
			dry_run: true,
		});

		expect(Object.keys(result.structuredContent ?? {})).toEqual([
			"success",
			"dry_run",
			"account",
			"before",
			"after",
			"current_balance",
		]);
		expect(answer.parse(result.structuredContent)).toMatchObject({
			dry_run: true,
			after: { date: "2025-12-01", balance: "0.0" },
			current_balance: { changes: true, by: "-1500.0" },
		});
		expect(await calls()).toEqual([{ tool: "set_opening_balance", outcome: "OK", changedRows: 0 }]);
		await expect(openingOf(call, account.id)).resolves.toMatchObject({
			date: "2026-01-10",
			amount: "1500.0",
		});
	});

	it("reads Rails' false values as no dry run", async () => {
		const account = await savings();
		const call = await assistant();

		const result = await call("set_opening_balance", {
			account_id: account.id,
			balance: 0,
			dry_run: "false",
		});

		expect(answer.parse(result.structuredContent)).toMatchObject({ changed: true });
	});

	it("refuses a date on or after the oldest entry, naming that date, writing nothing", async () => {
		const account = await savings();
		const call = await assistant();

		const result = await call("set_opening_balance", {
			account_id: account.id,
			balance: 0,
			date: "2026-01-15",
		});

		expect(result.isError).toBe(true);
		expect(bodyOf(result)).toEqual({
			success: false,
			error: "invalid_date",
			message: "Opening balance date must be before the oldest entry date (2026-01-15).",
			oldest_entry_date: "2026-01-15",
		});
		await expect(openingOf(call, account.id)).resolves.toMatchObject({ amount: "1500.0" });
	});

	it("saves a future date on an account without entries, as Sure's manager", async () => {
		db = (await ownDatabase()).db;
		const account = await openOwn({ ...pinned, name: "Vide" });
		const call = await assistant();

		const result = await call("set_opening_balance", {
			account_id: account.id,
			balance: 250,
			date: "2026-10-01",
		});

		expect(answer.parse(result.structuredContent)).toMatchObject({
			changed: true,
			after: { date: "2026-10-01", balance: "250.0" },
			current_balance: { changes: true, by: "-1250.0" },
		});
		// The ledger's spec reads the balance rows running to that day.
		await expect(openingOf(call, account.id)).resolves.toMatchObject({
			date: "2026-10-01",
			amount: "250.0",
		});
	});

	it("refuses a date more than a year ahead with validation_error naming date, writing nothing", async () => {
		db = (await ownDatabase()).db;
		const account = await openOwn({ ...pinned, name: "Vide" });
		const call = await assistant();

		const result = await call("set_opening_balance", {
			account_id: account.id,
			balance: 0,
			date: "2027-09-23",
		});

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toMatch(/^\{"success":false,"error":"validation_error"/u);
		expect(result.content[0]?.text).toContain("date date_too_late");
		await expect(openingOf(call, account.id)).resolves.toMatchObject({
			date: "2026-01-10",
			amount: "1500.0",
		});
	});

	it("finds the account by an upper-case UUID, as Sure's uuid column", async () => {
		const account = await savings();
		const call = await assistant();

		const result = await call("set_opening_balance", {
			account_id: account.id.toUpperCase(),
			balance: "750",
		});

		expect(answer.parse(result.structuredContent)).toMatchObject({
			account: { id: account.id },
			after: { balance: "750.0" },
		});
	});

	it("checks no date when none is given, an opening date after a line kept, as Sure's date: nil", async () => {
		const account = await savings();
		await sendOwn("PATCH", `/api/accounts/${account.id}/opening-balance`, {
			date: "2026-01-20",
			balance: "1 500,00",
		});
		const call = await assistant();

		const result = await call("set_opening_balance", { account_id: account.id, balance: "900" });

		expect(answer.parse(result.structuredContent)).toMatchObject({
			changed: true,
			after: { date: "2026-01-20", balance: "900.0" },
		});
	});

	it("validates balance and date, as Sure's", async () => {
		const account = await savings();
		const call = await assistant();

		const lots = await call("set_opening_balance", { account_id: account.id, balance: "lots" });
		const flag = await call("set_opening_balance", { account_id: account.id, balance: true });
		const missing = await call("set_opening_balance", { account_id: account.id });
		const slashes = await call("set_opening_balance", {
			account_id: account.id,
			balance: 0,
			date: "28/09/2026",
		});
		const blank = await call("set_opening_balance", {
			account_id: account.id,
			balance: 900,
			date: "",
		});

		for (const refused of [lots, flag, missing]) {
			expect(bodyOf(refused)).toEqual({
				success: false,
				error: "invalid_balance",
				message: "balance must be a number.",
			});
		}
		for (const refused of [slashes, blank]) {
			expect(bodyOf(refused)).toEqual({
				success: false,
				error: "invalid_date",
				message: "date must be YYYY-MM-DD.",
			});
		}
		await expect(openingOf(call, account.id)).resolves.toMatchObject({ amount: "1500.0" });
		expect((await calls()).slice(0, 5).map((row) => row.outcome)).toEqual([
			"VALIDATION_ERROR",
			"VALIDATION_ERROR",
			"VALIDATION_ERROR",
			"VALIDATION_ERROR",
			"VALIDATION_ERROR",
		]);
	});

	it("refuses an account synced from a provider before reading the balance", async () => {
		const account = await savings();
		const connectionId = crypto.randomUUID();
		const bankAccountId = crypto.randomUUID();
		await db.insert(bankConnections).values({
			id: connectionId,
			connector: "enable-banking",
			institutionName: "Banque Test",
			country: "FR",
			status: "active",
			createdAt: 0,
			updatedAt: 0,
		});
		await db.insert(bankAccounts).values({
			id: bankAccountId,
			bankConnectionId: connectionId,
			identificationHash: "hash",
			providerUid: "uid",
			name: "Compte courant",
			currency: "EUR",
			createdAt: 0,
			updatedAt: 0,
		});
		await db.$client.execute({
			sql: "update accounts set bank_account_id = ? where id = ?",
			args: [bankAccountId, account.id],
		});
		const call = await assistant();

		const result = await call("set_opening_balance", { account_id: account.id, balance: "lots" });

		expect(bodyOf(result)).toEqual({
			success: false,
			error: "linked_account",
			message:
				"Livret is synced from a provider, which manages its balances. Only manual accounts have an editable opening balance.",
		});
		expect(await calls()).toEqual([
			{ tool: "set_opening_balance", outcome: "ACCOUNT_LINKED", changedRows: 0 },
		]);
	});

	it("refuses an unknown or deactivated account with not_found", async () => {
		const account = await savings();
		await db.$client.execute({
			sql: "update accounts set active = 0 where id = ?",
			args: [account.id],
		});
		const call = await assistant();

		const unknown = await call("set_opening_balance", { account_id: "nothing", balance: 0 });
		const inactive = await call("set_opening_balance", { account_id: account.id, balance: 0 });

		expect(bodyOf(unknown)).toEqual({
			success: false,
			error: "not_found",
			message: "No account with id 'nothing' that you can write to.",
		});
		expect(bodyOf(inactive)).toMatchObject({ error: "not_found" });
	});

	it("gives a loan's amount owed positive, as get_accounts", async () => {
		db = (await ownDatabase()).db;
		const loan = await openOwn({ ...pinned, ...mortgage });
		const call = await assistant();

		const result = await call("set_opening_balance", {
			account_id: loan.id,
			balance: 175000.5,
		});

		expect(answer.parse(result.structuredContent)).toMatchObject({
			before: { balance: "180000.0" },
			after: { balance: "175000.5" },
			current_balance: { changes: true, by: "-4999.5" },
		});
		await expect(balanceOf(call, loan.id)).resolves.toBe("175000.5");
	});
});
