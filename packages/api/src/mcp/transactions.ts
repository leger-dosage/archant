import type { ServiceDeps } from "../services/deps.ts";
import type { TransactionRecord } from "../services/ledger/queries.ts";
import type { NameBook } from "../services/names.ts";
import type { TransactionItem } from "../services/transactions.ts";
import type { SureRefusal } from "./tool.ts";

import { z } from "zod";

import type { Money, MinorUnits } from "@archant/data/money";
import { isCurrencyCode, toDecimalString, toMinorUnits } from "@archant/data/money";
import { BANK_CONNECTOR_IDS } from "@archant/data/schema/bank-connections";
import { TRANSFER_KINDS, TRANSFER_STATUSES } from "@archant/data/transfer-kinds";

import { AppError } from "../lib/errors.ts";
import {
	bulkUpdateTransactionsInput,
	createTransactionInput,
	deleteTransactionInput,
	getTransactionsInput,
	groupTransactionsInput,
	transactionIdInput,
	updateTransactionInput,
} from "../schemas/assistants.ts";
import { DEFAULT_PAGE_SIZE, MAX_BULK_IDS } from "../schemas/transactions.ts";
import { namesOf, refOf } from "../services/names.ts";
import {
	bulkUpdateTransactions,
	createTransaction,
	deleteTransaction,
	findTransactions,
	getTransaction,
	groupTransactionsByLabel,
	updateTransaction,
} from "../services/transactions.ts";
import {
	BANK_TEXT,
	CREATES,
	DESTROYS,
	READ_ONLY,
	REPLACES,
	decimal,
	decimalOf,
	defineTool,
	formatMoney,
	namedRef,
	pageFieldsOf,
	pageOutput,
	refuse,
} from "./tool.ts";

/** Sure's `entry.classification`: money in is income, anything else an expense. */
const classifications = z.enum(["income", "expense"]);

const classificationOf = (amount: MinorUnits): z.output<typeof classifications> =>
	amount > 0 ? "income" : "expense";

/**
 * A transaction as Sure's `get_transactions` lists it: the amount without
 * its sign, which `classification` gives, and its account, category,
 * merchant and tags by name.
 */
const transaction = z.object({
	id: z.string(),
	name: z.string().describe("The label the line shows."),
	date: z.string(),
	amount: z
		.string()
		.describe(
			'The absolute amount as Sure\'s decimal text, such as "12.5"; classification gives its side.',
		),
	currency: z.string(),
	formatted_amount: z.string().describe('The absolute amount formatted, such as "12,50 €".'),
	classification: classifications.describe("income for money in, expense for money out."),
	account: z.string().describe("The account's name."),
	notes: z.string().nullable(),
	category: z.string().nullable().describe("The category's name; null when uncategorised."),
	merchant: z.string().nullable().describe("The merchant's name; null for none."),
	tags: z.array(z.string()).describe("The tags' names."),
	is_transfer: z
		.boolean()
		.describe(
			"A side of a transfer between two of the household's accounts, proposed or confirmed.",
		),
});

/** The names every transaction of an answer points to, read once for all of them. */
async function namesFor(deps: ServiceDeps, items: readonly TransactionRecord[]): Promise<NameBook> {
	return namesOf(deps, {
		accounts: items.map((item) => item.accountId),
		categories: items.flatMap((item) => (item.categoryId === null ? [] : [item.categoryId])),
		merchants: items.flatMap((item) => (item.merchantId === null ? [] : [item.merchantId])),
		tags: items.flatMap((item) => item.tagIds),
	});
}

/** A name an id names, or the id itself for a row deleted since. */
const nameOf = (names: ReadonlyMap<string, string>, id: string) => names.get(id) ?? id;

/** A transaction as get_transactions lists it. */
function itemOf(item: TransactionRecord, names: NameBook): z.input<typeof transaction> {
	const magnitude = { amount: toMinorUnits(Math.abs(item.amount)), currency: item.currency };

	return {
		id: item.id,
		name: item.label,
		date: item.date,
		amount: decimalOf(magnitude),
		currency: item.currency,
		formatted_amount: formatMoney(magnitude),
		classification: classificationOf(item.amount),
		account: nameOf(names.accounts, item.accountId),
		notes: item.notes,
		category: item.categoryId === null ? null : nameOf(names.categories, item.categoryId),
		merchant: item.merchantId === null ? null : nameOf(names.merchants, item.merchantId),
		tags: item.tagIds.map((id) => nameOf(names.tags, id)),
		is_transfer: item.transfer !== null,
	};
}

/** An amount reported in the reporting currency, positive, as Sure's `Money#format`. */
const totalOf = ({ amount, currency }: Money) =>
	formatMoney({ amount: toMinorUnits(Math.abs(amount)), currency });

export const getTransactions = defineTool({
	name: "get_transactions",
	title: "Transactions",
	description: `Searches the transactions of every active account with optional filters, as Sure's get_transactions; a deactivated account's are left out even when named. Good for finding specific transactions and basic stats on a small group of them; for long periods, use get_income_statement. Filters take exact names, as get_accounts, get_categories, get_merchants and get_tags give them. Pass types ["income", "expense"] to leave out transfers between the household's own accounts, and a small page_size when you only need a few rows. Most recent first, or as sort_by and order say, a split transaction listed as its lines. Each amount is positive, its classification saying whether it is income or an expense. The page gives total_pages, page, page_size (${DEFAULT_PAGE_SIZE} by default), total_results, and total_income and total_expenses, formatted in the reporting currency: transfers are left out of them, and so are transactions in another currency until exchange rates exist. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: getTransactionsInput,
	output: z.object({
		transactions: z.array(transaction),
		...pageOutput,
		total_results: z.number().int().describe("Every matching transaction, whatever its currency."),
		total_income: z
			.string()
			.describe(
				'Money in, formatted in the reporting currency such as "2 000,00 €", transactions in another currency left out.',
			),
		total_expenses: z
			.string()
			.describe(
				"Money out, positive and formatted in the reporting currency, transactions in another currency left out.",
			),
	}),
	run: async (deps, input) => {
		const found = await findTransactions(deps, input);
		const names = await namesFor(deps, found.items);

		return {
			result: {
				transactions: found.items.map((item) => itemOf(item, names)),
				...pageFieldsOf(found.total, found.page, found.pageSize),
				total_income: totalOf({ amount: found.sum.income, currency: found.sum.currency }),
				total_expenses: totalOf({ amount: found.sum.expense, currency: found.sum.currency }),
			},
			changedRows: 0,
		};
	},
});

export const groupTransactionLabels = defineTool({
	name: "group_transactions_by_label",
	title: "Transactions grouped by label",
	description: `Every transaction of an active account matching the filter, grouped by label with case, accents and spaces aside, money in and money out and each currency apart: the largest groups first, 100 at most, with how many groups there are. Each group gives the label most of its transactions carry, their count, signed total and last date, and the categories they carry, null for uncategorised. Start here to find what a rule should clean up; category_ids ["none"], or categories ["Uncategorized"], keeps the uncategorised ones. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: groupTransactionsInput,
	output: z.object({
		groups: z.array(
			z.object({
				label: z.string(),
				count: z.number().int(),
				total: decimal("Signed"),
				currency: z.string(),
				last_date: z.string(),
				categories: z.array(namedRef.nullable()).describe("null for uncategorised."),
			}),
		),
		group_count: z.number().int(),
	}),
	run: async (deps, input) => {
		const { groups, groupCount } = await groupTransactionsByLabel(deps, input);
		const names = await namesOf(deps, {
			categories: groups.flatMap((group) => group.categoryIds.filter((id) => id !== null)),
		});

		return {
			result: {
				groups: groups.map((group) => ({
					label: group.label,
					count: group.count,
					total: toDecimalString({ amount: group.total, currency: group.currency }),
					currency: group.currency,
					last_date: group.lastDate,
					categories: group.categoryIds.map((id) => refOf(names.categories, id)),
				})),
				group_count: groupCount,
			},
			changedRows: 0,
		};
	},
});

const source = z
	.discriminatedUnion("kind", [
		z.object({ kind: z.literal("manual") }),
		z.object({
			kind: z.literal("import"),
			// A string, not the enum: only the ledger imports the imports table (AD-2).
			format: z.string().describe('The file\'s format: "ofx", "csv" or "qif".'),
			date: z.string().describe("The day the file was imported."),
		}),
		z.object({ kind: z.literal("bank"), connector: z.enum(BANK_CONNECTOR_IDS) }),
	])
	.describe("Typed by hand, brought by a file, or synced from a bank.");

/** A transaction in full: get_transactions' item and what get_transactions leaves out. */
const transactionDetail = transaction.extend({
	account_id: z.string().describe("Its account's id, which delete_transaction takes."),
	excluded: z.boolean().describe("Left out of reports, still in the balance."),
	source,
	transfer: z
		.object({
			id: z.string().describe("The transfer's id, which unpair_transfer takes."),
			kind: z.enum(TRANSFER_KINDS),
			status: z
				.enum(TRANSFER_STATUSES)
				.describe("pending while the owner has not confirmed what matching proposed."),
			counterpart_transaction_id: z.string().describe("The other side's transaction id."),
			counterpart_account: namedRef.describe("The other side's account."),
		})
		.nullable()
		.describe("The transfer it is a side of, with the other side and its account; null for none."),
});

/** A transaction in full, its references named. */
async function detailOf(
	deps: ServiceDeps,
	item: TransactionItem,
): Promise<z.input<typeof transactionDetail>> {
	return {
		...itemOf(item, await namesFor(deps, [item])),
		account_id: item.accountId,
		excluded: item.excluded,
		source: item.source,
		transfer:
			item.transfer === null
				? null
				: {
						id: item.transfer.id,
						kind: item.transfer.kind,
						status: item.transfer.status,
						counterpart_transaction_id: item.transfer.counterpartTransactionId,
						counterpart_account: {
							id: item.transfer.counterpartAccountId,
							name: item.transfer.counterpartAccountName,
						},
					},
	};
}

export const getTransactionTool = defineTool({
	name: "get_transaction",
	title: "Transaction",
	description: `One transaction in full: get_transactions' fields, its account_id, whether it is left out of reports, where it came from and the transfer it is a side of. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: transactionIdInput,
	output: transactionDetail,
	run: async (deps, input) => ({
		result: await detailOf(deps, await getTransaction(deps, input.id)),
		changedRows: 0,
	}),
});

/**
 * Sure's refusal for a service's `AppError`, by its code and the field it
 * names: a refusal Sure's function makes for the same reason. `null` for
 * any other, which keeps the generic shape.
 */
type RefusalMap = {
	codes?: Partial<Record<AppError["code"], { error: SureRefusal; message: string }>>;
	fields?: readonly { path: string; error: SureRefusal; message: string }[];
};

/** Runs `write`, answering each failure `map` names as Sure's function refuses it. */
async function refusedAsSure<Written>(
	map: RefusalMap,
	write: () => Promise<Written>,
): Promise<Written> {
	try {
		return await write();
	} catch (error) {
		if (!(error instanceof AppError)) {
			throw error;
		}

		const byCode = map.codes?.[error.code];

		if (byCode !== undefined) {
			refuse(byCode.error, byCode.message);
		}

		// Sure's checks run in the order `map.fields` lists them: the first it finds answers.
		const byField = (map.fields ?? []).find((field) =>
			(error.fields ?? []).some((refused) => refused.path === field.path),
		);

		if (error.code === "VALIDATION_ERROR" && byField !== undefined) {
			refuse(byField.error, byField.message);
		}

		throw error;
	}
}

/** The ids a write sets, refused with Sure's keys and messages when they name no row. */
const REFERENCE_REFUSALS = [
	{
		path: "categoryId",
		error: "invalid_category",
		message: "category_id does not belong to the user's family.",
	},
	{
		path: "merchantId",
		error: "invalid_merchant",
		message: "merchant_id is not available to the user's family.",
	},
	{
		path: "tagIds",
		error: "invalid_tags",
		message: "One or more tag_ids do not belong to the user's family.",
	},
] as const;

/** A transaction as Sure's `update_transaction` answers it. */
const updatedTransaction = z.object({
	id: z.string(),
	name: z.string(),
	date: z.string(),
	notes: z.string().nullable(),
	category: namedRef.nullable(),
	merchant: namedRef.nullable(),
	tags: z.array(namedRef),
});

/** A transaction's references as Sure's writes answer them, `{ id, name }`. */
async function refsOf(deps: ServiceDeps, item: TransactionRecord) {
	const names = await namesFor(deps, [item]);

	return {
		category: refOf(names.categories, item.categoryId),
		merchant: refOf(names.merchants, item.merchantId),
		tags: item.tagIds.map((id) => ({ id, name: nameOf(names.tags, id) })),
	};
}

export const updateTransactionTool = defineTool({
	name: "update_transaction",
	title: "Classify a transaction",
	description: `Updates a transaction's name, notes, category, merchant, tags or exclusion, as its sheet in Archant and Sure's update_transaction do: use get_transactions first to find its id, and get_categories, get_merchants or get_tags for the ids it sets. Give at least one field, or it answers no_changes. Its date and amount come from the bank and never change here, and a split transaction or one of its lines keeps its exclusion: changing it answers transaction_split. Each field it changes is locked: no rule changes it afterwards, so prefer a rule when the label repeats. ${BANK_TEXT}`,
	scope: "archant:write",
	annotations: REPLACES,
	fieldPaths: { label: "name" },
	input: updateTransactionInput,
	output: z.object({
		success: z.literal(true),
		transaction: updatedTransaction,
		message: z.string(),
	}),
	run: async (deps, { id, patch }) => {
		const refusals = {
			codes: {
				NOT_FOUND: { error: "not_found", message: `Transaction with id '${id}' not found.` },
			},
			fields: REFERENCE_REFUSALS,
		} as const;

		if (Object.values(patch).every((value) => value === undefined)) {
			// Sure's order: an unknown id answers not_found before no_changes.
			await refusedAsSure(refusals, async () => getTransaction(deps, id));
			refuse("no_changes", "Provide at least one field to update.");
		}

		const item = await refusedAsSure(refusals, async () => updateTransaction(deps, id, patch));

		return {
			result: {
				success: true as const,
				transaction: {
					id: item.id,
					name: item.label,
					date: item.date,
					notes: item.notes,
					...(await refsOf(deps, item)),
				},
				message: `Transaction '${item.label}' updated.`,
			},
			changedRows: 1,
		};
	},
});

export const bulkUpdateTransactionsTool = defineTool({
	name: "bulk_update_transactions",
	title: "Classify transactions in bulk",
	description: `Sets a category or a merchant, adds tags or changes the exclusion on many transactions at once, as the bulk bar in Archant does: up to ${MAX_BULK_IDS} ids, or every transaction of an active account a filter matches. With a filter, first call get_transactions with it, show the owner its total_results and pass it as expected_count: when the filter matches another count now, nothing is written and it answers bulk_count_stale with the count now. Each field it changes is locked against rules. Returns how many transactions were matched and how many changed.`,
	scope: "archant:write",
	annotations: REPLACES,
	input: bulkUpdateTransactionsInput,
	output: z.object({
		matched: z.number().int().describe("Transactions selected, unchanged ones included."),
		changed: z.number().int().describe("Transactions whose fields changed."),
	}),
	run: async (deps, { ids, filter, expected_count: expectedCount, patch }) => {
		const selection = ids === undefined ? { filter: filter ?? {} } : { ids };
		const { updated, changed } = await bulkUpdateTransactions(
			deps,
			{ selection, patch },
			{ expectedCount },
		);

		return { result: { matched: updated, changed }, changedRows: changed };
	},
});

/** A decimal text as Sure's `BigDecimal(value.to_s)` reads it: a sign, digits, a fraction. */
const DECIMAL_TEXT = /^([+-]?)(\d*)(?:\.(\d+))?$/u;

/**
 * An amount in Sure's sign, positive for money out, as the ledger's decimal
 * text (AD-5): negated, or with `type`, its magnitude signed as `type` says.
 * Built from the digits, never through a float. `null` for anything Sure
 * would not read as a number.
 */
function ledgerAmount(
	value: string | number,
	type?: z.output<typeof createTransactionInput>["type"],
): string | null {
	const match = DECIMAL_TEXT.exec(String(value).trim());
	const [, sign = "", integer = "", fraction = ""] = match ?? [];

	if (match === null || (integer === "" && fraction === "")) {
		return null;
	}

	const digits = `${integer.replace(/^0+(?=\d)/u, "") || "0"}${
		fraction.replace(/0+$/u, "") === "" ? "" : `.${fraction.replace(/0+$/u, "")}`
	}`;
	const moneyIn =
		type === "income" || type === "inflow"
			? true
			: type === "expense" || type === "outflow"
				? false
				: sign === "-";

	return moneyIn || /^[0.]+$/u.test(digits) ? digits : `-${digits}`;
}

/** What a ledger amount is in Sure's sign, positive for money out. */
const sureSigned = (item: TransactionRecord) => ({
	amount: toMinorUnits(0 - item.amount),
	currency: item.currency,
});

/**
 * Sure's `create_transaction` refusals for what the sheet's checks refuse;
 * `run` checks the date's format first, so a date the sheet refuses, before
 * the opening or too far ahead, keeps the generic shape.
 */
const CREATE_REFUSALS = {
	codes: {
		NOT_FOUND: {
			error: "account_not_found",
			message: "No account found with that ID that this user can write to.",
		},
	},
	fields: [
		{ path: "amount", error: "invalid_amount", message: "amount must be a number." },
		...REFERENCE_REFUSALS,
	],
} as const;

/** A transaction as Sure's `create_transaction` answers it, its amount in Sure's sign. */
const createdTransaction = z.object({
	id: z.string(),
	entry_id: z.string().describe("The same id: Archant's entries and transactions share it."),
	name: z.string(),
	date: z.string(),
	amount: z
		.string()
		.describe(
			'Sure\'s decimal text in Sure\'s sign, such as "12.5" for money out, "-12.5" for money in.',
		),
	amount_formatted: z.string().describe('Such as "12,50 €", in Sure\'s sign.'),
	currency: z.string(),
	type: classifications,
	notes: z.string().nullable(),
	category: namedRef.nullable(),
	merchant: namedRef.nullable(),
	tags: z.array(namedRef),
});

/** The fields Sure's `create_transaction` and `delete_transaction` answer alike. */
function sureLineOf(item: TransactionRecord) {
	return {
		id: item.id,
		entry_id: item.id,
		name: item.label,
		date: item.date,
		amount: decimalOf(sureSigned(item)),
		amount_formatted: formatMoney(sureSigned(item)),
		currency: item.currency,
		type: classificationOf(item.amount),
	};
}

export const createTransactionTool = defineTool({
	name: "create_transaction",
	title: "Record a transaction",
	description: `Creates a transaction on one of the household's accounts, as Sure's create_transaction and Archant's transaction sheet: a cash payment, a line the bank does not show, a line of a statement. Rules then run on it, and transfer matching, as on a line typed by hand; a category, merchant or tags given here are set and locked, so no rule changes them. Amount sign, as Sure's: a positive amount is an expense (money out), a negative one an income (money in); or pass a positive magnitude with type "income" or "expense", which then decides the sign. The line is in the account's currency: another one answers invalid_currency. Calling it twice records two lines, unless external_id is given: then the second call records nothing and returns the line with created false. user_modified, Sure's, is accepted and changes nothing: a sync never rewrites a line it did not bring. Refusals answer Sure's keys: account_not_found, invalid_date, invalid_amount, invalid_name, invalid_currency, invalid_category, invalid_merchant, invalid_tags; a date before the account's opening or more than a year ahead answers validation_error, naming the field's path and code; another field the input itself refuses answers { error, hint }.`,
	scope: "archant:write",
	annotations: CREATES,
	fieldPaths: { label: "name" },
	input: createTransactionInput,
	output: z.object({
		success: z.literal(true),
		created: z
			.boolean()
			.describe("false when external_id named a line already recorded, which is unchanged."),
		transaction: createdTransaction,
		message: z.string(),
	}),
	run: async (deps, input) => {
		if (!z.iso.date().safeParse(input.date).success) {
			refuse("invalid_date", "date must be an ISO 8601 date (YYYY-MM-DD).");
		}

		const amount = ledgerAmount(input.amount, input.type);

		if (amount === null) {
			refuse("invalid_amount", "amount must be a number.");
		}

		const name = input.name.trim();

		if (name === "") {
			refuse("invalid_name", "name is required.");
		}

		// Sure's `presence`: a blank currency is the account's.
		const currency = input.currency?.trim().toUpperCase() || undefined;

		if (currency !== undefined && !isCurrencyCode(currency)) {
			refuse("invalid_currency", "currency must be a valid ISO 4217 code.");
		}

		const created = await refusedAsSure(CREATE_REFUSALS, async () => {
			try {
				return await createTransaction(
					deps,
					input.account_id,
					{ date: input.date, label: name, amount, notes: input.notes },
					{
						currency,
						categoryId: input.category_id,
						merchantId: input.merchant_id,
						tagIds: input.tag_ids,
						externalId:
							input.external_id === undefined
								? undefined
								: { source: input.source, id: input.external_id },
					},
				);
			} catch (error) {
				// Archant has no exchange rate (AD-6): a line is in its account's currency.
				if (
					error instanceof AppError &&
					(error.fields ?? []).some(
						(field) => field.path === "currency" && field.code === "currency_mismatch",
					) &&
					error.params?.currency !== undefined
				) {
					refuse(
						"invalid_currency",
						`currency must be the account's currency, ${error.params.currency}.`,
					);
				}

				throw error;
			}
		});
		const line = { ...sureLineOf(created), notes: created.notes, ...(await refsOf(deps, created)) };

		return {
			result: {
				success: true as const,
				created: created.created,
				transaction: line,
				message: created.created
					? `Created ${line.name} (${line.amount_formatted} on ${line.date}).`
					: "Transaction already exists for this external_id; returned the existing one.",
			},
			changedRows: created.created ? 1 : 0,
		};
	},
});

export const deleteTransactionTool = defineTool({
	name: "delete_transaction",
	title: "Delete a transaction",
	description: `Permanently deletes a transaction, as Sure's delete_transaction and « Supprimer » on its sheet in Archant, and recomputes the account's balances from its date. Pass the id, account_id, date and amount get_transaction gave and the owner agreed to, the amount in Sure's sign: as given for an expense, negated for an income. When the transaction no longer has them, nothing is deleted and it answers transaction_changed with the fields that differ. A split's line alone answers split_child: deleting the split's parent deletes its lines with it. A side of a transfer goes with its transfer, the other side becoming a standard transaction. A line a bank or a file brought comes back at the next sync or import still listing it. Returns the transaction as it was.`,
	scope: "archant:write",
	annotations: DESTROYS,
	input: deleteTransactionInput,
	output: z.object({
		success: z.literal(true),
		deleted: z.literal(true),
		transaction: z
			.object({
				id: z.string(),
				entry_id: z.string(),
				account_id: z.string(),
				name: z.string(),
				date: z.string(),
				amount: createdTransaction.shape.amount,
				amount_formatted: createdTransaction.shape.amount_formatted,
				currency: z.string(),
				type: classifications,
			})
			.describe("The transaction as it was, to type it again if need be."),
		message: z.string(),
	}),
	run: async (deps, { id, account_id: accountId, date, amount }) => {
		const shown = ledgerAmount(amount);

		// Unread text must never reach the ledger unnegated, where it would compare in Archant's sign.
		if (shown === null) {
			refuse("invalid_amount", "amount must be a number.");
		}
		const deleted = await refusedAsSure(
			{
				codes: {
					NOT_FOUND: {
						error: "not_found",
						message: `No transaction with id '${id}' in an account you can write to.`,
					},
					TRANSACTION_SPLIT: {
						error: "split_child",
						message:
							"Split child transactions cannot be deleted individually. Delete the split parent instead.",
					},
				},
			},
			async () => deleteTransaction(deps, id, { accountId, date, amount: shown }),
		);
		const line = sureLineOf(deleted.transaction);

		return {
			result: {
				success: true as const,
				deleted: true as const,
				// The output schema puts account_id back in Sure's place, after entry_id.
				transaction: { ...line, account_id: deleted.transaction.accountId },
				message: `Deleted ${line.name} (${line.amount_formatted} on ${line.date}).`,
			},
			changedRows: deleted.deletedCount,
		};
	},
});
