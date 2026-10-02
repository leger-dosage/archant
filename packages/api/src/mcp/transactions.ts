import { z } from "zod";

import { toDecimalString } from "@archant/data/money";
import { TRANSFER_KINDS } from "@archant/data/transfer-kinds";

import { getTransactionsInput, groupTransactionsInput } from "../schemas/assistants.ts";
import { findTransactions, groupTransactionsByLabel } from "../services/transactions.ts";
import { BANK_TEXT, READ_ONLY, defineTool } from "./tool.ts";

const decimal = (what: string) =>
	z.string().describe(`${what}, a decimal string such as "-12.50" in the currency beside it.`);

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

export const getTransactions = defineTool({
	name: "get_transactions",
	title: "Transactions",
	description: `A page of every account's transactions matching the filter, most recent first, with the count of every matching transaction and the income and expenses among them in the reporting currency; transactions in another currency are left out of those sums and counted in skippedCount. ${BANK_TEXT}`,
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
				items: found.items.map((item) => ({
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
							: {
									kind: item.transfer.kind,
									counterpartAccountId: item.transfer.counterpartAccountId,
								},
					pending: item.pending,
				})),
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
	description: `Every transaction matching the filter, grouped by label with case, accents and spaces aside, money in and money out and each currency apart: the largest groups first, 100 at most, with how many groups there are. Each group gives the label most of its transactions carry, their count, signed total and last date, and the categories they carry, null for uncategorised. Start here to find what a rule should clean up; category ["none"] keeps the uncategorised ones. ${BANK_TEXT}`,
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
