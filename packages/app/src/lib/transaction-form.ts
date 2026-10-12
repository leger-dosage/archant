import type { TransactionData } from "@/hooks/useTransactions";

import type { TransactionFormInput } from "@archant/api/schemas/transactions";

import { amountToText } from "@/lib/amount-sign";
import { toIsoDate } from "@/lib/dates";

/** A new transaction is dated today, as Sure's form, whatever the opening date. */
export function valuesOf(transaction: TransactionData | null): TransactionFormInput {
	return transaction === null
		? {
				date: toIsoDate(),
				label: "",
				amount: "",
				notes: "",
				excluded: false,
				oneTime: false,
				categoryId: null,
				merchantId: null,
				tagIds: [],
			}
		: {
				date: transaction.date,
				label: transaction.label,
				amount: amountToText(transaction.amount, transaction.currency),
				notes: transaction.notes ?? "",
				excluded: transaction.excluded,
				oneTime: transaction.oneTime,
				categoryId: transaction.categoryId,
				merchantId: transaction.merchantId,
				tagIds: transaction.tagIds,
			};
}
