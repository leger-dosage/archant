import type { TempDatabase } from "../testing/temp-database.ts";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { toMinorUnits } from "@archant/data/money";
import { assistantCalls } from "@archant/data/schema/assistant-calls";
import {
	recurringOccurrences,
	recurringPriceChanges,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { createLogger } from "../lib/logger.ts";
import { findTransaction } from "../services/ledger/queries.ts";
import { oneByOne } from "../services/ledger/shared.ts";
import { declareBill, editBill, markTransferRecurring } from "../services/recurring/bills.ts";
import { generateOccurrences } from "../services/recurring/occurrences.ts";
import { addPayment, markPaid } from "../services/recurring/payments.ts";
import { setRecurringStatus } from "../services/recurring/series.ts";
import { saveRecurringSettings } from "../services/recurring/switch.ts";
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
import { formatMoney } from "./tool.ts";

useSignedInApp();

// Stories 23.6 and 27.13. Each test has a household of its own, through
// `ownDatabase`: a bill's totals count every series of the database.

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
		read: async (name: string, args: unknown = {}) =>
			answer(await callTool(app, reader, name, args)),
		write: async (name: string, args: unknown = {}) =>
			answer(await callTool(app, author, name, args)),
		/** Sure's `{ error, hint }`, from a call that failed. */
		refusal: async (name: string, args: unknown = {}) =>
			refusalOf(await callTool(app, author, name, args)),
		refused: (name: string, args: unknown = {}) =>
			mcp(app, reader, "tools/call", { name, arguments: args }),
	};
}

type Answer = Record<string, unknown>;

const record = z.record(z.string(), z.unknown());

/** A call's answer, as the tool wrote it, its keys in their own order. */
function answer(result: Awaited<ReturnType<typeof callTool>>): Answer {
	expect(result.isError, result.content[0]?.text).toBeFalsy();

	return record.parse(result.structuredContent);
}

/** The value at `path` in an answer: a key of an object, an index of a list. */
function at(value: unknown, ...path: (string | number)[]): unknown {
	return path.reduce<unknown>(
		(node, key) =>
			typeof key === "number" ? z.array(z.unknown()).parse(node)[key] : record.parse(node)[key],
		value,
	);
}

/** The list at `path` in an answer. */
const listAt = (value: unknown, ...path: (string | number)[]) =>
	z.array(z.unknown()).parse(at(value, ...path));

/** An object's keys, in the order the tool wrote them. */
const keysOf = (value: unknown) => Object.keys(record.parse(value));

const textAt = (value: unknown, ...path: (string | number)[]) =>
	z.string().parse(at(value, ...path));

function refusalOf(result: Awaited<ReturnType<typeof callTool>>) {
	expect(result.isError).toBe(true);
	const body: unknown = JSON.parse(result.content[0]?.text ?? "");

	expect(keysOf(body)).toEqual(["error", "hint"]);

	return z.object({ error: z.string(), hint: z.string() }).parse(body);
}

function declare(
	accountId: string | null,
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

const NB = " ";

/** Sure's `Money#format` of a euro amount written with plain spaces, such as "1 500,00". */
const eur = (digits: string) => `${digits.replaceAll(" ", NB)}${NB}€`;

const BILL_KEYS = [
	"id",
	"name",
	"bill_type",
	"status",
	"amount",
	"currency",
	"frequency",
	"next_due_date",
	"autopay",
	"detected_automatically",
	"category",
	"account",
	"destination_account",
	"monthly_equivalent",
	"payment_url",
];

/**
 * The bill keys without those Sure's `.compact` leaves out of this bill, the
 * destination always but for a recurring transfer.
 */
const billKeys = (...absent: string[]) =>
	BILL_KEYS.filter((key) => key !== "destination_account" && !absent.includes(key));

const OCCURRENCE_KEYS = [
	"due_on",
	"effective_due_on",
	"state",
	"expected",
	"paid",
	"remaining",
	"partially_paid",
];

/** A route's amount as Sure's `Money#format` writes its magnitude in euros. */
const money = (amount: number) =>
	formatMoney({ amount: toMinorUnits(Math.abs(amount)), currency: "EUR" });

const FIX_HINT = "Fix the named fields and retry once.";
const AMOUNT_HINT =
	"Check the occurrence's remaining amount via get_bill_details and retry once with a valid amount.";
const NO_SUCH_RECORD = {
	error: "No such record, or it is not one you have access to",
	hint: "That record was not found. List valid options first (for example get_accounts or get_categories) and retry once with an exact match.",
};
const PRESETS = "monthly, weekly, biweekly, semimonthly, quarterly, semiannual, annual";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

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

describe("get_bills", () => {
	it("answers Sure's keys in Sure's order, leaving out what a bill lacks", async () => {
		const accountId = await household();
		const streaming = await ownCategory("Abonnements");
		const netflix = await declare(accountId, "Netflix", "13,49", "2026-10-05", {
			billType: "subscription",
			categoryId: streaming,
			paymentUrl: "netflix.com",
			autopay: true,
		});
		const water = await declare(null, "Eau", "20,00", "2026-10-02");
		const tools = await assistants();

		const result = await tools.read("get_bills");
		const [first, second] = listAt(result, "bills");

		expect(keysOf(result)).toEqual([
			"as_of_date",
			"total_results",
			"truncated",
			"family_currency",
			"bills",
			"totals",
		]);
		expect(result).toMatchObject({
			as_of_date: TODAY,
			total_results: 2,
			truncated: false,
			family_currency: "EUR",
		});
		expect(keysOf(first)).toEqual([
			...billKeys("category", "account", "payment_url"),
			"current_occurrence",
		]);
		expect(first).toEqual({
			id: water.id,
			name: "Eau",
			bill_type: "bill",
			status: "active",
			amount: eur("20,00"),
			currency: "EUR",
			frequency: "monthly",
			next_due_date: "2026-10-02",
			autopay: false,
			detected_automatically: false,
			monthly_equivalent: eur("20,00"),
			current_occurrence: {
				due_on: "2026-10-02",
				effective_due_on: "2026-10-02",
				state: "upcoming",
				expected: eur("20,00"),
				paid: eur("0,00"),
				remaining: eur("20,00"),
				partially_paid: false,
			},
		});
		expect(keysOf(at(first, "current_occurrence"))).toEqual(OCCURRENCE_KEYS);
		expect(keysOf(second)).toEqual([...billKeys(), "current_occurrence"]);
		expect(second).toMatchObject({
			id: netflix.id,
			bill_type: "subscription",
			autopay: true,
			category: "Abonnements",
			account: { id: accountId, name: "Courant" },
			payment_url: "https://netflix.com",
		});
		expect(keysOf(at(result, "totals"))).toEqual([
			"active_count",
			"overdue_count",
			"active_monthly_equivalent_by_currency",
		]);
		expect(at(result, "totals")).toEqual({
			active_count: 2,
			overdue_count: 0,
			active_monthly_equivalent_by_currency: { EUR: eur("33,49") },
		});
	});

	it("gives a recurring transfer its type and its destination, as Sure's", async () => {
		const accountId = await household();
		const loan = await openOwn({
			name: "Prêt immobilier",
			type: "loan",
			subtype: "mortgage",
			openingBalance: "180 000,00",
		});
		const outflow = await postOwn(accountId, {
			date: "2026-09-05",
			label: "ECHEANCE PRET",
			amount: "-800,00",
		});
		await postOwn(loan.id, { date: "2026-09-05", label: "ECHEANCE", amount: "800,00" });
		const transfer = (await findTransaction(deps(), outflow))?.transfer;
		const marked = await markTransferRecurring(deps(), transfer?.id ?? "");
		const tools = await assistants();

		const [bill] = listAt(await tools.read("get_bills"), "bills");

		expect(keysOf(bill)).toEqual([
			...BILL_KEYS.filter((key) => key !== "category" && key !== "payment_url"),
			"current_occurrence",
		]);
		expect(bill).toMatchObject({
			id: marked.id,
			name: "Remboursement vers Prêt immobilier",
			bill_type: "transfer",
			amount: eur("800,00"),
			account: { id: accountId, name: "Courant" },
			destination_account: { id: loan.id, name: "Prêt immobilier" },
		});
		// A transfer moves money, it is not spend, as Sure's totals; its unpaid
		// September occurrence still counts as overdue, as every row does.
		expect(at(await tools.read("get_bills"), "totals")).toEqual({
			active_count: 1,
			overdue_count: 1,
			active_monthly_equivalent_by_currency: {},
		});
	});

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
		const ids = async (status?: string) =>
			listAt(await tools.read("get_bills", status === undefined ? {} : { status }), "bills").map(
				(row) => [at(row, "id"), at(row, "status")],
			);

		await expect(ids()).resolves.toEqual([
			[sooner.id, "active"],
			[later.id, "active"],
		]);
		await expect(ids("paused")).resolves.toEqual([[paused.id, "paused"]]);
		await expect(ids("suggested")).resolves.toEqual([[suggestion.id, "suggested"]]);
		await expect(ids("ended")).resolves.toEqual([[ended.id, "ended"]]);
		await expect(ids("all")).resolves.toHaveLength(5);
		await expect(ids("")).resolves.toEqual(await ids());
		expect((await stored(paused.id))?.status).toBe("inactive");
		expect(await calls()).toEqual(
			Array.from({ length: 7 }, () => ({ tool: "get_bills", outcome: "OK", changedRows: 0 })),
		);
	});

	it("gives the amounts « Toutes les factures » gives, formatted", async () => {
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
		const [listed] = listAt(await tools.read("get_bills"), "bills");

		expect(listed).toMatchObject({
			id: water.id,
			amount: money(route.amount),
			frequency: "quarterly",
			monthly_equivalent: money(route.monthlyEquivalent),
			current_occurrence: {
				state: "overdue",
				expected: money(route.currentOccurrence.expected),
				remaining: money(route.currentOccurrence.remaining),
			},
		});
		expect(at(listed, "monthly_equivalent")).toBe(eur("28,07"));
	});

	it("keeps the bills due within the days, by payment state, type and search", async () => {
		const accountId = await household();
		const soon = await declare(accountId, "Eau du Grand Lyon", "20,00", "2026-09-23");
		await declare(accountId, "Électricité", "60,00", "2026-10-15", {
			billType: "subscription",
		});
		const tools = await assistants();
		const names = async (args: unknown) =>
			listAt(await tools.read("get_bills", args), "bills").map((row) => at(row, "name"));

		await expect(names({ due_within_days: 10 })).resolves.toEqual(["Eau du Grand Lyon"]);
		await expect(names({ due_within_days: "10" })).resolves.toEqual(["Eau du Grand Lyon"]);
		await expect(names({ payment_state: "due" })).resolves.toEqual(["Eau du Grand Lyon"]);
		await expect(names({ payment_state: "upcoming" })).resolves.toEqual(["Électricité"]);
		await expect(names({ payment_state: "paid" })).resolves.toEqual([]);
		await expect(names({ bill_type: "subscription" })).resolves.toEqual(["Électricité"]);
		await expect(names({ search: "GRAND lyon" })).resolves.toEqual(["Eau du Grand Lyon"]);

		await tools.write("record_bill_payment", {
			bill_id: soon.id,
			occurrence_due_on: "2026-09-23",
			amount: 5,
		});

		await expect(names({ payment_state: "partial" })).resolves.toEqual(["Eau du Grand Lyon"]);
	});

	it("totals the active bills but incomes per currency, each sum rounded once", async () => {
		const accountId = await household();
		const dollars = (await openOwn({ name: "Dollars", currency: "USD", openingDate: "2025-01-01" }))
			.id;
		await declare(accountId, "Netflix", "13,49", "2026-10-01");
		await declare(dollars, "Hosting", "10.00", "2026-10-03");
		await declare(accountId, "Salaire", "2 500,00", "2026-09-28", { kind: "income" });
		const tools = await assistants();

		const { totals } = await tools.read("get_bills");

		expect(totals).toEqual({
			active_count: 3,
			overdue_count: 0,
			active_monthly_equivalent_by_currency: { EUR: eur("13,49"), USD: `10,00${NB}$` },
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

		const result = await tools.read("get_bills");

		expect(listAt(result, "bills")).toHaveLength(100);
		expect(result).toMatchObject({
			total_results: 101,
			truncated: true,
			totals: {
				active_count: 101,
				active_monthly_equivalent_by_currency: { EUR: eur("1 010,00") },
			},
		});
	});

	it("gives an every-N cadence as custom", async () => {
		const accountId = await household();
		await declare(accountId, "Tous les cinq", "20,00", "2026-10-02", {
			frequency: { preset: "interval", interval: "5", unit: "weekly" },
		});
		const tools = await assistants();

		const [listed] = listAt(await tools.read("get_bills"), "bills");

		expect(at(listed, "frequency")).toBe("custom");
	});

	it("keeps a bill due on the last day of the range, and reads a partial payment", async () => {
		const accountId = await household();
		const edge = await declare(accountId, "Bord", "100,00", "2026-10-01");
		await declare(accountId, "Après", "100,00", "2026-10-02");
		const tools = await assistants();

		const within = await tools.read("get_bills", { due_within_days: 10 });
		await tools.write("record_bill_payment", {
			bill_id: edge.id,
			occurrence_due_on: "2026-10-01",
			amount: "30.00",
		});
		const partial = await tools.read("get_bills", { payment_state: "partial" });

		expect(listAt(within, "bills").map((row) => at(row, "name"))).toEqual(["Bord"]);
		expect(
			listAt(partial, "bills").map((row) => [at(row, "id"), at(row, "current_occurrence")]),
		).toEqual([
			[
				edge.id,
				{
					due_on: "2026-10-01",
					effective_due_on: "2026-10-01",
					state: "upcoming",
					expected: eur("100,00"),
					paid: eur("30,00"),
					remaining: eur("70,00"),
					partially_paid: true,
				},
			],
		]);
	});

	it("never calls a paused bill overdue, due or upcoming, and reads its leftover paused", async () => {
		const accountId = await household();
		setToday(TODAY);
		const late = await declare(accountId, "Gaz", "60,00", "2026-09-10");
		await setRecurringStatus(deps(), late.id, "inactive");
		const tools = await assistants();

		await oneByOne(["overdue", "due", "upcoming"], (state) =>
			expect(
				tools.read("get_bills", { status: "paused", payment_state: state }),
			).resolves.toMatchObject({ bills: [], totals: { overdue_count: 0 } }),
		);

		await expect(tools.read("get_bills", { status: "paused" })).resolves.toMatchObject({
			bills: [{ name: "Gaz", status: "paused", current_occurrence: { state: "paused" } }],
			totals: { overdue_count: 0 },
		});
		await expect(tools.read("get_bill_details", { bill_id: late.id })).resolves.toMatchObject({
			open_occurrences: [{ due_on: "2026-09-10", state: "paused" }],
		});

		const paid = await tools.write("record_bill_payment", { bill_id: late.id, amount: "10.00" });

		expect(at(paid, "occurrence")).toMatchObject({ status: "scheduled", state: "paused" });
	});

	it("says which other statuses hold bills when nothing matched, unless another filter narrowed it", async () => {
		const accountId = await household();
		await db
			.insert(recurringTransactions)
			.values([
				detected(accountId, "SPOTIFY", "suggested"),
				detected(accountId, "DEEZER", "suggested"),
				detected(accountId, "ANCIEN", "inactive"),
			]);
		const tools = await assistants();

		const empty = await tools.read("get_bills");

		expect(keysOf(empty)).toEqual([
			"as_of_date",
			"total_results",
			"truncated",
			"family_currency",
			"bills",
			"totals",
			"hint",
		]);
		expect(empty).toMatchObject({
			bills: [],
			totals: { active_count: 0, overdue_count: 0, active_monthly_equivalent_by_currency: {} },
			hint: "Nothing matched status active, but this family has 2 suggested, 1 inactive. Call get_bills again with that status, or status: all, before telling the user they have none.",
		});
		await expect(tools.read("get_bills", { status: "ended" })).resolves.toMatchObject({
			hint: "Nothing matched status ended, but this family has 2 suggested, 1 inactive. Call get_bills again with that status, or status: all, before telling the user they have none.",
		});
		// The counts keep to the type asked.
		await expect(
			tools.read("get_bills", { status: "ended", bill_type: "subscription" }),
		).resolves.not.toHaveProperty("hint");
		await expect(tools.read("get_bills", { search: "netflix" })).resolves.not.toHaveProperty(
			"hint",
		);
		await expect(tools.read("get_bills", { bill_type: "income" })).resolves.not.toHaveProperty(
			"hint",
		);
	});

	it("refuses an unknown status, type or payment state, then a range outside 1 to 365, as Sure", async () => {
		await household();
		const tools = await assistants();

		await expect(
			tools.refusal("get_bills", {
				status: "archived",
				bill_type: "subscriptions",
				payment_state: "late",
				due_within_days: 0,
			}),
		).resolves.toEqual({
			error: "archived is not a valid status",
			hint: "Valid values: active, suggested, paused, ended, all.",
		});
		await expect(
			tools.refusal("get_bills", { bill_type: "subscriptions", payment_state: "late" }),
		).resolves.toEqual({
			error: "subscriptions is not a valid bill_type",
			hint: "Valid values: bill, subscription, installment, income, transfer, other.",
		});
		await expect(
			tools.refusal("get_bills", { payment_state: "late", due_within_days: 0 }),
		).resolves.toEqual({
			error: "late is not a valid payment_state",
			hint: "Valid values: overdue, due, upcoming, partial, paid.",
		});
		await oneByOne([0, 366, 1.5, "ten"], (days) =>
			expect(tools.refusal("get_bills", { due_within_days: days })).resolves.toEqual({
				error: "due_within_days must be a whole number between 1 and 365",
				hint: "Retry once with a value in that range, or omit it.",
			}),
		);
		expect(await calls()).toEqual(
			Array.from({ length: 7 }, () => ({
				tool: "get_bills",
				outcome: "VALIDATION_ERROR",
				changedRows: 0,
			})),
		);
	});
});

describe("get_bill_details", () => {
	it("gives the declared mortgage's four paid months, their payments and analytics, and its next three dates", async () => {
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

		const result = await tools.read("get_bill_details", { bill_id: mortgage.id });

		expect(keysOf(result)).toEqual([
			"bill",
			"analytics",
			"open_occurrences",
			"history",
			"history_window",
			"upcoming_due_dates",
			"price_changes",
			"price_change_window",
		]);
		expect(keysOf(at(result, "bill"))).toEqual([
			...billKeys("category", "payment_url"),
			"amount_strategy",
			"weekend_adjust",
			"end_mode",
			"anchor_date",
			"schedule_pinned",
		]);
		expect(at(result, "bill")).toMatchObject({
			id: mortgage.id,
			name: "Prêt immobilier",
			amount: eur("571,29"),
			next_due_date: "2026-09-05",
			amount_strategy: "fixed",
			weekend_adjust: "none",
			end_mode: "never",
			anchor_date: "2026-05-05",
			schedule_pinned: false,
		});
		expect(at(result, "analytics")).toEqual({
			average_paid: eur("571,29"),
			lowest_paid: eur("571,29"),
			highest_paid: eur("571,29"),
			annualized_cost: eur("6 855,48"),
			annualized_declared: eur("6 855,48"),
			paid_this_year: eur("2 285,16"),
		});
		expect(listAt(result, "history").map((row) => [at(row, "due_on"), at(row, "status")])).toEqual([
			["2026-08-05", "paid"],
			["2026-07-05", "paid"],
			["2026-06-05", "paid"],
			["2026-05-05", "paid"],
		]);
		expect(keysOf(at(result, "history", 0))).toEqual([...OCCURRENCE_KEYS, "status", "payments"]);
		expect(at(result, "history", 0)).toEqual({
			due_on: "2026-08-05",
			effective_due_on: "2026-08-05",
			state: "paid",
			expected: eur("571,29"),
			paid: eur("571,29"),
			remaining: eur("0,00"),
			partially_paid: false,
			status: "paid",
			payments: [
				{
					amount: eur("571,29"),
					paid_on: "2026-08-06",
					source: "user_created",
					state: "confirmed",
				},
			],
		});
		expect(keysOf(at(result, "history", 0, "payments", 0))).toEqual([
			"amount",
			"paid_on",
			"source",
			"state",
		]);
		expect(at(result, "history_window")).toEqual({ count: 4, truncated: false });
		expect(keysOf(at(result, "history_window"))).toEqual(["count", "truncated"]);
		expect(at(result, "open_occurrences", 0)).toMatchObject({
			due_on: "2026-09-05",
			state: "overdue",
		});
		expect(at(result, "upcoming_due_dates")).toEqual(["2026-10-05", "2026-11-05", "2026-12-05"]);
		expect(at(result, "price_changes")).toEqual([
			{
				effective_on: "2026-08-05",
				previous_amount: eur("570,00"),
				new_amount: eur("571,29"),
				percent_change: 0.2,
				source: "detected",
			},
		]);
		expect(keysOf(at(result, "price_changes", 0))).toEqual([
			"effective_on",
			"previous_amount",
			"new_amount",
			"percent_change",
			"source",
		]);
		expect(at(result, "price_change_window")).toEqual({ months: 24, count: 1 });
	});

	it("gives a detected bill's amount band in Sure's order, its notes and its count, and no analytics before a payment", async () => {
		const accountId = await household();
		const band = {
			...detected(accountId, "BANDE", "active"),
			expectedAmountMin: -1200,
			expectedAmountMax: -900,
			expectedAmountAvg: -1050,
		};
		await db.insert(recurringTransactions).values(band);
		const plan = await declare(accountId, "Canapé", "50,00", "2026-10-03", { notes: "4 fois" });
		await editBill(deps(), plan.id, { billType: "installment", endAfterCount: "4" });
		const tools = await assistants();

		const banded = await tools.read("get_bill_details", { bill_id: band.id });
		const installment = await tools.read("get_bill_details", { bill_id: plan.id });

		expect(keysOf(at(banded, "bill"))).toEqual([
			...billKeys("category", "payment_url"),
			"amount_strategy",
			"weekend_adjust",
			"end_mode",
			"schedule_pinned",
			"expected_amount_min",
			"expected_amount_max",
			"expected_amount_avg",
		]);
		expect(at(banded, "bill")).toMatchObject({
			detected_automatically: true,
			expected_amount_min: eur("9,00"),
			expected_amount_max: eur("12,00"),
			expected_amount_avg: eur("10,50"),
		});
		expect(at(banded, "analytics")).toBeNull();
		expect(at(installment, "bill")).toMatchObject({
			bill_type: "installment",
			end_mode: "after_count",
			end_after_count: 4,
			notes: "4 fois",
		});
		expect(keysOf(at(installment, "bill"))).toEqual([
			...billKeys("category", "payment_url"),
			"amount_strategy",
			"weekend_adjust",
			"end_mode",
			"end_after_count",
			"anchor_date",
			"notes",
			"schedule_pinned",
		]);
	});

	it("names the transaction that paid an occurrence by its label", async () => {
		const accountId = await household();
		setToday("2026-08-30");
		const water = await declare(accountId, "Eau", "20,00", "2026-09-05");
		const entry = await postOwn(accountId, {
			date: "2026-09-05",
			label: "PRLV EAU DU GRAND LYON",
			amount: "-20,00",
		});
		const [open] = await occurrencesOf(water.id);
		await addPayment(deps(), open!.id, { entryId: entry });
		const tools = await assistants();

		const result = await tools.read("get_bill_details", { bill_id: water.id });
		const payment = at(result, "history", 0, "payments", 0);

		expect(keysOf(payment)).toEqual(["amount", "paid_on", "source", "state", "transaction_name"]);
		expect(payment).toEqual({
			amount: eur("20,00"),
			paid_on: "2026-09-05",
			source: "user_confirmed",
			state: "confirmed",
			transaction_name: "PRLV EAU DU GRAND LYON",
		});
	});

	it("refuses an id that is not a UUID, and answers an unknown one as Sure's tool caller", async () => {
		await household();
		const tools = await assistants();

		await expect(tools.refusal("get_bill_details", { bill_id: "nope" })).resolves.toEqual({
			error: "bill_id is not a valid id",
			hint: "Pass the exact id returned by get_bills.",
		});
		await expect(tools.refusal("get_bill_details", {})).resolves.toMatchObject({
			error: "bill_id is not a valid id",
		});
		await expect(tools.refusal("get_bill_details", { bill_id: UNKNOWN_ID })).resolves.toEqual(
			NO_SUCH_RECORD,
		);
		expect((await calls()).map((call) => call.outcome)).toEqual([
			"VALIDATION_ERROR",
			"VALIDATION_ERROR",
			"NOT_FOUND",
		]);
	});
});

const SECTIONS = [
	"possible_duplicates",
	"price_changes",
	"upcoming_trials",
	"upcoming_renewals",
	"long_overdue",
	"dormant",
	"awaiting_confirmation",
	"undeclared_candidates",
];

describe("get_bill_audit", () => {
	it("finds one group of two duplicates, a third price apart", async () => {
		const accountId = await household();
		const other = (await openOwn({ name: "Joint", openingDate: "2025-01-01" })).id;
		const first = await declare(accountId, "Netflix", "13,49", "2026-10-05");
		const second = await declare(other, "  netflix ", "13,49", "2026-10-05");
		await declare(accountId, "Netflix", "17,99", "2026-10-05");
		const tools = await assistants();

		const result = await tools.read("get_bill_audit");
		// Two bills due the same day come by id, and the group takes the first one's name.
		const group = [
			{ id: first.id, name: "Netflix", account: "Courant" },
			{ id: second.id, name: "netflix", account: "Joint" },
		].toSorted((a, b) => a.id.localeCompare(b.id));

		expect(at(result, "possible_duplicates")).toEqual({
			items: [
				{
					name: group[0]!.name,
					amount: eur("13,49"),
					bills: group.map(({ id, account }) => ({ id, account })),
				},
			],
			truncated: false,
			count: 1,
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

		const year = await tools.read("get_bill_audit");
		const twoYears = await tools.read("get_bill_audit", { lookback_months: "24" });

		expect(keysOf(year)).toEqual(["as_of_date", ...SECTIONS]);
		expect(at(year, "as_of_date")).toBe(TODAY);
		for (const name of SECTIONS) {
			expect(keysOf(at(year, name))).toEqual(["items", "truncated", "count"]);
		}
		expect(at(year, "upcoming_trials")).toEqual({ items: [], truncated: false, count: 0 });
		expect(at(year, "upcoming_renewals")).toEqual({ items: [], truncated: false, count: 0 });
		expect(at(year, "long_overdue", "items")).toEqual([
			{
				bill_id: late.id,
				name: "Internet",
				cycles_overdue: 1,
				next_due_date: "2026-08-12",
				amount: eur("29,99"),
			},
		]);
		expect(keysOf(at(year, "long_overdue", "items", 0))).toEqual([
			"bill_id",
			"name",
			"cycles_overdue",
			"next_due_date",
			"amount",
		]);
		expect(at(year, "dormant", "items")).toEqual([
			{ bill_id: dormant.id, name: "Salle de sport", status: "paused" },
		]);
		expect(at(year, "awaiting_confirmation", "items")).toEqual([
			{ bill_id: suggestion.id, name: "SPOTIFY", amount: eur("10,00") },
		]);
		expect(at(year, "price_changes", "items")).toEqual([
			{
				bill: "Internet",
				bill_id: late.id,
				effective_on: "2026-06-12",
				previous_amount: eur("26,99"),
				new_amount: eur("29,99"),
				percent_change: 11.1,
			},
		]);
		expect(keysOf(at(year, "price_changes", "items", 0))).toEqual([
			"bill",
			"bill_id",
			"effective_on",
			"previous_amount",
			"new_amount",
			"percent_change",
		]);
		expect(at(twoYears, "price_changes", "count")).toBe(2);
		expect(at(year, "undeclared_candidates", "items")).toEqual([
			{
				name: "DEEZER PREMIUM",
				average_amount: eur("10,99"),
				occurrence_count: 3,
				last_seen: "2026-09-08",
			},
		]);
		expect(keysOf(at(year, "undeclared_candidates", "items", 0))).toEqual([
			"name",
			"average_amount",
			"occurrence_count",
			"last_seen",
		]);
	});

	it("refuses a lookback outside 1 to 24 months, as Sure", async () => {
		await household();
		const tools = await assistants();

		await oneByOne([0, 25, "abc", 2.5], (months) =>
			expect(tools.refusal("get_bill_audit", { lookback_months: months })).resolves.toEqual({
				error: "lookback_months must be a whole number between 1 and 24",
				hint: "Retry once with a value in that range, or omit it for 12.",
			}),
		);
		await expect(tools.read("get_bill_audit", { lookback_months: "" })).resolves.toHaveProperty(
			"as_of_date",
		);
	});
});

describe("create_bill", () => {
	it("creates a bill on an account and a category by their names, a JSON number amount, and an income", async () => {
		const accountId = await household();
		await ownCategory("Abonnements");
		const tools = await assistants();

		const subscription = await tools.write("create_bill", {
			name: "Netflix",
			amount: 13.49,
			first_due_on: "2026-10-05",
			account_name: "Courant",
			bill_type: "subscription",
			category_name: "Abonnements",
			autopay: "true",
			payment_url: "netflix.com",
		});
		const salary = await tools.write("create_bill", {
			name: "Salaire",
			amount: "2500.00",
			first_due_on: "2026-09-28",
			account_name: "Courant",
			is_income: 1,
			bill_type: "subscription",
		});

		expect(keysOf(subscription)).toEqual(["created", "bill", "upcoming_due_dates"]);
		expect(keysOf(at(subscription, "bill"))).toEqual(billKeys());
		expect(subscription).toMatchObject({
			created: true,
			bill: {
				name: "Netflix",
				bill_type: "subscription",
				status: "active",
				amount: eur("13,49"),
				category: "Abonnements",
				account: { id: accountId, name: "Courant" },
				autopay: true,
				payment_url: "https://netflix.com",
				detected_automatically: false,
			},
			upcoming_due_dates: ["2026-10-05", "2026-11-05", "2026-12-05"],
		});
		expect(await stored(textAt(subscription, "bill", "id"))).toMatchObject({
			amount: -1349,
			manual: true,
		});
		expect(at(salary, "bill")).toMatchObject({ bill_type: "income", amount: eur("2 500,00") });
		expect(at(salary, "bill")).not.toHaveProperty("category");
		expect(await stored(textAt(salary, "bill", "id"))).toMatchObject({
			amount: 250_000,
			billType: "income",
			categoryId: null,
		});
		expect(at(salary, "upcoming_due_dates")).toEqual(["2026-09-28", "2026-10-28", "2026-11-28"]);
		expect(await calls()).toEqual([
			{ tool: "create_bill", outcome: "OK", changedRows: 1 },
			{ tool: "create_bill", outcome: "OK", changedRows: 1 },
		]);
	});

	it("creates a bill paid from any account without account_name, in the reporting currency", async () => {
		await household();
		const tools = await assistants();

		const created = await tools.write("create_bill", {
			name: "Eau",
			amount: "20",
			first_due_on: "2026-10-02",
			account_name: "",
			bill_type: "other",
		});

		expect(keysOf(at(created, "bill"))).toEqual(billKeys("category", "account", "payment_url"));
		expect(at(created, "bill")).toMatchObject({
			currency: "EUR",
			bill_type: "bill",
			amount: eur("20,00"),
		});
		expect(await stored(textAt(created, "bill", "id"))).toMatchObject({
			accountId: null,
			currency: "EUR",
		});
	});

	it("refuses a namesake account and an unknown one, writing nothing", async () => {
		await household();
		await openOwn({ name: "Compte courant", openingDate: "2025-01-01" });
		await openOwn({ name: "Compte courant", openingDate: "2025-01-01" });
		const tools = await assistants();
		const bill = { name: "Eau", amount: 20, first_due_on: "2026-10-02" };

		await expect(
			tools.refusal("create_bill", { ...bill, account_name: "Compte courant" }),
		).resolves.toEqual({
			error: 'More than one account is named "Compte courant"',
			hint: "Ask the user which one they mean; this tool cannot pick between namesakes.",
		});
		await expect(
			tools.refusal("create_bill", { ...bill, account_name: "courant" }),
		).resolves.toEqual({
			error: 'No account named "courant" that you can add bills to',
			hint: "Call get_accounts and retry once with the exact name of a writable account.",
		});
		expect(await db.select().from(recurringTransactions)).toHaveLength(0);
	});

	it("refuses in Sure's order: the flags, the account, the category, the frequency, the amount, the date, then the model", async () => {
		await household();
		const tools = await assistants();
		const bill = { name: "Netflix", amount: "13.49", first_due_on: "2026-10-05" };
		const wrong = {
			is_income: "yes",
			autopay: 2,
			account_name: "Nope",
			category_name: "Nope",
			frequency: "yearly",
			amount: "abc",
			first_due_on: "05/10/2026",
		};
		const without = (...keys: (keyof typeof wrong)[]) =>
			Object.fromEntries(
				Object.entries(wrong).filter(([key]) => !(keys as string[]).includes(key)),
			);

		await expect(tools.refusal("create_bill", { ...bill, ...wrong })).resolves.toEqual({
			error: "is_income must be true or false",
			hint: 'Pass a JSON boolean, not "yes".',
		});
		await expect(
			tools.refusal("create_bill", { ...bill, ...without("is_income") }),
		).resolves.toEqual({
			error: "autopay must be true or false",
			hint: "Pass a JSON boolean, not 2.",
		});
		await expect(
			tools.refusal("create_bill", { ...bill, ...without("is_income", "autopay") }),
		).resolves.toMatchObject({ error: 'No account named "Nope" that you can add bills to' });
		await expect(
			tools.refusal("create_bill", { ...bill, ...without("is_income", "autopay", "account_name") }),
		).resolves.toEqual({
			error: 'No category named "Nope"',
			hint: "Call get_categories and retry once with the exact category name.",
		});
		await expect(
			tools.refusal("create_bill", {
				...bill,
				...without("is_income", "autopay", "account_name", "category_name"),
			}),
		).resolves.toEqual({
			error: "yearly is not a frequency this app recognizes",
			hint: `Use one of: ${PRESETS}. Omit it entirely for monthly.`,
		});
		await expect(
			tools.refusal("create_bill", { ...bill, amount: "abc", first_due_on: "05/10/2026" }),
		).resolves.toEqual({ error: "Enter the amount as a plain number", hint: FIX_HINT });
		await expect(tools.refusal("create_bill", { ...bill, amount: 0 })).resolves.toEqual({
			error: "Enter the amount as a plain number",
			hint: FIX_HINT,
		});
		await expect(
			tools.refusal("create_bill", { ...bill, first_due_on: "05/10/2026" }),
		).resolves.toEqual({ error: "Enter the bill's next due date", hint: FIX_HINT });

		await tools.write("create_bill", bill);

		await expect(tools.refusal("create_bill", bill)).resolves.toEqual({
			error: "This bill already exists",
			hint: FIX_HINT,
		});
		await expect(tools.refusal("create_bill", { ...bill, name: "", amount: 1 })).resolves.toEqual({
			error: "name too_small",
			hint: FIX_HINT,
		});
		expect(await db.select().from(recurringTransactions)).toHaveLength(1);
		expect((await calls()).map((call) => [call.outcome, call.changedRows])).toEqual([
			["VALIDATION_ERROR", 0],
			["VALIDATION_ERROR", 0],
			["NOT_FOUND", 0],
			["NOT_FOUND", 0],
			["VALIDATION_ERROR", 0],
			["VALIDATION_ERROR", 0],
			["VALIDATION_ERROR", 0],
			["VALIDATION_ERROR", 0],
			["OK", 1],
			["RECURRING_ALREADY_EXISTS", 0],
			["VALIDATION_ERROR", 0],
		]);
	});

	it("takes a negative amount as its magnitude, as Sure's DeclaredBill", async () => {
		await household();
		const tools = await assistants();

		const created = await tools.write("create_bill", {
			name: "Gaz",
			amount: -60,
			first_due_on: "2026-10-02",
			is_income: "f",
		});

		expect(at(created, "bill")).toMatchObject({ bill_type: "bill", amount: eur("60,00") });
		expect(await stored(textAt(created, "bill", "id"))).toMatchObject({ amount: -6000 });
	});
});

describe("update_bill", () => {
	it('turns autopay off with Sure\'s "false", and takes a negative amount as its magnitude', async () => {
		const accountId = await household();
		const gym = await declare(accountId, "Salle", "35,00", "2026-10-08", { autopay: true });
		const tools = await assistants();

		const off = await tools.write("update_bill", { bill_id: gym.id, autopay: "false" });
		const negative = await tools.write("update_bill", { bill_id: gym.id, amount: -36 });

		expect(at(off, "bill", "autopay")).toBe(false);
		expect(await stored(gym.id)).toMatchObject({ autopay: false, amount: -3600 });
		expect(negative).toMatchObject({ changed_fields: ["amount"], bill: { amount: eur("36,00") } });
	});

	it("changes nothing for the Sunday a weekly bill already falls on", async () => {
		const accountId = await household();
		const basket = await declare(accountId, "Panier", "10,00", "2026-10-04", {
			frequency: { preset: "weekly" },
		});
		const tools = await assistants();

		await expect(
			tools.refusal("update_bill", { bill_id: basket.id, frequency: "weekly", weekday: 0 }),
		).resolves.toEqual({
			error: "No recognized fields to change",
			hint: "Pass at least one editable field.",
		});
		await expect(
			tools.write("update_bill", { bill_id: basket.id, frequency: "weekly", weekday: 1 }),
		).resolves.toMatchObject({ changed_fields: ["schedule"] });
	});
	it('sets a category by its exact name, and clears it with Sure\'s "Uncategorized"', async () => {
		const accountId = await household();
		await ownCategory("Abonnements");
		const netflix = await declare(accountId, "Netflix", "13,49", "2026-10-05");
		const tools = await assistants();

		const set = await tools.write("update_bill", {
			bill_id: netflix.id,
			category_name: "Abonnements",
		});
		const otherCase = await tools.refusal("update_bill", {
			bill_id: netflix.id,
			category_name: "abonnements",
		});
		const cleared = await tools.write("update_bill", {
			bill_id: netflix.id,
			category_name: "Uncategorized",
		});

		expect(keysOf(set)).toEqual(["updated", "changed_fields", "bill"]);
		expect(set).toMatchObject({
			updated: true,
			changed_fields: ["category"],
			bill: { category: "Abonnements" },
		});
		expect(otherCase).toEqual({
			error: 'No category named "abonnements"',
			hint: "Call get_categories and retry once with the exact category name.",
		});
		expect(at(cleared, "bill")).not.toHaveProperty("category");
		expect(await stored(netflix.id)).toMatchObject({ categoryId: null });
	});

	it("raises the amount from now on: the overdue occurrence keeps the old one", async () => {
		const accountId = await household();
		setToday("2026-08-30");
		const netflix = await declare(accountId, "Netflix", "13,49", "2026-09-05");
		const tools = await assistants();

		const result = await tools.write("update_bill", { bill_id: netflix.id, amount: 15.99 });
		const history = await tools.read("get_bill_details", { bill_id: netflix.id });

		expect(result).toMatchObject({ changed_fields: ["amount"], bill: { amount: eur("15,99") } });
		expect(
			listAt(history, "open_occurrences").map((row) => [
				at(row, "due_on"),
				at(row, "state"),
				at(row, "expected"),
			]),
		).toEqual([
			["2026-09-05", "overdue", eur("13,49")],
			["2026-10-05", "upcoming", eur("15,99")],
			["2026-11-05", "upcoming", eur("15,99")],
		]);
	});

	it("pauses and renames in one call, resumes on a new cadence, and moves to an account by name", async () => {
		const accountId = await household();
		const joint = (await openOwn({ name: "Joint", openingDate: "2025-01-01" })).id;
		const gym = await declare(accountId, "Salle", "35,00", "2026-10-08");
		const tools = await assistants();

		const paused = await tools.write("update_bill", {
			bill_id: gym.id,
			status: "paused",
			name: "Salle de sport",
		});
		// Stored as the interface's « En pause » stores it, before any resume.
		expect(await stored(gym.id)).toMatchObject({ status: "inactive" });
		const again = await tools.write("update_bill", { bill_id: gym.id, status: "paused" });
		const resumed = await tools.write("update_bill", {
			bill_id: gym.id,
			status: "active",
			frequency: "monthly",
			due_day_of_month: 15,
		});
		const moved = await tools.write("update_bill", { bill_id: gym.id, account_name: "Joint" });

		expect(paused).toMatchObject({
			changed_fields: ["name", "status"],
			bill: { name: "Salle de sport", status: "paused" },
		});
		expect(at(again, "bill", "status")).toBe("paused");
		expect(resumed).toMatchObject({
			changed_fields: ["status", "schedule"],
			bill: { status: "active", next_due_date: "2026-10-15" },
		});
		expect((await stored(gym.id))?.schedulePinnedAt).not.toBeNull();
		expect(moved).toMatchObject({
			changed_fields: ["account"],
			bill: { account: { id: joint, name: "Joint" } },
		});
		expect(await calls()).toEqual(
			Array.from({ length: 4 }, () => ({ tool: "update_bill", outcome: "OK", changedRows: 1 })),
		);
	});

	it("names the fields it changed in Sure's step order", async () => {
		const accountId = await household();
		await ownCategory("Sport");
		const gym = await declare(accountId, "Salle", "35,00", "2026-10-08");
		const tools = await assistants();

		const result = await tools.write("update_bill", {
			frequency: "weekly",
			status: "active",
			category_name: "Sport",
			account_name: "Courant",
			amount: "36",
			bill_type: "subscription",
			notes: "Badge 12",
			payment_url: "salle.fr",
			autopay: "yes",
			name: "Salle de sport",
			bill_id: gym.id,
		});

		expect(at(result, "changed_fields")).toEqual([
			"name",
			"autopay",
			"payment_url",
			"notes",
			"bill_type",
			"amount",
			"account",
			"category",
			"status",
			"schedule",
		]);
		expect(at(result, "bill")).toMatchObject({
			name: "Salle de sport",
			autopay: true,
			payment_url: "https://salle.fr",
			bill_type: "subscription",
			amount: eur("36,00"),
			category: "Sport",
			frequency: "weekly",
		});
	});

	it("refuses at Sure's first wrong step, writing nothing", async () => {
		const accountId = await household();
		const salary = await declare(accountId, "Salaire", "2 500,00", "2026-09-28", {
			kind: "income",
		});
		const gym = await declare(accountId, "Salle", "35,00", "2026-10-08");
		await openOwn({ name: "Joint", openingDate: "2025-01-01" });
		await openOwn({ name: "Joint", openingDate: "2025-01-01" });
		const tools = await assistants();
		const refusal = (args: Record<string, unknown>) =>
			tools.refusal("update_bill", { bill_id: gym.id, ...args });

		await expect(
			refusal({ name: "X", renews_on: "2026-12-01", bill_type: "other" }),
		).resolves.toEqual({
			error: "renews_on is not kept by Archant yet",
			hint: "Do not retry. Tell the user renewal and trial dates are not tracked.",
		});
		await expect(refusal({ trial_ends_on: null })).resolves.toMatchObject({
			error: "trial_ends_on is not kept by Archant yet",
		});
		await expect(
			tools.refusal("update_bill", { bill_id: salary.id, name: "Paie", bill_type: "bill" }),
		).resolves.toEqual({
			error: "Salaire is income and cannot change kind here",
			hint: "Only bill, subscription and installment kinds are editable.",
		});
		await expect(refusal({ bill_type: "other", amount: "abc" })).resolves.toEqual({
			error: '"other" is not a kind this tool can set',
			hint: "Use one of: bill, subscription, installment.",
		});
		await expect(refusal({ amount: "abc", account_name: "Nope" })).resolves.toEqual({
			error: "amount is not a number",
			hint: "Pass a positive numeric magnitude.",
		});
		await expect(refusal({ amount: 0 })).resolves.toEqual({
			error: "amount must be greater than zero",
			hint: "Pass a positive magnitude.",
		});
		await expect(refusal({ account_name: "Joint", category_name: "Nope" })).resolves.toEqual({
			error: 'More than one account is named "Joint"',
			hint: "Ask the user which one they mean; this tool cannot pick between namesakes.",
		});
		await expect(refusal({ category_name: "Nope", status: "deleted" })).resolves.toMatchObject({
			error: 'No category named "Nope"',
		});
		await expect(refusal({ status: "deleted", frequency: "yearly" })).resolves.toEqual({
			error: '"deleted" is not a status this tool can set',
			hint: "Use active or paused.",
		});
		await expect(refusal({ frequency: "yearly" })).resolves.toEqual({
			error: "yearly is not a frequency this app recognizes",
			hint: `Use one of: ${PRESETS}.`,
		});
		await expect(refusal({ weekday: 1 })).resolves.toEqual({
			error: "weekday need frequency alongside them",
			hint: "Pass frequency too (get_bill_details shows the current one).",
		});
		await expect(
			refusal({ due_day_of_month: 3, weekday: 1, month_of_year: 2 }),
		).resolves.toMatchObject({
			error: "due_day_of_month, weekday, and month_of_year need frequency alongside them",
		});
		await expect(refusal({})).resolves.toEqual({
			error: "No recognized fields to change",
			hint: "Pass at least one editable field.",
		});
		// The cadence it already has changes nothing, as Sure's `FrequencyPreset.apply`.
		await expect(refusal({ frequency: "monthly" })).resolves.toMatchObject({
			error: "No recognized fields to change",
		});
		await expect(refusal({ payment_url: "ftp://salle" })).resolves.toEqual({
			error: "payment_url invalid_url",
			hint: FIX_HINT,
		});
		await expect(tools.refusal("update_bill", { bill_id: "nope", name: "X" })).resolves.toEqual({
			error: "bill_id is not a valid id",
			hint: "Pass the exact id returned by get_bills.",
		});
		await expect(tools.refusal("update_bill", { bill_id: UNKNOWN_ID, name: "X" })).resolves.toEqual(
			NO_SUCH_RECORD,
		);
		expect(await stored(salary.id)).toMatchObject({ name: "Salaire", billType: "income" });
		expect(await stored(gym.id)).toMatchObject({ name: "Salle", billType: "bill", amount: -3500 });
	});
});

describe("record_bill_payment", () => {
	it("settles the overdue occurrence in full", async () => {
		const accountId = await household();
		setToday("2026-08-30");
		const mortgage = await declare(accountId, "Prêt immobilier", "571,29", "2026-09-05");
		const tools = await assistants();

		const result = await tools.write("record_bill_payment", { bill_id: mortgage.id });

		expect(keysOf(result)).toEqual(["recorded", "bill", "occurrence"]);
		expect(keysOf(at(result, "occurrence"))).toEqual([...OCCURRENCE_KEYS, "status"]);
		expect(result).toEqual({
			recorded: true,
			bill: "Prêt immobilier",
			occurrence: {
				due_on: "2026-09-05",
				effective_due_on: "2026-09-05",
				state: "paid",
				expected: eur("571,29"),
				paid: eur("571,29"),
				remaining: eur("0,00"),
				partially_paid: false,
				status: "paid",
			},
		});
		expect(await calls()).toEqual([{ tool: "record_bill_payment", outcome: "OK", changedRows: 1 }]);
	});

	it("refuses a retried settle once the current cycle is paid and the next not owed yet", async () => {
		const accountId = await household();
		setToday("2026-08-30");
		const mortgage = await declare(accountId, "Prêt immobilier", "571,29", "2026-09-05");
		const tools = await assistants();

		await tools.write("record_bill_payment", { bill_id: mortgage.id });
		const retried = await tools.refusal("record_bill_payment", {
			bill_id: mortgage.id,
			paid_on: "not a date",
		});

		expect(retried).toEqual({
			error: "Prêt immobilier has nothing owed right now",
			hint: "Its next cycle is due 2026-10-05 and is not owed yet. If you really mean to pay ahead, retry with occurrence_due_on set to that date.",
		});
		expect((await occurrencesOf(mortgage.id)).map((row) => row.status)).toEqual([
			"paid",
			...(await occurrencesOf(mortgage.id)).slice(1).map(() => "scheduled"),
		]);

		const ahead = await tools.write("record_bill_payment", {
			bill_id: mortgage.id,
			occurrence_due_on: "2026-10-05",
			paid_on: "2026-09-20",
		});

		expect(at(ahead, "occurrence")).toMatchObject({ due_on: "2026-10-05", status: "paid" });
	});

	it("adds a partial payment, and refuses one above what remains with Sure's figures", async () => {
		const accountId = await household();
		setToday("2026-08-30");
		const rent = await declare(accountId, "Loyer", "2 000,00", "2026-09-05");
		const tools = await assistants();

		const partial = await tools.write("record_bill_payment", { bill_id: rent.id, amount: 1000 });

		expect(at(partial, "occurrence")).toMatchObject({
			due_on: "2026-09-05",
			status: "scheduled",
			state: "overdue",
			paid: eur("1 000,00"),
			remaining: eur("1 000,00"),
			partially_paid: true,
		});
		await expect(
			tools.refusal("record_bill_payment", { bill_id: rent.id, amount: "1500" }),
		).resolves.toEqual({
			error: `${eur("1 500,00")} is more than the ${eur("1 000,00")} still owed on the cycle due 2026-09-05`,
			hint: "Record at most the remaining amount. If this payment was already recorded, do not retry.",
		});
		expect((await calls()).map((call) => [call.outcome, call.changedRows])).toEqual([
			["OK", 1],
			["VALIDATION_ERROR", 0],
		]);
	});

	it("refuses each argument and occurrence as Sure, the occurrence first", async () => {
		const accountId = await household();
		setToday("2026-08-30");
		const mortgage = await declare(accountId, "Prêt immobilier", "571,29", "2026-09-05");
		const once = await declare(accountId, "Unique", "50,00", "2026-08-31");
		await editBill(deps(), once.id, { billType: "installment", endAfterCount: "1" });
		await markPaid(deps(), (await occurrencesOf(once.id))[0]!.id);
		const tools = await assistants();
		const refusal = (args: Record<string, unknown>) =>
			tools.refusal("record_bill_payment", { bill_id: mortgage.id, ...args });
		const details = await tools.read("get_bill_details", { bill_id: mortgage.id });
		const dates = listAt(details, "open_occurrences")
			.slice(0, 6)
			.map((row) => at(row, "due_on"));

		await expect(
			refusal({ occurrence_due_on: "2026-09-06", amount: "abc", paid_on: "bad" }),
		).resolves.toEqual({
			error: "No open occurrence of Prêt immobilier is due on 2026-09-06",
			hint: `Open due dates: ${dates.join(", ")}. Retry once with one of them, or omit occurrence_due_on.`,
		});
		await expect(refusal({ occurrence_due_on: "06/09/2026" })).resolves.toEqual({
			error: "occurrence_due_on is not a valid date",
			hint: "Use YYYY-MM-DD.",
		});
		await expect(refusal({ paid_on: "bad", amount: "abc" })).resolves.toEqual({
			error: "paid_on is not a valid date",
			hint: "Use YYYY-MM-DD.",
		});
		await expect(refusal({ amount: "abc" })).resolves.toEqual({
			error: "amount is not a number",
			hint: AMOUNT_HINT,
		});
		await oneByOne(["-1.00", 0], (amount) =>
			expect(refusal({ amount })).resolves.toEqual({
				error: "amount must be greater than zero",
				hint: AMOUNT_HINT,
			}),
		);
		await expect(
			tools.refusal("record_bill_payment", { bill_id: once.id, amount: "abc" }),
		).resolves.toEqual({
			error: "Unique has no open occurrence to pay",
			hint: "Nothing is currently owed on this bill. Use get_bill_details to see its state.",
		});
		await expect(
			tools.refusal("record_bill_payment", { bill_id: UNKNOWN_ID, paid_on: "bad" }),
		).resolves.toEqual(NO_SUCH_RECORD);
		await expect(tools.refusal("record_bill_payment", { bill_id: UNKNOWN_ID })).resolves.toEqual(
			NO_SUCH_RECORD,
		);
		await expect(
			tools.refusal("record_bill_payment", { bill_id: UNKNOWN_ID, occurrence_due_on: "bad" }),
		).resolves.toEqual(NO_SUCH_RECORD);
		expect((await occurrencesOf(mortgage.id)).every((row) => row.status === "scheduled")).toBe(
			true,
		);
	});
});

describe("a read token", () => {
	it("is refused every bill write with 403 insufficient_scope, recorded, nothing written", async () => {
		const accountId = await household();
		const mortgage = await declare(accountId, "Prêt immobilier", "571,29", "2026-09-05");
		const before = await occurrencesOf(mortgage.id);
		const tools = await assistants();

		const writes = [
			["create_bill", { name: "Eau", amount: "20.00", first_due_on: "2026-10-02" }],
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

describe("the switch off", () => {
	it("refuses every bill tool with Sure's `recurring_disabled_result`, and get_recurring_transactions still answers", async () => {
		await household();
		const tools = await assistants();
		await saveRecurringSettings(deps(), { enabled: false });

		const bill = { bill_id: UNKNOWN_ID };

		const toolCalls = [
			["get_bills", {}],
			["get_bill_details", bill],
			["get_bill_audit", {}],
			["create_bill", { name: "Loyer", amount: 800, frequency: "monthly" }],
			["update_bill", bill],
			["record_bill_payment", bill],
		] as const;

		await expect(
			Promise.all(toolCalls.map(([tool, args]) => tools.refusal(tool, args))),
		).resolves.toEqual(
			toolCalls.map(() => ({
				error: "Bills & recurring transactions are disabled for this family",
				hint: "Do not retry. Tell the user this feature is switched off under Settings -> Recurring transactions, and answer from transaction data instead.",
			})),
		);

		await expect(tools.read("get_recurring_transactions")).resolves.toMatchObject({
			recurring_transactions: [],
		});
	});
});
