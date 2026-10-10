import type { TransactionData } from "@/hooks/useTransactions";

import type { TransactionFormInput } from "@archant/api/schemas/transactions";

import { amountToText } from "@/lib/amount-sign";
import { toIsoDate } from "@/lib/dates";

/**
 * A new transaction's default date: today, unless the account opened today or
 * later, where the first day it accepts is the day after its opening date.
 */
function defaultDate(openingDate: string): string {
	const dayAfterOpening = new Date(Date.parse(`${openingDate}T00:00:00Z`) + 86_400_000)
		.toISOString()
		.slice(0, 10);
	const today = toIsoDate();

	return today > dayAfterOpening ? today : dayAfterOpening;
}

export function valuesOf(
	transaction: TransactionData | null,
	openingDate: string,
): TransactionFormInput {
	return transaction === null
		? {
				date: defaultDate(openingDate),
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
