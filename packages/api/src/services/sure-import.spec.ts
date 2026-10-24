import type { TempDatabase } from "../testing/temp-database.ts";

import { sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CATEGORY_COLORS } from "@archant/data/category-presets";
import type { Database } from "@archant/data/client";

import { createLogger } from "../lib/logger.ts";
import {
	openOwn,
	own,
	ownCategory,
	ownDatabase,
	postOwn,
	sendOwn,
	useSignedInApp,
} from "../testing/app.ts";
import { insertSecurity } from "../testing/prices.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import { exportArchive } from "./export.ts";
import { seedDefaults } from "./seed.ts";
import {
	DEFAULT_SURE_IMPORT_LIMITS,
	importSureArchive,
	preflightSureImport,
} from "./sure-import.ts";

useSignedInApp();

// The clock is 2026-09-21 10:00 UTC, noon in Europe/Paris.

function source(): Database {
	if (own === undefined) {
		throw new Error("The test has no database of its own.");
	}

	return own.db;
}

const logger = createLogger("silent");

/** The `all.ndjson` of the test's own database, as its export writes it. */
async function allNdjson(db: Database = source()): Promise<Uint8Array> {
	const archive = exportArchive({ db, timeZone: "Europe/Paris", logger });
	const files = unzipSync(new Uint8Array(await new Response(archive.body).arrayBuffer()));
	const bytes = files["all.ndjson"];

	if (bytes === undefined) {
		throw new Error("The archive has no all.ndjson.");
	}

	return bytes;
}

async function created(path: string, json: Record<string, unknown>) {
	const body = await sendOwn("POST", path, json);

	return z.object({ data: z.object({ id: z.string() }) }).parse(body).data.id;
}

async function account(json: Record<string, unknown>) {
	return created("/api/accounts", {
		currency: "EUR",
		openingDate: "2026-04-01",
		openingBalance: "0",
		subtype: null,
		...json,
	});
}

/**
 * A household with an account of several kinds, a loan's details, categories
 * of two levels, tags, a merchant, a split, transfers of each kind and one
 * refused, a snapshot, trades and holdings, budgets and rules.
 */
async function household() {
	await ownDatabase();
	await seedDefaults({ db: source() });
	const checking = (
		await openOwn({ name: "Compte joint", openingBalance: "2 000,00", openingDate: "2026-04-01" })
	).id;
	const savings = await account({
		name: "Livret A",
		type: "depository",
		subtype: "savings",
		openingBalance: "500",
	});
	const card = await account({ name: "Carte", type: "credit_card", openingBalance: "100" });
	const loan = await account({
		name: "Crédit auto",
		type: "loan",
		subtype: "auto",
		openingBalance: "12 000",
		details: {
			originalAmount: "15 000",
			startDate: "2025-01-15",
			termMonths: "60",
			rateType: "fixed",
			interestRate: "3,45",
		},
	});
	const pea = await account({
		name: "PEA",
		type: "investment",
		subtype: "pea",
		openingBalance: "1 000",
		institutionName: "Boursorama",
		institutionDomain: "boursorama.com",
		notes: "Ouvert en 2019",
	});
	const car = await account({ name: "Voiture", type: "vehicle", openingBalance: "9 000" });
	await sendOwn("PATCH", `/api/accounts/${car}`, { active: false });

	const food = await ownCategory("Alimentation");
	const bakery = await ownCategory("Boulangerie", { parentId: food });
	const trip = await created("/api/tags", { name: "Voyage" });
	const baker = await created("/api/merchants", {
		name: "Boulanger du coin",
		websiteUrl: "boulanger.test",
	});

	const bread = await postOwn(checking, {
		date: "2026-09-10",
		label: "CB BOULANGERIE",
		amount: "-42,90",
	});
	await sendOwn("PATCH", `/api/transactions/${bread}`, {
		categoryId: bakery,
		merchantId: baker,
		tagIds: [trip],
		notes: "Pain",
	});
	const groceries = await postOwn(checking, {
		date: "2026-09-12",
		label: "SUPERMARCHE",
		amount: "-100,00",
	});
	await sendOwn("POST", `/api/transactions/${groceries}/split`, {
		lines: [
			{ label: "Courses", amount: "-60,00", categoryId: food },
			{ label: "Pain", amount: "-40,00", categoryId: bakery, tagIds: [trip] },
		],
	});
	const salary = await postOwn(checking, {
		date: "2026-08-28",
		label: "SALAIRE",
		amount: "2 500,00",
	});
	// What only Archant's own export carries, under `archant`, with values other than the defaults.
	await source().run(sql`update transactions set reference = 'CHQ 1234567', possible_duplicate = 1,
		category_id = ${food}, category_origin = 'rule',
		locked_fields = '{"label":1790000000000,"notes":null}' where entry_id = ${salary}`);
	const pendingCard = await postOwn(checking, {
		date: "2026-09-14",
		label: "CB EN COURS",
		amount: "-12,00",
	});
	await source().run(sql`update transactions set pending = 1 where entry_id = ${pendingCard}`);
	const dividend = await postOwn(pea, { date: "2026-09-09", label: "COUPON", amount: "15,00" });
	await sendOwn("PATCH", `/api/transactions/${dividend}`, { investmentActivityLabel: "Dividend" });
	const rent = await postOwn(checking, { date: "2026-09-01", label: "LOYER", amount: "-900,00" });
	const series = await created("/api/recurring", { entryId: rent });
	await sendOwn("PATCH", `/api/recurring/${series}`, { status: "inactive" });

	const move = async (from: string, to: string, date: string, amount: string) => {
		const outflow = await postOwn(from, { date, label: "Virement", amount: `-${amount}` });
		const inflow = await postOwn(to, { date, label: "Virement reçu", amount });
		const [row] = await source().all<{ id: string }>(
			sql`select id from transfers where outflow_transaction_id = ${outflow}`,
		);

		if (row === undefined) {
			await sendOwn("POST", "/api/transfers", { transactionId: outflow, counterpartId: inflow });
		}

		return outflow;
	};

	await move(checking, savings, "2026-09-02", "100,00");
	await move(checking, card, "2026-09-03", "80,00");
	await move(checking, loan, "2026-09-04", "300,00");
	await move(checking, pea, "2026-09-05", "200,00");
	await move(checking, savings, "2026-09-06", "33,00");
	const [refused] = await source().all<{ id: string }>(
		sql`select t.id from transfers t join entries e on e.id = t.outflow_transaction_id where e.date = '2026-09-06'`,
	);
	await sendOwn("POST", `/api/transfers/${refused?.id}/reject`);

	await sendOwn("POST", `/api/accounts/${checking}/snapshots`, {
		date: "2026-09-15",
		balance: "1 700,00",
	});

	const lvmh = await insertSecurity(source(), {}, { held: false });
	await created(`/api/accounts/${pea}/trades`, {
		side: "buy",
		security: { source: "known", id: lvmh },
		date: "2026-09-10",
		quantity: "1",
		price: "612,40",
		fee: "2,50",
	});
	await created(`/api/accounts/${pea}/trades`, {
		side: "sell",
		security: { source: "known", id: lvmh },
		date: "2026-09-12",
		quantity: "0,5",
		price: "650",
		fee: "0",
	});
	await created(`/api/accounts/${pea}/trades`, {
		side: "buy",
		security: { source: "manual", isin: "FR0010315770", name: "Fonds euros" },
		date: "2026-09-11",
		quantity: "100",
		price: "1",
		fee: "0",
	});

	await sendOwn("PUT", "/api/budgets/2026-09", {
		budgetedSpending: "1 000",
		expectedIncome: "2 500",
	});
	await sendOwn("PUT", `/api/budgets/2026-09/categories/${food}`, { budgetedSpending: "300" });

	await created("/api/rules", {
		name: "Boulangerie",
		conditions: [
			{ conditionType: "transaction_name", operator: "like", value: "BOULANGERIE" },
			{ conditionType: "transaction_amount", operator: ">", value: "10,50" },
		],
		actions: [
			{ actionType: "set_transaction_category", value: bakery },
			{ actionType: "set_transaction_merchant", value: baker },
			{ actionType: "set_transaction_tags", value: trip },
			{ actionType: "replace_in_transaction_name", value: "^CB ", replacement: "" },
		],
	});
	const off = await created("/api/rules", {
		name: "Épargne",
		conditions: [{ conditionType: "transaction_account", operator: "=", value: savings }],
		actions: [{ actionType: "exclude_transaction", value: null }],
	});
	await sendOwn("PATCH", `/api/rules/${off}`, { enabled: false });
}

/** What a database holds, by names rather than ids, in a stable order. */
async function snapshotOf(db: Database) {
	const rows = <Row>(query: ReturnType<typeof sql>) => db.all<Row>(query);

	return {
		accounts: await rows(
			sql`select name, type, subtype, currency, active, excluded_from_reports as excluded, details,
				notes, institution_name as institutionName, institution_domain as institutionDomain from accounts order by name`,
		),
		balances: await rows(
			sql`select a.name, b.date, b.balance from balances b join accounts a on a.id = b.account_id order by a.name, b.date`,
		),
		transactions: await rows(sql`
			select a.name as account, e.date, e.amount, t.label, t.notes, t.excluded, t.one_time as oneTime, t.pending,
				t.reference, t.possible_duplicate as possibleDuplicate, t.category_origin as categoryOrigin,
				t.locked_fields as lockedFields, t.investment_activity_label as activityLabel,
				c.name as category, m.name as merchant, p.date as parentDate,
				(select group_concat(g.name) from taggings x join tags g on g.id = x.tag_id where x.transaction_id = t.entry_id) as tags
			from transactions t join entries e on e.id = t.entry_id join accounts a on a.id = e.account_id
			left join categories c on c.id = t.category_id left join merchants m on m.id = t.merchant_id
			left join entries p on p.id = e.parent_entry_id
			order by a.name, e.date, e.amount, t.label`),
		transfers: await rows(sql`
			select ao.name as outflow, ai.name as inflow, t.kind, t.status from transfers t
			join entries eo on eo.id = t.outflow_transaction_id join accounts ao on ao.id = eo.account_id
			join entries ei on ei.id = t.inflow_transaction_id join accounts ai on ai.id = ei.account_id
			order by eo.date`),
		rejected: await rows(sql`select count(*) as count from rejected_transfers`),
		valuations: await rows(sql`
			select a.name, e.date, e.amount, e.valuation_kind as kind from entries e join accounts a on a.id = e.account_id
			where e.kind = 'valuation' order by a.name, e.date`),
		trades: await rows(sql`
			select a.name as account, e.date, e.amount, s.name as security, t.quantity, t.price, t.fee, t.income_kind as income
			from trades t join entries e on e.id = t.entry_id join accounts a on a.id = e.account_id
			left join securities s on s.id = t.security_id order by e.date, s.name`),
		holdings: await rows(sql`
			select a.name as account, s.name as security, h.date, h.quantity, h.amount
			from holdings h join accounts a on a.id = h.account_id join securities s on s.id = h.security_id
			order by a.name, s.name, h.date`),
		categories: await rows(sql`
			select c.name, c.color, c.icon, p.name as parent from categories c left join categories p on p.id = c.parent_id order by c.name`),
		tags: await rows(sql`select name, color from tags order by name`),
		merchants: await rows(sql`select name, color, website_url from merchants order by name`),
		budgets: await rows(
			sql`select month, currency, budgeted_spending as spending, expected_income as income from budgets order by month`,
		),
		budgetCategories: await rows(sql`
			select b.month, c.name, x.budgeted_spending as amount from budget_categories x
			join budgets b on b.id = x.budget_id join categories c on c.id = x.category_id order by b.month, c.name`),
		// Sure's one `name` is the typed name, else the label: the shown name survives.
		recurring: await rows(sql`
			select coalesce(r.name, r.label) as shown, r.label, r.label_key as labelKey, r.amount, r.currency, r.status, r.manual, r.bill_type as billType,
				r.expected_day_of_month as day, a.name as account,
				(select group_concat(x.frequency || ':' || x.interval || ':' || coalesce(x.day_of_month, '')) from recurrence_rules x where x.recurring_transaction_id = r.id) as rules
			from recurring_transactions r left join accounts a on a.id = r.account_id where r.manual = 1 order by r.amount`),
		rules: await rows(
			sql`select name, enabled, effective_date as effectiveDate from rules order by name`,
		),
		// An id stored in a value reads as the name of the row it names.
		actions: await rows(sql`
			select r.name, a.action_type as type, a.replacement,
				coalesce(c.name, m.name, g.name, x.name, a.value) as value
			from rule_actions a join rules r on r.id = a.rule_id
			left join categories c on c.id = a.value left join merchants m on m.id = a.value
			left join tags g on g.id = a.value left join accounts x on x.id = a.value
			order by r.name, a.position`),
		conditions: await rows(sql`
			select r.name, c.condition_type as type, c.operator, c.parent_id is not null as nested,
				coalesce(k.name, m.name, g.name, x.name, c.value) as value
			from rule_conditions c join rules r on r.id = c.rule_id
			left join categories k on k.id = c.value left join merchants m on m.id = c.value
			left join tags g on g.id = c.value left join accounts x on x.id = c.value
			order by r.name, c.position, c.parent_id is not null`),
	};
}

const line = (type: string, data: Record<string, unknown>) => ({ type, data });

/** Imports hand-written Sure lines into the test's own database. */
async function importLines(lines: readonly unknown[]) {
	return importSureArchive(
		{ db: source(), timeZone: "Europe/Paris", logger },
		{
			name: "all.ndjson",
			bytes: new TextEncoder().encode(lines.map((row) => JSON.stringify(row)).join("\n")),
		},
		DEFAULT_SURE_IMPORT_LIMITS,
	);
}

const rent = (id: string) =>
	line("RecurringTransaction", {
		id,
		account_id: "a",
		name: "Loyer",
		amount: "900",
		currency: "EUR",
		expected_day_of_month: 1,
		last_occurrence_date: "2026-09-01",
		next_expected_date: "2026-10-01",
		status: "active",
	});

async function intoNewDatabase(bytes: Uint8Array) {
	const target = await createTempDatabase();
	await seedDefaults({ db: target.db });
	const result = await importSureArchive(
		{ db: target.db, timeZone: "Europe/Paris", logger },
		{ name: "all.ndjson", bytes },
		DEFAULT_SURE_IMPORT_LIMITS,
	);

	return { target, result };
}

async function disposed<Value>(target: TempDatabase, read: () => Promise<Value>) {
	try {
		return await read();
	} finally {
		await target.dispose();
	}
}

describe("importSureArchive", () => {
	it("imports an Archant export into a new database: the same accounts, balances and transactions", async () => {
		await household();
		const bytes = await allNdjson();
		const before = await snapshotOf(source());
		const { target, result } = await intoNewDatabase(bytes);

		await disposed(target, async () => {
			const after = await snapshotOf(target.db);

			expect(result.counts.accounts).toBe(6);
			expect(after.accounts).toEqual(before.accounts);
			expect(after.balances).toEqual(before.balances);
			expect(after.transactions).toEqual(before.transactions);
			expect(before.transactions).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						label: "SALAIRE",
						reference: "CHQ 1234567",
						possibleDuplicate: 1,
						categoryOrigin: "rule",
						lockedFields: '{"label":1790000000000,"notes":null}',
					}),
					expect.objectContaining({ label: "CB EN COURS", pending: 1 }),
					expect.objectContaining({ label: "COUPON", activityLabel: "Dividend" }),
				]),
			);
			expect(before.accounts).toContainEqual(
				expect.objectContaining({
					name: "PEA",
					notes: "Ouvert en 2019",
					institutionName: "Boursorama",
					institutionDomain: "boursorama.com",
				}),
			);
			expect(after.transfers).toEqual(before.transfers);
			expect(after.rejected).toEqual(before.rejected);
			expect(after.valuations).toEqual(before.valuations);
			expect(after.trades).toEqual(before.trades);
			expect(after.holdings).toEqual(before.holdings);
			// The default categories are reused, never doubled.
			expect(after.categories).toEqual(before.categories);
			expect(after.tags).toEqual(before.tags);
			expect(after.merchants).toEqual(before.merchants);
			expect(after.budgets).toEqual(before.budgets);
			expect(after.budgetCategories).toEqual(before.budgetCategories);
			expect(after.recurring).toEqual(before.recurring);
			expect(after.recurring).toHaveLength(1);
			expect(after.rules).toEqual(before.rules);
			expect(after.actions).toEqual(before.actions);
			expect(after.conditions).toEqual(before.conditions);
			expect(before.conditions).toContainEqual(
				expect.objectContaining({ type: "transaction_amount", operator: ">", value: "10.50" }),
			);
			expect(before.actions).toContainEqual(
				expect.objectContaining({ type: "set_transaction_category", value: "Boulangerie" }),
			);
		});
	});

	it("merges an archive into the household it came from, reusing every name", async () => {
		await household();
		const bytes = await allNdjson();
		const before = await snapshotOf(source());

		await importSureArchive(
			{ db: source(), timeZone: "Europe/Paris", logger },
			{ name: "all.ndjson", bytes },
			DEFAULT_SURE_IMPORT_LIMITS,
		);
		const after = await snapshotOf(source());

		expect(after.accounts).toHaveLength(before.accounts.length * 2);
		expect(after.transactions).toHaveLength(before.transactions.length * 2);
		expect(after.categories).toEqual(before.categories);
		expect(after.tags).toEqual(before.tags);
		expect(after.merchants).toEqual(before.merchants);
		expect(after.budgets).toEqual(before.budgets);
		expect(after.budgetCategories).toEqual(before.budgetCategories);
	});

	it("writes nothing when the preflight finds an error", async () => {
		await ownDatabase();
		const lines = [
			{
				type: "Account",
				data: {
					id: "a",
					name: "Compte",
					balance: "10",
					accountable_type: "Depository",
					currency: "EUR",
				},
			},
			{ type: "Transaction", data: { id: "t", account_id: "x", date: "2026-09-10", amount: "5" } },
		];
		const bytes = new TextEncoder().encode(lines.map((row) => JSON.stringify(row)).join("\n"));

		await expect(
			importSureArchive(
				{ db: source(), timeZone: "Europe/Paris", logger },
				{ name: "all.ndjson", bytes },
				DEFAULT_SURE_IMPORT_LIMITS,
			),
		).rejects.toMatchObject({ code: "SURE_IMPORT_INVALID" });
		expect(await source().all(sql`select id from accounts where name = 'Compte'`)).toEqual([]);
	});

	it("previews without writing", async () => {
		await household();
		const bytes = await allNdjson();
		const accounts = await source().all(sql`select id from accounts`);
		const preflight = await preflightSureImport(
			{ db: source(), timeZone: "Europe/Paris" },
			{ name: "all.ndjson", bytes },
			DEFAULT_SURE_IMPORT_LIMITS,
		);

		expect(preflight.errors).toEqual([]);
		expect(preflight.counts).toMatchObject({ accounts: 6, transfers: 4, rejected_transfers: 1 });
		expect(
			preflight.warnings.every((warning) => warning.code === "existing_taxonomy_collision"),
		).toBe(true);
		expect(await source().all(sql`select id from accounts`)).toEqual(accounts);
	});

	it("gives an existing month the file's totals and currency, every category its line, and skips another currency", async () => {
		await ownDatabase();
		const salary = await ownCategory(`Salaire ${crypto.randomUUID()}`);
		const food = await ownCategory(`Courses ${crypto.randomUUID()}`);
		await sendOwn("PUT", "/api/budgets/2026-09", {
			budgetedSpending: "500",
			expectedIncome: "900",
		});
		const names = await source().all<{ id: string; name: string }>(
			sql`select id, name from categories where id in (${salary}, ${food})`,
		);
		const nameOf = (id: string) => names.find((row) => row.id === id)?.name;

		await importLines([
			line("Category", { id: "c-salary", name: nameOf(salary), classification: "income" }),
			line("Category", { id: "c-food", name: nameOf(food) }),
			line("Budget", {
				id: "b1",
				start_date: "2026-09-01",
				end_date: "2026-09-30",
				budgeted_spending: "1200.00",
				expected_income: "3000.00",
				currency: "EUR",
			}),
			line("Budget", {
				id: "b2",
				start_date: "2026-10-01",
				end_date: "2026-10-31",
				budgeted_spending: "100",
				currency: "USD",
			}),
			line("BudgetCategory", { budget_id: "b1", category_id: "c-salary", budgeted_spending: "10" }),
			line("BudgetCategory", { budget_id: "b1", category_id: "c-food", budgeted_spending: "300" }),
		]);

		expect(
			await source().all(
				sql`select month, currency, budgeted_spending as spending, expected_income as income from budgets order by month`,
			),
		).toEqual([{ month: "2026-09", currency: "EUR", spending: 120000, income: 300000 }]);
		expect(
			await source().all(
				sql`select category_id as category, budgeted_spending as amount from budget_categories order by amount`,
			),
			// A category Sure once classified as income takes its line, as Sure's since #1160.
		).toEqual([
			{ category: salary, amount: 1000 },
			{ category: food, amount: 30000 },
		]);
	});

	it("takes a tag's and a merchant's colour as Sure writes it, and draws one it cannot read", async () => {
		await ownDatabase();
		const stamp = { created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" };

		await importLines([
			line("Tag", { id: "t1", name: "Vacances", color: "#DB5A54", ...stamp }),
			line("Tag", { id: "t2", name: "Travaux", ...stamp }),
			line("Merchant", {
				id: "m1",
				name: "Starbucks",
				color: "#4DA568",
				website_url: " starbucks.com ",
				...stamp,
			}),
			line("Merchant", { id: "m2", name: "Bar", color: "red", website_url: "", ...stamp }),
		]);

		const rows = z
			.array(z.object({ name: z.string(), color: z.string(), website: z.string().nullable() }))
			.parse(
				await source().all(
					sql`select name, color, website_url as website from merchants union all select name, color, null from tags`,
				),
			);
		const byName = new Map(rows.map((row) => [row.name, row]));

		expect(byName.get("Vacances")?.color).toBe("#db5a54");
		expect(byName.get("Starbucks")).toEqual({
			name: "Starbucks",
			color: "#4da568",
			website: "starbucks.com",
		});
		expect(CATEGORY_COLORS).toContain(byName.get("Travaux")?.color);
		expect(CATEGORY_COLORS).toContain(byName.get("Bar")?.color);
		expect(byName.get("Bar")?.website).toBeNull();
	});

	it("imports Sure's rules Archant can hold, and leaves nothing behind for one it skips", async () => {
		await ownDatabase();
		const condition = { condition_type: "transaction_name", operator: "like", value: "NETFLIX" };

		await importLines([
			line("Rule", {
				id: "r1",
				name: "Condition inconnue",
				active: true,
				conditions: [
					{ condition_type: "transaction_details", operator: "like", value: "x" },
					{ condition_type: "transaction_category", operator: "=", value: "Fantôme catégorie" },
				],
				actions: [{ action_type: "set_transaction_tags", value: "Fantôme étiquette" }],
			}),
			line("Rule", {
				id: "r2",
				name: "Action inconnue",
				active: true,
				conditions: [condition],
				actions: [{ action_type: "auto_categorize", value: null }],
			}),
			line("Rule", {
				id: "r3",
				name: "Abonnement",
				active: true,
				conditions: [condition],
				actions: [
					{ action_type: "send_email_notification", value: null },
					{ action_type: "set_transaction_merchant", value: "Netflix" },
				],
			}),
		]);

		expect(await source().all(sql`select name, enabled from rules`)).toEqual([
			{ name: "Abonnement", enabled: 1 },
		]);
		expect(await source().all(sql`select action_type as type from rule_actions`)).toEqual([
			{ type: "set_transaction_merchant" },
		]);
		expect(await source().all(sql`select name from merchants`)).toEqual([{ name: "Netflix" }]);
		expect(await source().all(sql`select name from tags`)).toEqual([]);
		expect(
			await source().all(sql`select name from categories where name = 'Fantôme catégorie'`),
		).toEqual([]);
	});

	it("imports Sure's tag action naming several tags as one action holding them all", async () => {
		await ownDatabase();

		await importLines([
			line("Rule", {
				id: "r1",
				name: "Voyages",
				active: true,
				conditions: [{ condition_type: "transaction_name", operator: "like", value: "SNCF" }],
				actions: [{ action_type: "set_transaction_tags", value: '"Voyage, été",Italie' }],
			}),
		]);

		const tagIds = new Map(
			(await source().all<{ id: string; name: string }>(sql`select id, name from tags`)).map(
				(tag) => [tag.name, tag.id],
			),
		);

		expect(await source().all(sql`select action_type as type, value from rule_actions`)).toEqual([
			{
				type: "set_transaction_tags",
				value: `${tagIds.get("Voyage, été")},${tagIds.get("Italie")}`,
			},
		]);
	});

	it("imports Sure's negative and empty operators, and skips a tag one Sure never applies", async () => {
		await ownDatabase();
		const actions = [{ action_type: "set_transaction_merchant", value: "Netflix" }];

		await importLines([
			line("Rule", {
				id: "r1",
				name: "Négatifs",
				active: true,
				conditions: [
					{ condition_type: "transaction_name", operator: "not_like", value: "NETFLIX" },
					{ condition_type: "transaction_notes", operator: "is_not_null", value: "" },
					{ condition_type: "transaction_merchant", operator: "!=", value: "Netflix" },
				],
				actions,
			}),
			line("Rule", {
				id: "r2",
				name: "Étiquette",
				active: true,
				conditions: [{ condition_type: "transaction_tag", operator: "!=", value: "Voyage" }],
				actions,
			}),
		]);

		expect(await source().all(sql`select name from rules`)).toEqual([{ name: "Négatifs" }]);
		expect(
			await source().all(
				sql`select condition_type as type, operator, value is null as empty from rule_conditions order by position`,
			),
		).toEqual([
			{ type: "transaction_name", operator: "not_like", empty: 0 },
			{ type: "transaction_notes", operator: "is_not_null", empty: 1 },
			{ type: "transaction_merchant", operator: "!=", empty: 0 },
		]);
	});

	it("skips a transfer whose sides carry the wrong signs, and refuses a dividend without a security", async () => {
		await ownDatabase();
		const accounts = [
			line("Account", { id: "x1", name: "Compte X", balance: "0", accountable_type: "Depository" }),
			line("Account", { id: "x2", name: "Livret X", balance: "0", accountable_type: "Depository" }),
		];

		await importLines([
			...accounts,
			// In Sure's sign the outflow is positive: here both sides are reversed.
			line("Transaction", { id: "o", account_id: "x1", date: "2026-09-10", amount: "-50" }),
			line("Transaction", { id: "i", account_id: "x2", date: "2026-09-10", amount: "50" }),
			line("Transfer", { outflow_transaction_id: "o", inflow_transaction_id: "i" }),
		]);

		expect(await source().all(sql`select id from transfers`)).toEqual([]);

		const preflight = await preflightSureImport(
			{ db: source(), timeZone: "Europe/Paris" },
			{
				name: "all.ndjson",
				bytes: new TextEncoder().encode(
					[
						line("Account", {
							id: "p",
							name: "PEA X",
							balance: "0",
							accountable_type: "Investment",
						}),
						line("Trade", {
							account_id: "p",
							date: "2026-09-10",
							amount: "-3",
							qty: "0",
							price: "0",
							ticker: "CASH-P",
							investment_activity_label: "Dividend",
						}),
					]
						.map((row) => JSON.stringify(row))
						.join("\n"),
				),
			},
			DEFAULT_SURE_IMPORT_LIMITS,
		);

		expect(preflight.errors).toEqual([
			{
				code: "invalid_import_record",
				params: { line: "2", type: "Trade", field: "ticker", value: '"CASH-P"' },
			},
		]);
	});

	it("fails as a whole on a security stored in another currency, writing nothing", async () => {
		await ownDatabase();
		await insertSecurity(source(), { ticker: "SAP.DE", mic: "XETR", name: "SAP" }, { held: false });
		const counts = async () =>
			source().all(
				sql`select (select count(*) from accounts) as accounts, (select count(*) from entries) as entries, (select count(*) from categories) as categories`,
			);
		const before = await counts();

		await expect(
			importLines([
				line("Category", { id: "c", name: "Jamais créée" }),
				line("Account", {
					id: "u",
					name: "Compte en dollars",
					balance: "0",
					currency: "USD",
					accountable_type: "Investment",
				}),
				line("Trade", {
					account_id: "u",
					date: "2026-09-10",
					amount: "10",
					qty: "1",
					price: "10",
					currency: "USD",
					ticker: "SAP.DE",
					exchange_operating_mic: "XETR",
					security_name: "SAP",
				}),
			]),
		).rejects.toMatchObject({ code: "SURE_IMPORT_INVALID" });
		expect(await counts()).toEqual(before);
	});

	it("stores one series for two lines on the same account, name and amount", async () => {
		await ownDatabase();

		await importLines([
			line("Account", {
				id: "a",
				name: "Compte loyer",
				balance: "0",
				accountable_type: "Depository",
			}),
			rent("r1"),
			rent("r2"),
		]);

		expect(
			await source().all(sql`select label_key as labelKey, amount from recurring_transactions`),
		).toEqual([{ labelKey: "loyer", amount: -90000 }]);
	});
});
