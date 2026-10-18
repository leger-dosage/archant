import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { ACCOUNT_TYPE_IDS, loanDetailsOf } from "@archant/data/account-types";
import type { Database } from "@archant/data/client";
import { accounts } from "@archant/data/schema/accounts";
import { bankConnections } from "@archant/data/schema/bank-connections";

import { daysBetween } from "../domain/dates.ts";
import { amortizationSchedule } from "../domain/loans/amortization-schedule.ts";
import { createLogger } from "../lib/logger.ts";
import { openOwn, ownDatabase, postOwn, useSignedInApp } from "../testing/app.ts";
import { balanceOn } from "./ledger/balances.ts";
import { SAMPLE_DATA_SEED, STUDENT_LOAN_EXTRA_PAYMENT, samplePlan } from "./sample-data-plan.ts";
import { resetWithSampleData } from "./sample-data.ts";

useSignedInApp();

// The clock is 2026-09-21 10:00 UTC, noon in Europe/Paris.
const TODAY = "2026-09-21";

const logger = createLogger("silent");

const sample = () => samplePlan({ seed: SAMPLE_DATA_SEED, today: TODAY, currency: "EUR" });

const TABLES = [
	"accounts",
	"entries",
	"transactions",
	"transfers",
	"trades",
	"securities",
	"categories",
	"budgets",
	"budget_categories",
	"goals",
	"goal_accounts",
] as const;

async function counts(db: Database) {
	const rows = await Promise.all(
		TABLES.map(async (table) => {
			const row = await db.get<{ count: number }>(
				sql`select count(*) as count from ${sql.identifier(table)}`,
			);

			return [table, row?.count ?? 0] as const;
		}),
	);

	return Object.fromEntries(rows);
}

/** Every entry as amount, date and label, sorted: what two loads must share, ids and times aside. */
async function ledger(db: Database) {
	return db.all<{ name: string; date: string; amount: number; label: string | null }>(
		sql`select a.name, e.date, e.amount, t.label from entries e
			join accounts a on a.id = e.account_id
			left join transactions t on t.entry_id = e.id
			order by a.name, e.date, e.amount, t.label`,
	);
}

/** A load on TODAY, whatever a test did to the clock before. */
async function load(db: Database) {
	vi.setSystemTime(new Date(`${TODAY}T10:00:00Z`));
	await resetWithSampleData({ db, timeZone: "Europe/Paris", logger });
}

describe("samplePlan", () => {
	it("gives the same plan for the same seed and day", () => {
		expect(sample()).toEqual(sample());
		expect(samplePlan({ seed: 7, today: TODAY, currency: "EUR" })).not.toEqual(sample());
	});

	it("opens Sure's accounts, every type Archant has, all in the reporting currency", () => {
		const { plan } = sample();

		expect(plan.accounts).toHaveLength(20);
		expect(new Set(plan.accounts.map((account) => account.type))).toEqual(
			new Set(ACCOUNT_TYPE_IDS),
		);
		expect(plan.accounts.filter((account) => account.subtype === "checking")).toHaveLength(3);
		expect(plan.accounts.filter((account) => account.type === "investment")).toHaveLength(5);
		expect(plan.accounts.filter((account) => account.type === "loan")).toHaveLength(3);
		expect(plan.accounts.every((account) => account.currency === "EUR")).toBe(true);
	});

	it("writes every amount in integer minor units", () => {
		const { plan, goals } = sample();
		const amounts = [
			...plan.accounts.map((account) => account.opening.amount),
			...plan.transactions.map((row) => row.amount),
			...plan.trades.map((row) => row.amount),
			...plan.valuations.map((row) => row.amount),
			...plan.budgetCategories.map((row) => row.amount),
			...plan.budgets.flatMap((budget) => [budget.budgetedSpending, budget.expectedIncome]),
			...goals.flatMap((goal) => [
				goal.targetAmount,
				goal.completedAmount,
				...goal.accounts.map((link) => link.allocatedAmount),
			]),
		].filter((amount) => amount !== null);

		expect(amounts.every((amount) => Number.isSafeInteger(amount))).toBe(true);
	});

	it("pays Sure's salaries every other Friday for three years, a tenth saved each time", () => {
		const { plan } = sample();
		const salaries = plan.transactions.filter((row) => row.label === "Salaire Acme Corp");

		expect(salaries).toHaveLength(78);
		expect(salaries.every((row) => new Date(`${row.date}T00:00:00Z`).getUTCDay() === 5)).toBe(true);
		// 8 500 ± 2 %, money in.
		expect(salaries.every((row) => row.amount >= 833_000 && row.amount <= 867_000)).toBe(true);
		expect(
			plan.transactions.filter((row) => row.label === "Épargne automatique de 10 % du salaire"),
		).toHaveLength(156);
	});

	it("fills this month's budget from the three months before, in steps of 25", () => {
		const { plan } = sample();

		expect(plan.budgets).toEqual([
			expect.objectContaining({ month: "2026-09", expectedIncome: 0 }),
		]);
		expect(plan.budgetCategories.length).toBeGreaterThan(0);
		expect(plan.budgetCategories.every((line) => line.amount % 2_500 === 0)).toBe(true);

		const parents = new Map(
			plan.categories.map((category) => [category.sourceId, category.parentSourceId]),
		);
		const amount = (id: string) =>
			plan.budgetCategories.find((line) => line.categorySourceId === id)?.amount ?? 0;
		const children = plan.budgetCategories.filter(
			(line) => parents.get(line.categorySourceId) === "food",
		);

		// A parent holds its children's amounts.
		expect(amount("food")).toBeGreaterThanOrEqual(
			children.reduce((sum, line) => sum + line.amount, 0),
		);
		expect(plan.budgets[0]?.budgetedSpending).toBe(
			plan.budgetCategories
				.filter((line) => parents.get(line.categorySourceId) === null)
				.reduce((sum, line) => sum + line.amount, 0),
		);
	});

	it("buys into the 401(k) every other Friday whatever the day, Sure's parity slip fixed", () => {
		// 2027-03-01 spans 2026's 53rd week, which an even-week filter skips.
		for (const today of [TODAY, "2026-10-25", "2026-11-01", "2027-03-01"]) {
			const { plan } = samplePlan({ seed: SAMPLE_DATA_SEED, today, currency: "EUR" });
			const dates = [
				...new Set(
					plan.trades
						.filter((trade) => trade.accountSourceId === "vanguard_401k")
						.map((trade) => trade.date),
				),
			];

			// Three years of fortnights, Sure's first 90 paydays at most.
			expect(dates.length).toBeGreaterThanOrEqual(77);
			expect(dates.length).toBeLessThanOrEqual(90);
			expect(dates.slice(1).every((date, index) => daysBetween(dates[index]!, date) === 14)).toBe(
				true,
			);
		}
	});

	it("seeds Sure's nine goals in every state", () => {
		const { goals } = sample();

		expect(goals).toHaveLength(9);
		expect(new Set(goals.map((goal) => goal.state))).toEqual(
			new Set(["active", "paused", "archived", "completed"]),
		);
		expect(goals.find((goal) => goal.state === "completed")?.completedAmount).toBe(800_000);
	});
});

// A load writes about 8,100 entries and recomputes every balance: about a
// second here, eight for two loads on CI under coverage, past Vitest's 5 s.
describe("resetWithSampleData", { timeout: 30_000 }, () => {
	it("replaces the household with the sample, then loads the same rows again", async () => {
		const { db } = await ownDatabase();
		const own = await openOwn({ name: "Compte à effacer" });
		await postOwn(own.id, { date: "2026-09-10", label: "Boulangerie", amount: "-4,20" });

		await load(db);
		const first = await counts(db);
		const firstLedger = await ledger(db);

		const { plan, goals } = sample();

		// Every row of the plan came across: no transfer or trade was skipped.
		expect(first).toMatchObject({
			accounts: 20,
			transactions: plan.transactions.length,
			transfers: plan.transfers.length,
			trades: plan.trades.length,
			entries:
				plan.accounts.length +
				plan.transactions.length +
				plan.trades.length +
				plan.valuations.length,
			securities: 1,
			categories: 21,
			budgets: 1,
			budget_categories: plan.budgetCategories.length,
			goals: goals.length,
			goal_accounts: goals.reduce((sum, goal) => sum + goal.accounts.length, 0),
		});
		expect(
			await db.all(
				sql`select ga.goal_id from goal_accounts ga join accounts a on a.id = ga.account_id
					where a.name = 'Compte courant Chase Premier'`,
			),
		).not.toEqual([]);
		// The recurring detection ran after the commit.
		expect(
			(await db.get<{ count: number }>(sql`select count(*) as count from recurring_transactions`))
				?.count,
		).toBeGreaterThan(0);
		expect(plan.transactions.length).toBeGreaterThan(5_000);
		expect(await db.all(sql`select id from accounts where name = 'Compte à effacer'`)).toEqual([]);

		await load(db);

		// Goals are added to the ones kept, as Sure's reset keeps goals; the
		// kept ones lose the accounts the reset deleted.
		expect(await counts(db)).toEqual({ ...first, goals: 18 });
		expect(await ledger(db)).toEqual(firstLedger);
	});

	it("pays each loan from its schedule, so its balance is the schedule's", async () => {
		const { db } = await ownDatabase();
		await load(db);
		const loans = await db
			.select({
				id: accounts.id,
				type: accounts.type,
				subtype: accounts.subtype,
				details: accounts.details,
			})
			.from(accounts)
			.where(eq(accounts.type, "loan"));

		expect(loans).toHaveLength(3);

		const checked = await Promise.all(
			loans.map(async (loan) => {
				const details = loanDetailsOf(loan);
				const schedule =
					details === null
						? null
						: amortizationSchedule({ ...details, originationDate: details.startDate });
				const paid = schedule?.payments.filter((payment) => payment.date <= TODAY) ?? [];
				// The student loan's one extra payment, a year ago, in cents.
				const extra = loan.subtype === "student" ? STUDENT_LOAN_EXTRA_PAYMENT * 100 : 0;
				const balance = await balanceOn({ db, timeZone: "Europe/Paris" }, loan.id, TODAY);

				return { owed: Number(paid.at(-1)?.endingBalance) - extra, balance: balance?.amount };
			}),
		);

		for (const { owed, balance } of checked) {
			expect(owed).toBeGreaterThan(0);
			expect(balance).toBe(owed);
		}
	});

	it("ends each traded investment account with no cash, its balance its holdings", async () => {
		const { db } = await ownDatabase();
		await load(db);
		const rows = await db.all<{ name: string; balance: number; cash: number; held: number }>(
			sql`select a.name, b.balance, b.cash,
					(select coalesce(sum(h.amount), 0) from holdings h
						where h.account_id = a.id and h.date = b.date) as held
				from accounts a
				join balances b on b.account_id = a.id
					and b.date = (select max(date) from balances where account_id = a.id)
				where a.type = 'investment'
					and exists (select 1 from entries e where e.account_id = a.id and e.kind = 'trade')`,
		);

		expect(rows).toHaveLength(4);

		for (const row of rows) {
			expect(row.cash).toBe(0);
			expect(row.held).toBeGreaterThan(0);
			expect(row.balance).toBe(row.held);
		}
	});

	it("ends both cards within 250 € of Sure's targets, 2 500 and 4 200", async () => {
		const { db } = await ownDatabase();
		await load(db);
		const rows = await db.all<{ name: string; balance: number }>(
			sql`select a.name, b.balance from accounts a
				join balances b on b.account_id = a.id
					and b.date = (select max(date) from balances where account_id = a.id)
				where a.type = 'credit_card' order by a.name`,
		);
		const targets: Record<string, number> = {
			"Carte Amex Gold": 250_000,
			"Carte Chase Sapphire Reserve": 420_000,
		};

		expect(rows).toHaveLength(2);

		for (const row of rows) {
			expect(Math.abs(row.balance - (targets[row.name] ?? 0))).toBeLessThanOrEqual(25_000);
		}
	});

	it("leaves the household as it was when the load fails after the reset", async () => {
		const { db } = await ownDatabase();
		const own = await openOwn({ name: "Compte gardé" });
		await postOwn(own.id, { date: "2026-09-10", label: "Boulangerie", amount: "-4,20" });
		const before = await counts(db);
		// The goals are written last: refusing them fails the load after the reset and the plan.
		await db.run(
			sql`create trigger refuse_goals before insert on goals begin select raise(abort, 'refused'); end`,
		);

		await expect(load(db)).rejects.toThrow();
		expect(await counts(db)).toEqual(before);
		expect(await db.all(sql`select id from accounts where name = 'Compte gardé'`)).toHaveLength(1);
	});

	it("refuses SYNC_IN_PROGRESS while a sync holds its lease, the household intact", async () => {
		const { db } = await ownDatabase();
		await openOwn();
		const now = Date.now();
		await db.insert(bankConnections).values({
			id: crypto.randomUUID(),
			connector: "enable-banking",
			institutionName: "Banque",
			country: "FR",
			status: "active",
			syncStartedAt: now,
			createdAt: now,
			updatedAt: now,
		});

		await expect(load(db)).rejects.toMatchObject({ code: "SYNC_IN_PROGRESS" });
		expect(await counts(db)).toMatchObject({ accounts: 1, goals: 0, budgets: 0 });
	});
});
