import type { TempDatabase } from "../testing/temp-database.ts";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CATEGORY_COLORS } from "@archant/data/category-presets";
import { toMinorUnits } from "@archant/data/money";
import { merchants } from "@archant/data/schema/merchants";

import { createTempDatabase } from "../testing/temp-database.ts";
import { createAccount } from "./ledger/accounts.ts";
import { updateTransaction } from "./ledger/edits.ts";
import { ingest } from "./ledger/ingest.ts";
import {
	createMerchant,
	deleteMerchant,
	listMerchants,
	mergeMerchants,
	updateMerchant,
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
				sql`select merchant_id as merchantId, (select json_group_array(key) from json_each(locked_fields)) as locked from transactions where entry_id = ${id}`,
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

/** One of Sure's ten, drawn at random as `COLORS.sample`. */
const sampledColor: unknown = expect.stringMatching(
	new RegExp(`^(${CATEGORY_COLORS.join("|")})$`, "u"),
);

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

		expect(merchant).toEqual({
			id: merchant.id,
			name: "Carrefour",
			color: sampledColor,
			websiteUrl: null,
			transactionCount: 0,
		});
		expect(merchant.id).toMatch(/^[0-9a-f-]{36}$/u);
	});

	it("draws one of Sure's ten colours without one, as `set_default_color`", async () => {
		const merchant = await create("Carrefour");

		expect(CATEGORY_COLORS).toContain(merchant.color);
	});

	it("keeps the colour and the website it is given", async () => {
		await expect(
			createMerchant(deps(), { name: "Starbucks", color: "#4da568", websiteUrl: "starbucks.com" }),
		).resolves.toMatchObject({ color: "#4da568", websiteUrl: "starbucks.com" });
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

describe("updateMerchant", () => {
	it("recolours and changes the website when given, and keeps them otherwise", async () => {
		const merchant = await createMerchant(deps(), {
			name: "Starbucks",
			color: "#4da568",
			websiteUrl: "starbucks.com",
		});

		await expect(
			updateMerchant(deps(), merchant.id, { name: "Starbucks Café" }),
		).resolves.toMatchObject({
			name: "Starbucks Café",
			color: "#4da568",
			websiteUrl: "starbucks.com",
		});
		await expect(
			updateMerchant(deps(), merchant.id, {
				name: "Starbucks",
				color: "#805dee",
				websiteUrl: null,
			}),
		).resolves.toMatchObject({ color: "#805dee", websiteUrl: null });
	});

	it("renames, and keeps its own name in another case", async () => {
		const merchant = await create("Carrefour");

		await expect(updateMerchant(deps(), merchant.id, { name: "CARREFOUR" })).resolves.toMatchObject(
			{ name: "CARREFOUR" },
		);
	});

	it("refuses a name another merchant holds", async () => {
		await create("Carrefour");
		const lidl = await create("Lidl");

		await expect(updateMerchant(deps(), lidl.id, { name: "carrefour" })).rejects.toMatchObject(
			fieldError("name", "name_taken"),
		);
	});

	it("answers NOT_FOUND for an unknown merchant", async () => {
		await expect(updateMerchant(deps(), "nope", { name: "X" })).rejects.toMatchObject({
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

describe("mergeMerchants", () => {
	it("moves every source's transactions to the target, keeping locks, and deletes the sources", async () => {
		const first = await create("CB Carrefour");
		const second = await create("Carrefour Market");
		const target = await create("Carrefour");
		const fromFirst = await transactionsOf(first.id, 2);
		const fromSecond = await transactionsOf(second.id, 1);

		await expect(mergeMerchants(deps(), target.id, [first.id, second.id])).resolves.toMatchObject({
			target: { id: target.id, name: "Carrefour", transactionCount: 3 },
			merged: 2,
		});

		// The one set by hand stays locked: a rule must not undo the merge.
		await expect(linksOf([...fromFirst, ...fromSecond])).resolves.toEqual([
			{ merchantId: target.id, locked: ["merchant"] },
			{ merchantId: target.id, locked: [] },
			{ merchantId: target.id, locked: ["merchant"] },
		]);
		await expect(stored(first.id)).resolves.toBeUndefined();
		await expect(stored(second.id)).resolves.toBeUndefined();
	});

	it("refuses the target among the sources and changes nothing", async () => {
		const source = await create("CB Carrefour");
		const target = await create("Carrefour");
		const ids = await transactionsOf(source.id, 1);

		await expect(mergeMerchants(deps(), target.id, [source.id, target.id])).rejects.toMatchObject(
			fieldError("sourceIds", "same_merchant"),
		);
		await expect(linksOf(ids)).resolves.toEqual([{ merchantId: source.id, locked: ["merchant"] }]);
		await expect(stored(source.id)).resolves.toBeDefined();
	});

	it("refuses an unknown target or source and changes nothing", async () => {
		const source = await create("CB Carrefour");
		const target = await create("Carrefour");

		await expect(mergeMerchants(deps(), "nope", [source.id])).rejects.toMatchObject(
			fieldError("targetId", "invalid_value"),
		);
		await expect(mergeMerchants(deps(), target.id, [source.id, "nope"])).rejects.toMatchObject(
			fieldError("sourceIds", "invalid_value"),
		);
		await expect(stored(source.id)).resolves.toBeDefined();
	});
});
