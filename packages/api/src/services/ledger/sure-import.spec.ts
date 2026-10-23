import type { SurePlan } from "../sure-import-plan.ts";
import type { ImportedAccount, SureIds } from "./sure-import.ts";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { categories } from "@archant/data/schema/categories";
import { merchants } from "@archant/data/schema/merchants";
import { securities } from "@archant/data/schema/securities";
import { tags } from "@archant/data/schema/tags";

import { checking, deps, temp, useLedgerDatabase } from "../../testing/ledger.ts";
import { readSureArchive } from "../sure-import-plan.ts";
import { createAccount } from "./accounts.ts";
import { insertSureAccounts, insertSureEntries } from "./sure-import.ts";

useLedgerDatabase();

const anyNumber: unknown = expect.any(Number);
const anyString: unknown = expect.any(String);

const LIMITS = { maxBytes: 1024 * 1024, maxRows: 1000 };

const line = (type: string, data: Record<string, unknown>) => ({ type, data });

const account = (id: string, accountable_type: string, currency = "EUR") =>
	line("Account", { id, name: `Compte ${id}`, balance: "0", currency, accountable_type });

async function planOf(lines: readonly unknown[]): Promise<SurePlan> {
	const archive = await readSureArchive(
		{ db: temp.db, timeZone: "Europe/Paris" },
		{
			name: "all.ndjson",
			bytes: new TextEncoder().encode(lines.map((row) => JSON.stringify(row)).join("\n")),
		},
		LIMITS,
	);

	return archive.plan;
}

/** A row of a taxonomy table, as the service creates them before the ledger writes. */
async function named(table: typeof categories | typeof tags | typeof merchants, name: string) {
	const id = crypto.randomUUID();
	const stamps = { createdAt: 0, updatedAt: 0 };

	await (table === categories
		? temp.db.insert(categories).values({ id, name, color: "#e99537", icon: "tag", ...stamps })
		: temp.db.insert(table).values({ id, name, ...stamps }));

	return id;
}

/**
 * Writes `plan` as the service does, `drop` left out of the accounts the
 * ledger knows and `extra` added, as a plan and its ids could disagree.
 */
async function write(
	plan: SurePlan,
	ids: Omit<SureIds, "accounts">,
	{ drop = [], extra = [] }: { drop?: string[]; extra?: [string, ImportedAccount][] } = {},
) {
	return temp.db.transaction(
		async (tx) => {
			const now = Date.now();
			const accounts = await insertSureAccounts(tx, plan.accounts, now);

			for (const sourceId of drop) {
				accounts.delete(sourceId);
			}

			for (const [sourceId, row] of extra) {
				accounts.set(sourceId, row);
			}

			await insertSureEntries(tx, plan, { ...ids, accounts }, { now, timeZone: "Europe/Paris" });

			return accounts;
		},
		{ behavior: "immediate" },
	);
}

describe("insertSureEntries", () => {
	it("writes splits, transfers, rejected pairs, trades, prices and locks as the ledger does", async () => {
		const category = await named(categories, `Courses ${crypto.randomUUID()}`);
		const tag = await named(tags, `Voyage ${crypto.randomUUID()}`);
		const merchant = await named(merchants, `Boulanger ${crypto.randomUUID()}`);
		const listed = crypto.randomUUID();
		const fund = crypto.randomUUID();
		const shares = crypto.randomUUID();
		const stamps = { createdAt: 0, updatedAt: 0, currency: "EUR" };
		await temp.db.insert(securities).values([
			{ id: listed, ticker: "LVMH.PA", mic: "XPAR", name: "LVMH", provider: "yahoo", ...stamps },
			{ id: fund, isin: "FR0010315770", name: "Fonds euros", ...stamps },
			{ id: shares, name: "Parts sociales", ...stamps },
		]);
		const plan = await planOf([
			account("a1", "Depository"),
			account("a2", "Depository"),
			account("i1", "Investment"),
			account("gone", "Investment"),
			line("Merchant", { id: "m1", name: "Boulanger" }),
			line("Transaction", {
				id: "t1",
				account_id: "a1",
				date: "2026-09-10",
				amount: "100",
				merchant_id: "m1",
				tag_ids: ["g1"],
				split_lines: [
					{
						id: "s1",
						amount: "60",
						name: "Pain",
						notes: "Croissants",
						category_id: "c1",
						merchant_id: "m1",
						tag_ids: [],
					},
					{ amount: "40" },
				],
				archant: { locked_fields: { label: "2026-09-10T08:00:00.000Z", nonsense: null } },
			}),
			line("Transaction", {
				id: "t2",
				account_id: "a1",
				date: "2026-09-11",
				amount: "5",
				category_id: "unknown",
				tag_ids: ["unknown"],
				kind: "one_time",
			}),
			line("Transaction", {
				id: "t3",
				account_id: "a1",
				date: "2026-09-12",
				amount: "50",
				kind: "one_time",
			}),
			line("Transaction", { id: "t4", account_id: "a2", date: "2026-09-12", amount: "-50" }),
			line("Transaction", { id: "t5", account_id: "a1", date: "2026-09-13", amount: "7" }),
			line("Transaction", { id: "t6", account_id: "i1", date: "2026-09-01", amount: "-1000" }),
			line("Transaction", { id: "t7", account_id: "gone", date: "2026-09-01", amount: "1" }),
			line("Transfer", { outflow_transaction_id: "t3", inflow_transaction_id: "t4" }),
			// Reversed: in Archant's sign the outflow is above zero and the inflow below.
			line("Transaction", { id: "t8", account_id: "a1", date: "2026-09-14", amount: "-20" }),
			line("Transaction", { id: "t9", account_id: "a2", date: "2026-09-14", amount: "20" }),
			line("Transfer", { outflow_transaction_id: "t8", inflow_transaction_id: "t9" }),
			line("Transaction", { id: "t10", account_id: "a1", date: "2026-09-14", amount: "30" }),
			line("Transfer", { outflow_transaction_id: "t10", inflow_transaction_id: "t9" }),
			// A transfer side of the securities account, which no trade converts.
			line("Transaction", { id: "t11", account_id: "i1", date: "2026-09-01", amount: "30" }),
			line("Transaction", { id: "t12", account_id: "a2", date: "2026-09-01", amount: "-30" }),
			line("Transfer", {
				outflow_transaction_id: "t11",
				inflow_transaction_id: "t12",
				notes: "Versement de mars",
			}),
			line("Transfer", { outflow_transaction_id: "t3", inflow_transaction_id: "t2" }),
			line("Transfer", { outflow_transaction_id: "t5", inflow_transaction_id: "t2" }),
			line("Transfer", { outflow_transaction_id: "s1", inflow_transaction_id: "t4" }),
			line("Transfer", { outflow_transaction_id: "lost", inflow_transaction_id: "t4" }),
			line("RejectedTransfer", { outflow_transaction_id: "t5", inflow_transaction_id: "t4" }),
			line("RejectedTransfer", { outflow_transaction_id: "t5", inflow_transaction_id: "t4" }),
			line("RejectedTransfer", { outflow_transaction_id: "t5", inflow_transaction_id: "t5" }),
			line("RejectedTransfer", { outflow_transaction_id: "lost", inflow_transaction_id: "t5" }),
			...[
				{ ticker: "LVMH.PA", exchange_operating_mic: "XPAR", archant: { parent_entry_id: "t6" } },
				{ ticker: "AAPL", security_name: "Apple", archant: { parent_entry_id: "t1" } },
				{
					ticker: "FR0010315770",
					security_name: "Fonds",
					archant: { isin: "FR0010315770", parent_entry_id: "s1" },
				},
				{
					ticker: "Parts sociales",
					security_name: "Parts sociales",
					archant: { parent_entry_id: "lost" },
				},
				{ ticker: "Parts sociales", security_name: "Parts sociales" },
				// A second trade naming the converted transaction, and one naming a transfer side.
				{ ticker: "LVMH.PA", exchange_operating_mic: "XPAR", archant: { parent_entry_id: "t6" } },
				{ ticker: "LVMH.PA", exchange_operating_mic: "XPAR", archant: { parent_entry_id: "t11" } },
			].map((security) =>
				line("Trade", {
					account_id: "i1",
					date: "2026-09-02",
					amount: "10",
					qty: "1",
					price: "10",
					...security,
				}),
			),
			line("Trade", {
				account_id: "i1",
				date: "2026-09-03",
				amount: "-1.50",
				qty: "0",
				price: "0",
				ticker: "CASH-I1",
				investment_activity_label: "Interest",
			}),
			line("Trade", {
				account_id: "gone",
				date: "2026-09-03",
				amount: "10",
				qty: "1",
				price: "10",
				ticker: "AAPL",
			}),
			...[
				["2026-09-05", "12", true],
				["2026-09-04", "11", true],
				["2026-09-06", "0", true],
				["2026-09-07", "13", false],
			].map(([date, price, locked]) =>
				line("Holding", {
					account_id: "i1",
					date,
					amount: "10",
					qty: "1",
					price,
					ticker: "LVMH.PA",
					exchange_operating_mic: "XPAR",
					cost_basis: "9.5",
					cost_basis_source: "manual",
					cost_basis_locked: locked,
				}),
			),
			line("Holding", {
				account_id: "gone",
				date: "2026-09-05",
				amount: "10",
				qty: "1",
				price: "10",
				ticker: "AAPL",
			}),
			line("Valuation", { id: "v1", account_id: "a2", date: "2026-09-15", amount: "500" }),
			line("Valuation", { id: "v2", account_id: "gone", date: "2026-09-15", amount: "1" }),
		]);
		const ids = {
			categories: new Map([["c1", category]]),
			tags: new Map([["g1", tag]]),
			merchants: new Map([["m1", merchant]]),
		};
		// An account the archive does not name, which the recompute leaves alone.
		const elsewhere = await createAccount(deps(), checking, { origin: "user" });
		const accounts = await write(plan, ids, {
			drop: ["gone"],
			extra: [["elsewhere", elsewhere]],
		});
		const a1 = accounts.get("a1")?.id;
		const i1 = accounts.get("i1")?.id;

		const rows = await temp.db.all<Record<string, unknown>>(sql`
			select t.label, e.amount, t.excluded, t.one_time as oneTime, t.category_id as categoryId,
				t.merchant_id as merchantId, t.locked_fields as locked, e.parent_entry_id is not null as child,
				(select count(*) from taggings g where g.transaction_id = t.entry_id) as tags
			from transactions t join entries e on e.id = t.entry_id where e.account_id = ${a1}
			order by e.date, e.created_at`);

		expect(rows).toMatchObject([
			{
				label: "Opération importée",
				amount: -10000,
				excluded: 1,
				merchantId: merchant,
				tags: 1,
				child: 0,
			},
			{
				label: "Pain",
				amount: -6000,
				excluded: 0,
				categoryId: category,
				merchantId: merchant,
				tags: 0,
				child: 1,
			},
			{
				label: "Opération importée",
				amount: -4000,
				categoryId: null,
				merchantId: merchant,
				tags: 1,
				child: 1,
			},
			{ amount: -500, oneTime: 1, categoryId: null, tags: 0 },
			// A transfer side loses `one_time`.
			{ amount: -5000, oneTime: 0 },
			{ amount: -700 },
			{ amount: 2000 },
			{ amount: -3000 },
		]);
		expect(JSON.parse(String(rows[0]?.["locked"]))).toEqual({
			label: Date.parse("2026-09-10T08:00:00.000Z"),
			excluded: anyNumber,
		});
		expect(
			await temp.db.all(
				sql`select t.kind, t.status from transfers t join entries e on e.id = t.outflow_transaction_id where e.account_id = ${a1}`,
			),
			// `t8` → `t9` has both signs reversed, `t10` → `t9` its inflow below zero.
		).toEqual([{ kind: "internal_move", status: "pending" }]);
		expect(
			await temp.db.all(
				sql`select count(*) as count from rejected_transfers r join entries e on e.id = r.outflow_transaction_id where e.account_id = ${a1}`,
			),
		).toEqual([{ count: 1 }]);
		// Sure's `Transfer.notes`, the transfer's own.
		expect(
			await temp.db.all(
				sql`select t.notes from transfers t join entries e on e.id = t.outflow_transaction_id where e.account_id = ${i1}`,
			),
		).toEqual([{ notes: "Versement de mars" }]);

		const trades = await temp.db.all<Record<string, unknown>>(sql`
			select s.id as securityId, s.ticker, s.provider, t.income_kind as income, e.parent_entry_id as parent
			from trades t join entries e on e.id = t.entry_id left join securities s on s.id = t.security_id
			where e.account_id = ${i1} order by e.date, e.created_at`);

		expect(trades).toHaveLength(8);
		expect(trades.filter((trade) => trade["parent"] !== null)).toHaveLength(1);
		expect(trades[0]).toMatchObject({ securityId: listed, parent: anyString });
		expect(trades[1]).toMatchObject({ ticker: "AAPL", provider: "yahoo", parent: null });
		expect(trades[2]).toMatchObject({ securityId: fund, parent: null });
		expect(trades[3]).toMatchObject({ securityId: shares, parent: null });
		expect(trades[4]).toMatchObject({ securityId: shares });
		expect(trades[7]).toMatchObject({ securityId: null, income: "interest" });
		expect(
			await temp.db.all(
				sql`select date, price, source from security_prices where security_id = ${listed} order by date`,
			),
		).toEqual([
			{ date: "2026-09-04", price: 11_000_000, source: "provider" },
			{ date: "2026-09-05", price: 12_000_000, source: "provider" },
			{ date: "2026-09-07", price: 13_000_000, source: "provider" },
		]);
		expect(
			await temp.db.all(
				sql`select cost_basis as costBasis, locked_on as lockedOn from cost_basis_locks where account_id = ${i1}`,
			),
		).toEqual([{ costBasis: 9_500_000, lockedOn: "2026-09-04" }]);
		expect(
			await temp.db.all(
				sql`select count(*) as count from entries where account_id = ${accounts.get("a2")?.id} and valuation_kind = 'reconciliation'`,
			),
		).toEqual([{ count: 1 }]);
	});

	it("fails on a security found in another currency than its account's", async () => {
		await temp.db.insert(securities).values({
			id: crypto.randomUUID(),
			ticker: "SAP.DE",
			mic: "XETR",
			name: "SAP",
			currency: "EUR",
			provider: "yahoo",
			createdAt: 0,
			updatedAt: 0,
		});
		const plan = await planOf([
			account("u1", "Investment", "USD"),
			line("Trade", {
				account_id: "u1",
				date: "2026-09-02",
				amount: "10",
				qty: "1",
				price: "10",
				currency: "USD",
				ticker: "SAP.DE",
				exchange_operating_mic: "XETR",
			}),
		]);

		await expect(
			write(plan, { categories: new Map(), tags: new Map(), merchants: new Map() }),
		).rejects.toMatchObject({ code: "SURE_IMPORT_INVALID" });
		expect(await temp.db.all(sql`select id from accounts where name = 'Compte u1'`)).toEqual([]);
	});
});
