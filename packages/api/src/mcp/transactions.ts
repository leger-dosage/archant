import type { ServiceDeps } from "../services/deps.ts";
import type { TransactionRecord } from "../services/ledger/queries.ts";
import type { NameBook } from "../services/names.ts";
import type { TransactionItem } from "../services/transactions.ts";

import { z } from "zod";

import { toDecimalString } from "@archant/data/money";
import { BANK_CONNECTOR_IDS } from "@archant/data/schema/bank-connections";
import { TRANSFER_KINDS } from "@archant/data/transfer-kinds";

import {
	bulkUpdateTransactionsInput,
	createTransactionInput,
	deleteTransactionInput,
	getTransactionsInput,
	groupTransactionsInput,
	transactionIdInput,
	updateTransactionInput,
} from "../schemas/assistants.ts";
import { MAX_BULK_IDS } from "../schemas/transactions.ts";
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
	defineTool,
	namedRef,
	pageFieldsOf,
	pageOutput,
} from "./tool.ts";

const transferFields = {
	id: z.string().describe("The transfer's id, which unpair_transfer takes."),
	kind: z.enum(TRANSFER_KINDS),
	counterpart_transaction_id: z.string().describe("The other side's transaction id."),
	counterpart_account: namedRef.describe("The other side's account."),
};

/**
 * A transaction as Sure's `create_transaction` and `update_transaction`
 * answer it: its account, category, merchant and tags as `{ id, name }`,
 * the names Sure's `get_transactions` gives beside the ids the write tools take.
 */
const transaction = z.object({
	id: z.string(),
	date: z.string(),
	name: z.string().describe("The label the line shows."),
	amount: decimal("Signed: negative is money out"),
	currency: z.string(),
	classification: z
		.enum(["income", "expense"])
		.describe("From the sign, as Sure's: money in is income, money out an expense."),
	account: namedRef,
	category: namedRef.nullable(),
	merchant: namedRef.nullable(),
	tags: z.array(namedRef),
	notes: z.string().nullable(),
	excluded: z.boolean().describe("Left out of reports, still in the balance."),
	transfer: z
		.object(transferFields)
		.nullable()
		.describe("The transfer it is a side of, with the other side and its account; null for none."),
	transfer_suggested: z
		.boolean()
		.describe(
			"In no transfer, with several candidates: matching left it for the owner to pair, through get_transfer_candidates.",
		),
	pending: z.boolean().describe("Not booked by the bank yet."),
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

/** A transaction as get_transactions lists it. */
function itemOf(item: TransactionRecord, names: NameBook): z.input<typeof transaction> {
	return {
		id: item.id,
		date: item.date,
		name: item.label,
		amount: toDecimalString(item),
		currency: item.currency,
		classification: item.amount > 0 ? "income" : "expense",
		account: { id: item.accountId, name: names.accounts.get(item.accountId) ?? item.accountId },
		category: refOf(names.categories, item.categoryId),
		merchant: refOf(names.merchants, item.merchantId),
		tags: item.tagIds.map((id) => ({ id, name: names.tags.get(id) ?? id })),
		notes: item.notes,
		excluded: item.excluded,
		transfer:
			item.transfer === null
				? null
				: {
						id: item.transfer.id,
						kind: item.transfer.kind,
						counterpart_transaction_id: item.transfer.counterpartTransactionId,
						counterpart_account: {
							id: item.transfer.counterpartAccountId,
							name: item.transfer.counterpartAccountName,
						},
					},
		transfer_suggested: item.transferSuggested,
		pending: item.pending,
	};
}

export const getTransactions = defineTool({
	name: "get_transactions",
	title: "Transactions",
	description: `A page of the transactions of every active account matching the filter; a deactivated account's are left out even when named, as in Archant's list; most recent first, a split transaction listed as its lines, with the count of every matching transaction and the income and expenses among them in the reporting currency; transactions in another currency are left out of those sums and counted in skipped_count. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: getTransactionsInput,
	output: z.object({
		transactions: z.array(transaction),
		...pageOutput,
		total_results: z.number().int().describe("Every matching transaction, whatever its currency."),
		total_income: decimal("Money in"),
		total_expenses: decimal("Money out"),
		currency: z.string(),
		skipped_count: z.number().int(),
	}),
	run: async (deps, input) => {
		const found = await findTransactions(deps, input);
		const names = await namesFor(deps, found.items);

		return {
			result: {
				transactions: found.items.map((item) => itemOf(item, names)),
				...pageFieldsOf(found.total, found.page, found.pageSize),
				total_income: toDecimalString({ amount: found.sum.income, currency: found.sum.currency }),
				total_expenses: toDecimalString({
					amount: found.sum.expense,
					currency: found.sum.currency,
				}),
				currency: found.sum.currency,
				skipped_count: found.sum.skippedCount,
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

/** A transaction in full, as its sheet shows it. */
const transactionDetail = transaction.extend({
	reference: z.string().nullable().describe("A cheque or QIF number from the file it came in."),
	source,
});

/** A transaction in full, its references named. */
async function detailOf(
	deps: ServiceDeps,
	item: TransactionItem,
): Promise<z.input<typeof transactionDetail>> {
	return {
		...itemOf(item, await namesFor(deps, [item])),
		reference: item.reference,
		source: item.source,
	};
}

export const getTransactionTool = defineTool({
	name: "get_transaction",
	title: "Transaction",
	description: `One transaction in full, as its sheet shows it: get_transactions' fields, its reference and where it came from. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: transactionIdInput,
	output: transactionDetail,
	run: async (deps, input) => ({
		result: await detailOf(deps, await getTransaction(deps, input.id)),
		changedRows: 0,
	}),
});

export const updateTransactionTool = defineTool({
	name: "update_transaction",
	title: "Classify a transaction",
	description: `Sets a transaction's category, merchant, tags, notes, label or exclusion as its sheet in Archant does, and returns it under transaction, as get_transaction gives it, as Sure's update_transaction does. Its date and amount come from the bank and never change here, and a split transaction or one of its lines keeps its exclusion: changing it answers TRANSACTION_SPLIT. Each field it changes is locked: no rule changes it afterwards, so prefer a rule when the label repeats. ${BANK_TEXT}`,
	scope: "archant:write",
	annotations: REPLACES,
	fieldPaths: { label: "name" },
	input: updateTransactionInput,
	output: z.object({ transaction: transactionDetail }),
	run: async (deps, { id, patch }) => ({
		result: { transaction: await detailOf(deps, await updateTransaction(deps, id, patch)) },
		changedRows: 1,
	}),
});

export const bulkUpdateTransactionsTool = defineTool({
	name: "bulk_update_transactions",
	title: "Classify transactions in bulk",
	description: `Sets a category or a merchant, adds tags or changes the exclusion on many transactions at once, as the bulk bar in Archant does: up to ${MAX_BULK_IDS} ids, or every transaction of an active account a filter matches. With a filter, first call get_transactions with it, show the owner its total_results and pass it as expected_count: when the filter matches another count now, nothing is written and it answers BULK_COUNT_STALE with the count now. Each field it changes is locked against rules. Returns how many transactions were matched and how many changed.`,
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

/**
 * The amount as the ledger reads it: Sure's `type` sets the sign of the
 * magnitude, money out negative as every Archant amount; without it the
 * amount is taken as signed.
 */
function signedAmount(
	amount: string,
	type: z.output<typeof createTransactionInput>["type"],
): string {
	if (type === undefined) {
		return amount;
	}

	const magnitude = amount.trim().replace(/^[+-]\s*/, "");

	return type === "expense" || type === "outflow" ? `-${magnitude}` : magnitude;
}

export const createTransactionTool = defineTool({
	name: "create_transaction",
	title: "Record a transaction",
	description: `Records a transaction on an account, as the transaction sheet does in Archant: a cash payment, a line the bank does not show, a line of a statement. Rules then run on it, and transfer matching, as on a line typed by hand; a category, merchant or tags given here are set and locked, so no rule changes them. The line is in the account's currency. Returns created and the line under transaction, as get_transaction gives it, as Sure's create_transaction does. Calling it twice records two lines, unless external_id is given: then the second call records nothing and returns the line with created false. user_modified, Sure's, is accepted and changes nothing: a sync never rewrites a line it did not bring. A refused field answers VALIDATION_ERROR with its path and code; an unknown account_id, NOT_FOUND.`,
	scope: "archant:write",
	annotations: CREATES,
	fieldPaths: { label: "name" },
	input: createTransactionInput,
	output: z.object({
		created: z
			.boolean()
			.describe("false when external_id named a line already recorded, which is unchanged."),
		transaction: transactionDetail,
	}),
	run: async (deps, input) => {
		const created = await createTransaction(
			deps,
			input.account_id,
			{
				date: input.date,
				label: input.name,
				amount: signedAmount(input.amount, input.type),
				notes: input.notes,
			},
			{
				currency: input.currency,
				categoryId: input.category_id,
				merchantId: input.merchant_id,
				tagIds: input.tag_ids,
				externalId:
					input.external_id === undefined
						? undefined
						: { source: input.source, id: input.external_id },
			},
		);

		return {
			result: { created: created.created, transaction: await detailOf(deps, created) },
			changedRows: created.created ? 1 : 0,
		};
	},
});

export const deleteTransactionTool = defineTool({
	name: "delete_transaction",
	title: "Delete a transaction",
	description: `Deletes one transaction for good, as « Supprimer » on its sheet in Archant, and recomputes the account's balances from its date. Pass the account_id, date and amount get_transaction gave and the owner agreed to: when the transaction no longer has them, nothing is deleted and it answers TRANSACTION_CHANGED with the fields that differ. A split's line alone answers TRANSACTION_SPLIT: deleting the split's parent deletes its lines with it. A side of a transfer goes with its transfer, the other side becoming a standard transaction. A line a bank or a file brought comes back at the next sync or import still listing it. Returns the transaction as it was and how many rows went.`,
	scope: "archant:write",
	annotations: DESTROYS,
	input: deleteTransactionInput,
	output: z.object({
		deleted: z.literal(true),
		transaction: transactionDetail.describe(
			"The transaction as it was, to type it again if need be.",
		),
		deleted_count: z
			.number()
			.int()
			.describe(
				"Entries deleted: the transaction, with a split's lines or the order it was converted into.",
			),
	}),
	run: async (deps, { id, account_id: accountId, date, amount }) => {
		const deleted = await deleteTransaction(deps, id, { accountId, date, amount });

		return {
			result: {
				deleted: true as const,
				transaction: await detailOf(deps, deleted.transaction),
				deleted_count: deleted.deletedCount,
			},
			changedRows: deleted.deletedCount,
		};
	},
});
