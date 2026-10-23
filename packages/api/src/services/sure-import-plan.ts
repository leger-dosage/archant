import type { IsoDate } from "../domain/dates.ts";
import type { RecurrenceRule } from "../domain/recurring/schedule.ts";
import type { ServiceDeps } from "./deps.ts";
import type {
	Data,
	Findings,
	Line,
	Parsed,
	SureImportLimits,
	SureIssue,
	SurePreflight,
} from "./sure-import-preflight.ts";

import { z } from "zod";

import type { AccountDetails, AccountSubtype, AccountType } from "@archant/data/account-types";
import {
	ACCOUNT_TYPES,
	AREA_UNITS,
	LOAN_INSURANCE_TYPES,
	LOAN_RATE_TYPES,
	MILEAGE_UNITS,
	TAX_TREATMENTS,
	holdsSecurities,
	isSubtypeOf,
} from "@archant/data/account-types";
import type { ActivityLabel } from "@archant/data/activity-labels";
import { ACTIVITY_LABELS } from "@archant/data/activity-labels";
import type { CategoryIcon } from "@archant/data/category-presets";
import {
	CATEGORY_COLOR_PATTERN,
	CATEGORY_ICONS,
	newCategory,
} from "@archant/data/category-presets";
import { CATEGORY_NAME_MAX_LENGTH } from "@archant/data/category-presets";
import type { Quantity, TradePrice } from "@archant/data/decimals";
import {
	formatQuantity,
	formatTradePrice,
	parseQuantity,
	parseTradePrice,
} from "@archant/data/decimals";
import type { IncomeKind } from "@archant/data/income-kinds";
import type { Micros } from "@archant/data/micros";
import { parseMicros } from "@archant/data/micros";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode, toMinorUnits } from "@archant/data/money";
import { MERCHANT_NAME_MAX_LENGTH, TAG_NAME_MAX_LENGTH } from "@archant/data/name-limits";
import type { BillType } from "@archant/data/recurring";
import { BILL_TYPES, LAST_DAY_OF_MONTH, MAX_END_AFTER_COUNT } from "@archant/data/recurring";
import type { CategoryOrigin } from "@archant/data/schema/categories";
import { CATEGORY_ORIGINS } from "@archant/data/schema/categories";
import type { RecurringStatus } from "@archant/data/schema/recurring-transactions";
import { RECURRING_STATUSES } from "@archant/data/schema/recurring-transactions";
import type { TransferKind, TransferStatus } from "@archant/data/transfer-kinds";
import { TRANSFER_KINDS, TRANSFER_STATUSES } from "@archant/data/transfer-kinds";

import { addDays, today } from "../domain/dates.ts";
import { isTooFarAhead } from "../domain/statement.ts";
import { tradeAmount, tradeValue } from "../domain/trades.ts";
import { ACCOUNT_NAME_MAX_LENGTH } from "../schemas/accounts.ts";
import { parseAccountDetails } from "../schemas/accounts.ts";
import { LABEL_MAX_LENGTH, NOTES_MAX_LENGTH } from "../schemas/transactions.ts";
import { getReportingCurrency } from "./settings.ts";
import {
	amountOf,
	archantOf,
	arrayOf,
	booleanOf,
	dateOf,
	decimalText,
	idOf,
	inspect,
	isBlank,
	isData,
	issue,
	oneOf,
	recordsOf,
	splitAmountOf,
	splitLinesOf,
	textOf,
	runPreflight,
} from "./sure-import-preflight.ts";

// What Archant keeps of a Sure archive: each line read once into the plan
// the import writes from, and Archant's own refusals beside Sure's preflight,
// as Sure's `InvalidRecordError`.

/** Sure's `ACCOUNTABLE_TYPE_CLASSES`, each with the Archant type it becomes. */
const ACCOUNTABLE_TYPES: Record<string, AccountType> = {
	Depository: "depository",
	Investment: "investment",
	Crypto: "crypto",
	Property: "property",
	Vehicle: "vehicle",
	OtherAsset: "other_asset",
	CreditCard: "credit_card",
	Loan: "loan",
	OtherLiability: "other_liability",
};

// --- The plan: what the import writes, each row naming the others by the
// archive's ids, which the import maps to new ones per type. --------------

export type PlanAccount = {
	sourceId: string;
	name: string;
	type: AccountType;
	subtype: AccountSubtype | null;
	currency: CurrencyCode;
	active: boolean;
	excludedFromReports: boolean;
	institutionName: string | null;
	institutionDomain: string | null;
	notes: string | null;
	details: AccountDetails | null;
	/** A stored balance (AD-5), the start of the forward computation. */
	opening: { date: IsoDate; amount: MinorUnits };
};

export type PlanCategory = {
	sourceId: string;
	name: string;
	color: string;
	icon: CategoryIcon;
	parentSourceId: string | null;
};

export type PlanNamed = { sourceId: string; name: string };

type PlanSplitLine = {
	sourceId: string | null;
	label: string;
	amount: MinorUnits;
	notes: string | null;
	oneTime: boolean;
	categorySourceId: string | null;
	/** `undefined` when the line names none: it takes its parent's, as Sure's. */
	merchantSourceId: string | null | undefined;
	/** `null` when the line has no `tag_ids`: it takes its parent's. */
	tagSourceIds: string[] | null;
	/** Archant's own export's locks, `null` from Sure: the line locks what a user's split does. */
	lockedFields: Record<string, number | null> | null;
};

export type PlanTransaction = {
	sourceId: string;
	accountSourceId: string;
	date: IsoDate;
	amount: MinorUnits;
	label: string;
	notes: string | null;
	excluded: boolean;
	oneTime: boolean;
	pending: boolean;
	reference: string | null;
	possibleDuplicate: boolean;
	/** Each locked field with the time it was locked, as Archant's export writes them. */
	lockedFields: Record<string, number | null>;
	categorySourceId: string | null;
	categoryOrigin: CategoryOrigin;
	merchantSourceId: string | null;
	tagSourceIds: string[];
	investmentActivityLabel: ActivityLabel | null;
	splitLines: PlanSplitLine[];
};

type PlanTransfer = {
	outflowSourceId: string;
	inflowSourceId: string;
	kind: TransferKind | null;
	status: TransferStatus;
	notes: string | null;
};

type PlanPair = { outflowSourceId: string; inflowSourceId: string };

/**
 * A trade's or a holding's security as its line names it. `byHand` is one
 * typed by hand, its ticker the ISIN or the name an export wrote for want
 * of one; any other is a listing the price provider knows.
 */
export type PlanSecurity = {
	key: string;
	ticker: string;
	mic: string | null;
	isin: string | null;
	name: string;
	byHand: boolean;
};

type PlanTrade = {
	accountSourceId: string;
	date: IsoDate;
	/** `null` for interest on cash, Sure's `CASH-<account id>`. */
	security: PlanSecurity | null;
	incomeKind: IncomeKind | null;
	quantity: Quantity;
	price: TradePrice;
	fee: MinorUnits;
	amount: MinorUnits;
	parentSourceId: string | null;
};

type PlanHolding = {
	accountSourceId: string;
	date: IsoDate;
	security: PlanSecurity;
	price: Micros;
	/** A cost basis the owner locked, as Sure's `manual` source with `cost_basis_locked`. */
	lockedCostBasis: Micros | null;
};

type PlanValuation = { accountSourceId: string; date: IsoDate; amount: MinorUnits };

type PlanRecurring = {
	sourceId: string;
	accountSourceId: string | null;
	destinationSourceId: string | null;
	merchantSourceId: string | null;
	categorySourceId: string | null;
	name: string | null;
	label: string;
	amount: MinorUnits;
	expectedAmountMin: MinorUnits | null;
	expectedAmountMax: MinorUnits | null;
	expectedAmountAvg: MinorUnits | null;
	currency: CurrencyCode;
	expectedDayOfMonth: number;
	lastOccurrenceDate: IsoDate;
	nextExpectedDate: IsoDate;
	occurrenceCount: number;
	status: RecurringStatus;
	manual: boolean;
	autopay: boolean;
	notes: string | null;
	paymentUrl: string | null;
	billType: BillType;
	anchorDate: IsoDate | null;
	endAfterCount: number | null;
	dedupScope: string;
	schedulePinnedAt: number | null;
	nameAliases: string[];
	learnedTolerance: number | null;
	rules: RecurrenceRule[];
};

type PlanBudget = {
	sourceId: string;
	month: string;
	budgetedSpending: MinorUnits | null;
	expectedIncome: MinorUnits | null;
};

type PlanBudgetCategory = {
	budgetSourceId: string;
	categorySourceId: string;
	amount: MinorUnits;
	rolloverEnabled: boolean | undefined;
};

export type SurePlan = {
	accounts: PlanAccount[];
	categories: PlanCategory[];
	tags: PlanNamed[];
	merchants: PlanNamed[];
	recurring: PlanRecurring[];
	transactions: PlanTransaction[];
	transfers: PlanTransfer[];
	rejectedTransfers: PlanPair[];
	trades: PlanTrade[];
	holdings: PlanHolding[];
	valuations: PlanValuation[];
	budgets: PlanBudget[];
	budgetCategories: PlanBudgetCategory[];
	rules: Data[];
};

export type SureArchive = SurePreflight & { plan: SurePlan };

// --- Archant's refusals, and the plan --------------------------------------

/**
 * Sure's `invalid_import_record`: the line, its type, the field and, unless
 * it is an amount (AD-14), the value Archant cannot keep.
 */
function invalid(record: Line, field: string, value?: unknown): SureIssue {
	return issue("invalid_import_record", {
		line: String(record.line),
		type: record.type,
		field,
		...(value === undefined ? {} : { value: inspect(value) }),
	});
}

/** The type and subtype of an account line, or the field Archant refuses. */
function accountKind(
	data: Data,
): { type: AccountType; subtype: AccountSubtype | null } | { field: string; value: unknown } {
	const typeName = String(data.accountable_type);
	// Own keys only: `constructor` or `__proto__` would read an inherited value.
	const type = Object.hasOwn(ACCOUNTABLE_TYPES, typeName) ? ACCOUNTABLE_TYPES[typeName] : undefined;

	if (type === undefined) {
		return { field: "accountable_type", value: data.accountable_type ?? null };
	}

	const archant = archantOf(data);

	// Archant's own export keeps the subtype Sure's has no word for.
	if (archant.type === type && (archant.subtype === null || typeof archant.subtype === "string")) {
		const subtype = archant.subtype;

		if (isSubtypeOf(type, subtype)) {
			return {
				type,
				subtype: ACCOUNT_TYPES[type].subtypes.find((known) => known === subtype) ?? null,
			};
		}
	}

	const accountable = isData(data.accountable) ? data.accountable : {};
	const given = textOf(accountable.subtype) ?? textOf(data.subtype);
	// Sure's only card subtype is `credit_card`; Archant's card has none.
	const subtype = type === "credit_card" && given === "credit_card" ? null : given;

	if (!isSubtypeOf(type, subtype)) {
		return { field: "subtype", value: subtype };
	}

	return { type, subtype: ACCOUNT_TYPES[type].subtypes.find((known) => known === subtype) ?? null };
}

const scalar = (value: unknown): string | undefined =>
	typeof value === "string"
		? value
		: typeof value === "number" || typeof value === "boolean"
			? String(value)
			: undefined;

/**
 * The details of an account line Archant keeps, as its form would read them
 * typed: a value that does not read is left unknown, never a refusal.
 */
function detailsOf(
	type: AccountType,
	data: Data,
	currency: CurrencyCode,
	openingDate: IsoDate,
): AccountDetails | null {
	const accountable = isData(data.accountable) ? data.accountable : {};
	const archant = archantOf(data);
	const context = { currency, openingDate };

	switch (type) {
		case "loan": {
			const schedule = isData(accountable.variable_rate_schedule)
				? accountable.variable_rate_schedule
				: {};
			const parsed = parseAccountDetails(
				type,
				{
					originalAmount: scalar(accountable.initial_balance),
					downPayment: scalar(accountable.down_payment),
					startDate: scalar(accountable.start_date),
					termMonths: scalar(accountable.term_months),
					rateType: oneOf(LOAN_RATE_TYPES, accountable.rate_type) ?? undefined,
					interestRate: scalar(accountable.interest_rate),
					insuranceRate: scalar(accountable.insurance_rate),
					insuranceRateType:
						oneOf(LOAN_INSURANCE_TYPES, accountable.insurance_rate_type) ?? undefined,
					rateChanges: Object.entries(schedule).map(([effectiveDate, rate]) => ({
						effectiveDate,
						rate: scalar(rate) ?? "",
					})),
				},
				context,
			);
			const endDate = dateOf(archant.loan_end_date);

			return parsed === null || !("rateChanges" in parsed.details)
				? null
				: { ...parsed.details, endDate };
		}
		case "credit_card":
			return (
				parseAccountDetails(
					type,
					{
						availableCredit: scalar(accountable.available_credit),
						minimumPayment: scalar(accountable.minimum_payment),
						apr: scalar(accountable.apr),
						expirationDate: scalar(accountable.expiration_date),
						annualFee: scalar(accountable.annual_fee),
					},
					context,
				)?.details ?? null
			);
		case "property": {
			const address = isData(archant.address) ? archant.address : {};

			return (
				parseAccountDetails(
					type,
					{
						yearBuilt: scalar(accountable.year_built),
						areaValue: scalar(accountable.area_value),
						areaUnit: oneOf(AREA_UNITS, accountable.area_unit) ?? undefined,
						addressLine1: scalar(address.line1),
						locality: scalar(address.locality),
						region: scalar(address.region),
						postalCode: scalar(address.postal_code),
						country: scalar(address.country),
					},
					context,
				)?.details ?? null
			);
		}
		case "vehicle":
			return (
				parseAccountDetails(
					type,
					{
						make: scalar(accountable.make),
						model: scalar(accountable.model),
						year: scalar(accountable.year),
						mileageValue: scalar(accountable.mileage_value),
						mileageUnit: oneOf(MILEAGE_UNITS, accountable.mileage_unit) ?? undefined,
					},
					context,
				)?.details ?? null
			);
		case "crypto":
			return {
				taxTreatment: oneOf(TAX_TREATMENTS, accountable.tax_treatment) ?? "taxable",
			};
		default:
			return null;
	}
}

/** Every line's account and date, for Sure's oldest entry of each account. */
function oldestDates(parsed: Parsed): Map<string, IsoDate> {
	const oldest = new Map<string, IsoDate>();

	for (const type of ["Balance", "Transaction", "Trade", "Holding", "Valuation"]) {
		for (const record of recordsOf(parsed, type)) {
			const account = idOf(record.data.account_id);
			const date = dateOf(record.data.date);

			if (account !== null && date !== null) {
				const current = oldest.get(account);
				oldest.set(account, current === undefined || date < current ? date : current);
			}
		}
	}

	return oldest;
}

type Reader = {
	parsed: Parsed;
	findings: Findings;
	timeZone: string;
	accounts: Map<string, PlanAccount>;
	/** The currency each security key was first traded or held in. */
	securityCurrencies: Map<string, string>;
};

/**
 * Accounts as `createAccount` writes them. The opening anchor is the
 * account's first `opening_anchor` valuation; without one, Sure's
 * `OpeningBalanceManager` fallback: its `balance`, the day before its oldest
 * line, else today.
 */
function readAccounts(reader: Reader): PlanAccount[] {
	const { parsed, findings } = reader;
	const oldest = oldestDates(parsed);
	const anchors = new Map<string, Line>();

	for (const record of recordsOf(parsed, "Valuation")) {
		const account = idOf(record.data.account_id);

		if (account !== null && record.data.kind === "opening_anchor" && !anchors.has(account)) {
			anchors.set(account, record);
		}
	}

	return recordsOf(parsed, "Account").flatMap((record): PlanAccount[] => {
		const { data } = record;
		const sourceId = idOf(data.id);
		const kind = accountKind(data);

		if ("field" in kind) {
			findings.errors.push(invalid(record, kind.field, kind.value));

			return [];
		}

		const currency = data.currency ?? getReportingCurrency();

		if (typeof currency !== "string" || !isCurrencyCode(currency)) {
			findings.errors.push(invalid(record, "currency", currency));

			return [];
		}

		const name = textOf(data.name)?.trim() ?? null;
		const balance = amountOf(data.balance, currency);

		if (balance === null) {
			findings.errors.push(invalid(record, "balance"));

			return [];
		}

		// A blank one is Sure's `missing_required_fields`; one that is no text is refused here.
		if (sourceId === null || name === null) {
			if (sourceId === null && !isBlank(data.id)) {
				findings.errors.push(invalid(record, "id", data.id));
			}

			if (name === null && !isBlank(data.name)) {
				findings.errors.push(invalid(record, "name", data.name));
			}

			return [];
		}

		const anchor = anchors.get(sourceId);
		let opening: PlanAccount["opening"];

		if (anchor === undefined) {
			const first = oldest.get(sourceId);
			opening = {
				date: first === undefined ? today(reader.timeZone) : addDays(first, -1),
				amount: balance,
			};
		} else {
			const date = entryDateOf(reader, anchor.data.date);
			const amount = amountOf(anchor.data.amount, currency);

			// Reported on the valuation's line: without its account, it is read no further.
			if (date === null) {
				findings.errors.push(invalid(anchor, "date", anchor.data.date));

				return [];
			}

			if (amount === null) {
				findings.errors.push(invalid(anchor, "amount"));

				return [];
			}

			opening = { date, amount };
		}

		return [
			{
				sourceId,
				name: cut(name, ACCOUNT_NAME_MAX_LENGTH),
				type: kind.type,
				subtype: kind.subtype,
				currency,
				active: data.status !== "disabled",
				excludedFromReports: booleanOf(data.exclude_from_reports, false),
				institutionName: textOf(data.institution_name),
				institutionDomain: textOf(data.institution_domain),
				notes: textOf(data.notes),
				details: detailsOf(kind.type, data, currency, opening.date),
				opening,
			},
		];
	});
}

/**
 * An entry's date, `null` when it does not read or lies more than 366 days
 * ahead, as `ingest` refuses `DATE_TOO_LATE`: each day up to the latest
 * entry gets a balance row, and 9999-12-31 would write millions.
 */
function entryDateOf(reader: Reader, value: unknown): IsoDate | null {
	const date = dateOf(value);

	return date === null || isTooFarAhead(date, today(reader.timeZone)) ? null : date;
}

/** The account a line names, read already; `undefined` when refused or absent. */
function accountOf(reader: Reader, record: Line): PlanAccount | undefined {
	const id = idOf(record.data.account_id);

	return id === null ? undefined : reader.accounts.get(id);
}

/**
 * An entry's currency, its account's or refused (AD-6): one currency per
 * account, and a line dropped would leave its balance silently wrong.
 */
function entryCurrency(reader: Reader, record: Line, account: PlanAccount): boolean {
	const currency = record.data.currency ?? account.currency;

	if (currency !== account.currency) {
		reader.findings.errors.push(invalid(record, "currency", currency));

		return false;
	}

	return true;
}

/** `Balance` lines are checked, never stored: the import recomputes balances. */
function readBalances(reader: Reader): void {
	for (const record of recordsOf(reader.parsed, "Balance")) {
		const account = accountOf(reader, record);
		const currency = record.data.currency ?? account?.currency;

		if (dateOf(record.data.date) === null) {
			reader.findings.errors.push(invalid(record, "date", record.data.date));
		} else if (typeof currency === "string" && amountOf(record.data.balance, currency) === null) {
			reader.findings.errors.push(invalid(record, "balance"));
		}
	}
}

function readCategories(reader: Reader): PlanCategory[] {
	return recordsOf(reader.parsed, "Category").flatMap((record): PlanCategory[] => {
		const sourceId = idOf(record.data.id);
		const name = textOf(record.data.name);
		const preset = newCategory();
		const color = typeof record.data.color === "string" ? record.data.color.toLowerCase() : "";

		return sourceId === null || name === null
			? []
			: [
					{
						sourceId,
						name: cut(name.trim(), CATEGORY_NAME_MAX_LENGTH),
						color: CATEGORY_COLOR_PATTERN.test(color) ? color : preset.color,
						icon: oneOf(CATEGORY_ICONS, record.data.lucide_icon) ?? preset.icon,
						parentSourceId: idOf(record.data.parent_id),
					},
				];
	});
}

function readNamed(reader: Reader, type: string, max: number): PlanNamed[] {
	return recordsOf(reader.parsed, type).flatMap((record) => {
		const sourceId = idOf(record.data.id);
		const name = textOf(record.data.name);

		return sourceId === null || name === null ? [] : [{ sourceId, name: cut(name.trim(), max) }];
	});
}

/**
 * A text cut to `max` characters, as Archant's forms bound them, by code
 * point so an emoji is never split in two.
 */
export function cut(text: string, max: number): string {
	const points = Array.from(text);

	return points.length <= max ? text : points.slice(0, max).join("");
}

const cutOrNull = (text: string | null, max: number) => (text === null ? null : cut(text, max));

/** An import time from Rails' ISO 8601, `null` when it does not read. */
function instantOf(value: unknown): number | null {
	const time = typeof value === "string" ? Date.parse(value) : Number.NaN;

	return Number.isFinite(time) ? time : null;
}

/** The transaction's columns Sure's line has no key for, from Archant's own export. */
function archantTransaction(data: Data) {
	const archant = archantOf(data);
	const locked = isData(archant.locked_fields) ? archant.locked_fields : {};
	// The ledger keeps the fields it knows (AD-10).
	const lockedFields = Object.fromEntries(
		Object.entries(locked).map(([field, at]) => [field, instantOf(at)]),
	);

	return {
		pending: booleanOf(archant.pending, false),
		reference: textOf(archant.reference),
		possibleDuplicate: booleanOf(archant.possible_duplicate, false),
		lockedFields,
		categoryOrigin: oneOf(CATEGORY_ORIGINS, archant.category_origin) ?? "user",
		investmentActivityLabel: oneOf(ACTIVITY_LABELS, archant.investment_activity_label),
	};
}

/** The label of an imported line without one: Sure's « Imported transaction ». */
const IMPORTED_LABEL = "Opération importée";

/** Tag ids as Sure's `mapped_tag_ids` reads them, repeats dropped. */
function tagIdsOf(value: unknown): string[] {
	return [...new Set(arrayOf(value).flatMap((id) => idOf(id) ?? []))];
}

/**
 * A transaction in Archant's sign (AD-5), its split lines too; a line in
 * another currency than its account's, or whose amount or date does not
 * read, is refused.
 */
function readTransactions(reader: Reader, merchantIds: ReadonlySet<string>): PlanTransaction[] {
	const merchant = (value: unknown) => {
		const id = idOf(value);

		return id !== null && merchantIds.has(id) ? id : null;
	};

	return recordsOf(reader.parsed, "Transaction").flatMap((record): PlanTransaction[] => {
		const { data } = record;
		const account = accountOf(reader, record);
		const sourceId = idOf(data.id);

		if (account === undefined || sourceId === null || !entryCurrency(reader, record, account)) {
			return [];
		}

		const date = entryDateOf(reader, data.date);
		const sureAmount = amountOf(data.amount, account.currency);

		if (date === null) {
			reader.findings.errors.push(invalid(record, "date", data.date));

			return [];
		}

		if (sureAmount === null) {
			reader.findings.errors.push(invalid(record, "amount"));

			return [];
		}

		const amount = toMinorUnits(0 - sureAmount);
		const rawLines = splitLinesOf(data);
		const splitLines = (Array.isArray(rawLines) ? rawLines : []).flatMap(
			(split): PlanSplitLine[] => {
				if (!isData(split)) {
					return [];
				}

				const lineAmount = amountOf(splitAmountOf(split), account.currency);

				if (lineAmount === null) {
					return [];
				}

				return [
					{
						sourceId: idOf(split.id),
						label: cut(
							textOf(split.name) ??
								textOf(split.memo) ??
								textOf(split.description) ??
								IMPORTED_LABEL,
							LABEL_MAX_LENGTH,
						),
						amount: toMinorUnits(0 - lineAmount),
						notes: cutOrNull(textOf(split.notes), NOTES_MAX_LENGTH),
						oneTime: split.kind === "one_time",
						categorySourceId: idOf(split.category_id),
						merchantSourceId: Object.hasOwn(split, "merchant_id")
							? merchant(split.merchant_id)
							: undefined,
						tagSourceIds: Object.hasOwn(split, "tag_ids") ? tagIdsOf(split.tag_ids) : null,
						lockedFields: isData(archantOf(split).locked_fields)
							? archantTransaction(split).lockedFields
							: null,
					},
				];
			},
		);

		if (
			Array.isArray(rawLines) &&
			(splitLines.length !== rawLines.length ||
				splitLines.reduce((sum, line) => sum + line.amount, 0) !== amount)
		) {
			// Rounded to the account's minor units, the lines no longer add up.
			reader.findings.errors.push(invalid(record, "split_lines"));

			return [];
		}

		const categorySourceId = idOf(data.category_id);
		const archant = archantTransaction(data);

		return [
			{
				sourceId,
				accountSourceId: account.sourceId,
				date,
				amount,
				label: cut(textOf(data.name) ?? IMPORTED_LABEL, LABEL_MAX_LENGTH),
				notes: cutOrNull(textOf(data.notes), NOTES_MAX_LENGTH),
				excluded: booleanOf(data.excluded, false),
				oneTime: data.kind === "one_time",
				pending: archant.pending,
				reference: archant.reference,
				possibleDuplicate: archant.possibleDuplicate,
				lockedFields: archant.lockedFields,
				categorySourceId,
				categoryOrigin: archant.categoryOrigin,
				merchantSourceId: merchant(data.merchant_id),
				tagSourceIds: tagIdsOf(data.tag_ids),
				investmentActivityLabel: archant.investmentActivityLabel,
				splitLines,
			},
		];
	});
}

/** A transfer's two sides, none when either is blank. */
function pairOf(record: Line): PlanPair[] {
	const outflowSourceId = idOf(record.data.outflow_transaction_id);
	const inflowSourceId = idOf(record.data.inflow_transaction_id);

	return outflowSourceId === null || inflowSourceId === null
		? []
		: [{ outflowSourceId, inflowSourceId }];
}

function readTransfers(reader: Reader): { transfers: PlanTransfer[]; rejected: PlanPair[] } {
	return {
		transfers: recordsOf(reader.parsed, "Transfer").flatMap((record) =>
			pairOf(record).map((sides) => ({
				...sides,
				kind: oneOf(TRANSFER_KINDS, archantOf(record.data).kind),
				status: oneOf(TRANSFER_STATUSES, record.data.status) ?? "pending",
				notes: textOf(record.data.notes),
			})),
		),
		rejected: recordsOf(reader.parsed, "RejectedTransfer").flatMap(pairOf),
	};
}

const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}\d$/u;

/** A trade's or a holding's security, as `find_or_create_security` reads its line. */
function securityOf(data: Data): PlanSecurity | null {
	const ticker = textOf(data.ticker)?.trim().toUpperCase() ?? null;

	if (ticker === null) {
		return null;
	}

	const mic = textOf(data.exchange_operating_mic)?.trim().toUpperCase() ?? null;
	const archantIsin = textOf(archantOf(data).isin)?.trim().toUpperCase() ?? null;
	const given = textOf(data.security_name)?.trim() ?? null;
	const name = given ?? ticker;
	// An export writes a security without a ticker under its ISIN, else its name.
	const byHand =
		ticker === archantIsin ||
		(archantIsin === null && ISIN_PATTERN.test(ticker)) ||
		ticker === given?.toUpperCase();
	const isin = archantIsin ?? (ISIN_PATTERN.test(ticker) ? ticker : null);

	return {
		key: JSON.stringify(
			byHand ? ["hand", isin, isin === null ? name : null] : ["listing", ticker, mic],
		),
		ticker,
		mic: byHand ? null : mic,
		isin,
		name,
		byHand,
	};
}

/**
 * Whether a security is held in one currency across the archive (AD-6): the
 * import finds one row by its ticker and MIC, or its ISIN, and a line from
 * an account in another currency would fail it. Refused on the later line.
 */
function oneCurrency(
	reader: Reader,
	record: Line,
	security: PlanSecurity,
	currency: string,
): boolean {
	const keys = [security.key, ...(security.isin === null ? [] : [`isin ${security.isin}`])];
	const other = keys
		.map((key) => reader.securityCurrencies.get(key))
		.find((known) => known !== undefined && known !== currency);

	if (other !== undefined) {
		reader.findings.errors.push(invalid(record, "ticker", record.data.ticker ?? null));

		return false;
	}

	for (const key of keys) {
		reader.securityCurrencies.set(key, reader.securityCurrencies.get(key) ?? currency);
	}

	return true;
}

/** Whether an account holds securities, refused on the line otherwise. */
function holdsSecuritiesFor(reader: Reader, record: Line, account: PlanAccount): boolean {
	if (!holdsSecurities(account.type)) {
		reader.findings.errors.push(invalid(record, "account_id", record.data.account_id));

		return false;
	}

	return true;
}

/**
 * Trades as Archant stores them (AD-22): a buy or a sale keeps Sure's signed
 * quantity, its fee from `archant.fee`, else the amount less the quantity
 * times the price, never below zero; a dividend or interest is an income of
 * quantity zero, interest on Sure's `CASH-<id>` on no security.
 */
function readTrades(reader: Reader): PlanTrade[] {
	return recordsOf(reader.parsed, "Trade").flatMap((record): PlanTrade[] => {
		const { data } = record;
		const account = accountOf(reader, record);

		if (
			account === undefined ||
			!entryCurrency(reader, record, account) ||
			!holdsSecuritiesFor(reader, record, account)
		) {
			return [];
		}

		const date = entryDateOf(reader, data.date);
		const sureAmount = amountOf(data.amount, account.currency);
		const label = data.investment_activity_label;
		const cash = textOf(data.ticker)?.toUpperCase() === `CASH-${account.sourceId}`.toUpperCase();
		const incomeKind: IncomeKind | null =
			label === "Dividend" ? "dividend" : label === "Interest" ? "interest" : null;

		if (date === null) {
			reader.findings.errors.push(invalid(record, "date", data.date));

			return [];
		}

		if (sureAmount === null) {
			reader.findings.errors.push(invalid(record, "amount"));

			return [];
		}

		const amount = toMinorUnits(0 - sureAmount);
		const parentSourceId = idOf(archantOf(data).parent_entry_id);
		const security = incomeKind === "interest" && cash ? null : securityOf(data);

		// Only interest is paid on cash (`trades_security_check`): a dividend names a security.
		if (incomeKind === "dividend" && (cash || security === null)) {
			reader.findings.errors.push(invalid(record, "ticker", data.ticker ?? null));

			return [];
		}

		if (security !== null && !oneCurrency(reader, record, security, account.currency)) {
			return [];
		}

		if (incomeKind !== null) {
			if (amount <= 0) {
				reader.findings.errors.push(invalid(record, "amount"));

				return [];
			}

			return [
				{
					accountSourceId: account.sourceId,
					date,
					security,
					incomeKind,
					quantity: formatQuantity(0n),
					price: formatTradePrice(0n),
					fee: toMinorUnits(0),
					amount,
					parentSourceId,
				},
			];
		}

		const quantity = parseQuantity(decimalText(data.qty) ?? "");
		const price = parseTradePrice(decimalText(data.price) ?? "");

		if (quantity === null || quantity === "0") {
			reader.findings.errors.push(invalid(record, "qty", data.qty));

			return [];
		}

		if (price === null || price.startsWith("-")) {
			reader.findings.errors.push(invalid(record, "price", data.price));

			return [];
		}

		if (security === null) {
			reader.findings.errors.push(invalid(record, "ticker", data.ticker ?? null));

			return [];
		}

		const fee = feeOf(archantOf(data).fee, account.currency, { quantity, price }, sureAmount);
		const archantAmount = tradeAmount({ quantity, price, fee }, account.currency);

		if (archantAmount === null) {
			reader.findings.errors.push(invalid(record, "amount"));

			return [];
		}

		return [
			{
				accountSourceId: account.sourceId,
				date,
				security,
				incomeKind: null,
				quantity,
				price,
				fee,
				amount: archantAmount,
				parentSourceId,
			},
		];
	});
}

type TradeFigures = { quantity: Quantity; price: TradePrice };

/** `archant.fee`, else Sure's amount less `quantity × price`, never below zero. */
function feeOf(
	given: unknown,
	currency: CurrencyCode,
	trade: TradeFigures,
	sureAmount: MinorUnits,
): MinorUnits {
	const archant = amountOf(given, currency);

	if (archant !== null && archant >= 0) {
		return archant;
	}

	const fee = BigInt(sureAmount) - tradeValue(trade.quantity, trade.price, currency);

	return toMinorUnits(fee > 0n ? Number(fee) : 0);
}

/** A holding's price and, when the owner locked one, its cost basis. */
function readHoldings(reader: Reader): PlanHolding[] {
	return recordsOf(reader.parsed, "Holding").flatMap((record): PlanHolding[] => {
		const { data } = record;
		const account = accountOf(reader, record);

		if (
			account === undefined ||
			!entryCurrency(reader, record, account) ||
			!holdsSecuritiesFor(reader, record, account)
		) {
			return [];
		}

		const date = dateOf(data.date);
		const price = parseMicros(decimalText(data.price) ?? "");
		const security = securityOf(data);
		const costText = decimalText(data.cost_basis);
		const costBasis = costText === null || costText === "" ? null : parseMicros(costText);

		if (date === null) {
			reader.findings.errors.push(invalid(record, "date", data.date));

			return [];
		}

		if (parseQuantity(decimalText(data.qty) ?? "") === null) {
			reader.findings.errors.push(invalid(record, "qty", data.qty));

			return [];
		}

		if (price === null || price < 0) {
			reader.findings.errors.push(invalid(record, "price", data.price));

			return [];
		}

		if (security === null) {
			reader.findings.errors.push(invalid(record, "ticker", data.ticker ?? null));

			return [];
		}

		if (!oneCurrency(reader, record, security, account.currency)) {
			return [];
		}

		if (amountOf(data.amount, account.currency) === null) {
			reader.findings.errors.push(invalid(record, "amount"));

			return [];
		}

		if (costText !== null && costText !== "" && (costBasis === null || costBasis < 0)) {
			reader.findings.errors.push(invalid(record, "cost_basis", data.cost_basis));

			return [];
		}

		const locked = data.cost_basis_source === "manual" && booleanOf(data.cost_basis_locked, false);

		return [
			{
				accountSourceId: account.sourceId,
				date,
				security,
				price,
				lockedCostBasis: locked ? costBasis : null,
			},
		];
	});
}

/** Snapshots: every valuation but the opening anchor the account starts from. */
function readValuations(reader: Reader): PlanValuation[] {
	const anchored = new Set<string>();

	return recordsOf(reader.parsed, "Valuation").flatMap((record): PlanValuation[] => {
		const account = accountOf(reader, record);

		if (account === undefined || !entryCurrency(reader, record, account)) {
			return [];
		}

		const date = entryDateOf(reader, record.data.date);
		const amount = amountOf(record.data.amount, account.currency);

		if (date === null) {
			reader.findings.errors.push(invalid(record, "date", record.data.date));

			return [];
		}

		if (amount === null) {
			reader.findings.errors.push(invalid(record, "amount"));

			return [];
		}

		// The first opening anchor is the account's own, written with it.
		if (record.data.kind === "opening_anchor" && !anchored.has(account.sourceId)) {
			anchored.add(account.sourceId);

			return [];
		}

		return [{ accountSourceId: account.sourceId, date, amount }];
	});
}

const MAX_LEARNED_TOLERANCE = 250;

const integerOf = (value: unknown) =>
	typeof value === "number" && Number.isInteger(value) ? value : null;

/** A recurrence rule Archant's shape check accepts, else none, as Sure skips an invalid one. */
function ruleOf(data: Data): RecurrenceRule | null {
	const interval = Number(data.interval);
	const day = integerOf(data.day_of_month);
	const weekday = integerOf(data.weekday);
	const month = integerOf(data.month_of_year);

	if (!Number.isInteger(interval) || interval < 1 || !isBlank(data.weekday_ordinal)) {
		return null;
	}

	const dayFits = day !== null && day >= LAST_DAY_OF_MONTH && day <= 31 && day !== 0;

	switch (data.frequency) {
		case "weekly":
			return weekday !== null && weekday >= 0 && weekday <= 6 && day === null
				? { frequency: "weekly", interval, weekday }
				: null;
		case "monthly":
			return dayFits && weekday === null
				? { frequency: "monthly", interval, dayOfMonth: day }
				: null;
		case "yearly":
			return dayFits && weekday === null && month !== null && month >= 1 && month <= 12
				? { frequency: "yearly", interval, dayOfMonth: day, monthOfYear: month }
				: null;
		default:
			return null;
	}
}

/**
 * Series as Sure's importer keeps them, a band in Archant's sign: its
 * export swaps the minimum and the maximum. A series without a name whose
 * merchant is missing is skipped, as Sure's; a day or a date that does not
 * read skips it too.
 */
function readRecurring(reader: Reader, merchantIds: ReadonlySet<string>): PlanRecurring[] {
	const rulesBySeries = new Map<string, Map<number, RecurrenceRule>>();

	for (const record of recordsOf(reader.parsed, "RecurrenceRule")) {
		const series = idOf(record.data.recurring_transaction_id);
		const rule = ruleOf(record.data);
		const position = Number(record.data.position ?? 0);

		if (series !== null && rule !== null && Number.isInteger(position) && position >= 0) {
			const rules = rulesBySeries.get(series) ?? new Map<number, RecurrenceRule>();

			if (!rules.has(position)) {
				rules.set(position, rule);
			}

			rulesBySeries.set(series, rules);
		}
	}

	return recordsOf(reader.parsed, "RecurringTransaction").flatMap((record): PlanRecurring[] => {
		const { data } = record;
		const sourceId = idOf(data.id);
		const accountSourceId = idOf(data.account_id);
		const account = accountSourceId === null ? undefined : reader.accounts.get(accountSourceId);
		const merchantSourceId = idOf(data.merchant_id);
		const merchant =
			merchantSourceId !== null && merchantIds.has(merchantSourceId) ? merchantSourceId : null;
		const name = textOf(data.name)?.trim() ?? null;
		const currency = data.currency ?? account?.currency ?? getReportingCurrency();
		const day = Number(data.expected_day_of_month);
		const last = dateOf(data.last_occurrence_date);
		const next = dateOf(data.next_expected_date);

		if (
			sourceId === null ||
			(accountSourceId !== null && account === undefined) ||
			(merchant === null && name === null)
		) {
			return [];
		}

		if (!Number.isInteger(day) || day < 1 || day > 31) {
			reader.findings.errors.push(
				invalid(record, "expected_day_of_month", data.expected_day_of_month ?? null),
			);

			return [];
		}

		if (last === null || next === null) {
			const field = last === null ? "last_occurrence_date" : "next_expected_date";

			reader.findings.errors.push(invalid(record, field, data[field] ?? null));

			return [];
		}

		// One currency per account (AD-6), as its entries.
		if (
			typeof currency !== "string" ||
			!isCurrencyCode(currency) ||
			(account !== undefined && currency !== account.currency)
		) {
			reader.findings.errors.push(invalid(record, "currency", currency));

			return [];
		}

		const sure = amountOf(data.amount, currency);

		if (sure === null) {
			reader.findings.errors.push(invalid(record, "amount"));

			return [];
		}

		const band = (value: unknown) => {
			const amount = amountOf(value, currency);

			return amount === null ? null : toMinorUnits(0 - amount);
		};
		const archant = archantOf(data);
		const destinationSourceId = idOf(archant.destination_account_id);
		const destination =
			destinationSourceId !== null &&
			destinationSourceId !== accountSourceId &&
			accountSourceId !== null &&
			reader.accounts.has(destinationSourceId)
				? destinationSourceId
				: null;
		const billType = oneOf(BILL_TYPES, destination === null ? data.bill_type : "transfer");
		const hints = isData(data.matcher_hints) ? data.matcher_hints : {};
		const toleranceText = decimalText(hints.learned_tolerance_pct);
		// Absent, blank or not a number is no learned tolerance, never zero.
		const tolerance =
			toleranceText === null || toleranceText === "" ? Number.NaN : Number(toleranceText);
		const endAfterCount = Number(data.end_after_count);
		const rules = [...(rulesBySeries.get(sourceId) ?? new Map<number, RecurrenceRule>())]
			.toSorted(([a], [b]) => a - b)
			.map(([, rule]) => rule);

		return [
			{
				sourceId,
				accountSourceId,
				destinationSourceId: destination,
				merchantSourceId: destination === null ? merchant : null,
				categorySourceId: idOf(data.category_id),
				name,
				label: name ?? "",
				amount: toMinorUnits(0 - sure),
				expectedAmountMin: band(data.expected_amount_max),
				expectedAmountMax: band(data.expected_amount_min),
				expectedAmountAvg: band(data.expected_amount_avg),
				currency,
				expectedDayOfMonth: day,
				lastOccurrenceDate: last,
				nextExpectedDate: next,
				occurrenceCount: Math.max(0, Math.trunc(Number(data.occurrence_count) || 0)),
				// Sure's `paused` is Archant's `inactive`.
				status:
					data.status === "paused"
						? "inactive"
						: (oneOf(RECURRING_STATUSES, data.status) ?? "active"),
				manual: booleanOf(data.manual, false),
				autopay: booleanOf(data.autopay, false),
				notes: textOf(data.notes),
				paymentUrl: textOf(data.payment_url),
				billType:
					billType === null || (billType === "transfer") !== (destination !== null)
						? "bill"
						: billType,
				anchorDate: dateOf(data.anchor_date),
				endAfterCount:
					data.end_mode === "after_count" &&
					Number.isInteger(endAfterCount) &&
					endAfterCount >= 1 &&
					endAfterCount <= MAX_END_AFTER_COUNT
						? endAfterCount
						: null,
				dedupScope: typeof data.dedup_scope === "string" ? data.dedup_scope : "",
				schedulePinnedAt: instantOf(hints.schedule_pinned_at),
				nameAliases: z.array(z.string()).catch([]).parse(hints.name_aliases),
				learnedTolerance: Number.isFinite(tolerance)
					? Math.min(MAX_LEARNED_TOLERANCE, Math.max(0, Math.round(tolerance * 10)))
					: null,
				rules,
			},
		];
	});
}

/**
 * Months of the reporting currency, Archant's only budget currency (AD-6):
 * a line in another is skipped, with its categories.
 */
function readBudgets(reader: Reader): { budgets: PlanBudget[]; lines: PlanBudgetCategory[] } {
	const currency = getReportingCurrency();
	const budgets = recordsOf(reader.parsed, "Budget").flatMap((record): PlanBudget[] => {
		const { data } = record;
		const sourceId = idOf(data.id);
		const start = dateOf(data.start_date);

		if (sourceId === null || (data.currency ?? currency) !== currency) {
			return [];
		}

		if (start === null) {
			reader.findings.errors.push(invalid(record, "start_date", data.start_date));

			return [];
		}

		const amount = (field: string) => {
			if (isBlank(data[field])) {
				return null;
			}

			const value = amountOf(data[field], currency);

			if (value === null || value < 0) {
				reader.findings.errors.push(invalid(record, field));
			}

			return value;
		};

		return [
			{
				sourceId,
				month: start.slice(0, 7),
				budgetedSpending: amount("budgeted_spending"),
				expectedIncome: amount("expected_income"),
			},
		];
	});
	const kept = new Set(budgets.map((budget) => budget.sourceId));
	const lines = recordsOf(reader.parsed, "BudgetCategory").flatMap(
		(record): PlanBudgetCategory[] => {
			const { data } = record;
			const budgetSourceId = idOf(data.budget_id);
			const categorySourceId = idOf(data.category_id);

			if (budgetSourceId === null || categorySourceId === null || !kept.has(budgetSourceId)) {
				return [];
			}

			const amount = isBlank(data.budgeted_spending)
				? toMinorUnits(0)
				: amountOf(data.budgeted_spending, currency);

			if (amount === null || amount < 0) {
				reader.findings.errors.push(invalid(record, "budgeted_spending"));

				return [];
			}

			return [
				{
					budgetSourceId,
					categorySourceId,
					amount,
					rolloverEnabled: Object.hasOwn(data, "rollover_enabled")
						? booleanOf(data.rollover_enabled, false)
						: undefined,
				},
			];
		},
	);

	return { budgets, lines };
}

/** Archant's refusals, each on its line, and the plan of what Archant keeps. */
function readPlan(parsed: Parsed, findings: Findings, timeZone: string): SurePlan {
	const reader: Reader = {
		parsed,
		findings,
		timeZone,
		accounts: new Map(),
		securityCurrencies: new Map(),
	};

	for (const account of readAccounts(reader)) {
		reader.accounts.set(account.sourceId, account);
	}

	readBalances(reader);
	const merchantList = [
		...readNamed(reader, "Merchant", MERCHANT_NAME_MAX_LENGTH),
		...readNamed(reader, "ProviderMerchant", MERCHANT_NAME_MAX_LENGTH),
	];
	const merchantIds = new Set(merchantList.map((merchant) => merchant.sourceId));
	const { transfers, rejected } = readTransfers(reader);
	const { budgets, lines } = readBudgets(reader);

	return {
		accounts: [...reader.accounts.values()],
		categories: readCategories(reader),
		tags: readNamed(reader, "Tag", TAG_NAME_MAX_LENGTH),
		merchants: merchantList,
		recurring: readRecurring(reader, merchantIds),
		transactions: readTransactions(reader, merchantIds),
		transfers,
		rejectedTransfers: rejected,
		trades: readTrades(reader),
		holdings: readHoldings(reader),
		valuations: readValuations(reader),
		budgets,
		budgetCategories: lines,
		rules: recordsOf(parsed, "Rule").map((record) => record.data),
	};
}

/**
 * Reads an uploaded archive: Sure's preflight with Archant's refusals beside
 * it, each finding on its line, Sure's counts and the plan of what the
 * import writes. Writes nothing.
 */
export async function readSureArchive(
	deps: ServiceDeps,
	file: { name: string; bytes: Uint8Array },
	limits: SureImportLimits,
): Promise<SureArchive> {
	const { kept, ...preflight } = await runPreflight(deps, file, limits, (parsed, findings) =>
		readPlan(parsed, findings, deps.timeZone),
	);

	return { ...preflight, plan: kept };
}
