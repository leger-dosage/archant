import type { TransactionRecord } from "../services/ledger/queries.ts";
import type { TransactionItem } from "../services/transactions.ts";

import { z } from "zod";

import { toDecimalString } from "@archant/data/money";
import { BANK_CONNECTOR_IDS } from "@archant/data/schema/bank-connections";
import { TRANSFER_KINDS } from "@archant/data/transfer-kinds";

import {
	bulkUpdateTransactionsInput,
	getTransactionsInput,
	groupTransactionsInput,
	transactionIdInput,
	updateTransactionInput,
} from "../schemas/assistants.ts";
import { MAX_BULK_IDS } from "../schemas/transactions.ts";
import {
	bulkUpdateTransactions,
	findTransactions,
	getTransaction,
	groupTransactionsByLabel,
	updateTransaction,
} from "../services/transactions.ts";
import { BANK_TEXT, READ_ONLY, REPLACES, decimal, defineTool } from "./tool.ts";

const transaction = z.object({
	id: z.string(),
	date: z.string(),
	label: z.string(),
	amount: decimal("Signed: negative is money out"),
	currency: z.string(),
	accountId: z.string(),
	categoryId: z.string().nullable(),
	merchantId: z.string().nullable(),
	tagIds: z.array(z.string()),
	notes: z.string().nullable(),
	excluded: z.boolean().describe("Left out of reports, still in the balance."),
	transfer: z
		.object({ kind: z.enum(TRANSFER_KINDS), counterpartAccountId: z.string() })
		.nullable()
		.describe("The transfer it is a side of, with the other side's account; null for none."),
	pending: z.boolean().describe("Not booked by the bank yet."),
});

/** A transaction as get_transactions lists it. */
function itemOf(item: TransactionRecord): z.input<typeof transaction> {
	return {
		id: item.id,
		date: item.date,
		label: item.label,
		amount: toDecimalString(item),
		currency: item.currency,
		accountId: item.accountId,
		categoryId: item.categoryId,
		merchantId: item.merchantId,
		tagIds: item.tagIds,
		notes: item.notes,
		excluded: item.excluded,
		transfer:
			item.transfer === null
				? null
				: { kind: item.transfer.kind, counterpartAccountId: item.transfer.counterpartAccountId },
		pending: item.pending,
	};
}

export const getTransactions = defineTool({
	name: "get_transactions",
	title: "Transactions",
	description: `A page of the transactions of every active account matching the filter; a deactivated account's are left out even when named, as in Archant's list; most recent first, a split transaction listed as its lines, with the count of every matching transaction and the income and expenses among them in the reporting currency; transactions in another currency are left out of those sums and counted in skippedCount. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: getTransactionsInput,
	output: z.object({
		items: z.array(transaction),
		page: z.number().int(),
		pageSize: z.number().int(),
		total: z.number().int().describe("Every matching transaction, whatever its currency."),
		income: decimal("Money in"),
		expense: decimal("Money out"),
		currency: z.string(),
		skippedCount: z.number().int(),
	}),
	run: async (deps, input) => {
		const found = await findTransactions(deps, input);

		return {
			result: {
				items: found.items.map(itemOf),
				page: found.page,
				pageSize: found.pageSize,
				total: found.total,
				income: toDecimalString({ amount: found.sum.income, currency: found.sum.currency }),
				expense: toDecimalString({ amount: found.sum.expense, currency: found.sum.currency }),
				currency: found.sum.currency,
				skippedCount: found.sum.skippedCount,
			},
			changedRows: 0,
		};
	},
});

export const groupTransactionLabels = defineTool({
	name: "group_transactions_by_label",
	title: "Transactions grouped by label",
	description: `Every transaction of an active account matching the filter, grouped by label with case, accents and spaces aside, money in and money out and each currency apart: the largest groups first, 100 at most, with how many groups there are. Each group gives the label most of its transactions carry, their count, signed total and last date, and the categories they carry, null for uncategorised. Start here to find what a rule should clean up; category ["none"] keeps the uncategorised ones. ${BANK_TEXT}`,
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
				lastDate: z.string(),
				categoryIds: z.array(z.string().nullable()),
			}),
		),
		groupCount: z.number().int(),
	}),
	run: async (deps, input) => {
		const { groups, groupCount } = await groupTransactionsByLabel(deps, input);

		return {
			result: {
				groups: groups.map((group) => ({
					label: group.label,
					count: group.count,
					total: toDecimalString({ amount: group.total, currency: group.currency }),
					currency: group.currency,
					lastDate: group.lastDate,
					categoryIds: group.categoryIds,
				})),
				groupCount,
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
	transfer: z
		.object({
			kind: z.enum(TRANSFER_KINDS),
			counterpartAccountId: z.string(),
			counterpartAccountName: z.string(),
		})
		.nullable()
		.describe("The transfer it is a side of, with the other side's account; null for none."),
	source,
});

function detailOf(item: TransactionItem): z.input<typeof transactionDetail> {
	return {
		...itemOf(item),
		reference: item.reference,
		transfer:
			item.transfer === null
				? null
				: {
						kind: item.transfer.kind,
						counterpartAccountId: item.transfer.counterpartAccountId,
						counterpartAccountName: item.transfer.counterpartAccountName,
					},
		source: item.source,
	};
}

export const getTransactionTool = defineTool({
	name: "get_transaction",
	title: "Transaction",
	description: `One transaction in full, as its sheet shows it: get_transactions' fields, its reference, the other side of its transfer with that account's name, and where it came from. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: transactionIdInput,
	output: transactionDetail,
	run: async (deps, input) => ({
		result: detailOf(await getTransaction(deps, input.id)),
		changedRows: 0,
	}),
});

export const updateTransactionTool = defineTool({
	name: "update_transaction",
	title: "Classify a transaction",
	description: `Sets a transaction's category, merchant, tags, notes, label or exclusion as its sheet in Archant does, and returns it as get_transaction does. Its date and amount come from the bank and never change here, and a split transaction or one of its lines keeps its exclusion: changing it answers TRANSACTION_SPLIT. Each field it changes is locked: no rule changes it afterwards, so prefer a rule when the label repeats. ${BANK_TEXT}`,
	scope: "archant:write",
	annotations: REPLACES,
	input: updateTransactionInput,
	output: transactionDetail,
	run: async (deps, { id, ...fields }) => ({
		result: detailOf(await updateTransaction(deps, id, fields)),
		changedRows: 1,
	}),
});

export const bulkUpdateTransactionsTool = defineTool({
	name: "bulk_update_transactions",
	title: "Classify transactions in bulk",
	description: `Sets a category or a merchant, adds tags or changes the exclusion on many transactions at once, as the bulk bar in Archant does: up to ${MAX_BULK_IDS} ids, or every transaction of an active account a filter matches. With a filter, first call get_transactions with it, show the owner its total and pass that total as expectedCount: when the filter matches another count now, nothing is written and it answers BULK_COUNT_STALE with the count now. Each field it changes is locked against rules. Returns how many transactions were matched and how many changed.`,
	scope: "archant:write",
	annotations: REPLACES,
	input: bulkUpdateTransactionsInput,
	output: z.object({
		matched: z.number().int().describe("Transactions selected, unchanged ones included."),
		changed: z.number().int().describe("Transactions whose fields changed."),
	}),
	run: async (deps, { ids, filter, expectedCount, patch }) => {
		const selection = ids === undefined ? { filter: filter ?? {} } : { ids };
		const { updated, changed } = await bulkUpdateTransactions(
			deps,
			{ selection, patch },
			{ expectedCount },
		);

		return { result: { matched: updated, changed }, changedRows: changed };
	},
});
