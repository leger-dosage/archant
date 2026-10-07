import { z } from "zod";

import { BILL_TYPES } from "@archant/data/recurring";
import { RULE_OPERATORS_BY_TYPE } from "@archant/data/rules";

import { BALANCE_PERIODS } from "./balances.ts";
import {
	BILL_LIFECYCLES,
	BILL_PAYMENT_STATES,
	EDITABLE_BILL_TYPES,
	FREQUENCY_PRESETS,
} from "./bills.ts";
import { createCategorySchema } from "./categories.ts";
import { merchantSchema } from "./merchants.ts";
import { RECURRING_VIEWS } from "./recurring.ts";
import { monthSchema } from "./reports.ts";
import { MAX_RULE_CONDITIONS, RULE_TYPE_VALUES } from "./rules.ts";
import { tagSchema } from "./tags.ts";
import {
	DEFAULT_PAGE_SIZE,
	MAX_BULK_IDS,
	MAX_TAG_FILTER,
	bulkIds,
	bulkPatchSchema,
	checkFilter,
	directionSchema,
	filterFields,
	parseBounds,
} from "./transactions.ts";

/** The input of a tool that takes none: an assistant may send `{}`, nothing more. */
export const noToolInput = z.strictObject({});

/**
 * A period ending today, as the dashboard's and an account page's charts
 * offer them. A year by default, as Sure's tools default to the last 365 days.
 */
const toolPeriod = z
	.enum(BALANCE_PERIODS)
	.default("1Y")
	.describe(
		'"1M", "3M", "6M" or "1Y": that many months ending today; "all": since the first account opened.',
	);

/** `get_accounts`: today's balances, and with `includeBalanceSeries` their history. */
export const getAccountsInput = z.strictObject({
	includeBalanceSeries: z
		.boolean()
		.default(false)
		.describe("Adds each account's balance over the period, as its page charts it."),
	period: toolPeriod.describe(
		'Only with includeBalanceSeries. "1M", "3M", "6M" or "1Y": that many months ending today; "all": since the account opened.',
	),
});

/** `get_balance_sheet`: net worth over a period. */
export const balanceSheetInput = z.strictObject({ period: toolPeriod });

/** `get_income_statement`: one calendar month's income and expenses. */
export const incomeStatementInput = z.strictObject({
	month: monthSchema.optional().describe("YYYY-MM; the current month when absent."),
});

/** `get_recurring_transactions`: the series « Récurrents » lists, narrowed. */
export const recurringInput = z.strictObject({
	status: z
		.enum(RECURRING_VIEWS)
		.default("current")
		.describe(
			'"current": suggested or active; "inactive": paused or retired; "all": both, ended ones never.',
		),
	withinDays: z
		.number()
		.int()
		.min(1)
		.max(365)
		.optional()
		.describe(
			"Keeps the series expected from today to today plus this many days; overdue ones are left out.",
		),
});

/** `get_holdings`: one account's positions today. */
export const holdingsInput = z.strictObject({
	accountId: z
		.string()
		.min(1)
		.describe("An account id from get_accounts; an investment account holds positions."),
});

/** `get_transaction`: one transaction in full. */
export const transactionIdInput = z.strictObject({
	id: z.string().min(1).describe("A transaction id from get_transactions."),
});

/** The page an assistant reads at once: a list page of the interface, no more. */
const MAX_TOOL_PAGE_SIZE = 100;

// Every repeated key of the list's query takes as many ids as its tag filter.
const idsOf = (what: string) =>
	z.array(z.string().min(1)).max(MAX_TAG_FILTER).optional().describe(what);

/**
 * The cross-account list's filter, each repeated key as an array: an
 * assistant sends JSON, never a query string.
 */
const toolFilterFields = {
	account: idsOf("Account ids from get_accounts; any of them."),
	direction: z
		.array(directionSchema)
		.transform((values) => [...new Set(values)])
		.optional()
		.describe(
			"income, expense or transfer, as the list's type filter; any of them. A transfer between two accounts is neither income nor expense.",
		),
	category: idsOf(
		'Category ids from get_categories, "none" standing for uncategorised; any of them. A parent stands for its children too.',
	),
	merchant: idsOf("Merchant ids from get_merchants; any of them."),
	tag: idsOf("Tag ids from get_tags; transactions carrying any of them."),
	from: filterFields.from.describe("The first date, YYYY-MM-DD, inclusive."),
	to: filterFields.to.describe("The last date, YYYY-MM-DD, inclusive."),
	amountMin: filterFields.amountMin.describe(
		'The smallest absolute amount, a decimal string such as "12.50".',
	),
	amountMax: filterFields.amountMax.describe(
		'The largest absolute amount, a decimal string such as "120".',
	),
	q: filterFields.q.describe("Text searched in the label and the notes, case aside."),
};

const pageFields = {
	page: z.number().int().min(1).default(1),
	pageSize: z.number().int().min(1).max(MAX_TOOL_PAGE_SIZE).default(50),
};

/** `get_transactions`: the list's filter and a page of it. */
export const getTransactionsInput = z
	.strictObject({ ...toolFilterFields, ...pageFields })
	.superRefine(checkFilter)
	.transform(parseBounds);

/** `group_transactions_by_label`: the list's filter, every matching transaction grouped. */
export const groupTransactionsInput = z
	.strictObject(toolFilterFields)
	.superRefine(checkFilter)
	.transform(parseBounds);

/** `get_rule_runs`: a page of past applications. */
export const ruleRunsInput = z.strictObject({
	page: pageFields.page,
	pageSize: z.number().int().min(1).max(MAX_TOOL_PAGE_SIZE).default(20),
});

const operatorsOf = <Type extends keyof typeof RULE_OPERATORS_BY_TYPE>(type: Type, what: string) =>
	z.enum(RULE_OPERATORS_BY_TYPE[type]).describe(what);

/** `is_null` reads no value: it is omitted or `null`. */
const optionalValue = (what: string) => z.string().nullable().optional().describe(what);

const TEXT_OPERATORS =
	'"like": contains the value, case aside, accents counting; "=": the whole text, case included.';

/**
 * One leaf condition per type, each with its own operators, so a refused
 * operator names its type's: the shape of `RULE_OPERATORS_BY_TYPE`.
 */
const leafConditions = [
	z.strictObject({
		conditionType: z.literal("transaction_name"),
		operator: operatorsOf("transaction_name", TEXT_OPERATORS),
		value: z.string().describe("Text compared with the label as the bank wrote it."),
	}),
	z.strictObject({
		conditionType: z.literal("transaction_amount"),
		operator: operatorsOf(
			"transaction_amount",
			"Compares the transaction's absolute amount with the value.",
		),
		value: z
			.string()
			.describe(
				'A decimal string such as "12.50", without a sign. Only transactions in the reporting currency match.',
			),
	}),
	z.strictObject({
		conditionType: z.literal("transaction_account"),
		operator: operatorsOf("transaction_account", '"=": the transaction is in this account.'),
		value: z.string().describe("An account id from get_accounts."),
	}),
	z.strictObject({
		conditionType: z.literal("transaction_merchant"),
		operator: operatorsOf(
			"transaction_merchant",
			'"=": this merchant; "is_null": no merchant, without a value.',
		),
		value: optionalValue("A merchant id from get_merchants or create_merchant."),
	}),
	z.strictObject({
		conditionType: z.literal("transaction_category"),
		operator: operatorsOf(
			"transaction_category",
			'"=": exactly this category, never one of its children; "is_null": uncategorised, without a value.',
		),
		value: optionalValue("A category id from get_categories or create_category."),
	}),
	z.strictObject({
		conditionType: z.literal("transaction_tag"),
		operator: operatorsOf(
			"transaction_tag",
			'"=": carries this tag among others; "is_null": carries no tag, without a value.',
		),
		value: optionalValue("A tag id from get_tags or create_tag."),
	}),
	z.strictObject({
		conditionType: z.literal("transaction_notes"),
		operator: operatorsOf(
			"transaction_notes",
			`${TEXT_OPERATORS} "is_null": no notes, without a value.`,
		),
		value: optionalValue("Text compared with the notes."),
	}),
	z.strictObject({
		conditionType: z.literal("transaction_type"),
		operator: operatorsOf("transaction_type", '"=": the transaction is of this type.'),
		value: z
			.enum(RULE_TYPE_VALUES)
			.describe("income, expense or transfer, as the transaction list's type filter."),
	}),
] as const;

const leafCondition = z.discriminatedUnion("conditionType", leafConditions);

const condition = z.discriminatedUnion("conditionType", [
	...leafConditions,
	z.strictObject({
		conditionType: z.literal("compound"),
		operator: operatorsOf(
			"compound",
			'"and": every condition of the group holds; "or": any of them. An empty group matches every transaction.',
		),
		conditions: z
			.array(leafCondition)
			.max(MAX_RULE_CONDITIONS)
			.describe("Conditions of any type but a group: groups nest one level deep."),
	}),
]);

const action = z.discriminatedUnion("actionType", [
	z.strictObject({
		actionType: z.literal("set_transaction_category"),
		value: z.string().describe("A category id from get_categories or create_category."),
	}),
	z.strictObject({
		actionType: z.literal("set_transaction_merchant"),
		value: z.string().describe("A merchant id from get_merchants or create_merchant."),
	}),
	z.strictObject({
		actionType: z.literal("set_transaction_tags"),
		value: z
			.string()
			.describe("One tag id from get_tags or create_tag, added to the tags the transaction keeps."),
	}),
	z.strictObject({
		actionType: z.literal("set_transaction_name"),
		value: z.string().describe("The new label, replacing the whole label."),
	}),
	z.strictObject({
		actionType: z.literal("replace_in_transaction_name"),
		value: z
			.string()
			.describe(
				"An RE2 regular expression, case ignored: no back reference, no lookaround. Every match in the label is replaced.",
			),
		replacement: z
			.string()
			.describe(
				"The text put in place of each match, literally: $1 means nothing. Empty removes it.",
			),
	}),
	z.strictObject({
		actionType: z.literal("exclude_transaction"),
		value: z.null().optional().describe("None: the transaction is left out of reports."),
	}),
	z.strictObject({
		actionType: z.literal("set_as_transfer_or_payment"),
		value: z
			.string()
			.describe(
				"The account id from get_accounts where the other side of the transfer is expected; Archant pairs the two when it finds it.",
			),
	}),
]);

/**
 * A rule as the interface's form sends it, its condition and action types
 * closed: the shape `createRule` and `updateRule` take, checked by them again.
 */
const ruleFields = {
	name: z
		.string()
		.nullable()
		.optional()
		.describe("A short name; without one, the list shows the conditions."),
	effectiveDate: z
		.string()
		.nullable()
		.optional()
		.describe(
			"YYYY-MM-DD: the rule reaches transactions dated on or after it; null for every date.",
		),
	conditions: z
		.array(condition)
		.max(MAX_RULE_CONDITIONS)
		.describe("Every one must hold. An empty list matches every transaction."),
	actions: z
		.array(action)
		.min(1)
		.describe("One at least, each type once, applied in order to every matching transaction."),
};

export const ruleToolInput = z.strictObject(ruleFields);

const ruleId = z.string().min(1).describe("A rule id from get_rules or create_rule.");

export const updateRuleInput = z.strictObject({ ruleId, ...ruleFields });

export const ruleIdInput = z.strictObject({ ruleId });

export const setRuleEnabledInput = z.strictObject({
	ruleId,
	enabled: z.boolean().describe("false stops the rule; what it wrote stays."),
});

/** `preview_rule`: a saved rule, a draft, or every enabled rule when neither is given. */
export const previewRuleInput = z
	.strictObject({
		ruleId: ruleId.optional(),
		rule: ruleToolInput.optional().describe("A draft in create_rule's shape, not saved."),
	})
	.superRefine((value, context) => {
		if (value.ruleId !== undefined && value.rule !== undefined) {
			context.addIssue({ code: "custom", path: ["rule"], message: "rule_id_or_rule" });
		}
	});

export const applyRulesInput = z.strictObject({
	ruleId: ruleId
		.optional()
		.describe("The rule to apply, enabled or not; absent for every enabled rule."),
	expectedChanged: z
		.number()
		.int()
		.min(0)
		.describe(
			"The changed count preview_rule gave for the same ruleId: nothing is written if it differs now.",
		),
});

export const createCategoryInput = createCategorySchema
	.pick({ name: true, kind: true })
	.extend({
		parentId: z
			.string()
			.min(1)
			.optional()
			.describe("A top-level category's id; the new one then takes its kind and colour."),
	})
	.strict();

export const createMerchantInput = merchantSchema.strict();

export const createTagInput = tagSchema.strict();

const categoryId = z
	.string()
	.min(1)
	.describe("A category id from get_categories or create_category.");
const merchantId = z
	.string()
	.min(1)
	.describe("A merchant id from get_merchants or create_merchant.");
const tagId = z.string().min(1).describe("A tag id from get_tags or create_tag.");

/**
 * `update_transaction`: the transaction sheet's fields, never its date nor its
 * amount, which come from the bank: a label written to mislead the assistant
 * must not move money. Passed raw to `updateTransaction`, which parses them as
 * it parses the sheet's.
 */
export const updateTransactionInput = z
	.strictObject({
		id: transactionIdInput.shape.id,
		categoryId: categoryId
			.nullable()
			.optional()
			.describe("A category id; null leaves it uncategorised."),
		merchantId: merchantId
			.nullable()
			.optional()
			.describe("A merchant id; null removes the merchant."),
		tagIds: z
			.array(tagId)
			.optional()
			.describe("The whole set of tag ids, replacing the tags it carries; [] removes them all."),
		notes: z
			.string()
			.nullable()
			.optional()
			.describe("The notes, replacing them; null or empty removes them."),
		label: z.string().optional().describe("The new label, replacing the whole label."),
		excluded: z
			.boolean()
			.optional()
			.describe("true leaves it out of reports; it still counts in the balance."),
	})
	.refine(
		(value) => Object.entries(value).some(([key, field]) => key !== "id" && field !== undefined),
		{ message: "empty_patch" },
	);

/**
 * `bulk_update_transactions`: the bulk bar's patch on up to 200 ids, or on
 * every transaction a filter matches. With a filter, the count the assistant
 * read and showed the owner is required: the ledger writes nothing if the
 * filter now selects another count.
 */
export const bulkUpdateTransactionsInput = z
	.strictObject({
		ids: bulkIds
			.optional()
			.describe(
				`Up to ${MAX_BULK_IDS} transaction ids from get_transactions; without filter. Every id must exist, or nothing is written.`,
			),
		filter: groupTransactionsInput
			.optional()
			.describe("get_transactions' filter, without page or pageSize; without ids."),
		expectedCount: z
			.number()
			.int()
			.min(0)
			.optional()
			.describe(
				"Required with filter, refused with ids: the total get_transactions gave for the same filter, shown to the owner. Nothing is written if the filter matches another count now.",
			),
		// Strict: a misspelt key would otherwise be dropped, and the patch would change less than asked.
		patch: bulkPatchSchema
			.strict()
			.describe(
				"At least one of: categoryId (null leaves them uncategorised), merchantId (null removes it), addTagIds (tag ids added beside those each carries, never removing one), excluded.",
			),
	})
	.superRefine((value, context) => {
		if ((value.ids === undefined) === (value.filter === undefined)) {
			context.addIssue({ code: "custom", path: ["ids"], message: "ids_or_filter" });
		}

		if (value.filter !== undefined && value.expectedCount === undefined) {
			context.addIssue({ code: "custom", path: ["expectedCount"], message: "required" });
		}

		if (value.ids !== undefined && value.expectedCount !== undefined) {
			context.addIssue({ code: "custom", path: ["expectedCount"], message: "filter_only" });
		}
	});

/** The names « Réglages » takes: one rule for creating and renaming. */
export const renameCategoryInput = z.strictObject({
	categoryId,
	name: createCategorySchema.shape.name,
});

export const renameMerchantInput = z.strictObject({ merchantId, ...merchantSchema.shape });

export const renameTagInput = z.strictObject({ tagId, ...tagSchema.shape });

/** `get_budget`: a month's budget, and up to eleven months before it, as Sure's `GetBudget`. */
export const budgetInput = z.strictObject({
	month: monthSchema.optional().describe("YYYY-MM; the current month when absent."),
	priorMonths: z
		.number()
		.int()
		.min(0)
		.max(11)
		.default(0)
		.describe(
			"How many months before month to add, up to 11; those before the first month a budget can cover are left out.",
		),
});

const budgetAmount = (what: string) =>
	z
		.string()
		.optional()
		.describe(
			`${what}, a decimal string such as "1500.00" in the reporting currency; absent keeps it.`,
		);

/**
 * `update_budget`: what the budget page sets, at once. Passed raw to
 * `updateBudget`, which parses the amounts as the page's fields are parsed
 * and refuses an empty call, a category twice and « Sans catégorie ».
 */
export const updateBudgetInput = z.strictObject({
	month: monthSchema.describe("YYYY-MM: the month to set."),
	budgetedSpending: budgetAmount("The month's planned spending"),
	expectedIncome: budgetAmount("The month's expected income"),
	categories: z
		.array(
			z.strictObject({
				categoryId: categoryId
					.nullable()
					.describe(
						"An expense category id from get_categories or get_budget. null, « Sans catégorie », is refused: it holds what budgetedSpending leaves unallocated.",
					),
				budgeted: z
					.string()
					.describe(
						'The amount, a decimal string such as "250.00"; "" or "0" lets a subcategory share its parent\'s. A parent\'s amount is never below what its subcategories hold.',
					),
			}),
		)
		.optional()
		.describe(
			"Category amounts, each category once; the month must be set up, by this call or before.",
		),
});

const billId = z.string().min(1).describe("A bill id from get_bills.");

/** `get_bills`: Sure's `GetBills` filters. */
export const getBillsInput = z.strictObject({
	status: z
		.enum(BILL_LIFECYCLES)
		.default("active")
		.describe(
			'"active": followed by the owner; "suggested": found by Archant, awaiting the owner, not a bill yet; "paused": set aside; "ended": dismissed or finished; "all": every one.',
		),
	paymentState: z
		.enum(BILL_PAYMENT_STATES)
		.optional()
		.describe(
			"The current occurrence's state: overdue, due (within three days of its date), upcoming, partial (partly paid) or paid.",
		),
	billType: z
		.enum(BILL_TYPES)
		.optional()
		.describe('"income" is a declared income, not something to pay.'),
	search: z
		.string()
		.trim()
		.min(1)
		.max(200)
		.optional()
		.describe("Text searched in the name, the merchant and the label, case aside."),
	dueWithinDays: z
		.number()
		.int()
		.min(1)
		.max(365)
		.optional()
		.describe(
			"Keeps the bills whose next due date falls within this many days, overdue ones included.",
		),
});

export const billIdInput = z.strictObject({ billId });

/** `get_bill_audit`: how far back price changes reach. */
export const billAuditInput = z.strictObject({
	lookbackMonths: z
		.number()
		.int()
		.min(1)
		.max(24)
		.default(12)
		.describe("How many months of price changes to report, 12 by default."),
});

const billAmount = (what: string) =>
	z
		.string()
		.describe(
			`${what}, a positive decimal string such as "13.49" in the account's currency, never negative: the type carries the direction.`,
		);

const frequencyPreset = z.enum(FREQUENCY_PRESETS);

const accountId = z.string().min(1).describe("An account id from get_accounts.");

const billTypeInput = z
	.enum(EDITABLE_BILL_TYPES)
	.describe("The kind of bill; an income is never one of them.");

const paymentUrlInput = z
	.string()
	.describe("Where the bill gets paid, an http or https link; a bare host gets https://.");

/**
 * `create_bill`: the declare dialog's fields, by id, passed raw to
 * `declareBill`, which parses them as it parses the dialog's.
 */
export const createBillInput = z.strictObject({
	name: z.string().describe("What the owner calls the bill."),
	amount: billAmount("The amount of each occurrence"),
	firstDueOn: z.iso
		.date()
		.describe("YYYY-MM-DD: the first due date; its day, weekday and month set the schedule's."),
	accountId,
	frequency: frequencyPreset.default("monthly").describe("How often, monthly by default."),
	isIncome: z
		.boolean()
		.default(false)
		.describe("true for an income such as a salary: money coming in, with no type or category."),
	billType: billTypeInput.optional().describe('"bill" by default; ignored for an income.'),
	categoryId: z
		.string()
		.min(1)
		.optional()
		.describe("A category id from get_categories; ignored for an income."),
	entryId: z
		.string()
		.min(1)
		.optional()
		.describe(
			"The transaction an undeclared candidate came from, as get_bill_audit gives it: the bill then matches its bank lines.",
		),
	autopay: z.boolean().optional().describe("Paid by direct debit, without the owner acting."),
	paymentUrl: paymentUrlInput.optional(),
	notes: z.string().optional(),
});

const DAY_FIELDS = ["dueDayOfMonth", "weekday", "monthOfYear"] as const;

/**
 * `update_bill`: the edit dialog's fields and a status, by id. A day without
 * the cadence it belongs to is refused rather than dropped, and so is a call
 * that changes nothing.
 */
export const updateBillInput = z
	.strictObject({
		billId,
		name: z.string().optional().describe("The new name; empty shows the merchant or label again."),
		amount: billAmount(
			"The new amount, from now on: occurrences already due keep the one they had",
		).optional(),
		accountId: accountId.optional(),
		categoryId: z
			.string()
			.min(1)
			.nullable()
			.optional()
			.describe("A category id from get_categories; null clears it."),
		billType: billTypeInput.optional().describe("Never to or from an income."),
		status: z
			.enum(["active", "paused"])
			.optional()
			.describe('"paused" sets the bill aside, with no new occurrences; "active" resumes it.'),
		frequency: frequencyPreset
			.optional()
			.describe(
				"A new cadence, pinned against detection; dueDayOfMonth, weekday or monthOfYear set its day.",
			),
		dueDayOfMonth: z
			.number()
			.int()
			.min(-1)
			.max(31)
			.refine((day) => day !== 0, "invalid_value")
			.optional()
			.describe("1 to 31, or -1 for the month's last day; only with frequency."),
		weekday: z
			.number()
			.int()
			.min(0)
			.max(6)
			.optional()
			.describe("0 is Sunday; only with frequency."),
		monthOfYear: z.number().int().min(1).max(12).optional().describe("Only with frequency."),
		autopay: z.boolean().optional(),
		paymentUrl: paymentUrlInput.nullable().optional().describe("null or empty removes it."),
		notes: z.string().nullable().optional().describe("null or empty removes them."),
	})
	.superRefine((value, context) => {
		if (Object.entries(value).every(([key, field]) => key === "billId" || field === undefined)) {
			context.addIssue({ code: "custom", message: "empty_patch" });
		}

		if (value.frequency === undefined) {
			for (const field of DAY_FIELDS.filter((key) => value[key] !== undefined)) {
				context.addIssue({ code: "custom", path: [field], message: "requires_frequency" });
			}
		}
	});

/** `record_bill_payment`: an open occurrence, the current one by default, in full or in part. */
export const recordBillPaymentInput = z.strictObject({
	billId,
	occurrenceDueOn: z.iso
		.date()
		.optional()
		.describe(
			"YYYY-MM-DD: the due date of the open occurrence to pay, as get_bill_details lists it; the current one when absent.",
		),
	amount: billAmount("A partial payment, at most what remains")
		.optional()
		.describe(
			'A partial payment, a positive decimal string such as "100.00", at most what remains; absent settles what remains.',
		),
	paidOn: z.iso.date().optional().describe("YYYY-MM-DD: when it was paid; today when absent."),
});

const transferTransactionId = z
	.string()
	.min(1)
	.describe("A transaction id from get_transactions, in no transfer.");

/** `get_transfer_candidates`: what « Rapprocher un virement » lists for a transaction. */
export const transferCandidatesInput = z.strictObject({ transactionId: transferTransactionId });

/** `pair_transfer`: the body of `POST /api/transfers`, as the picker sends it. */
export const pairTransferInput = z.strictObject({
	transactionId: transferTransactionId,
	counterpartId: z
		.string()
		.min(1)
		.describe("A candidate's id, as get_transfer_candidates lists it for transactionId."),
});

/** `unpair_transfer`: « Dissocier », or « Ne plus proposer » with `neverPropose`. */
export const unpairTransferInput = z.strictObject({
	transferId: z
		.string()
		.min(1)
		.describe("A transfer's id, as get_transactions or get_transaction gives it in transfer.id."),
	neverPropose: z
		.boolean()
		.default(false)
		.describe(
			"true also refuses the pair for good: no search, by hand, by an import or by a sync, offers it again, and nothing undoes the refusal. Pass it only when the owner said so.",
		),
});

/** `get_valuations`: a page of one account's snapshots, as its « Soldes » tab lists them. */
export const valuationsInput = z.strictObject({
	accountId,
	page: pageFields.page.describe(
		`${DEFAULT_PAGE_SIZE} snapshots a page, most recent first; 1 by default.`,
	),
});

/**
 * `record_valuation`: the « Soldes » dialog's fields, passed raw to
 * `createSnapshot`, which parses the balance in the account's currency as
 * it parses the dialog's.
 */
export const recordValuationInput = z.strictObject({
	accountId,
	date: z.iso
		.date()
		.describe(
			"YYYY-MM-DD: the day whose end-of-day balance this is, after the opening date and not after today.",
		),
	balance: z
		.string()
		.describe(
			'The stored balance, a decimal string such as "175000.00" in the account\'s currency: what an asset holds or is worth, what a liability still owes, both positive; an overdraft is negative.',
		),
});
