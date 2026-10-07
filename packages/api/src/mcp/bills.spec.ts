import type { TempDatabase } from "../testing/temp-database.ts";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { toDecimalString, toMinorUnits } from "@archant/data/money";
import { assistantCalls } from "@archant/data/schema/assistant-calls";
import {
	recurringOccurrences,
	recurringPriceChanges,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { createLogger } from "../lib/logger.ts";
import { oneByOne } from "../services/ledger/shared.ts";
import { declareBill } from "../services/recurring/bills.ts";
import { generateOccurrences } from "../services/recurring/occurrences.ts";
import { markPaid } from "../services/recurring/payments.ts";
import { setRecurringStatus } from "../services/recurring/series.ts";
import {
	openOwn,
	ownCategory,
	ownDatabase,
	ownRequest,
	postOwn,
	template,
	useSignedInApp,
} from "../testing/app.ts";
import { READ_WRITE, callTool, connect, mcp, registerClient } from "../testing/assistant.ts";
import { buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";

useSignedInApp();

// Story 23.6. Each test has a household of its own, through `ownDatabase`:
// a bill's totals count every series of the database.

let db: TempDatabase["db"];

const deps = () => ({ db, timeZone: "Europe/Paris" });

const TODAY = "2026-09-21";

/** Moves the clock to noon, Paris time, of `date`. */
const setToday = (date: string) => vi.setSystemTime(new Date(`${date}T10:00:00Z`));

/** A household of its own, with an account opened early enough for a year of bills. */
async function household() {
	db = (await ownDatabase()).db;
	const account = await openOwn({ name: "Courant", openingDate: "2025-01-01" });

	return account.id;
}

/**
 * A read-only and a read-write assistant of the household, connected today:
 * an access token lasts ten minutes, so the clock must not move after this.
 */
async function assistants() {
	setToday(TODAY);
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

function declare(
	accountId: string,
	name: string,
	amount: string,
	firstDueOn: string,
	overrides: Partial<Parameters<typeof declareBill>[1]> = {},
) {
	return declareBill(deps(), {
		kind: "bill",
		name,
		amount,
		accountId,
		firstDueOn,
		frequency: { preset: "monthly" },
		...overrides,
	});
}

/** A series detection would have stored, inserted as it stands. */
function detected(
	accountId: string,
	label: string,
	status: "suggested" | "active" | "inactive" | "ended",
	nextExpectedDate = "2026-10-01",
) {
	return {
		id: crypto.randomUUID(),
		accountId,
		labelKey: label.toLowerCase(),
		label,
		amount: -1000,
		currency: "EUR",
		expectedDayOfMonth: Number(nextExpectedDate.slice(8)),
		lastOccurrenceDate: "2026-09-01",
		nextExpectedDate,
		occurrenceCount: 3,
		status,
		createdAt: 0,
		updatedAt: 0,
	};
}

const occurrence = z.object({
	due_on: z.string(),
	effective_due_on: z.string(),
	state: z.string(),
	expected: z.string(),
	paid: z.string(),
	remaining: z.string(),
	partially_paid: z.boolean(),
});

const bill = z
	.object({
		id: z.string(),
		name: z.string(),
		bill_type: z.string(),
		status: z.string(),
		amount: z.string(),
		currency: z.string(),
		frequency: z.string(),
		next_due_date: z.string(),
		monthly_equivalent: z.string(),
		account: z.object({ id: z.string(), name: z.string() }),
		category: z.object({ id: z.string(), name: z.string() }).nullable(),
	})
	.loose();

const bills = z.object({
	as_of_date: z.string(),
	bills: z.array(bill.extend({ current_occurrence: occurrence.nullable() })),
	total_results: z.number(),
	truncated: z.boolean(),
	totals: z.object({
		currency: z.string(),
		active_count: z.number(),
		overdue_count: z.number(),
		active_monthly_equivalent: z.string(),
		left_out_count: z.number(),
		left_out_account_ids: z.array(z.string()),
	}),
});

const details = z.object({
	bill: bill.extend({ schedule_pinned: z.boolean(), anchor_date: z.string().nullable() }),
	open_occurrences: z.array(occurrence),
	closed_occurrences: z.array(
		occurrence.extend({
			status: z.string(),
			payments: z.array(
				z.object({
					amount: z.string(),
					paid_on: z.string().nullable(),
					source: z.string(),
					state: z.string(),
					transaction_id: z.string().nullable(),
					transaction_label: z.string().nullable(),
				}),
			),
		}),
	),
	closed_count: z.number(),
	upcoming_due_dates: z.array(z.string()),
	price_changes: z.array(z.record(z.string(), z.unknown())),
});

const section = z.object({
	items: z.array(z.record(z.string(), z.unknown())),
	count: z.number(),
	truncated: z.boolean(),
});

const audit = z.object({
	possible_duplicates: section,
	price_changes: section,
	long_overdue: section,
	dormant: section,
	awaiting_confirmation: section,
	undeclared_candidates: section,
});

const recorded = z.object({
	recorded: z.literal(true),
	bill_id: z.string(),
	occurrence: occurrence.extend({ status: z.string() }),
});

const updated = z.object({ updated: z.literal(true), changed_fields: z.array(z.string()), bill });

const created = z.object({
	created: z.literal(true),
	bill,
	upcoming_due_dates: z.array(z.string()),
});

const euros = (amount: number) =>
	toDecimalString({ amount: toMinorUnits(amount), currency: "EUR" });

function calls() {
	return db
		.select({
			tool: assistantCalls.tool,
			outcome: assistantCalls.outcome,
			changedRows: assistantCalls.changedRows,
		})
		.from(assistantCalls);
}

/** A series' occurrences, by due date. */
async function occurrencesOf(seriesId: string) {
	const rows = await db
		.select({
			id: recurringOccurrences.id,
			seriesId: recurringOccurrences.recurringTransactionId,
			dueOn: recurringOccurrences.dueOn,
			status: recurringOccurrences.status,
			expectedAmount: recurringOccurrences.expectedAmount,
		})
		.from(recurringOccurrences);

	return rows
		.filter((row) => row.seriesId === seriesId)
		.toSorted((a, b) => a.dueOn.localeCompare(b.dueOn));
}

const stored = async (id: string) =>
	(await db.select().from(recurringTransactions)).find((row) => row.id === id);

/** The error text of a tool call that failed. */
function failure(result: Awaited<ReturnType<typeof callTool>>) {
	expect(result.isError).toBe(true);

	return result.content[0]?.text ?? "";
}

describe("get_bills", () => {
	it("lists the active bills by next due date, and each lifecycle when asked", async () => {
		const accountId = await household();
		const later = await declare(accountId, "Électricité", "60,00", "2026-10-12");
		const sooner = await declare(accountId, "Eau", "20,00", "2026-10-02");
		const paused = await declare(accountId, "Salle de sport", "35,00", "2026-10-08");
		await setRecurringStatus(deps(), paused.id, "inactive");
		const suggestion = detected(accountId, "SPOTIFY", "suggested");
		const ended = detected(accountId, "ANCIEN FORFAIT", "ended");
		await db.insert(recurringTransactions).values([suggestion, ended]);
		const tools = await assistants();

		const active = bills.parse((await tools.read("get_bills")).structuredContent);
		const pausedOnes = bills.parse(
			(await tools.read("get_bills", { status: "paused" })).structuredContent,
		);
		const suggested = bills.parse(
			(await tools.read("get_bills", { status: "suggested" })).structuredContent,
		);
		const endedOnes = bills.parse(
			(await tools.read("get_bills", { status: "ended" })).structuredContent,
		);
		const all = bills.parse((await tools.read("get_bills", { status: "all" })).structuredContent);

		expect(active.bills.map((row) => row.id)).toEqual([sooner.id, later.id]);
		expect(active.bills[0]).toMatchObject({
			name: "Eau",
			bill_type: "bill",
			status: "active",
			amount: "20.00",
			currency: "EUR",
			frequency: "monthly",
			next_due_date: "2026-10-02",
			autopay: false,
			detected_automatically: false,
			account: { id: accountId, name: "Courant" },
			category: null,
			monthly_equivalent: "20.00",
			payment_url: null,
			current_occurrence: {
				due_on: "2026-10-02",
				effective_due_on: "2026-10-02",
				state: "upcoming",
				expected: "20.00",
				paid: "0.00",
				remaining: "20.00",
				partially_paid: false,
			},
		});
		expect(pausedOnes.bills.map((row) => [row.id, row.status])).toEqual([[paused.id, "paused"]]);
		expect((await stored(paused.id))?.status).toBe("inactive");
		expect(suggested.bills.map((row) => row.id)).toEqual([suggestion.id]);
		expect(endedOnes.bills.map((row) => row.id)).toEqual([ended.id]);
		expect(all.total_results).toBe(5);
		expect(await calls()).toEqual(
			Array.from({ length: 5 }, () => ({ tool: "get_bills", outcome: "OK", changedRows: 0 })),
		);
	});

	it("gives the amounts « Toutes les factures » gives", async () => {
		const accountId = await household();
		const water = await declare(accountId, "Eau", "84,20", "2026-09-10", {
			frequency: { preset: "quarterly" },
		});
		const tools = await assistants();
		const route = z
			.object({
				data: z.object({
					bills: z.array(
						z.object({
							id: z.string(),
							amount: z.number(),
							monthlyEquivalent: z.number(),
							currentOccurrence: z.object({ expected: z.number(), remaining: z.number() }),
						}),
					),
				}),
			})
			.parse((await ownRequest("GET", "/api/recurring/bills/all")).body)
			.data.bills.find((row) => row.id === water.id)!;

		const [listed] = bills.parse((await tools.read("get_bills")).structuredContent).bills;

		expect(listed).toMatchObject({
			id: water.id,
			amount: euros(Math.abs(route.amount)),
			frequency: "quarterly",
			monthly_equivalent: euros(route.monthlyEquivalent),
			current_occurrence: {
				state: "overdue",
				expected: euros(route.currentOccurrence.expected),
				remaining: euros(route.currentOccurrence.remaining),
			},
		});
		expect(listed?.monthly_equivalent).toBe("28.07");
	});

	it("keeps the bills due within the days, by payment state, type and search", async () => {
		const accountId = await household();
		const soon = await declare(accountId, "Eau du Grand Lyon", "20,00", "2026-09-23");
		await declare(accountId, "Électricité", "60,00", "2026-10-15", {
			billType: "subscription",
		});
		const tools = await assistants();
		const ids = async (args: unknown) =>
			bills
				.parse((await tools.read("get_bills", args)).structuredContent)
				.bills.map((row) => row.name);

		await expect(ids({ due_within_days: 10 })).resolves.toEqual(["Eau du Grand Lyon"]);
		await expect(ids({ payment_state: "due" })).resolves.toEqual(["Eau du Grand Lyon"]);
		await expect(ids({ payment_state: "upcoming" })).resolves.toEqual(["Électricité"]);
		await expect(ids({ payment_state: "paid" })).resolves.toEqual([]);
		await expect(ids({ bill_type: "subscription" })).resolves.toEqual(["Électricité"]);
		await expect(ids({ search: "GRAND lyon" })).resolves.toEqual(["Eau du Grand Lyon"]);

		await tools.write("record_bill_payment", {
			bill_id: soon.id,
			occurrence_due_on: "2026-09-23",
			amount: "5.00",
		});

		await expect(ids({ payment_state: "partial" })).resolves.toEqual(["Eau du Grand Lyon"]);
	});

	it("leaves incomes out of the monthly total, and names a bill in another currency", async () => {
		const accountId = await household();
		const dollars = (await openOwn({ name: "Dollars", currency: "USD", openingDate: "2025-01-01" }))
			.id;
		await declare(accountId, "Loyer", "800,00", "2026-10-01");
		await declare(accountId, "Assurance", "300,00", "2026-10-01", {
			frequency: { preset: "annual" },
		});
		await declare(accountId, "Salaire", "2 500,00", "2026-09-28", { kind: "income" });
		await declare(dollars, "Hosting", "12.00", "2026-10-03");
		const tools = await assistants();

		const { totals } = bills.parse((await tools.read("get_bills")).structuredContent);

		expect(totals).toEqual({
			currency: "EUR",
			active_count: 4,
			overdue_count: 0,
			active_monthly_equivalent: "825.00",
			left_out_count: 1,
			left_out_account_ids: [dollars],
		});
	});

	it("gives 100 bills at most, with the totals over every match", async () => {
		const accountId = await household();
		await db
			.insert(recurringTransactions)
			.values(
				Array.from({ length: 101 }, (_, index) => detected(accountId, `MANY ${index}`, "active")),
			);
		const tools = await assistants();

		const result = bills.parse((await tools.read("get_bills")).structuredContent);

		expect(result.bills).toHaveLength(100);
		expect(result).toMatchObject({
			total_results: 101,
			truncated: true,
			totals: { active_count: 101 },
		});
		expect(result.totals.active_monthly_equivalent).toBe("1010.00");
	});

	it("gives the amount band only when it spreads, and an every-N cadence as custom", async () => {
		const accountId = await household();
		await db.insert(recurringTransactions).values([
			{
				...detected(accountId, "BANDE", "active"),
				expectedAmountMin: -1200,
				expectedAmountMax: -900,
			},
			{
				...detected(accountId, "FIXE", "active"),
				expectedAmountMin: -1000,
				expectedAmountMax: -1000,
			},
		]);
		await declare(accountId, "Tous les cinq", "20,00", "2026-10-02", {
			frequency: { preset: "interval", interval: "5", unit: "weekly" },
		});
		const tools = await assistants();

		const listed = bills.parse((await tools.read("get_bills")).structuredContent).bills;
		const named = (name: string) => listed.find((row) => row.name === name)!;

		expect(named("BANDE")).toMatchObject({ amount_min: "9.00", amount_max: "12.00" });
		expect(named("FIXE")).not.toHaveProperty("amount_min");
		expect(named("FIXE")).not.toHaveProperty("amount_max");
		expect(named("Tous les cinq").frequency).toBe("custom");
	});

	it("keeps a bill due on the last day of the range, and reads a partial payment", async () => {
		const accountId = await household();
		const edge = await declare(accountId, "Bord", "100,00", "2026-10-01");
		await declare(accountId, "Après", "100,00", "2026-10-02");
		const tools = await assistants();

		const within = bills.parse(
			(await tools.read("get_bills", { due_within_days: 10 })).structuredContent,
		);
		await tools.write("record_bill_payment", {
			bill_id: edge.id,
			occurrence_due_on: "2026-10-01",
			amount: "30.00",
		});
		const partial = bills.parse(
			(await tools.read("get_bills", { payment_state: "partial" })).structuredContent,
		);

		expect(within.bills.map((row) => row.name)).toEqual(["Bord"]);
		expect(partial.bills.map((row) => [row.id, row.current_occurrence])).toEqual([
			[
				edge.id,
				{
					due_on: "2026-10-01",
					effective_due_on: "2026-10-01",
					state: "upcoming",
					expected: "100.00",
					paid: "30.00",
					remaining: "70.00",
					partially_paid: true,
				},
			],
		]);
	});

	it("refuses a range outside 1 to 365 days, and records it", async () => {
		await household();
		const tools = await assistants();

		const text = failure(await tools.read("get_bills", { due_within_days: 0 }));

		expect(text).toMatch(/^VALIDATION_ERROR/u);
		expect(text).toContain('"path":"due_within_days"');
		expect(await calls()).toEqual([
			{ tool: "get_bills", outcome: "VALIDATION_ERROR", changedRows: 0 },
		]);
	});
});

describe("get_bill_details", () => {
	it("gives the declared mortgage's four paid months with their payments, and its next three dates", async () => {
		const accountId = await household();
		setToday("2026-05-01");
		const mortgage = await declare(accountId, "Prêt immobilier", "571,29", "2026-05-05");

		await oneByOne(["05", "06", "07", "08"], async (month) => {
			setToday(`2026-${month}-06`);
			await db.transaction((tx) => generateOccurrences(tx, `2026-${month}-06`));
			const open = (await occurrencesOf(mortgage.id)).find(
				(row) => row.status === "scheduled" && row.dueOn === `2026-${month}-05`,
			);
			await markPaid(deps(), open!.id);
		});

		setToday(TODAY);
		await db.transaction((tx) => generateOccurrences(tx, TODAY));
		await db.insert(recurringPriceChanges).values({
			id: "rise",
			recurringTransactionId: mortgage.id,
			effectiveOn: "2026-08-05",
			previousAmount: 57_000,
			newAmount: 57_129,
			currency: "EUR",
			createdAt: 0,
			updatedAt: 0,
		});
		const tools = await assistants();

		const result = details.parse(
			(await tools.read("get_bill_details", { bill_id: mortgage.id })).structuredContent,
		);

		expect(result.bill).toMatchObject({
			id: mortgage.id,
			name: "Prêt immobilier",
			amount: "571.29",
			anchor_date: "2026-05-05",
			end_after_count: null,
			notes: null,
			schedule_pinned: false,
			next_due_date: "2026-09-05",
		});
		expect(result.closed_occurrences.map((row) => [row.due_on, row.status])).toEqual([
			["2026-08-05", "paid"],
			["2026-07-05", "paid"],
			["2026-06-05", "paid"],
			["2026-05-05", "paid"],
		]);
		expect(result.closed_occurrences[0]).toMatchObject({
			state: "paid",
			expected: "571.29",
			paid: "571.29",
			remaining: "0.00",
			partially_paid: false,
			payments: [
				{
					amount: "571.29",
					paid_on: "2026-08-06",
					source: "user_created",
					state: "confirmed",
					transaction_id: null,
					transaction_label: null,
				},
			],
		});
		expect(result.closed_count).toBe(4);
		expect(result.open_occurrences[0]).toMatchObject({ due_on: "2026-09-05", state: "overdue" });
		expect(result.upcoming_due_dates).toEqual(["2026-10-05", "2026-11-05", "2026-12-05"]);
		expect(result.price_changes).toEqual([
			{
				bill_id: mortgage.id,
				name: "Prêt immobilier",
				effective_on: "2026-08-05",
				previous_amount: "570.00",
				new_amount: "571.29",
				currency: "EUR",
				percent_change: 0.2,
			},
		]);
	});

	it("answers NOT_FOUND for an id no bill has", async () => {
		await household();
		const tools = await assistants();

		expect(failure(await tools.read("get_bill_details", { bill_id: "nope" }))).toMatch(
			/^NOT_FOUND/u,
		);
	});
});

describe("get_bill_audit", () => {
	it("finds one group of two duplicates, a third price apart", async () => {
		const accountId = await household();
		const other = (await openOwn({ name: "Joint", openingDate: "2025-01-01" })).id;
		const first = await declare(accountId, "Netflix", "13,49", "2026-10-05");
		const second = await declare(other, "  netflix ", "13,49", "2026-10-05");
		await declare(accountId, "Netflix", "17,99", "2026-10-05");
		const tools = await assistants();

		const result = audit.parse((await tools.read("get_bill_audit")).structuredContent);
		// Two bills due the same day come by id, and the group takes the first one's name.
		const group = [
			{ bill_id: first.id, name: "Netflix", account: { id: accountId, name: "Courant" } },
			{ bill_id: second.id, name: "netflix", account: { id: other, name: "Joint" } },
		].toSorted((a, b) => a.bill_id.localeCompare(b.bill_id));

		expect(result.possible_duplicates).toEqual({
			items: [{ name: group[0]!.name, amount: "13.49", currency: "EUR", due_day: 5, bills: group }],
			count: 1,
			truncated: false,
		});
	});

	it("lists a bill a whole cycle late, paused bills still owed, suggestions, price changes and undeclared charges", async () => {
		const accountId = await household();
		setToday("2026-08-10");
		const late = await declare(accountId, "Internet", "29,99", "2026-08-12");
		const dormant = await declare(accountId, "Salle de sport", "35,00", "2026-08-15");
		setToday("2026-08-30");
		await declare(accountId, "Électricité", "60,00", "2026-09-01");
		await declare(accountId, "Salaire", "2 500,00", "2026-08-01", { kind: "income" });
		setToday(TODAY);
		await setRecurringStatus(deps(), dormant.id, "inactive");
		const suggestion = detected(accountId, "SPOTIFY", "suggested");
		await db.insert(recurringTransactions).values(suggestion);
		await db.insert(recurringPriceChanges).values([
			{
				id: "recent",
				recurringTransactionId: late.id,
				effectiveOn: "2026-06-12",
				previousAmount: 2699,
				newAmount: 2999,
				currency: "EUR",
				createdAt: 0,
				updatedAt: 0,
			},
			{
				id: "old",
				recurringTransactionId: late.id,
				effectiveOn: "2025-06-12",
				previousAmount: 2499,
				newAmount: 2699,
				currency: "EUR",
				createdAt: 0,
				updatedAt: 0,
			},
		]);

		await oneByOne(["2026-07-08", "2026-08-08", "2026-09-08"], (date) =>
			postOwn(accountId, { date, label: "DEEZER PREMIUM", amount: "-10,99" }),
		);

		const tools = await assistants();

		const year = audit.parse((await tools.read("get_bill_audit")).structuredContent);
		const twoYears = audit.parse(
			(await tools.read("get_bill_audit", { lookback_months: 24 })).structuredContent,
		);

		expect(year.long_overdue.items).toEqual([
			{
				bill_id: late.id,
				name: "Internet",
				account: { id: accountId, name: "Courant" },
				cycles_overdue: 1,
				next_due_date: "2026-08-12",
				amount: "29.99",
				currency: "EUR",
			},
		]);
		expect(year.dormant.items.map((item) => item.bill_id)).toEqual([dormant.id]);
		expect(year.awaiting_confirmation.items.map((item) => item.bill_id)).toEqual([suggestion.id]);
		expect(year.price_changes.items).toEqual([
			{
				bill_id: late.id,
				name: "Internet",
				effective_on: "2026-06-12",
				previous_amount: "26.99",
				new_amount: "29.99",
				currency: "EUR",
				percent_change: 11.1,
			},
		]);
		expect(twoYears.price_changes.count).toBe(2);
		expect(year.undeclared_candidates.items).toEqual([
			{
				name: "DEEZER PREMIUM",
				average_amount: "10.99",
				currency: "EUR",
				account: { id: accountId, name: "Courant" },
				occurrence_count: 3,
				last_seen: "2026-09-08",
				entry_id: z.string().parse(year.undeclared_candidates.items[0]?.entry_id),
			},
		]);
		expect(failure(await tools.read("get_bill_audit", { lookback_months: 25 }))).toMatch(
			/^VALIDATION_ERROR/u,
		);
	});
});

describe("create_bill", () => {
	it("creates a bill on an account by id and a category by name, typed, and an income without category", async () => {
		const accountId = await household();
		const streaming = await ownCategory("Abonnements");
		const tools = await assistants();

		const subscription = created.parse(
			(
				await tools.write("create_bill", {
					name: "Netflix",
					amount: "13.49",
					first_due_on: "2026-10-05",
					account_id: accountId,
					bill_type: "subscription",
					category_name: "Abonnements",
					autopay: true,
					payment_url: "netflix.com",
				})
			).structuredContent,
		);
		const salary = created.parse(
			(
				await tools.write("create_bill", {
					name: "Salaire",
					amount: "2500.00",
					first_due_on: "2026-09-28",
					account_id: accountId,
					is_income: true,
					bill_type: "subscription",
					category_name: "Abonnements",
				})
			).structuredContent,
		);

		expect(subscription).toMatchObject({
			bill: {
				name: "Netflix",
				bill_type: "subscription",
				status: "active",
				amount: "13.49",
				category: { id: streaming, name: "Abonnements" },
				autopay: true,
				payment_url: "https://netflix.com",
				detected_automatically: false,
			},
			upcoming_due_dates: ["2026-10-05", "2026-11-05", "2026-12-05"],
		});
		expect(await stored(subscription.bill.id)).toMatchObject({ amount: -1349, manual: true });
		expect(salary.bill).toMatchObject({
			bill_type: "income",
			amount: "2500.00",
			category: null,
		});
		expect(await stored(salary.bill.id)).toMatchObject({
			amount: 250_000,
			billType: "income",
			categoryId: null,
		});
		expect(salary.upcoming_due_dates).toEqual(["2026-09-28", "2026-10-28", "2026-11-28"]);
		expect(await calls()).toEqual([
			{ tool: "create_bill", outcome: "OK", changedRows: 1 },
			{ tool: "create_bill", outcome: "OK", changedRows: 1 },
		]);
	});

	it("declares from an undeclared candidate's transaction, keyed as its bank lines", async () => {
		const accountId = await household();
		await oneByOne(["2026-07-08", "2026-08-08", "2026-09-08"], (date) =>
			postOwn(accountId, { date, label: "DEEZER PREMIUM", amount: "-10,99" }),
		);
		const tools = await assistants();
		const [candidate] = audit.parse((await tools.read("get_bill_audit")).structuredContent)
			.undeclared_candidates.items;

		const result = created.parse(
			(
				await tools.write("create_bill", {
					name: "Deezer",
					amount: "10.99",
					first_due_on: "2026-10-08",
					account_id: accountId,
					entry_id: candidate?.entry_id,
				})
			).structuredContent,
		);

		expect(candidate?.entry_id).toBeTypeOf("string");
		expect(await stored(result.bill.id)).toMatchObject({
			name: "Deezer",
			label: "DEEZER PREMIUM",
			merchantId: null,
			labelKey: "deezer premium",
		});
	});

	it("refuses the same account, name and amount twice, a negative amount and an unknown category", async () => {
		const accountId = await household();
		const tools = await assistants();
		const netflix = {
			name: "Netflix",
			amount: "13.49",
			first_due_on: "2026-10-05",
			account_id: accountId,
		};

		await tools.write("create_bill", netflix);

		expect(failure(await tools.write("create_bill", netflix))).toMatch(
			/^RECURRING_ALREADY_EXISTS/u,
		);
		expect(failure(await tools.write("create_bill", { ...netflix, amount: "-13.49" }))).toContain(
			'"code":"not_positive"',
		);
		expect(
			failure(
				await tools.write("create_bill", { ...netflix, amount: "9.99", category_name: "Nope" }),
			),
		).toContain('"path":"category_name"');
		expect(
			failure(
				await tools.write("create_bill", { ...netflix, amount: "9.99", frequency: "yearly" }),
			),
		).toContain('"path":"frequency"');
		expect(await db.select().from(recurringTransactions)).toHaveLength(1);
		expect((await calls()).map((call) => [call.outcome, call.changedRows])).toEqual([
			["OK", 1],
			["RECURRING_ALREADY_EXISTS", 0],
			["VALIDATION_ERROR", 0],
			["VALIDATION_ERROR", 0],
			["VALIDATION_ERROR", 0],
		]);
	});
});

describe("update_bill", () => {
	it('sets a category by its exact name, and clears it with Sure\'s "Uncategorized"', async () => {
		const accountId = await household();
		const streaming = await ownCategory("Abonnements");
		const netflix = await declare(accountId, "Netflix", "13,49", "2026-10-05");
		const tools = await assistants();

		const set = updated.parse(
			(await tools.write("update_bill", { bill_id: netflix.id, category_name: "Abonnements" }))
				.structuredContent,
		);
		const otherCase = await tools.write("update_bill", {
			bill_id: netflix.id,
			category_name: "abonnements",
		});
		const cleared = updated.parse(
			(await tools.write("update_bill", { bill_id: netflix.id, category_name: "Uncategorized" }))
				.structuredContent,
		);

		expect(set).toMatchObject({
			updated: true,
			changed_fields: ["category_name"],
			bill: { category: { id: streaming, name: "Abonnements" } },
		});
		expect(failure(otherCase)).toContain('"path":"category_name"');
		expect(cleared.bill.category).toBeNull();
		expect(await stored(netflix.id)).toMatchObject({ categoryId: null });
	});

	it("raises the amount from now on: the overdue occurrence keeps the old one", async () => {
		const accountId = await household();
		setToday("2026-08-30");
		const netflix = await declare(accountId, "Netflix", "13,49", "2026-09-05");
		const tools = await assistants();

		const result = updated.parse(
			(await tools.write("update_bill", { bill_id: netflix.id, amount: "15.99" }))
				.structuredContent,
		);
		const history = details.parse(
			(await tools.read("get_bill_details", { bill_id: netflix.id })).structuredContent,
		);

		expect(result).toMatchObject({ changed_fields: ["amount"], bill: { amount: "15.99" } });
		expect(history.open_occurrences.map((row) => [row.due_on, row.state, row.expected])).toEqual([
			["2026-09-05", "overdue", "13.49"],
			["2026-10-05", "upcoming", "15.99"],
			["2026-11-05", "upcoming", "15.99"],
		]);
	});

	it("pauses and renames in one call, and resumes on a new cadence", async () => {
		const accountId = await household();
		const gym = await declare(accountId, "Salle", "35,00", "2026-10-08");
		const tools = await assistants();

		const paused = updated.parse(
			(
				await tools.write("update_bill", {
					bill_id: gym.id,
					status: "paused",
					name: "Salle de sport",
				})
			).structuredContent,
		);
		// Stored as the interface's « En pause » stores it, before any resume.
		expect(await stored(gym.id)).toMatchObject({ status: "inactive" });
		const again = updated.parse(
			(await tools.write("update_bill", { bill_id: gym.id, status: "paused" })).structuredContent,
		);
		const resumed = updated.parse(
			(
				await tools.write("update_bill", {
					bill_id: gym.id,
					status: "active",
					frequency: "monthly",
					due_day_of_month: 15,
				})
			).structuredContent,
		);

		expect(paused).toMatchObject({
			changed_fields: ["name", "status"],
			bill: { name: "Salle de sport", status: "paused" },
		});
		expect(await stored(gym.id)).toMatchObject({ name: "Salle de sport", status: "active" });
		expect(again.bill.status).toBe("paused");
		expect(resumed).toMatchObject({
			changed_fields: ["status", "frequency", "due_day_of_month"],
			bill: { status: "active", next_due_date: "2026-10-15" },
		});
		expect((await stored(gym.id))?.schedulePinnedAt).not.toBeNull();
		expect(await calls()).toEqual(
			Array.from({ length: 3 }, () => ({ tool: "update_bill", outcome: "OK", changedRows: 1 })),
		);
	});

	it("writes nothing when a part is refused, and refuses a day alone or an empty call", async () => {
		const accountId = await household();
		const salary = await declare(accountId, "Salaire", "2 500,00", "2026-09-28", {
			kind: "income",
		});
		const suggestion = detected(accountId, "SPOTIFY", "suggested");
		await db.insert(recurringTransactions).values(suggestion);
		const tools = await assistants();

		expect(
			failure(
				await tools.write("update_bill", { bill_id: salary.id, name: "Paie", bill_type: "bill" }),
			),
		).toContain('"path":"bill_type"');
		expect(
			failure(
				await tools.write("update_bill", {
					bill_id: suggestion.id,
					name: "Spotify",
					status: "paused",
				}),
			),
		).toContain('"path":"status"');
		expect(failure(await tools.write("update_bill", { bill_id: salary.id, weekday: 1 }))).toContain(
			'{"path":"weekday","code":"requires_frequency"}',
		);
		expect(failure(await tools.write("update_bill", { bill_id: salary.id }))).toContain(
			'"code":"empty_patch"',
		);
		expect(failure(await tools.write("update_bill", { bill_id: "nope", name: "X" }))).toMatch(
			/^NOT_FOUND/u,
		);
		expect(await stored(salary.id)).toMatchObject({ name: "Salaire", billType: "income" });
		expect(await stored(suggestion.id)).toMatchObject({ name: null, status: "suggested" });
	});
});

describe("record_bill_payment", () => {
	it("settles the overdue occurrence in full", async () => {
		const accountId = await household();
		setToday("2026-08-30");
		const mortgage = await declare(accountId, "Prêt immobilier", "571,29", "2026-09-05");
		const tools = await assistants();

		const result = recorded.parse(
			(await tools.write("record_bill_payment", { bill_id: mortgage.id })).structuredContent,
		);

		expect(result).toEqual({
			recorded: true,
			bill_id: mortgage.id,
			occurrence: {
				due_on: "2026-09-05",
				effective_due_on: "2026-09-05",
				state: "paid",
				status: "paid",
				expected: "571.29",
				paid: "571.29",
				remaining: "0.00",
				partially_paid: false,
			},
		});
		expect(await calls()).toEqual([{ tool: "record_bill_payment", outcome: "OK", changedRows: 1 }]);
	});

	it("refuses to settle an occurrence not yet due unless it is named", async () => {
		const accountId = await household();
		const mortgage = await declare(accountId, "Prêt immobilier", "571,29", "2026-10-05");
		const tools = await assistants();

		expect(failure(await tools.write("record_bill_payment", { bill_id: mortgage.id }))).toContain(
			'{"path":"occurrence_due_on","code":"not_due"}',
		);
		expect((await occurrencesOf(mortgage.id)).every((row) => row.status === "scheduled")).toBe(
			true,
		);

		const ahead = recorded.parse(
			(
				await tools.write("record_bill_payment", {
					bill_id: mortgage.id,
					occurrence_due_on: "2026-10-05",
					paid_on: "2026-09-20",
				})
			).structuredContent,
		);

		expect(ahead.occurrence).toMatchObject({ due_on: "2026-10-05", status: "paid" });
	});

	it("adds a partial payment, refuses one above what remains and a date with no open occurrence", async () => {
		const accountId = await household();
		setToday("2026-08-30");
		const mortgage = await declare(accountId, "Prêt immobilier", "571,29", "2026-09-05");
		const tools = await assistants();

		const partial = recorded.parse(
			(await tools.write("record_bill_payment", { bill_id: mortgage.id, amount: "100.00" }))
				.structuredContent,
		);

		expect(partial.occurrence).toMatchObject({
			due_on: "2026-09-05",
			status: "scheduled",
			state: "overdue",
			paid: "100.00",
			remaining: "471.29",
			partially_paid: true,
		});
		expect(
			failure(await tools.write("record_bill_payment", { bill_id: mortgage.id, amount: "471.30" })),
		).toContain('{"path":"amount","code":"exceeds_remaining"}');
		expect(
			failure(
				await tools.write("record_bill_payment", {
					bill_id: mortgage.id,
					occurrence_due_on: "2026-09-06",
				}),
			),
		).toMatch(/^NOT_FOUND/u);
		expect(
			failure(await tools.write("record_bill_payment", { bill_id: mortgage.id, amount: "-1.00" })),
		).toContain('"code":"not_positive"');
		expect((await calls()).map((call) => [call.outcome, call.changedRows])).toEqual([
			["OK", 1],
			["VALIDATION_ERROR", 0],
			["NOT_FOUND", 0],
			["VALIDATION_ERROR", 0],
		]);
	});
});

describe("a read token", () => {
	it("is refused every bill write with 403 insufficient_scope, recorded, nothing written", async () => {
		const accountId = await household();
		const mortgage = await declare(accountId, "Prêt immobilier", "571,29", "2026-09-05");
		const before = await occurrencesOf(mortgage.id);
		const tools = await assistants();

		const writes = [
			["create_bill", { name: "Eau", amount: "20.00", first_due_on: "2026-10-02", accountId }],
			["update_bill", { bill_id: mortgage.id, name: "Crédit" }],
			["record_bill_payment", { bill_id: mortgage.id }],
		] as const;

		await oneByOne(writes, async ([name, args]) => {
			const response = await tools.refused(name, args);

			expect(response.status).toBe(403);
			expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
		});

		expect(await db.select().from(recurringTransactions)).toHaveLength(1);
		expect(await stored(mortgage.id)).toMatchObject({ name: "Prêt immobilier" });
		expect(await occurrencesOf(mortgage.id)).toEqual(before);
		expect(await calls()).toEqual([
			{ tool: "create_bill", outcome: "INSUFFICIENT_SCOPE", changedRows: 0 },
			{ tool: "update_bill", outcome: "INSUFFICIENT_SCOPE", changedRows: 0 },
			{ tool: "record_bill_payment", outcome: "INSUFFICIENT_SCOPE", changedRows: 0 },
		]);
	});
});
