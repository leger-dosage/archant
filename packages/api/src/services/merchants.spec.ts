import type { TempDatabase } from "../testing/temp-database.ts";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { merchants } from "@archant/data/schema/merchants";

import { createTempDatabase } from "../testing/temp-database.ts";
import { createAccount, ingest, updateTransaction } from "./ledger.ts";
import {
	createMerchant,
	deleteMerchant,
	listMerchants,
	mergeMerchant,
	renameMerchant,
} from "./merchants.ts";

let temp: TempDatabase;
const deps = () => ({ db: temp.db, timeZone: "Europe/Paris" });

beforeAll(async () => {
	temp = await createTempDatabase();
});

afterAll(async () => {
	await temp.dispose();
});

// Each test starts from an empty set, so names never collide across tests.
beforeEach(async () => {
	await temp.db.run(sql`update transactions set merchant_id = null`);
	await temp.db.delete(merchants);
});

const create = (name: string) => createMerchant(deps(), { name });

/** `count` new transactions, the first linked to `merchantId` by hand, the rest by a rule. */
async function transactionsOf(merchantId: string, count: number): Promise<string[]> {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));

	try {
		const account = await createAccount(
			deps(),
			{
				name: "Compte joint",
				type: "depository",
				subtype: "checking",
				currency: "EUR",
				openingBalance: toMinorUnits(0),
				openingDate: "2026-09-01",
			},
			{ origin: "user" },
		);
		const result = await ingest(
			deps(),
			account.id,
			{
				transactions: Array.from({ length: count }, (_, index) => ({
					externalId: null,
					date: "2026-09-10",
					amount: toMinorUnits(-100 - index),
					currency: "EUR",
					label: `CB CARREFOUR ${index}`,
					reference: null,
					notes: null,
					pending: false,
				})),
				balance: null,
				rejected: [],
			},
			{ manual: true },
			{ origin: "sync" },
		);
		// One after the other: each is an `immediate` ledger transaction.
		await result.created.reduce<Promise<unknown>>(
			(pending, id, index) =>
				pending.then(() =>
					updateTransaction(deps(), id, { merchantId }, { origin: index === 0 ? "user" : "rule" }),
				),
			Promise.resolve(),
		);

		return result.created;
	} finally {
		vi.useRealTimers();
	}
}

async function linksOf(entryIds: string[]) {
	const rows = await Promise.all(
		entryIds.map((id) =>
			temp.db.get<{ merchantId: string | null; locked: string }>(
				sql`select merchant_id as merchantId, locked_fields as locked from transactions where entry_id = ${id}`,
			),
		),
	);

	return rows.map((row) => {
		const locked: unknown = JSON.parse(row?.locked ?? "[]");

		return { merchantId: row?.merchantId, locked };
	});
}

async function stored(id: string) {
	return temp.db.select().from(merchants).where(eq(merchants.id, id)).get();
}

const fieldError = (path: string, code: string) => ({
	code: "VALIDATION_ERROR",
	fields: [{ path, code }],
});

describe("listMerchants", () => {
	it("sorts names as a French reader does, with each one's transaction count", async () => {
		const carrefour = await create("Carrefour");
		await create("Épicerie du coin");
		await create("Boulangerie");
		await transactionsOf(carrefour.id, 2);

		await expect(listMerchants(deps())).resolves.toEqual([
			expect.objectContaining({ name: "Boulangerie", transactionCount: 0 }),
			expect.objectContaining({ name: "Carrefour", transactionCount: 2 }),
			expect.objectContaining({ name: "Épicerie du coin", transactionCount: 0 }),
		]);
	});
});

describe("createMerchant", () => {
	it("creates a merchant with no transaction", async () => {
		const merchant = await create("Carrefour");

		expect(merchant).toEqual({ id: merchant.id, name: "Carrefour", transactionCount: 0 });
		expect(merchant.id).toMatch(/^[0-9a-f-]{36}$/u);
	});

	it.each(["carrefour", "CARREFOUR"])("refuses %j when « Carrefour » exists", async (name) => {
		await create("Carrefour");

		await expect(create(name)).rejects.toMatchObject(fieldError("name", "name_taken"));
	});

	it("folds case beyond ASCII, where SQLite's `lower` stops", async () => {
		await create("Épicerie");

		await expect(create("ÉPICERIE")).rejects.toMatchObject(fieldError("name", "name_taken"));
	});
});

describe("renameMerchant", () => {
	it("renames, and keeps its own name in another case", async () => {
		const merchant = await create("Carrefour");

		await expect(renameMerchant(deps(), merchant.id, { name: "CARREFOUR" })).resolves.toMatchObject(
			{ name: "CARREFOUR" },
		);
	});

	it("refuses a name another merchant holds", async () => {
		await create("Carrefour");
		const lidl = await create("Lidl");

		await expect(renameMerchant(deps(), lidl.id, { name: "carrefour" })).rejects.toMatchObject(
			fieldError("name", "name_taken"),
		);
	});

	it("answers NOT_FOUND for an unknown merchant", async () => {
		await expect(renameMerchant(deps(), "nope", { name: "X" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("deleteMerchant", () => {
	it("unlinks its transactions, keeping their locks, then deletes it", async () => {
		const merchant = await create("Fleuriste");
		const ids = await transactionsOf(merchant.id, 2);

		await expect(deleteMerchant(deps(), merchant.id)).resolves.toEqual({
			id: merchant.id,
			unlinked: 2,
		});

		await expect(linksOf(ids)).resolves.toEqual([
			{ merchantId: null, locked: ["merchant"] },
			{ merchantId: null, locked: [] },
		]);
		await expect(stored(merchant.id)).resolves.toBeUndefined();
	});

	it("answers NOT_FOUND for an unknown merchant", async () => {
		await expect(deleteMerchant(deps(), "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("mergeMerchant", () => {
	it("moves the transactions to the target, deletes the source and returns the target", async () => {
		const source = await create("CB Carrefour");
		const target = await create("Carrefour");
		const moved = await transactionsOf(source.id, 3);

		await expect(mergeMerchant(deps(), source.id, target.id)).resolves.toEqual({
			id: target.id,
			name: "Carrefour",
			transactionCount: 3,
		});

		// The one set by hand stays locked: a rule must not undo the merge.
		await expect(linksOf(moved)).resolves.toEqual([
			{ merchantId: target.id, locked: ["merchant"] },
			{ merchantId: target.id, locked: [] },
			{ merchantId: target.id, locked: [] },
		]);
		await expect(stored(source.id)).resolves.toBeUndefined();
	});

	it.each(["self", "unknown"])("refuses a %s target and changes nothing", async (which) => {
		const source = await create("Carrefour");
		const ids = await transactionsOf(source.id, 1);
		const targetId = which === "self" ? source.id : "nope";

		await expect(mergeMerchant(deps(), source.id, targetId)).rejects.toMatchObject(
			fieldError("targetId", "invalid_value"),
		);
		await expect(linksOf(ids)).resolves.toEqual([{ merchantId: source.id, locked: ["merchant"] }]);
		await expect(stored(source.id)).resolves.toBeDefined();
	});

	it("answers NOT_FOUND for an unknown source", async () => {
		const target = await create("Carrefour");

		await expect(mergeMerchant(deps(), "nope", target.id)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});
