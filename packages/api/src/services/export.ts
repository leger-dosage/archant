import type { IsoDate } from "../domain/dates.ts";
import type { TradeType } from "../domain/trades.ts";
import type { Logger } from "../lib/logger.ts";
import type { ServiceDeps } from "./deps.ts";
import type { ExportedTransactionRow } from "./ledger/export.ts";

import { Zip, ZipDeflate } from "fflate";
import Papa from "papaparse";

import type { AccountType } from "@archant/data/account-types";
import type { Database, ReadSnapshot } from "@archant/data/client";
import { readSnapshot } from "@archant/data/client";
import { formatMicros } from "@archant/data/micros";
import type { MinorUnits, Money } from "@archant/data/money";
import { toDecimalString, toMinorUnits } from "@archant/data/money";
import type { RuleActionType } from "@archant/data/rules";
import type { TransferKind } from "@archant/data/transfer-kinds";

import { daysBetween, monthRange, today } from "../domain/dates.ts";
import { typeOf } from "../domain/trades.ts";
import { AppError } from "../lib/errors.ts";
import { rolloverAmounts } from "./budgets.ts";
import { balanceOn } from "./ledger/balances.ts";
import {
	balancePages,
	exportedAccounts,
	exportedAttachments,
	exportedBudgetCategories,
	exportedBudgets,
	exportedCategories,
	exportedGoalAccounts,
	exportedGoals,
	exportedMerchants,
	exportedRecurrenceRules,
	exportedRecurring,
	exportedRejectedTransfers,
	exportedRules,
	exportedTags,
	exportedTrades,
	exportedTransfers,
	exportedCostBasisLocks,
	exportedTypedPrices,
	exportedValuations,
	holdingPages,
	transactionPages,
} from "./ledger/export.ts";
import { getReportingCurrency } from "./settings.ts";

export type ExportDeps = ServiceDeps & {
	/** `$client` too: the archive reads one snapshot, a libSQL transaction of its own. */
	db: Pick<Database, "$client">;
	logger: Logger;
};

export type Archive = {
	/** `archant_export_YYYYMMDD_HHMMSS.zip`, the time in `APP_TIMEZONE`, as Sure names its own. */
	fileName: string;
	body: ReadableStream<Uint8Array>;
};

type ValuationKind = NonNullable<Valuation["valuationKind"]>;

/** Sure's `Family::DataExporter::EXPORT_VERSION`, the format this archive follows. */
const EXPORT_VERSION = 2;

/** Sure's `accountable_type` of each account type. */
const SURE_ACCOUNTABLE_TYPES = {
	depository: "Depository",
	credit_card: "CreditCard",
	loan: "Loan",
	investment: "Investment",
	property: "Property",
	vehicle: "Vehicle",
} as const satisfies Record<AccountType, string>;

type SureAccountableType = (typeof SURE_ACCOUNTABLE_TYPES)[AccountType];

/**
 * Sure's `Transaction#kind` of each side of a transfer: its outflow says what
 * the movement is, as `Transfer.kind_for_account` decides it, and its inflow
 * is always `funds_movement`, as `Family::DataImporter` writes it.
 */
const SURE_OUTFLOW_KINDS = {
	internal_move: "funds_movement",
	credit_card_payment: "cc_payment",
	loan_payment: "loan_payment",
	investment_contribution: "investment_contribution",
} as const satisfies Record<TransferKind, string>;

/** Which valuation of a day Sure keeps, `SureImport::Preflight` refusing two. */
const VALUATION_PRECEDENCE: Record<ValuationKind, number> = {
	opening_anchor: 0,
	current_anchor: 1,
	reconciliation: 2,
};

/** Actions Sure has no equivalent for, kept under `archant.actions`. */
const ARCHANT_ONLY_ACTIONS: ReadonlySet<RuleActionType> = new Set(["replace_in_transaction_name"]);

const BALANCE_NAMES = {
	opening_anchor: "Opening balance",
	current_anchor: "Current balance",
	reconciliation: "Manual balance update",
};

const VALUE_NAMES = {
	opening_anchor: "Original purchase price",
	current_anchor: "Current market value",
	reconciliation: "Manual value update",
};

/** Sure's `Valuation::Name`, by accountable type and kind. */
const VALUATION_NAMES: Record<SureAccountableType, Record<ValuationKind, string>> = {
	Depository: BALANCE_NAMES,
	CreditCard: BALANCE_NAMES,
	Loan: {
		opening_anchor: "Original principal",
		current_anchor: "Current loan balance",
		reconciliation: "Manual principal update",
	},
	Investment: {
		opening_anchor: "Opening account value",
		current_anchor: "Current account value",
		reconciliation: "Manual value update",
	},
	Property: VALUE_NAMES,
	Vehicle: VALUE_NAMES,
};

/** An amount as it is stored: a balance, a valuation or a budget envelope. */
function decimal(amount: MinorUnits, currency: string): string {
	return toDecimalString({ amount, currency });
}

/**
 * A movement in Sure's sign, a purchase positive: the reverse of AD-5, where
 * money leaving the account is negative.
 */
function sureAmount(amount: MinorUnits, currency: string): string {
	return decimal(toMinorUnits(0 - amount), currency);
}

/** A series' band amount in Sure's sign, or none before detection measured one. */
function bandAmount(amount: number | null, currency: string): string | null {
	return amount === null ? null : sureAmount(toMinorUnits(amount), currency);
}

/** A rate in basis points as Sure's percentage: 345 is `3.45`. */
function percent(basisPoints: number): string {
	return `${Math.trunc(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, "0")}`;
}

/** A timestamp as Rails writes one in JSON. */
function timestamp(milliseconds: number): string {
	return new Date(milliseconds).toISOString();
}

/** A timestamp as Ruby's `Time#iso8601`, in Sure's CSV files. */
function csvTimestamp(milliseconds: number): string {
	return timestamp(milliseconds).replace(/\.\d{3}Z$/u, "Z");
}

/** Sure's `escape_legacy_tag_name`: a tag list is comma-separated in `transactions.csv`. */
function escapeTagName(name: string): string {
	return name.replaceAll(/[\\,|]/gu, (character) => `\\${character}`);
}

/**
 * A text cell a spreadsheet would read as a formula, `'`-prefixed: a label
 * or a note is written by a bank or by whoever sends money, and `=HYPERLINK`
 * in one would run when the owner opens the file. `all.ndjson`, which Sure
 * imports, keeps the text exact.
 */
function textCell(value: string | null | undefined): string | null {
	return value === null || value === undefined || !/^[=+\-@\t\r]/u.test(value)
		? (value ?? null)
		: `'${value}`;
}

/** One CSV chunk, each row ending in `\n` as Ruby's `CSV.generate` writes it. */
function csv(rows: readonly (readonly unknown[])[]): string {
	return rows.length === 0
		? ""
		: `${Papa.unparse(
				rows.map((row) => [...row]),
				{ newline: "\n" },
			)}\n`;
}

/** Sure's subtype of an account; the original goes under `archant.subtype`. */
function sureSubtype(type: AccountType, subtype: string | null): string | null {
	if (type === "credit_card") {
		return "credit_card";
	}

	// Sure's loans have no consumer subtype; `other` is its catch-all.
	return type === "loan" && subtype === "consumer" ? "other" : subtype;
}

type Counts = Record<string, number>;

type Line = { type: string; data: Record<string, unknown> };

/** `all.ndjson` lines, each one JSON object ending in `\n`. */
function ndjson(lines: readonly Line[], counts: Counts): string {
	for (const line of lines) {
		counts[line.type] = (counts[line.type] ?? 0) + 1;
	}

	return lines.map((line) => `${JSON.stringify(line)}\n`).join("");
}

/** Reads `read` once, on first use, and hands every later caller the same rows. */
function once<Value>(read: () => Promise<Value>): () => Promise<Value> {
	let pending: Promise<Value> | null = null;

	return () => {
		pending ??= read();

		return pending;
	};
}

type Rule = Awaited<ReturnType<typeof exportedRules>>[number];
type RuleCondition = Rule["conditions"][number];
type RuleAction = Rule["actions"][number];
type Named = { id: string; name: string };

/** The rows a rule's operands name: Sure's export writes names, never ids alone. */
type Operands = {
	categories: Map<string, Named>;
	merchants: Map<string, Named>;
	tags: Map<string, Named>;
};

type Operand = {
	value: string | null;
	value_ref?:
		| { type: string; id: string; name: string }
		| { type: string; id: string; name: string }[];
};

/**
 * Sure's `rule_operand`: the name of the row an id names, with a `value_ref`
 * saying which; a row deleted since leaves its id, as Sure leaves it.
 */
function operandOf(value: string | null, type: string, rows: Map<string, Named>): Operand {
	const row = value === null ? undefined : rows.get(value);

	return row === undefined
		? { value }
		: { value: row.name, value_ref: { type, id: row.id, name: row.name } };
}

/**
 * Sure's `resolve_multi_tag_operand`: tag names as one CSV line, a single
 * tag's `value_ref` an object and several an array.
 */
function tagsOperand(value: string | null, tags: Map<string, Named>): Operand {
	const ids = (value ?? "").split(",").filter((id) => id !== "");
	const rows = ids.map((id) => tags.get(id));
	const names = ids.map((id, index) => rows[index]?.name ?? id);
	const refs = rows
		.filter((row) => row !== undefined)
		.map((row) => ({ type: "Tag", id: row.id, name: row.name }));
	const ref = ids.length <= 1 ? refs[0] : refs;

	return {
		value: Papa.unparse([names], { newline: "" }),
		...(ref === undefined ? {} : { value_ref: ref }),
	};
}

function conditionOperand(condition: RuleCondition, operands: Operands): Operand {
	switch (condition.conditionType) {
		case "transaction_category":
			return operandOf(condition.value, "Category", operands.categories);
		case "transaction_merchant":
			return operandOf(condition.value, "Merchant", operands.merchants);
		case "transaction_tag":
			return operandOf(condition.value, "Tag", operands.tags);
		// Minor units of the reporting currency (`schemas/rules.ts`), a decimal for Sure.
		case "transaction_amount":
			return {
				value:
					condition.value === null
						? null
						: decimal(toMinorUnits(Number(condition.value)), getReportingCurrency()),
			};
		default:
			return { value: condition.value };
	}
}

/** Sure's `serialize_condition`, a group with its conditions under `sub_conditions`. */
function sureCondition(
	condition: RuleCondition,
	conditions: readonly RuleCondition[],
	operands: Operands,
): Record<string, unknown> {
	const children = conditions.filter((child) => child.parentId === condition.id);

	return {
		condition_type: condition.conditionType,
		operator: condition.operator,
		...conditionOperand(condition, operands),
		...(condition.conditionType === "compound"
			? { sub_conditions: children.map((child) => sureCondition(child, conditions, operands)) }
			: {}),
	};
}

/** Sure's `serialize_action`; account ids stay ids, as Sure keeps them. */
function sureAction(action: RuleAction, operands: Operands): Record<string, unknown> {
	switch (action.actionType) {
		case "set_transaction_category":
			return {
				action_type: action.actionType,
				...operandOf(action.value, "Category", operands.categories),
			};
		case "set_transaction_merchant":
			return {
				action_type: action.actionType,
				...operandOf(action.value, "Merchant", operands.merchants),
			};
		case "set_transaction_tags":
			return { action_type: action.actionType, ...tagsOperand(action.value, operands.tags) };
		default:
			return { action_type: action.actionType, value: action.value };
	}
}

/**
 * A rule in Sure's shape, `null` when Sure would refuse it: Sure's `Rule`
 * needs an action, and a replacement in the label has no equivalent there,
 * so a rule that only replaces is left out of Sure's files.
 */
function sureRule(rule: Rule, operands: Operands) {
	const sure = rule.actions.filter((action) => !ARCHANT_ONLY_ACTIONS.has(action.actionType));
	const own = rule.actions.filter((action) => ARCHANT_ONLY_ACTIONS.has(action.actionType));

	if (sure.length === 0) {
		return null;
	}

	return {
		name: rule.name,
		resource_type: "transaction",
		active: rule.enabled,
		effective_date: rule.effectiveDate,
		conditions: rule.conditions
			.filter((condition) => condition.parentId === null)
			.map((condition) => sureCondition(condition, rule.conditions, operands)),
		actions: sure.map((action) => sureAction(action, operands)),
		archant: {
			actions: own.map((action) => ({
				action_type: action.actionType,
				value: action.value,
				replacement: action.replacement,
			})),
		},
	};
}

type Transfer = Awaited<ReturnType<typeof exportedTransfers>>[number];

/**
 * The first day of Sure's lines: the export day, in `timeZone`, 29 years
 * back. Sure's `Entry` refuses a date 30 years old or more, and one refusal
 * fails the whole import; the year left over lets the archive wait a while
 * before it is imported. Older entries are carried by the stored balance of
 * that day, which the opening anchor moves to.
 */
function sureFrom(timeZone: string): IsoDate {
	const day = today(timeZone);

	return new Date(
		Date.UTC(Number(day.slice(0, 4)) - 29, Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))),
	)
		.toISOString()
		.slice(0, 10);
}

/**
 * Whether Sure's `Transfer` validations accept the pair once confirmed: two
 * accounts, money leaving one side and reaching the other, the same amount
 * when the currency is the same, and 30 days apart at most. Sure's import
 * fails whole on a transfer it refuses, and a side before `from` is not in
 * Sure's lines at all. A transfer refused here stays on its two transactions
 * as `archant.transfer`.
 */
function sureAcceptsTransfer({ outflow, inflow }: Transfer, from: IsoDate): boolean {
	const days = Math.abs(daysBetween(outflow.date, inflow.date));

	return (
		outflow.date >= from &&
		inflow.date >= from &&
		outflow.accountId !== inflow.accountId &&
		outflow.amount < 0 &&
		inflow.amount > 0 &&
		(outflow.currency !== inflow.currency || outflow.amount + inflow.amount === 0) &&
		days <= 30
	);
}

/** What every file reads, each set of rows read once from the snapshot, when first needed. */
function readersOf(deps: ServiceDeps) {
	const db = deps.db;

	return {
		accounts: once(async () => exportedAccounts(deps)),
		categories: once(async () => exportedCategories(db)),
		tags: once(async () => exportedTags(db)),
		merchants: once(async () => exportedMerchants(db)),
		transfers: once(async () => exportedTransfers(db)),
		trades: once(async () => exportedTrades(db)),
		rules: once(async () => exportedRules(db)),
	};
}

type Readers = ReturnType<typeof readersOf>;

const byId = <Row extends { id: string }>(rows: readonly Row[]) =>
	new Map(rows.map((row) => [row.id, row]));

async function operandsOf(readers: Readers): Promise<Operands> {
	return {
		categories: byId(await readers.categories()),
		merchants: byId(await readers.merchants()),
		tags: byId(await readers.tags()),
	};
}

/** The transfers Sure accepts; a transaction of another keeps Sure's `standard`. */
async function acceptedTransfers(readers: Readers, from: IsoDate): Promise<Transfer[]> {
	return (await readers.transfers()).filter((transfer) => sureAcceptsTransfer(transfer, from));
}

async function* accountsCsv(readers: Readers) {
	yield csv([["id", "name", "type", "subtype", "balance", "currency", "created_at"]]);
	yield csv(
		(await readers.accounts()).map((account) => [
			account.id,
			textCell(account.name),
			SURE_ACCOUNTABLE_TYPES[account.type],
			sureSubtype(account.type, account.subtype),
			decimal(account.balance?.amount ?? toMinorUnits(0), account.currency),
			account.currency,
			csvTimestamp(account.createdAt),
		]),
	);
}

async function* transactionsCsv(deps: ServiceDeps, readers: Readers) {
	yield csv([["date", "account_name", "amount", "name", "category", "tags", "notes", "currency"]]);
	const accounts = byId(await readers.accounts());
	const categories = byId(await readers.categories());
	const tags = byId(await readers.tags());

	// A split's lines, never its parent, as Sure's `exportable_transactions`.
	for await (const page of transactionPages(deps.db, "lines")) {
		yield csv(
			page.map((row) => [
				row.date,
				textCell(accounts.get(row.accountId)?.name),
				sureAmount(toMinorUnits(row.amount), row.currency),
				textCell(row.transaction.label),
				row.transaction.categoryId === null
					? null
					: textCell(categories.get(row.transaction.categoryId)?.name),
				textCell(row.tagIds.map((id) => escapeTagName(tags.get(id)?.name ?? "")).join(",")),
				textCell(row.transaction.notes),
				row.currency,
			]),
		);
	}
}

type Trade = Awaited<ReturnType<typeof exportedTrades>>[number];

type ExportedSecurity = { ticker: string | null; isin: string | null; name: string };

/**
 * What Sure's importer finds a trade's or a holding's security by: its
 * ticker, else its ISIN for one typed by hand, else its name, such as a
 * fonds euros. Never blank: Sure's preflight refuses a `Trade` or a
 * `Holding` line without a ticker, and one refusal fails the whole import.
 */
function sureTicker(row: { security: ExportedSecurity }): string {
	return row.security.ticker ?? row.security.isin ?? row.security.name;
}

/**
 * A trade's security as Sure's lines name it. Interest on cash has none:
 * Sure books it on `Security.cash_for(account)`, whose ticker is
 * `CASH-<account id>` upper-cased and whose name is `Cash`.
 */
function tradeSecurity(trade: Trade): { ticker: string; name: string; mic: string | null } {
	return trade.security === null
		? { ticker: `CASH-${trade.accountId}`.toUpperCase(), name: "Cash", mic: null }
		: {
				ticker: sureTicker({ security: trade.security }),
				name: trade.security.name,
				mic: trade.security.mic,
			};
}

/** Sure's `Trade#investment_activity_label` for each kind of trade. */
const SURE_ACTIVITY_LABELS = {
	buy: "Buy",
	sell: "Sell",
	dividend: "Dividend",
	interest: "Interest",
} as const satisfies Record<TradeType, string>;

async function* tradesCsv(readers: Readers) {
	yield csv([["date", "account_name", "ticker", "quantity", "price", "amount", "currency"]]);
	const accounts = byId(await readers.accounts());

	yield csv(
		(await readers.trades()).map((trade) => [
			trade.date,
			textCell(accounts.get(trade.accountId)?.name),
			textCell(tradeSecurity(trade).ticker),
			formatMicros(trade.trade.quantity),
			formatMicros(trade.trade.price),
			sureAmount(toMinorUnits(trade.amount), trade.currency),
			trade.currency,
		]),
	);
}

async function* categoriesCsv(readers: Readers) {
	const categories = await readers.categories();
	const names = byId(categories);

	yield csv([["name", "color", "parent_category", "lucide_icon"]]);
	yield csv(
		categories.map((category) => [
			textCell(category.name),
			category.color,
			category.parentId === null ? null : textCell(names.get(category.parentId)?.name),
			category.icon,
		]),
	);
}

async function* merchantsCsv(readers: Readers) {
	yield csv([["name", "color", "website_url"]]);
	yield csv((await readers.merchants()).map((merchant) => [textCell(merchant.name), null, null]));
}

async function* rulesCsv(readers: Readers) {
	const operands = await operandsOf(readers);

	yield csv([["name", "resource_type", "active", "effective_date", "conditions", "actions"]]);
	yield csv(
		(await readers.rules()).flatMap((rule) => {
			const sure = sureRule(rule, operands);

			return sure === null
				? []
				: [
						[
							textCell(sure.name),
							sure.resource_type,
							sure.active,
							sure.effective_date,
							JSON.stringify(sure.conditions),
							JSON.stringify(sure.actions),
						],
					];
		}),
	);
}

type SplitLineRow = ExportedTransactionRow["splitLines"][number];

/** What Sure's `Transaction` has no key for, under `archant`. */
function archantTransaction(transaction: ExportedTransactionRow["transaction"]) {
	return {
		pending: transaction.pending,
		locked_fields: transaction.lockedFields,
		category_origin: transaction.categoryOrigin,
		reference: transaction.reference,
		possible_duplicate: transaction.possibleDuplicate,
	};
}

/**
 * A split line under its parent, with the keys of Sure's
 * `serialize_split_lines_for_export`. A line is never a transfer side
 * (AD-20), so its kind is `standard`; the entry is the transaction, so both
 * ids are its own.
 */
function sureSplitLine(line: SplitLineRow) {
	return {
		id: line.id,
		entry_id: line.id,
		amount: sureAmount(toMinorUnits(line.amount), line.currency),
		currency: line.currency,
		name: line.transaction.label,
		notes: line.transaction.notes,
		excluded: line.transaction.excluded,
		category_id: line.transaction.categoryId,
		merchant_id: line.transaction.merchantId,
		tag_ids: line.tagIds,
		kind: "standard",
		created_at: timestamp(line.createdAt),
		updated_at: timestamp(line.updatedAt),
		archant: archantTransaction(line.transaction),
	};
}

/**
 * `all.ndjson`, in the order Sure's importer reads its types, so each line's
 * references exist by the time it is imported. Sure's keys carry what Sure
 * can represent; the rest of a row goes under `archant`, which Sure's
 * importer ignores.
 */
async function* allNdjson(deps: ServiceDeps, readers: Readers, counts: Counts) {
	const accounts = await readers.accounts();
	const accountTypes = new Map(
		accounts.map((account) => [account.id, SURE_ACCOUNTABLE_TYPES[account.type]]),
	);

	yield ndjson(
		accounts.map((account) => {
			const loan = account.type === "loan" ? account.details : null;
			const subtype = sureSubtype(account.type, account.subtype);

			return {
				type: "Account",
				data: {
					id: account.id,
					name: account.name,
					balance: decimal(account.balance?.amount ?? toMinorUnits(0), account.currency),
					currency: account.currency,
					accountable_type: SURE_ACCOUNTABLE_TYPES[account.type],
					subtype,
					status: account.active ? "active" : "disabled",
					exclude_from_reports: account.excludedFromReports,
					created_at: timestamp(account.createdAt),
					updated_at: timestamp(account.updatedAt),
					accountable: {
						subtype,
						...(account.type === "loan"
							? {
									initial_balance:
										loan?.originalAmount === null || loan?.originalAmount === undefined
											? null
											: decimal(toMinorUnits(loan.originalAmount), account.currency),
									interest_rate:
										loan?.interestRate === null || loan?.interestRate === undefined
											? null
											: percent(loan.interestRate),
								}
							: {}),
					},
					archant: {
						type: account.type,
						subtype: account.subtype,
						...(account.type === "loan" ? { loan_end_date: loan?.endDate ?? null } : {}),
					},
				},
			};
		}),
		counts,
	);

	for await (const page of balancePages(deps.db)) {
		yield ndjson(
			page.map((row) => ({
				type: "Balance",
				data: {
					account_id: row.accountId,
					date: row.date,
					balance: decimal(toMinorUnits(row.balance), row.currency),
					cash_balance: decimal(row.cash, row.currency),
					currency: row.currency,
				},
			})),
			counts,
		);
	}

	yield ndjson(
		(await readers.categories()).map((category) => ({
			type: "Category",
			data: {
				id: category.id,
				name: category.name,
				color: category.color,
				lucide_icon: category.icon,
				parent_id: category.parentId,
				classification: category.kind,
				created_at: timestamp(category.createdAt),
				updated_at: timestamp(category.updatedAt),
			},
		})),
		counts,
	);

	for (const [type, rows] of [
		["Tag", await readers.tags()],
		["Merchant", await readers.merchants()],
	] as const) {
		yield ndjson(
			rows.map((row) => ({
				type,
				data: {
					id: row.id,
					name: row.name,
					created_at: timestamp(row.createdAt),
					updated_at: timestamp(row.updatedAt),
				},
			})),
			counts,
		);
	}

	yield ndjson(
		(await exportedRecurring(deps.db)).map((row) => ({
			type: "RecurringTransaction",
			data: {
				id: row.id,
				account_id: row.accountId,
				merchant_id: row.merchantId,
				amount: sureAmount(toMinorUnits(row.amount), row.currency),
				// Sure's sign reverses the order: Archant's largest outflow, its
				// minimum, is Sure's maximum, and Sure refuses a minimum above it.
				expected_amount_min: bandAmount(row.expectedAmountMax, row.currency),
				expected_amount_max: bandAmount(row.expectedAmountMin, row.currency),
				expected_amount_avg: bandAmount(row.expectedAmountAvg, row.currency),
				currency: row.currency,
				expected_day_of_month: row.expectedDayOfMonth,
				last_occurrence_date: row.lastOccurrenceDate,
				next_expected_date: row.nextExpectedDate,
				// Archant's statuses are Sure's, `paused` aside.
				status: row.status,
				occurrence_count: row.occurrenceCount,
				// Sure's one `name` is both what a series is called and what it
				// matches: the typed name, else the label.
				name: row.name ?? row.label,
				manual: row.manual,
				payment_url: row.paymentUrl,
				autopay: row.autopay,
				notes: row.notes,
				bill_type: row.billType,
				category_id: row.categoryId,
				anchor_date: row.anchorDate,
				end_mode: row.endAfterCount === null ? "never" : "after_count",
				end_after_count: row.endAfterCount,
				matcher_hints:
					row.schedulePinnedAt === null
						? {}
						: { schedule_pinned_at: timestamp(row.schedulePinnedAt) },
				dedup_scope: row.dedupScope,
				created_at: timestamp(row.createdAt),
				updated_at: timestamp(row.updatedAt),
			},
		})),
		counts,
	);

	yield ndjson(
		(await exportedRecurrenceRules(deps.db)).map((rule) => ({
			type: "RecurrenceRule",
			data: {
				id: rule.id,
				recurring_transaction_id: rule.recurringTransactionId,
				frequency: rule.frequency,
				interval: rule.interval,
				day_of_month: rule.dayOfMonth,
				weekday: rule.weekday,
				// Archant has no nth weekday: no Sure screen sets one.
				weekday_ordinal: null,
				month_of_year: rule.monthOfYear,
				position: rule.position,
			},
		})),
		counts,
	);

	const from = sureFrom(deps.timeZone);
	const sureTransfers = await acceptedTransfers(readers, from);
	const accepted = new Set(sureTransfers.map((transfer) => transfer.id));
	// The ids of transactions too old for Sure: few, unlike the ones kept.
	const tooOld = new Set<string>();

	// Top-level rows, a split's lines under its parent, as Sure's
	// `ndjson_exportable_transactions`.
	for await (const page of transactionPages(deps.db, "nested")) {
		for (const row of page) {
			if (row.date < from) {
				tooOld.add(row.id);
			}
		}

		yield ndjson(
			page
				.filter((row) => row.date >= from)
				.map((row) => {
					const kind =
						row.outflowOf !== null && accepted.has(row.outflowOf.id)
							? SURE_OUTFLOW_KINDS[row.outflowOf.kind]
							: row.inflowOf !== null && accepted.has(row.inflowOf.id)
								? "funds_movement"
								: "standard";

					return {
						type: "Transaction",
						data: {
							id: row.id,
							account_id: row.accountId,
							date: row.date,
							amount: sureAmount(toMinorUnits(row.amount), row.currency),
							currency: row.currency,
							name: row.transaction.label,
							notes: row.transaction.notes,
							excluded: row.transaction.excluded,
							category_id: row.transaction.categoryId,
							merchant_id: row.transaction.merchantId,
							tag_ids: row.tagIds,
							kind,
							created_at: timestamp(row.createdAt),
							updated_at: timestamp(row.updatedAt),
							...(row.splitLines.length === 0
								? {}
								: { split_lines: row.splitLines.map(sureSplitLine) }),
							archant: {
								...archantTransaction(row.transaction),
								// Every transfer, Sure's or not: one Sure refuses keeps its link here.
								transfer:
									row.outflowOf === null
										? row.inflowOf === null
											? null
											: { ...row.inflowOf, side: "inflow" }
										: { ...row.outflowOf, side: "outflow" },
							},
						},
					};
				}),
			counts,
		);
	}

	yield ndjson(
		sureTransfers.map((transfer) => ({
			type: "Transfer",
			data: {
				id: transfer.id,
				inflow_transaction_id: transfer.inflowTransactionId,
				outflow_transaction_id: transfer.outflowTransactionId,
				status: "confirmed",
				notes: null,
				created_at: timestamp(transfer.createdAt),
				updated_at: timestamp(transfer.createdAt),
				archant: { kind: transfer.kind },
			},
		})),
		counts,
	);

	yield ndjson(
		(await exportedRejectedTransfers(deps.db))
			.filter(
				(rejected) =>
					!tooOld.has(rejected.inflowTransactionId) && !tooOld.has(rejected.outflowTransactionId),
			)
			.map((rejected) => ({
				type: "RejectedTransfer",
				data: {
					id: rejected.id,
					inflow_transaction_id: rejected.inflowTransactionId,
					outflow_transaction_id: rejected.outflowTransactionId,
					created_at: timestamp(rejected.createdAt),
					updated_at: timestamp(rejected.createdAt),
				},
			})),
		counts,
	);

	// After the rejected pairs, as Sure's exporter.
	yield ndjson(
		(await readers.trades())
			.filter((trade) => trade.date >= from)
			.map((trade) => ({
				type: "Trade",
				data: {
					// The entry is the trade, so both ids are its own.
					id: trade.id,
					entry_id: trade.id,
					account_id: trade.accountId,
					security_id: trade.trade.securityId,
					ticker: tradeSecurity(trade).ticker,
					security_name: tradeSecurity(trade).name,
					exchange_operating_mic: tradeSecurity(trade).mic,
					investment_activity_label: SURE_ACTIVITY_LABELS[typeOf(trade.trade)],
					date: trade.date,
					qty: formatMicros(trade.trade.quantity),
					price: formatMicros(trade.trade.price),
					amount: sureAmount(toMinorUnits(trade.amount), trade.currency),
					currency: trade.currency,
					created_at: timestamp(trade.createdAt),
					updated_at: timestamp(trade.updatedAt),
					archant: {
						isin: trade.security?.isin ?? null,
						fee: decimal(trade.trade.fee, trade.currency),
						// The transaction converted into it, an excluded `Transaction` line.
						parent_entry_id: trade.parentEntryId,
					},
				},
			})),
		counts,
	);

	// No `id`: a holding is derived, and Sure's importer finds one by its
	// account, security and day. A cost basis the owner locked stands on the
	// days its position holds the security, as Sure's `cost_basis_source`
	// ranks it.
	const locks = new Map(
		(await exportedCostBasisLocks(deps.db)).map((lock) => [
			`${lock.accountId} ${lock.securityId}`,
			lock,
		]),
	);

	for await (const page of holdingPages(deps.db, from)) {
		yield ndjson(
			page.map((row) => {
				const lock = locks.get(`${row.accountId} ${row.securityId}`);
				const locked =
					lock !== undefined && row.quantity > 0 && (lock.after === null || row.date > lock.after);
				const costBasis = locked ? lock.costBasis : row.costBasis;

				return {
					type: "Holding",
					data: {
						account_id: row.accountId,
						security_id: row.securityId,
						ticker: sureTicker(row),
						security_name: row.security.name,
						exchange_operating_mic: row.security.mic,
						date: row.date,
						qty: formatMicros(row.quantity),
						price: formatMicros(row.price),
						amount: decimal(row.amount, row.currency),
						currency: row.currency,
						cost_basis: costBasis === null ? null : formatMicros(costBasis),
						cost_basis_source: costBasis === null ? null : locked ? "manual" : "calculated",
						cost_basis_locked: locked,
						security_locked: false,
						archant: { isin: row.security.isin },
					},
				};
			}),
			counts,
		);
	}

	const valuations = await exportedValuations(deps);
	const moved = new Map(
		await Promise.all(
			valuations
				.filter((row) => row.valuationKind === "opening_anchor" && row.date < from)
				.map(async (row) => [row.id, await balanceOn(deps, row.accountId, from)] as const),
		),
	);

	yield ndjson(valuationLines(valuations, accountTypes, from, moved), counts);
	yield ndjson(await budgetLines(deps), counts);

	const operands = await operandsOf(readers);

	yield ndjson(
		(await readers.rules()).flatMap((rule) => {
			const sure = sureRule(rule, operands);

			return sure === null
				? []
				: [
						{
							type: "Rule",
							data: {
								id: rule.id,
								...sure,
								created_at: timestamp(rule.createdAt),
								updated_at: timestamp(rule.updatedAt),
							},
						},
					];
		}),
		counts,
	);
}

type Valuation = Awaited<ReturnType<typeof exportedValuations>>[number];

/**
 * One valuation per account and day, as `SureImport::Preflight` demands:
 * the opening anchor first, then the bank's figure, then a snapshot. Rows
 * arrive by account and day, oldest first, so a later one of the same kind
 * replaces an earlier one. An opening anchor before `from` moves to that
 * day, at the stored balance `moved` gives it there, its own date under
 * `archant.opening_date`; any other valuation before `from` stays out.
 */
function valuationLines(
	rows: readonly Valuation[],
	accountTypes: ReadonlyMap<string, SureAccountableType>,
	from: IsoDate,
	moved: ReadonlyMap<string, Money | null>,
): Line[] {
	const kept = new Map<string, { row: Valuation; kind: ValuationKind; date: IsoDate }>();

	for (const row of rows) {
		const kind = row.valuationKind ?? "reconciliation";
		const date = kind === "opening_anchor" && row.date < from ? from : row.date;
		const key = `${row.accountId} ${date}`;
		const current = kept.get(key);

		if (
			date >= from &&
			(current === undefined || VALUATION_PRECEDENCE[kind] <= VALUATION_PRECEDENCE[current.kind])
		) {
			kept.set(key, { row, kind, date });
		}
	}

	return [...kept.values()].map(({ row, kind, date }) => {
		const balance = date === row.date ? row.dayBalance : moved.get(row.id);

		return {
			type: "Valuation",
			data: {
				id: row.id,
				account_id: row.accountId,
				date,
				amount: decimal(balance?.amount ?? toMinorUnits(row.amount), row.currency),
				currency: row.currency,
				name: VALUATION_NAMES[accountTypes.get(row.accountId) ?? "Depository"][kind],
				kind,
				created_at: timestamp(row.createdAt),
				updated_at: timestamp(row.updatedAt),
				...(date === row.date ? {} : { archant: { opening_date: row.date } }),
			},
		};
	});
}

/**
 * Each month's budget with its category amounts. What a category received
 * from the month before is the chain the page reads, never the stored
 * column, which a transaction recategorised since leaves stale.
 */
async function budgetLines(deps: ServiceDeps): Promise<Line[]> {
	const [months, amounts, carried] = await Promise.all([
		exportedBudgets(deps.db),
		exportedBudgetCategories(deps.db),
		rolloverAmounts(deps),
	]);
	const carriedOf = new Map(carried.map((row) => [row.id, row.carried]));

	return [
		...months.map((month) => ({
			type: "Budget",
			data: {
				id: month.id,
				start_date: monthRange(month.month).from,
				end_date: monthRange(month.month).to,
				budgeted_spending:
					month.budgetedSpending === null
						? null
						: decimal(toMinorUnits(month.budgetedSpending), month.currency),
				expected_income:
					month.expectedIncome === null
						? null
						: decimal(toMinorUnits(month.expectedIncome), month.currency),
				currency: month.currency,
				created_at: timestamp(month.createdAt),
				updated_at: timestamp(month.updatedAt),
			},
		})),
		...amounts.map((row) => ({
			type: "BudgetCategory",
			data: {
				id: row.id,
				budget_id: row.budgetId,
				category_id: row.categoryId,
				budgeted_spending: decimal(toMinorUnits(row.budgetedSpending), row.currency),
				currency: row.currency,
				rollover_enabled: row.rolloverEnabled,
				rolled_over_amount: decimal(carriedOf.get(row.id) ?? toMinorUnits(0), row.currency),
				created_at: timestamp(row.createdAt),
				updated_at: timestamp(row.updatedAt),
			},
		})),
	];
}

type Part = readonly [name: string, chunks: () => AsyncIterable<string>];

/**
 * `goals.ndjson`: each goal and each of its links, in Sure's column names
 * and as `all.ndjson` writes its lines, amounts as decimals. Apart from
 * `all.ndjson`, because Sure's exporter writes no goal and
 * `SureImport::Preflight` refuses a type it does not know (AD-23). A link
 * has no id or timestamps of its own: the goal and the account name it.
 */
async function* goalsNdjson(deps: ServiceDeps, counts: Counts) {
	const [goalRows, links] = await Promise.all([
		exportedGoals(deps.db),
		exportedGoalAccounts(deps.db),
	]);

	yield ndjson(
		[
			...goalRows.map((goal) => ({
				type: "Goal",
				data: {
					id: goal.id,
					name: goal.name,
					target_amount: decimal(toMinorUnits(goal.targetAmount), goal.currency),
					currency: goal.currency,
					target_date: goal.targetDate,
					color: goal.color,
					icon: goal.icon,
					notes: goal.notes,
					state: goal.state,
					kind: goal.kind,
					target_mode: goal.targetMode,
					target_months: goal.targetMonths,
					completed_amount:
						goal.completedAmount === null
							? null
							: decimal(toMinorUnits(goal.completedAmount), goal.currency),
					completed_at: goal.completedAt === null ? null : timestamp(goal.completedAt),
					created_at: timestamp(goal.createdAt),
					updated_at: timestamp(goal.updatedAt),
				},
			})),
			...links.map((link) => ({
				type: "GoalAccount",
				data: {
					goal_id: link.goalId,
					account_id: link.accountId,
					allocated_amount:
						link.allocatedAmount === null
							? null
							: decimal(toMinorUnits(link.allocatedAmount), link.currency),
				},
			})),
		],
		counts,
	);
}

/**
 * `prices.ndjson`: each price the owner typed, a `SecurityPrice` line naming
 * its security as a `Trade` line does. Apart from `all.ndjson`, because
 * `SureImport::Preflight` refuses a price line (AD-23); the provider's
 * prices stay out, its next fetch finding them again.
 */
async function* pricesNdjson(deps: ServiceDeps, counts: Counts) {
	yield ndjson(
		(await exportedTypedPrices(deps.db)).map((row) => ({
			type: "SecurityPrice",
			data: {
				security_id: row.securityId,
				ticker: sureTicker(row),
				security_name: row.security.name,
				exchange_operating_mic: row.security.mic,
				date: row.date,
				price: formatMicros(row.price),
				currency: row.currency,
				source: row.source,
				archant: { isin: row.security.isin },
			},
		})),
		counts,
	);
}

/**
 * `attachments.json`, Sure's `generate_attachments_manifest`: one line of
 * JSON listing every attachment without its bytes, which never leave. The
 * entry is the transaction, so `record_id` and `entry_id` are both its id.
 * `checksum` is `null`: Sure's is Active Storage's MD5, which Archant does
 * not keep.
 */
async function* attachmentsJson(deps: ServiceDeps) {
	const attachments = await exportedAttachments(deps.db);

	yield JSON.stringify({
		version: 1,
		binary_included: false,
		attachments: attachments.map((attachment) => ({
			id: attachment.id,
			record_type: "Transaction",
			record_id: attachment.transactionId,
			name: "attachments",
			filename: attachment.filename,
			content_type: attachment.contentType,
			byte_size: attachment.byteSize,
			checksum: null,
			binary_included: false,
			created_at: timestamp(attachment.createdAt),
			entry_id: attachment.transactionId,
			account_id: attachment.accountId,
		})),
	});
}

async function* version() {
	yield `export_version: ${EXPORT_VERSION}\n`;
}

/**
 * The archive's entries, in the order of Sure's, without what Archant has not
 * built yet, then what Sure's export has no file for.
 */
function partsOf(deps: ServiceDeps, counts: Counts): Part[] {
	const readers = readersOf(deps);

	return [
		["version.txt", version],
		["accounts.csv", () => accountsCsv(readers)],
		["transactions.csv", () => transactionsCsv(deps, readers)],
		["trades.csv", () => tradesCsv(readers)],
		["categories.csv", () => categoriesCsv(readers)],
		["merchants.csv", () => merchantsCsv(readers)],
		["rules.csv", () => rulesCsv(readers)],
		["attachments.json", () => attachmentsJson(deps)],
		["all.ndjson", () => allNdjson(deps, readers, counts)],
		["goals.ndjson", () => goalsNdjson(deps, counts)],
		["prices.ndjson", () => pricesNdjson(deps, counts)],
	];
}

/** fflate's streaming ZIP, what it writes held until the stream takes it. */
function zipWriter() {
	const ready: Uint8Array[] = [];
	const failures: Error[] = [];
	const zip = new Zip((error, data) => {
		if (error === null) {
			ready.push(data);
		} else {
			failures.push(error);
		}
	});

	function* drain() {
		const [failure] = failures;

		if (failure !== undefined) {
			throw failure;
		}

		yield* ready.splice(0);
	}

	return { zip, drain };
}

const encoder = new TextEncoder();

/** One entry, deflated as its text arrives. */
async function* entry(
	writer: ReturnType<typeof zipWriter>,
	[name, chunks]: Part,
): AsyncGenerator<Uint8Array> {
	const file = new ZipDeflate(name, { level: 6 });
	writer.zip.add(file);

	for await (const text of chunks()) {
		file.push(encoder.encode(text));
		yield* writer.drain();
	}

	file.push(new Uint8Array(0), true);
	yield* writer.drain();
}

/**
 * The ZIP of `parts`, each entry deflated as its text arrives: what a page of
 * rows compresses to leaves before the next page is read, so the archive is
 * never whole in memory.
 */
async function* zipped(parts: readonly Part[]): AsyncGenerator<Uint8Array> {
	const writer = zipWriter();

	for (const part of parts) {
		yield* entry(writer, part);
	}

	writer.zip.end();
	yield* writer.drain();
}

/**
 * The archive's bytes, read from one snapshot opened at the first pull and
 * closed at the end, on a failure, or when the client goes. One log line
 * says how it ended: counts and duration, never a figure or a name (AD-14).
 */
async function* archiveBytes(deps: ExportDeps): AsyncGenerator<Uint8Array> {
	const started = performance.now();
	const counts: Counts = {};
	let outcome: "finished" | "failed" | "cancelled" = "cancelled";
	let snapshot: ReadSnapshot | null = null;

	try {
		snapshot = await readSnapshot(deps.db);
		yield* zipped(partsOf({ db: snapshot.db, timeZone: deps.timeZone }, counts));
		outcome = "finished";
	} catch (error) {
		outcome = "failed";
		deps.logger.error({ error: error instanceof Error ? error.name : "unknown" }, "export failed");
		throw error;
	} finally {
		snapshot?.close();

		if (outcome !== "failed") {
			deps.logger.info(
				{ durationMs: Math.round(performance.now() - started), ...counts },
				`export ${outcome}`,
			);
		}
	}
}

/** How long the stream waits for a client to read on before it gives its snapshot back. */
export const EXPORT_IDLE_MS = 2 * 60_000;

/** `archant_export_YYYYMMDD_HHMMSS.zip` at `now` in `timeZone`. */
export function archiveName(now: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(now);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((item) => item.type === type)?.value ?? "";

	return `archant_export_${part("year")}${part("month")}${part("day")}_${part("hour")}${part("minute")}${part("second")}.zip`;
}

/**
 * Every figure Archant holds, as a ZIP in Sure's export format
 * (`Family::DataExporter` at 14638a7), so Sure's `SureImport` accepts its
 * `all.ndjson`. Streamed and pull-driven: a page is read only once the client
 * has taken the bytes before it, and nothing is stored (AD-23).
 */
export function exportArchive(deps: ExportDeps, now = new Date()): Archive {
	const bytes = archiveBytes(deps);
	let idle: ReturnType<typeof setTimeout> | undefined;

	return {
		fileName: archiveName(now, deps.timeZone),
		body: new ReadableStream<Uint8Array>(
			{
				async pull(controller) {
					clearTimeout(idle);

					try {
						const next = await bytes.next();

						if (next.done === true) {
							controller.close();
						} else {
							controller.enqueue(next.value);
							// A client that stops reading without going would hold the
							// snapshot, its pooled connection and the WAL's growth forever.
							idle = setTimeout(() => {
								void bytes.return(undefined);
								controller.error(
									new AppError("INTERNAL_ERROR", "The export stopped: nothing read for too long."),
								);
							}, EXPORT_IDLE_MS);
							idle.unref();
						}
					} catch {
						// `archiveBytes` logged the name. `@hono/node-server` prints a
						// stream's error whole, and a Drizzle error holds the query's
						// parameters, amounts among them.
						controller.error(new AppError("INTERNAL_ERROR", "The export stopped."));
					}
				},
				async cancel() {
					clearTimeout(idle);
					await bytes.return(undefined);
				},
			},
			// No pull before a read: Hono answers `HEAD` by dropping the body
			// unread and never cancels it, and a pull opens the snapshot.
			{ highWaterMark: 0 },
		),
	};
}
