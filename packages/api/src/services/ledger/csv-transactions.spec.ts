import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
	categoryOf,
	deps,
	line,
	newCategory,
	newTag,
	openChecking,
	tagsOf,
	temp,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { ingestCsvStatements } from "./csv-transactions.ts";

useLedgerDatabase();

/** Every transaction of the account, in date order. */
const entriesOf = async (accountId: string) =>
	temp.db.all<{ id: string; label: string; notes: string | null }>(
		sql`select e.id, t.label, t.notes from entries e join transactions t on t.entry_id = e.id
			where e.account_id = ${accountId} order by e.date`,
	);

describe("ingestCsvStatements", () => {
	it("writes each account's lines under a confirmed import with their category and tags", async () => {
		const account = await openChecking();
		const category = await newCategory("Alimentation");
		const tag = await newTag("pain");
		const result = await ingestCsvStatements(
			deps(),
			[{ accountId: account.id, lines: [line({ categoryId: category, tagIds: [tag] })] }],
			"releve.csv",
		);
		const [entry] = await entriesOf(account.id);

		expect(result.created).toBe(1);
		expect(
			await temp.db.all(
				sql`select status, file_name from imports where id = ${result.importIds[0] ?? ""}`,
			),
		).toEqual([{ status: "confirmed", file_name: "releve.csv" }]);
		expect(await categoryOf(entry?.id ?? "")).toBe(category);
		expect(await tagsOf(entry?.id ?? "")).toEqual([tag]);
	});

	it("leaves a line found again as it is when the file gives nothing, and retags it alone", async () => {
		const account = await openChecking();
		const tag = await newTag("courses");
		const lines = [line({ date: "2026-09-11" }), line({ date: "2026-09-12", label: "Épicerie" })];

		await ingestCsvStatements(deps(), [{ accountId: account.id, lines }], "a.csv");
		const again = await ingestCsvStatements(
			deps(),
			[
				{
					accountId: account.id,
					lines: [
						lines[0] ?? line(),
						{ ...line({ date: "2026-09-12", label: "Épicerie" }), tagIds: [tag] },
					],
				},
			],
			"b.csv",
		);
		const [first, second] = await entriesOf(account.id);

		expect(again.created).toBe(0);
		expect(await tagsOf(first?.id ?? "")).toEqual([]);
		expect(await categoryOf(first?.id ?? "")).toBeNull();
		expect(await tagsOf(second?.id ?? "")).toEqual([tag]);
	});
});
