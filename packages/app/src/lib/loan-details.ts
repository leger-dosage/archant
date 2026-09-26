import type { LoanDetailsInput } from "@archant/api/schemas/accounts";
import type { LoanDetails } from "@archant/data/account-types";

import { amountToText } from "@/lib/amount-sign";

/** A rate in basis points, always with two decimals: 345 is `3,45`, 300 is `3,00`. */
export function rateToText(basisPoints: number): string {
	const units = Math.trunc(basisPoints / 100);
	const hundredths = basisPoints % 100;

	return `${units},${String(hundredths).padStart(2, "0")}`;
}

/** A rate as the account header reads it, with French spacing before the sign. */
export function formatRate(basisPoints: number): string {
	return `${rateToText(basisPoints)} %`;
}

/** Stored details back into the text the account edit dialog edits, blank when unknown. */
export function loanDetailsToInput(
	details: LoanDetails | null,
	currency: string,
): LoanDetailsInput {
	const { originalAmount = null, interestRate = null, endDate = null } = details ?? {};

	return {
		originalAmount: originalAmount === null ? "" : amountToText(originalAmount, currency),
		interestRate: interestRate === null ? "" : rateToText(interestRate),
		endDate: endDate ?? "",
	};
}
