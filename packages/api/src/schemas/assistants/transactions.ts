import type { AmountBound, AmountOperator } from "../transactions.ts";

import { z } from "zod";

import {
	AMOUNT_OPERATORS,
	MAX_BULK_IDS,
	STATUSES,
	bulkPatchSchema,
	MAX_TAGS_PER_TRANSACTION,
	MAX_TAG_FILTER,
	bulkIds,
	directionSchema,
	filterCheck,
	filterFields,
	operatorBounds,
	pendingOf,
} from "../transactions.ts";
import { accountId, clampedPageFields, merchantId, requiredLoose, sureAmount } from "./fields.ts";

/** `get_transaction`: one transaction in full. */
export const transactionIdInput = z.strictObject({
	id: z.string().min(1).describe("A transaction id from get_transactions."),
});

// Every repeated key of the list's query takes as many ids as its tag filter.
const idsOf = (what: string) =>
	z.array(z.string().min(1)).max(MAX_TAG_FILTER).optional().describe(what);

const namesOf = idsOf;

/**
 * The cross-account list's filter by id, each repeated key as an array: an
 * assistant sends JSON, never a query string. Named as Sure's
 * `get_transactions` names them where it has the field, `account_ids`.
 */
const idFields = {
	account_ids: idsOf("Account ids from get_accounts; any of them."),
	types: z
		.array(directionSchema)
		.transform((values) => [...new Set(values)])
		.optional()
		.describe(
			'Filter by kind, income, expense or transfer; any of them. ["income", "expense"] leaves out transfers between the household\'s own accounts.',
		),
	category_ids: idsOf(
		'Category ids from get_categories, "none" standing for uncategorised; any of them. A parent stands for its children too.',
	),
	merchant_ids: idsOf("Merchant ids from get_merchants; any of them."),
	tag_ids: idsOf("Tag ids from get_tags; transactions carrying any of them."),
	start_date: filterFields.from.describe("The first date, YYYY-MM-DD, inclusive."),
	end_date: filterFields.to.describe("The last date, YYYY-MM-DD, inclusive."),
	search: filterFields.q.describe("Text searched in the label and the notes, case aside."),
};

/**
 * The filter a read takes: by id, and by exact name as Sure's
 * `get_transactions` takes them, names any assistant reads in the lists.
 * A name and an id of one kind narrow each other; a name nothing holds
 * matches nothing.
 */
const toolFilterFields = {
	...idFields,
	accounts: namesOf("Exact account names, as get_accounts gives them; any of them."),
	categories: namesOf(
		'Exact category names, as get_categories gives them, "Uncategorized", « Non catégorisé » or « Sans catégorie » standing for uncategorised; any of them. A parent stands for its children too.',
	),
	merchants: namesOf("Exact merchant names, as get_merchants gives them; any of them."),
	tags: namesOf("Exact tag names, as get_tags gives them; transactions carrying any of them."),
};

// Partial: the bulk filter and get_transactions take some of these fields only.
type ToolFilter = Partial<z.output<z.ZodObject<typeof idFields>>> &
	Partial<Record<"accounts" | "categories" | "merchants" | "tags", string[] | undefined>>;

/** The list's filter as the services read it, from the tool's names. */
function listFilterOf({
	account_ids: account,
	types: direction,
	category_ids: category,
	merchant_ids: merchant,
	tag_ids: tag,
	start_date: from,
	end_date: to,
	search: q,
	accounts,
	categories,
	merchants,
	tags,
}: ToolFilter) {
	const filter = { account, direction, category, merchant, tag, from, to, q };
	const names = { accounts, categories, merchants, tags };

	return Object.values(names).every((value) => value === undefined) ? filter : { ...filter, names };
}

// A tool's amount is Sure's, read leniently by `amountFilterOf`.
const checkWithToolPaths = filterCheck({ to: "end_date" });

/** The list's checks, on the tool's names, each refusal under the tool's name for the field. */
function checkToolFilter(value: ToolFilter, context: z.core.$RefinementCtx) {
	checkWithToolPaths(listFilterOf(value), context);
}

/**
 * Sure's `amount` as Ruby's `to_f` then `abs` read it: the text's leading
 * decimal, its sign dropped, or 0 without one, so `"-12,50"` reads 12. A
 * JSON number arrives as its shortest decimal text, never through a float.
 */
function leadingAmount(value: string | number): AmountBound {
	const match = /^\s*[+-]?(\d*)(?:\.(\d+))?/u.exec(String(value));
	const fraction = match?.[2] ?? "";

	return { units: BigInt(`0${match?.[1] ?? ""}${fraction}`), scale: fraction.length };
}

/**
 * Sure's `amount` and `amount_operator` as the list's bounds on the absolute
 * amount. Either alone, or a blank amount, filters nothing, as Sure's
 * `apply_amount_filter` returns the scope untouched.
 */
function amountFilterOf(
	amount: string | number | undefined,
	operator: AmountOperator | undefined,
): { amountMin?: AmountBound; amountMax?: AmountBound } {
	if (amount === undefined || operator === undefined || String(amount).trim() === "") {
		return {};
	}

	const { min, max } = operatorBounds(operator, leadingAmount(amount));

	return {
		...(min === undefined ? {} : { amountMin: min }),
		...(max === undefined ? {} : { amountMax: max }),
	};
}

/**
 * Sure's amount filter, which `get_transactions`, `group_transactions_by_label`
 * and the bulk filter share so one counts what the other selects.
 */
const amountFields = {
	amount: z
		.union([z.string().max(40), z.number()])
		.optional()
		.describe(
			'An amount such as "12.50", compared with each absolute amount by amount_operator; read as Sure reads it, its leading number with the sign aside, 0 without one. Without amount_operator it filters nothing.',
		),
	amount_operator: z
		.enum(AMOUNT_OPERATORS)
		.optional()
		.describe(
			'"equal": within 0.01; "less" or "greater": strictly. Without amount it filters nothing.',
		),
};

/**
 * `get_transactions`: Sure's parameters, names where Sure takes names, its
 * sort, statuses and amount operator, and its page clamped as Sure's.
 */
export const getTransactionsInput = z
	.strictObject({
		...clampedPageFields,
		order: z.enum(["asc", "desc"]).default("desc").describe("Sort direction, desc by default."),
		sort_by: z
			.enum(["date", "amount"])
			.default("date")
			.describe("By date, by default, or by absolute amount, then most recent first."),
		search: idFields.search,
		...amountFields,
		start_date: idFields.start_date,
		end_date: idFields.end_date,
		types: idFields.types,
		statuses: z
			.array(z.enum(STATUSES))
			.min(1)
			.optional()
			.describe(
				'"pending": lines the bank has not booked yet; "confirmed": booked ones; both, every line.',
			),
		account_ids: idFields.account_ids,
		accounts: toolFilterFields.accounts,
		categories: toolFilterFields.categories,
		merchants: toolFilterFields.merchants,
		tags: toolFilterFields.tags,
	})
	.superRefine(checkToolFilter)
	.transform(
		({
			page,
			page_size: pageSize,
			order,
			sort_by: by,
			amount,
			amount_operator: operator,
			statuses,
			...filter
		}) => {
			const pending = pendingOf(statuses);

			return {
				...listFilterOf(filter),
				...amountFilterOf(amount, operator),
				...(pending === undefined ? {} : { pending }),
				page,
				pageSize,
				sort: { by, order },
			};
		},
	);

/**
 * `group_transactions_by_label`: the list's filter, every matching
 * transaction grouped, the groups a page at a time as Sure's `get_categories`.
 */
export const groupTransactionsInput = z
	.strictObject({ ...toolFilterFields, ...amountFields, ...clampedPageFields })
	.superRefine(checkToolFilter)
	.transform(({ page, page_size: pageSize, amount, amount_operator: operator, ...filter }) => ({
		filter: { ...listFilterOf(filter), ...amountFilterOf(amount, operator) },
		page,
		pageSize,
	}));

/**
 * The filter `bulk_update_transactions` writes through: by id only, and
 * Sure's amount filter, so get_transactions counts what it selects. A bank
 * writes account names, and a write never selects by a text a bank wrote (AD-19).
 */
const bulkFilterInput = z
	.strictObject({ ...idFields, ...amountFields })
	.superRefine(checkToolFilter)
	.transform(({ amount, amount_operator: operator, ...filter }) => ({
		...listFilterOf(filter),
		...amountFilterOf(amount, operator),
	}));

const categoryId = z
	.string()
	.min(1)
	.describe("A category id from get_categories or create_category.");

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
		category_id: categoryId
			.nullable()
			.optional()
			.describe("A category id; null leaves it uncategorised."),
		merchant_id: merchantId
			.nullable()
			.optional()
			.describe("A merchant id; null removes the merchant."),
		tag_ids: z
			.array(tagId)
			.optional()
			.describe("The whole set of tag ids, replacing the tags it carries; [] removes them all."),
		notes: z
			.string()
			.nullable()
			.optional()
			.describe("The notes, replacing them; null or empty removes them."),
		name: z.string().optional().describe("The new label, replacing the whole label."),
		excluded: z
			.boolean()
			.optional()
			.describe("true leaves it out of reports; it still counts in the balance."),
	})
	// No field at all is refused by `run`, after the id, with Sure's `no_changes`.
	.transform(({ id, category_id, merchant_id, tag_ids, notes, name, excluded }) => ({
		id,
		patch: {
			categoryId: category_id,
			merchantId: merchant_id,
			tagIds: tag_ids,
			notes,
			label: name,
			excluded,
		},
	}));

const bulkPatch = bulkPatchSchema.shape;

/**
 * `bulk_update_transactions`: the bulk drawer's patch, without its date, on
 * up to 200 ids, or on every transaction a filter matches: as with
 * `update_transaction`, a label an assistant read never moves money. With a
 * filter, the count the assistant read and showed the owner is required: the
 * ledger writes nothing if the filter now selects another count.
 */
export const bulkUpdateTransactionsInput = z
	.strictObject({
		ids: bulkIds
			.optional()
			.describe(
				`Up to ${MAX_BULK_IDS} transaction ids from get_transactions; without filter. Every id must exist, or nothing is written.`,
			),
		filter: bulkFilterInput
			.optional()
			.describe(
				'get_transactions\' filter, with ids where it takes names (category_ids, merchant_ids, tag_ids, "none" for uncategorised), without statuses, page or page_size; without ids.',
			),
		expected_count: z
			.number()
			.int()
			.min(0)
			.optional()
			.describe(
				"Required with filter, refused with ids: the total get_transactions gave for the same filter, shown to the owner. Nothing is written if the filter matches another count now.",
			),
		// Strict: a misspelt key would otherwise be dropped, and the patch would change less than asked.
		patch: z
			.strictObject({
				category_id: bulkPatch.categoryId,
				merchant_id: bulkPatch.merchantId,
				tag_ids: bulkPatch.tagIds,
				name: bulkPatch.name,
				notes: bulkPatch.notes,
			})
			// The bulk drawer's checks, under the same codes.
			.refine((patch) => Object.values(patch).some((value) => value !== undefined), {
				message: "empty_patch",
			})
			.describe(
				"At least one of: category_id, merchant_id, tag_ids (the whole set of tag ids, replacing the tags each carries; [] removes them all), name (the new label, replacing the whole label), notes (replacing them). A blank text changes nothing; nothing clears a category or a merchant.",
			)
			.transform(({ category_id, merchant_id, tag_ids, name, notes }) => ({
				...(category_id === undefined ? {} : { categoryId: category_id }),
				...(merchant_id === undefined ? {} : { merchantId: merchant_id }),
				...(tag_ids === undefined ? {} : { tagIds: tag_ids }),
				...(name === undefined ? {} : { name }),
				...(notes === undefined ? {} : { notes }),
			})),
	})
	.superRefine((value, context) => {
		if ((value.ids === undefined) === (value.filter === undefined)) {
			context.addIssue({ code: "custom", path: ["ids"], message: "ids_or_filter" });
		}

		if (value.filter !== undefined && value.expected_count === undefined) {
			context.addIssue({ code: "custom", path: ["expected_count"], message: "required" });
		}

		if (value.ids !== undefined && value.expected_count !== undefined) {
			context.addIssue({ code: "custom", path: ["expected_count"], message: "filter_only" });
		}
	});

/** Sure's `type`: the sign of a magnitude, money in or money out. */
const TRANSACTION_TYPES = ["income", "expense", "inflow", "outflow"] as const;

/**
 * `create_transaction`: Sure's parameters. The date, the amount and the name
 * reach `run` loosely typed, which refuses them with Sure's keys; the amount
 * is in Sure's sign, positive for money out, which `run` turns into the
 * ledger's (AD-5). The line is recorded through the sheet's checks, its
 * category, merchant and tags set and locked, and an id of the assistant's
 * own makes a retry find the line instead of recording it twice.
 */
export const createTransactionInput = z.strictObject({
	account_id: accountId,
	date: requiredLoose(z.string()).describe(
		"ISO 8601 date (YYYY-MM-DD) of the transaction, from 1900 on and at most a year from today.",
	),
	amount: requiredLoose(sureAmount).describe(
		"Transaction amount in the account's currency, a number or a decimal string: positive is an expense (money out), negative an income (money in). With type, type decides the sign and the magnitude of amount is used.",
	),
	name: requiredLoose(z.string()).describe(
		"Transaction name / payee / description, such as « Marché du samedi ».",
	),
	type: z
		.enum(TRANSACTION_TYPES)
		.optional()
		.describe(
			'Optional. Derives the sign: "income" or "inflow" is money in, "expense" or "outflow" money out. Omit to take amount as given.',
		),
	currency: z
		.string()
		.optional()
		.describe(
			"ISO 4217 currency code, the account's by default; another one than the account's is refused.",
		),
	notes: z.string().nullable().optional(),
	category_id: categoryId.nullable().optional(),
	merchant_id: merchantId.nullable().optional(),
	// Repeats are dropped before the cap counts, as the sheet's.
	tag_ids: z
		.array(tagId)
		.transform((ids) => [...new Set(ids)])
		.pipe(z.array(z.string()).max(MAX_TAGS_PER_TRANSACTION))
		.optional(),
	external_id: z
		.string()
		.min(1)
		.max(200)
		.optional()
		.describe(
			"An id of your own for the line, such as a statement row's: called again with the same external_id and source on this account, it records nothing and returns the line with created false.",
		),
	source: z
		.string()
		.trim()
		.min(1)
		.max(50)
		// The key joins it to externalId with a colon: one inside would let two
		// pairs name the same line.
		.regex(/^[^:]*$/u)
		.default("mcp")
		.describe('Where external_id comes from, "mcp" by default; ignored without external_id.'),
	user_modified: z
		.boolean()
		.optional()
		.describe(
			"Sure's flag keeping a later bank sync from overwriting the line. Accepted and changes nothing: a sync never rewrites a line it did not bring, and every field given here is locked.",
		),
});

/**
 * `delete_transaction`: the transaction and what the owner was shown of it,
 * every field required: the ledger deletes it only while they still hold.
 * The amount is in Sure's sign, which `run` turns into the ledger's.
 */
export const deleteTransactionInput = z.strictObject({
	id: transactionIdInput.shape.id,
	account_id: accountId.describe("Its account id, as get_transaction gave it."),
	date: z.iso.date().describe("Its date, YYYY-MM-DD, as get_transaction gave it."),
	amount: sureAmount.describe(
		'Its amount in Sure\'s sign, a number or a decimal string: get_transaction\'s amount, such as "12.5", for an expense, and that amount negated, such as "-12.5", for an income.',
	),
});
