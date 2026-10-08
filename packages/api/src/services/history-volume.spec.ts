import type { TempDatabase } from "../testing/temp-database.ts";

import { and, eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { refreshStatistics } from "@archant/data/client";
import { toMicros } from "@archant/data/micros";
import { toMinorUnits } from "@archant/data/money";
import { entries } from "@archant/data/schema/entries";
import { holdings } from "@archant/data/schema/holdings";
import { securities, securityPrices } from "@archant/data/schema/securities";
import { trades } from "@archant/data/schema/trades";
import { transactions } from "@archant/data/schema/transactions";
import { transfers } from "@archant/data/schema/transfers";

import { addDays, today } from "../domain/dates.ts";
import { tradeAmount } from "../domain/trades.ts";
import { createLogger } from "../lib/logger.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { exportArchive } from "./export.ts";
import { confirmImport, createImport, previewImport } from "./imports.ts";
import { createAccount } from "./ledger/accounts.ts";
import { recomputeBalances } from "./ledger/balances.ts";
import { transactionPages } from "./ledger/export.ts";
import { revalueHoldings } from "./ledger/holdings.ts";
import { ROWS_PER_INSERT, inSequence } from "./ledger/shared.ts";
import { getBalanceSheet, getIncomeStatement } from "./reports.ts";
import { listAccountTransactions, listAllTransactions, transactionTotals } from "./transactions.ts";
import { listTransferCandidates } from "./transfers.ts";

// NFR10, on a decade of a household's history. CI runners are slower and
// noisier than the small server the target names, so they get twice the time.
const MARGIN = process.env["CI"] === undefined ? 1 : 2;
const PAGE_MS = 150 * MARGIN;
// NFR10 names no report. A report over the whole history reads all 100,000
// rows once, where a page reads 50: a bare join of entries and transactions,
// grouped, already took 110 ms of the 150 its first read did on 2026-10-08.
const REPORT_MS = 2 * PAGE_MS;
// NFR10's import, held to a multiple of this machine's speed rather than to
// a time: the same code confirmed in 4.7 s on one CI run and 8.3 s on
// another, and failed 3 s × MARGIN four times on 2026-10-07. Divided by the
// bare writes of its lines, it stayed between 1.8 and 3.5 on 2026-10-08, on
// a laptop idle and loaded and on CI, around 2.8 most of the time. Five
// leaves room above the worst and still fails a confirm grown twice as costly.
const IMPORT_RATIO = 5;
const EXPORT_MS = 10_000 * MARGIN;
const REVALUE_MS = 1000 * MARGIN;

const ROWS = 100_000;
const DAYS = 3650;
const OFX_LINES = 24_000;
const FIRST_DAY = Date.UTC(2016, 0, 2);
const SECURITIES = 20;
const TIME_ZONE = "Europe/Paris";

let temp: TempDatabase;
let jointId = "";
let savingsId = "";
let cardId = "";
let suggestedId = "";
let securityIds: string[] = [];
let peaId = "";
/** Days each security is held, from its first trade to today. */
let heldDays = 0;

const deps = () => ({ db: temp.db, timeZone: TIME_ZONE });
const importDeps = () => ({ ...deps(), logger: createLogger("silent") });

function chunksOf<Row>(rows: readonly Row[], size: number): Row[][] {
	return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) =>
		rows.slice(index * size, (index + 1) * size),
	);
}

const dayOf = (offset: number) =>
	new Date(FIRST_DAY + offset * 86_400_000).toISOString().slice(0, 10);

const listQuery = { page: 1, pageSize: 50 } as const;
const expenses = { direction: ["expense" as const] };

async function openAccount(name: string, subtype: "checking" | "savings") {
	const account = await createAccount(
		deps(),
		{
			name,
			type: "depository",
			subtype,
			currency: "EUR",
			openingBalance: toMinorUnits(0),
			openingDate: "2016-01-01",
		},
		{ origin: "user" },
	);

	return account.id;
}

type SeedRow = {
	id: string;
	accountId: string;
	date: string;
	amount: number;
	pending: boolean;
};

/**
 * Ten years of a household on three accounts, about 27 rows a day: mostly
 * spending on the joint account and the card, a credit every 97 rows, and
 * every 400 rows a move to the savings account recorded as a transfer. Every
 * 50th row has its exact opposite on the card a day later, unlinked, so the
 * list pays for the suggestion's search as it would on an imported history.
 */
function seedRows(): { rows: SeedRow[]; pairs: [string, string][] } {
	const rows: SeedRow[] = [];
	const pairs: [string, string][] = [];

	while (rows.length < ROWS) {
		const index = rows.length;
		const offset = Math.floor((index * DAYS) / ROWS);
		const date = dayOf(offset);
		const id = crypto.randomUUID();

		if (index % 400 === 0) {
			const inflow = crypto.randomUUID();
			rows.push(
				{ id, accountId: jointId, date, amount: -50_000, pending: false },
				{ id: inflow, accountId: savingsId, date, amount: 50_000, pending: false },
			);
			pairs.push([id, inflow]);
		} else if (index % 50 === 1) {
			const magnitude = 1000 + (index % 7919);
			rows.push(
				{ id, accountId: jointId, date, amount: -magnitude, pending: false },
				{
					id: crypto.randomUUID(),
					accountId: cardId,
					date: dayOf(Math.min(offset + 1, DAYS - 1)),
					amount: magnitude,
					pending: false,
				},
			);
		} else {
			rows.push({
				id,
				accountId: index % 3 === 0 ? cardId : jointId,
				date,
				amount: index % 97 === 0 ? 250_000 : -(100 + (index % 9973)),
				// The last days hold a few lines the bank has not booked yet.
				pending: offset > DAYS - 4 && index % 5 === 0,
			});
		}
	}

	return { rows: rows.slice(0, ROWS), pairs };
}

/** A security's close on the `day`-th day of the decade, in millionths of a euro. */
const closeOf = (security: number, day: number) =>
	toMicros((50 + security * 10 + (day % 100)) * 1_000_000);

/** Today's close as the timed fetch writes it: a euro above the seeded one. */
const closeToday = (security: number) => toMicros(closeOf(security, DAYS) + 1_000_000);

/**
 * Ten years of a PEA beside the household: twenty securities priced every
 * day up to today, each bought on the first day of every month and partly
 * sold every twelfth, inserted directly as the transactions are, then one
 * ledger recompute that writes its holdings and balances.
 */
async function seedInvestments() {
	const last = today(TIME_ZONE);
	const first = addDays(last, -DAYS);
	const pea = await createAccount(
		deps(),
		{
			name: "PEA",
			type: "investment",
			subtype: "pea",
			currency: "EUR",
			openingBalance: toMinorUnits(10_000_000),
			openingDate: addDays(first, -1),
		},
		{ origin: "user" },
	);
	const now = Date.UTC(2026, 0, 1);
	securityIds = Array.from({ length: SECURITIES }, () => crypto.randomUUID());

	await temp.db.insert(securities).values(
		securityIds.map((id, index) => ({
			id,
			isin: null,
			ticker: `T${index}.PA`,
			mic: "XPAR",
			name: `Titre ${index}`,
			currency: "EUR",
			provider: "yahoo" as const,
			createdAt: now,
			updatedAt: now,
		})),
	);

	const days = Array.from({ length: DAYS + 1 }, (_, day) => ({ day, date: addDays(first, day) }));
	const prices = securityIds.flatMap((securityId, security) =>
		days.map(({ day, date }) => ({
			securityId,
			date,
			price: closeOf(security, day),
			currency: "EUR",
			source: "provider" as const,
		})),
	);

	await chunksOf(prices, 1000).reduce(async (previous, chunk) => {
		await previous;
		await temp.db.insert(securityPrices).values(chunk);
	}, Promise.resolve());

	const monthly = days.filter(({ date }) => date.endsWith("-01"));
	peaId = pea.id;
	heldDays = DAYS + 1 - (monthly[0]?.day ?? 0);
	const rows = securityIds.flatMap((securityId, security) =>
		monthly.map(({ day, date }, month) => {
			const quantity = toMicros(month % 12 === 11 ? -6_000_000 : 1_000_000);
			const price = closeOf(security, day);
			const fee = toMinorUnits(100);

			return {
				id: crypto.randomUUID(),
				date,
				securityId,
				quantity,
				price,
				fee,
				amount: tradeAmount({ quantity, price, fee }, "EUR") ?? 0,
			};
		}),
	);

	await chunksOf(rows, 1000).reduce(async (previous, chunk, number) => {
		await previous;
		await temp.db.insert(entries).values(
			chunk.map((row, index) => ({
				id: row.id,
				accountId: pea.id,
				kind: "trade" as const,
				date: row.date,
				amount: row.amount,
				currency: "EUR",
				createdAt: now + number * 1000 + index,
				updatedAt: now + number * 1000 + index,
			})),
		);
		await temp.db.insert(trades).values(
			chunk.map((row) => ({
				entryId: row.id,
				securityId: row.securityId,
				quantity: row.quantity,
				price: row.price,
				fee: row.fee,
			})),
		);
	}, Promise.resolve());

	await temp.db.transaction(
		async (tx) => recomputeBalances(tx, pea, addDays(first, -1), TIME_ZONE),
		{ behavior: "immediate" },
	);
}

async function seed() {
	jointId = await openAccount("Compte joint", "checking");
	savingsId = await openAccount("Livret A", "savings");
	cardId = await openAccount("Carte", "checking");
	const { rows, pairs } = seedRows();
	const now = Date.UTC(2026, 0, 1);
	const kept = new Set(rows.map((row) => row.id));
	suggestedId = rows.find((row, index) => index % 50 === 1 && row.amount < 0)?.id ?? "";

	// Seeded directly: the ledger would recompute ten years of balances per row,
	// and only the read paths are being measured. In sequence, so each chunk's
	// transaction rows find their entries.
	await chunksOf(rows, 2000).reduce(async (previous, chunk, number) => {
		await previous;
		const start = number * 2000;
		await temp.db.insert(entries).values(
			chunk.map((row, index) => ({
				id: row.id,
				accountId: row.accountId,
				kind: "transaction" as const,
				date: row.date,
				amount: row.amount,
				currency: "EUR",
				createdAt: now + start + index,
				updatedAt: now + start + index,
			})),
		);
		await temp.db.insert(transactions).values(
			chunk.map((row, index) => ({
				entryId: row.id,
				label: `CB MAGASIN ${(start + index) % 300}`,
				pending: row.pending,
			})),
		);
	}, Promise.resolve());

	const linked = pairs.filter(([outflow, inflow]) => kept.has(outflow) && kept.has(inflow));

	await chunksOf(linked, 500).reduce(async (previous, chunk) => {
		await previous;
		await temp.db.insert(transfers).values(
			chunk.map(([outflow, inflow]) => ({
				id: crypto.randomUUID(),
				outflowTransactionId: outflow,
				inflowTransactionId: inflow,
				kind: "internal_move" as const,
				createdAt: now,
			})),
		);
	}, Promise.resolve());

	await seedInvestments();
	await refreshStatistics(temp.db);
}

/** A statement Drizzle sent to libSQL: its text and its positional arguments. */
const capturedSchema = z.object({
	sql: z.string(),
	args: z.array(z.union([z.string(), z.number(), z.bigint(), z.boolean(), z.null()])),
});

type Captured = z.infer<typeof capturedSchema>;

/** Every statement `run` sent through the client, outside a transaction. */
async function statementsOf(run: () => Promise<unknown>): Promise<Captured[]> {
	const spy = vi.spyOn(temp.db.$client, "execute");

	try {
		await run();

		return spy.mock.calls.map(([statement]) => capturedSchema.parse(statement));
	} finally {
		spy.mockRestore();
	}
}

/** `EXPLAIN QUERY PLAN` of `statement`, one detail per line. */
async function planOf(statement: Captured): Promise<string> {
	const result = await temp.db.$client.execute({
		sql: `EXPLAIN QUERY PLAN ${statement.sql}`,
		args: statement.args,
	});

	return result.rows.map((row) => z.string().parse(row["detail"])).join("\n");
}

/**
 * The index gives the order by date, and only the rows of one day are sorted
 * by the rest. SQLite 3.45, which libSQL embeds, says « right part »; newer
 * releases say « last 3 terms ». A sort of the whole result says neither.
 */
const WITHIN_A_DAY = /USE TEMP B-TREE FOR (?:RIGHT PART|LAST 3 TERMS) OF ORDER BY/u;

function only(statements: Captured[], pattern: RegExp): Captured {
	const found = statements.filter((statement) => pattern.test(statement.sql));

	expect(found).toHaveLength(1);
	const [statement] = found;

	if (statement === undefined) {
		throw new Error(`No statement matches ${pattern.source}.`);
	}

	return statement;
}

/** Reads `reader` to its end, handing each chunk to `take` as it arrives. */
async function readToEnd(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	take: (chunk: Uint8Array) => void,
): Promise<void> {
	const read = await reader.read();

	if (!read.done) {
		take(read.value);
		await readToEnd(reader, take);
	}
}

/**
 * How long this machine takes to write a statement's worth of bare rows: in
 * a database of its own, one transaction inserting `OFX_LINES` entries and
 * their transactions, in the ledger's chunks. The median of five passes, so
 * one slow pass does not set it.
 */
async function bareWritesMs(): Promise<number> {
	const scratch = await createTempDatabase();

	try {
		const account = await createAccount(
			{ db: scratch.db, timeZone: TIME_ZONE },
			{
				name: "Étalon",
				type: "depository",
				subtype: "checking",
				currency: "EUR",
				openingBalance: toMinorUnits(0),
				openingDate: "2016-01-01",
			},
			{ origin: "user" },
		);
		const pass = async () => {
			const rows = Array.from({ length: OFX_LINES }, (_, index) => ({
				id: crypto.randomUUID(),
				date: dayOf(Math.floor((index * DAYS) / OFX_LINES)),
				amount: -(100 + (index % 9973)),
				label: `PRLV ${index % 300}`,
			}));
			const started = performance.now();

			await scratch.db.transaction(async (tx) =>
				inSequence(rows, ROWS_PER_INSERT, async (chunk) => {
					await tx.insert(entries).values(
						chunk.map((row) => ({
							id: row.id,
							accountId: account.id,
							kind: "transaction" as const,
							date: row.date,
							amount: row.amount,
							currency: "EUR",
							createdAt: 0,
							updatedAt: 0,
						})),
					);
					await tx
						.insert(transactions)
						.values(chunk.map((row) => ({ entryId: row.id, label: row.label })));
				}),
			);

			return performance.now() - started;
		};
		const passes = await Array.from({ length: 5 }).reduce<Promise<number[]>>(
			async (previous) => [...(await previous), await pass()],
			Promise.resolve([]),
		);

		return passes.toSorted((a, b) => a - b)[2] ?? Number.NaN;
	} finally {
		await scratch.dispose();
	}
}

/** The milliseconds `run` takes, after one warm-up run as a running server has had. */
async function timed(run: () => Promise<unknown>): Promise<number> {
	await run();
	const started = performance.now();
	await run();

	return performance.now() - started;
}

beforeAll(async () => {
	temp = await createTempDatabase();
	await seed();
}, 120_000);

afterAll(async () => {
	await temp.dispose();
});

describe("NFR10 at 100,000 transactions", () => {
	it("answers the first page of the transaction list and its totals in under 150 ms", async () => {
		const page = await listAllTransactions(deps(), listQuery);
		const totals = await transactionTotals(deps(), {});

		expect(page.items).toHaveLength(50);
		expect(totals.total).toBe(ROWS);
		await expect(
			timed(async () =>
				Promise.all([listAllTransactions(deps(), listQuery), transactionTotals(deps(), {})]),
			),
		).resolves.toBeLessThan(PAGE_MS);
	});

	it("answers the first page of « Dépenses » and its totals in under 150 ms", async () => {
		await expect(
			timed(async () =>
				Promise.all([
					listAllTransactions(deps(), { ...listQuery, ...expenses }),
					transactionTotals(deps(), expenses),
				]),
			),
		).resolves.toBeLessThan(PAGE_MS);
	});

	it.each([
		["the largest", { sort: { by: "amount", order: "desc" } }, {}],
		["the oldest", { sort: { by: "date", order: "asc" } }, {}],
		["the booked lines'", { pending: false }, { pending: false }],
	] as const)(
		"answers the assistant's first page of %s transactions and its totals in under 150 ms",
		async (_name, extra, totalsQuery) => {
			const query = { ...listQuery, ...extra };
			const page = await listAllTransactions(deps(), query);

			expect(page.items).toHaveLength(50);
			await expect(
				timed(async () =>
					Promise.all([listAllTransactions(deps(), query), transactionTotals(deps(), totalsQuery)]),
				),
			).resolves.toBeLessThan(PAGE_MS);
		},
	);

	it("answers the first page of an account in under 150 ms", async () => {
		const page = await listAccountTransactions(deps(), jointId, listQuery);

		expect(page.items).toHaveLength(50);
		await expect(
			timed(async () => listAccountTransactions(deps(), jointId, listQuery)),
		).resolves.toBeLessThan(PAGE_MS);
	});

	// One read of the whole history each, which the medians need.
	it("answers the assistant's income statement over ten years and 36 months by month in under 300 ms each", async () => {
		const decade = { from: dayOf(0), to: dayOf(DAYS - 1), byMonth: false, comparePrevious: true };
		const months = { from: "2023-10-01", to: "2026-09-30", byMonth: true, comparePrevious: true };
		const statement = await getIncomeStatement(deps(), decade);

		expect(statement.expenses).toBeLessThan(0);
		expect(statement.breakdown?.medianMonthlyExpenses).toBeLessThan(0);
		expect((await getIncomeStatement(deps(), months)).months).toHaveLength(36);
		await expect(timed(async () => getIncomeStatement(deps(), decade))).resolves.toBeLessThan(
			REPORT_MS,
		);
		await expect(timed(async () => getIncomeStatement(deps(), months))).resolves.toBeLessThan(
			REPORT_MS,
		);
	});

	it("answers the assistant's balance sheet over ten years by month and 400 days by day in under 150 ms each", async () => {
		const decade = { period: "last_10_years", interval: "1 month" } as const;
		const days = {
			from: addDays(today(TIME_ZONE), -399),
			to: today(TIME_ZONE),
			interval: "1 day",
		} as const;

		expect((await getBalanceSheet(deps(), decade)).series.netWorth).toHaveLength(121);
		expect((await getBalanceSheet(deps(), days)).series.netWorth).toHaveLength(400);
		await expect(timed(async () => getBalanceSheet(deps(), decade))).resolves.toBeLessThan(PAGE_MS);
		await expect(timed(async () => getBalanceSheet(deps(), days))).resolves.toBeLessThan(PAGE_MS);
	});

	// Before the import below, which adds its own lines.
	it("streams the whole export in under 10 seconds, its first bytes early and half of them before the end", async () => {
		const chunks: Uint8Array[] = [];
		const arrivals: { at: number; bytes: number }[] = [];
		const started = performance.now();
		const reader = exportArchive({ ...importDeps(), db: temp.db }).body.getReader();

		await readToEnd(reader, (chunk) => {
			arrivals.push({ at: performance.now() - started, bytes: chunk.length });
			chunks.push(chunk);
		});

		const elapsed = performance.now() - started;
		const archive = unzipSync(new Uint8Array(await new Blob(chunks).arrayBuffer()));
		const csvLines = new TextDecoder().decode(archive["transactions.csv"]).split("\n");

		expect(elapsed).toBeLessThan(EXPORT_MS);
		// Streamed: buffered pages would send nearly every byte at the very end.
		const total = arrivals.reduce((sum, arrival) => sum + arrival.bytes, 0);
		const sentBy = (moment: number) =>
			arrivals
				.filter((arrival) => arrival.at <= moment)
				.reduce((sum, arrival) => sum + arrival.bytes, 0);

		expect(arrivals[0]?.at ?? elapsed).toBeLessThan(elapsed / 2);
		expect(sentBy(elapsed * 0.8)).toBeGreaterThanOrEqual(total / 2);
		// The header, every transaction, and the empty string after the last newline.
		expect(csvLines).toHaveLength(ROWS + 2);
		// A holding a day for each security, from its first trade on.
		const holdingLines = new TextDecoder()
			.decode(archive["all.ndjson"])
			.split("\n")
			.filter((line) => line.startsWith('{"type":"Holding"'));
		expect(holdingLines).toHaveLength(SECURITIES * heldDays);
		// Pulled a page at a time: no single chunk holds a whole file.
		expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThan(1024 * 1024);
	}, 60_000);

	it("values twenty securities again after a day's prices in under a second", async () => {
		// The daily fetch writes again from its earliest provisional day.
		const day = today(TIME_ZONE);
		const from = addDays(day, -7);
		// As `priceSecurity`: the day's price and its holders' values in one transaction.
		const revalueAll = async () =>
			securityIds.reduce(async (previous, securityId, security) => {
				await previous;
				await temp.db.transaction(
					async (tx) => {
						await tx
							.insert(securityPrices)
							.values({
								securityId,
								date: day,
								price: closeToday(security),
								currency: "EUR",
								source: "provider",
							})
							.onConflictDoUpdate({
								target: [securityPrices.securityId, securityPrices.date],
								set: { price: closeToday(security) },
							});
						await revalueHoldings(tx, securityId, from, TIME_ZONE, { origin: "provider" });
					},
					{ behavior: "immediate" },
				);
			}, Promise.resolve());

		await expect(timed(revalueAll)).resolves.toBeLessThan(REVALUE_MS);
		const [held] = await temp.db
			.select({ price: holdings.price })
			.from(holdings)
			.where(
				and(
					eq(holdings.accountId, peaId),
					eq(holdings.securityId, securityIds[0] ?? ""),
					eq(holdings.date, day),
				),
			);
		expect(held?.price).toBe(closeToday(0));
	});

	it("confirms a 24,000-line OFX file in under five times the bare writes of its lines", async () => {
		const accountId = await openAccount("Compte courant", "checking");
		const lines = Array.from({ length: OFX_LINES }, (_, index) => {
			const date = dayOf(Math.floor((index * DAYS) / OFX_LINES)).replaceAll("-", "");
			const cents = 100 + (index % 9973);

			return `<STMTTRN><DTPOSTED>${date}<TRNAMT>-${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}<FITID>F${index}<NAME>PRLV ${index % 300}</STMTTRN>`;
		});
		const bytes = new TextEncoder().encode(
			`<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKTRANLIST>\n${lines.join("\n")}\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`,
		);
		const created = await createImport(importDeps(), accountId, { name: "releve.ofx", bytes });
		await previewImport(importDeps(), created.id, { moveOpeningDate: null });

		const started = performance.now();
		const confirmed = await confirmImport(importDeps(), created.id);
		const elapsed = performance.now() - started;
		const bare = await bareWritesMs();

		expect(confirmed.counts.created).toBe(OFX_LINES);
		expect(elapsed / bare).toBeLessThan(IMPORT_RATIO);
	}, 60_000);
});

describe("query plans at 100,000 transactions", () => {
	it("finds a transfer candidate by the source's key and the amount index", async () => {
		const statements = await statementsOf(async () => listTransferCandidates(deps(), suggestedId));
		const plan = await planOf(only(statements, /"source_entry"/u));

		expect(plan).toMatch(/SEARCH source_entry USING INDEX sqlite_autoindex_entries_1 \(id=\?\)/u);
		expect(plan).toMatch(
			/SEARCH entries USING INDEX entries_kind_amount_date \(kind=\? AND amount=\? AND date>\? AND date<\?\)/u,
		);
		expect(plan).not.toMatch(/entries_kind_amount_date \(kind=\?\)/u);
		expect(plan).not.toMatch(/SCAN source_account/u);
	});

	it.each([
		["every transaction", {}],
		["« Dépenses »", expenses],
	])("sums %s from the covering index, with no correlated subquery", async (_name, filter) => {
		const statements = await statementsOf(async () => transactionTotals(deps(), filter));
		const plan = await planOf(only(statements, /group by/u));

		expect(plan).toMatch(/USING COVERING INDEX entries_kind_currency_amount/u);
		expect(plan).not.toMatch(/CORRELATED/u);
		// The split parents' ids, read once from the partial index, never the table.
		expect(plan).toMatch(/split_child USING COVERING INDEX entries_parent_entry/u);
		expect(plan).not.toMatch(/SCAN split_child/u);
	});

	it.each([
		["every transaction", () => ({})],
		["« Dépenses »", () => expenses],
		["two accounts", () => ({ account: [jointId, cardId] })],
	])("lists %s from the date index, sorting only within a day", async (_name, filterOf) => {
		const statements = await statementsOf(async () =>
			listAllTransactions(deps(), { ...listQuery, ...filterOf() }),
		);
		const plan = await planOf(
			only(statements, /order by "entries"."date" desc, "transactions"."pending" desc/u),
		);

		expect(plan).toMatch(/SEARCH entries USING INDEX entries_kind_date \(kind=\?\)/u);
		expect(plan).toMatch(WITHIN_A_DAY);
	});

	it("reads each page of the export's transactions from the date index, after the last one", async () => {
		const statements = await statementsOf(async () => {
			const pages = transactionPages(temp.db, "lines");
			await pages.next();
			await pages.next();
			await pages.return(undefined);
		});
		const plan = await planOf(
			only(statements, /\("entries"\."date", "entries"\."created_at", "entries"\."id"\) >/u),
		);

		expect(plan).toMatch(
			/SEARCH entries USING INDEX entries_kind_date \(kind=\? AND \(date,created_at,id\)>\(\?,\?,\?\)\)/u,
		);
		expect(plan).not.toMatch(/TEMP B-TREE/u);
	});

	it("lists one account from its date index, sorting only within a day", async () => {
		const statements = await statementsOf(async () =>
			listAccountTransactions(deps(), jointId, listQuery),
		);
		const plan = await planOf(
			only(statements, /order by "entries"."date" desc, "transactions"."pending" desc/u),
		);

		expect(plan).toMatch(/SEARCH entries USING INDEX entries_account_date \(account_id=\?\)/u);
		expect(plan).toMatch(WITHIN_A_DAY);
	});
});
