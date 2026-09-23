import type { TempDatabase } from "../testing/temp-database.ts";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { tags } from "@archant/data/schema/tags";

import { createTempDatabase } from "../testing/temp-database.ts";
import { createAccount, ingest, updateTransaction } from "./ledger.ts";
import { createTag, deleteTag, listTags, renameTag } from "./tags.ts";

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
	await temp.db.run(sql`delete from taggings`);
	await temp.db.delete(tags);
});

const create = (name: string) => createTag(deps(), { name });

/** `count` new transactions, the first tagged with `tagId` by hand, the rest by a rule. */
async function transactionsOf(tagId: string, count: number): Promise<string[]> {
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
					label: `HOTEL ${index}`,
					reference: null,
					notes: null,
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
					updateTransaction(
						deps(),
						id,
						{ tagIds: [tagId] },
						{ origin: index === 0 ? "user" : "rule" },
					),
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
		entryIds.map(async (id) => {
			const row = await temp.db.get<{ locked: string }>(
				sql`select locked_fields as locked from transactions where entry_id = ${id}`,
			);
			const tagged = await temp.db.all<{ tagId: string }>(
				sql`select tag_id as tagId from taggings where transaction_id = ${id}`,
			);
			const locked: unknown = JSON.parse(row?.locked ?? "[]");

			return { tagIds: tagged.map((tagging) => tagging.tagId), locked };
		}),
	);

	return rows;
}

async function stored(id: string) {
	return temp.db.select().from(tags).where(eq(tags.id, id)).get();
}

const fieldError = (path: string, code: string) => ({
	code: "VALIDATION_ERROR",
	fields: [{ path, code }],
});

describe("listTags", () => {
	it("sorts names as a French reader does, with each one's transaction count", async () => {
		const holidays = await create("Vacances 2026");
		await create("Été");
		await create("Anniversaire");
		await transactionsOf(holidays.id, 2);

		await expect(listTags(deps())).resolves.toEqual([
			expect.objectContaining({ name: "Anniversaire", transactionCount: 0 }),
			expect.objectContaining({ name: "Été", transactionCount: 0 }),
			expect.objectContaining({ name: "Vacances 2026", transactionCount: 2 }),
		]);
	});
});

describe("createTag", () => {
	it("creates a tag with no transaction", async () => {
		const tag = await create("Vacances");

		expect(tag).toEqual({ id: tag.id, name: "Vacances", transactionCount: 0 });
		expect(tag.id).toMatch(/^[0-9a-f-]{36}$/u);
	});

	it.each(["vacances", "VACANCES"])("refuses %j when « Vacances » exists", async (name) => {
		await create("Vacances");

		await expect(create(name)).rejects.toMatchObject(fieldError("name", "name_taken"));
	});

	it("folds case beyond ASCII, where SQLite's `lower` stops", async () => {
		await create("Été");

		await expect(create("ÉTÉ")).rejects.toMatchObject(fieldError("name", "name_taken"));
	});
});

describe("renameTag", () => {
	it("renames, and keeps its own name in another case", async () => {
		const tag = await create("Vacances");

		await expect(renameTag(deps(), tag.id, { name: "VACANCES" })).resolves.toMatchObject({
			name: "VACANCES",
		});
	});

	it("refuses a name another tag holds", async () => {
		await create("Vacances");
		const work = await create("Travaux");

		await expect(renameTag(deps(), work.id, { name: "vacances" })).rejects.toMatchObject(
			fieldError("name", "name_taken"),
		);
	});

	it("answers NOT_FOUND for an unknown tag", async () => {
		await expect(renameTag(deps(), "nope", { name: "X" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("deleteTag", () => {
	it("removes it from its transactions, keeping their locks, then deletes it", async () => {
		const tag = await create("Vacances");
		const ids = await transactionsOf(tag.id, 2);

		await expect(deleteTag(deps(), tag.id)).resolves.toEqual({ id: tag.id, untagged: 2 });

		await expect(linksOf(ids)).resolves.toEqual([
			{ tagIds: [], locked: ["tags"] },
			{ tagIds: [], locked: [] },
		]);
		await expect(stored(tag.id)).resolves.toBeUndefined();
	});

	it("answers NOT_FOUND for an unknown tag", async () => {
		await expect(deleteTag(deps(), "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
