import type { LoanDetailsInput, UpdateAccountInput } from "@archant/api/schemas/accounts";
import type { LoanDetails } from "@archant/data/account-types";
import { MAX_LOAN_TERM_MONTHS } from "@archant/data/account-types";

import { amountToText } from "@/lib/amount-sign";

/** Every field of a loan's details, as a PATCH must send them. */
type CompleteLoanInput = NonNullable<UpdateAccountInput["details"]>;

/**
 * A rate in millionths as the percentage typed, with two decimals at least and
 * no trailing zero beyond: 18200 is `1,82`, 2917 is `0,2917`, 30000 is `3,00`.
 */
export function rateToText(millionths: number): string {
	const units = Math.trunc(millionths / 10_000);
	const fraction = String(millionths % 10_000)
		.padStart(4, "0")
		.replace(/0{1,2}$/u, "");

	return `${units},${fraction}`;
}

/**
 * An interest rate as the account header reads it, with Sure's three decimals
 * and French spacing before the sign: 18200 is `1,820 %`.
 */
export function formatRate(millionths: number): string {
	const units = Math.trunc(millionths / 10_000);
	const thousandths = Math.round((millionths % 10_000) / 10);

	return `${units},${String(thousandths).padStart(3, "0")} %`;
}

/**
 * A term as the account header names it: whole years when it has no months
 * left over, months otherwise, so 30 months never reads as two years.
 */
export function termOf(months: number): { unit: "years" | "months"; count: number } {
	return months % 12 === 0
		? { unit: "years", count: months / 12 }
		: { unit: "months", count: months };
}

/**
 * The term a loan saved before Story 24.1 is proposed: the whole calendar
 * months from origination to its end date, days ignored, clamped to Sure's
 * bounds.
 */
export function proposedTerm(origination: string, endDate: string): number {
	const [fromYear = 0, fromMonth = 0] = origination.split("-").map(Number);
	const [toYear = 0, toMonth = 0] = endDate.split("-").map(Number);
	const months = (toYear - fromYear) * 12 + (toMonth - fromMonth);

	return Math.min(Math.max(months, 1), MAX_LOAN_TERM_MONTHS);
}

/** Where the API's field errors on a loan's details land in either account form. */
export const LOAN_FIELD_NAMES = [
	"details.originalAmount",
	"details.downPayment",
	"details.startDate",
	"details.termMonths",
	"details.rateType",
	"details.interestRate",
	"details.insuranceRate",
	"details.insuranceRateType",
	"details.rateChanges",
] as const;

/**
 * Typed details with every field present, a missing one blank: a PATCH
 * replaces them whole, and a new loan starts from `completeLoanInput(undefined)`.
 */
export function completeLoanInput(details: LoanDetailsInput | undefined): CompleteLoanInput {
	return {
		originalAmount: details?.originalAmount ?? "",
		downPayment: details?.downPayment ?? "",
		startDate: details?.startDate ?? "",
		termMonths: details?.termMonths ?? "",
		rateType: details?.rateType ?? "",
		interestRate: details?.interestRate ?? "",
		insuranceRate: details?.insuranceRate ?? "",
		insuranceRateType: details?.insuranceRateType ?? "",
		rateChanges: details?.rateChanges ?? [],
	};
}

function rateOrBlank(millionths: number | null): string {
	return millionths === null ? "" : rateToText(millionths);
}

/**
 * Stored details back into the text the account edit dialog edits, blank when
 * unknown. A loan saved before Story 24.1 has an end date and no term: the
 * term from origination, its start date or else the account's opening date,
 * to that end date is proposed, and saving drops the end date.
 */
export function loanDetailsToInput(
	details: LoanDetails | null,
	currency: string,
	openingDate: string,
): CompleteLoanInput {
	if (details === null) {
		return completeLoanInput(undefined);
	}

	const amount = (value: LoanDetails["originalAmount"]) =>
		value === null ? "" : amountToText(value, currency);
	const termMonths =
		details.termMonths ??
		(details.endDate === null
			? null
			: proposedTerm(details.startDate ?? openingDate, details.endDate));

	return {
		originalAmount: amount(details.originalAmount),
		downPayment: amount(details.downPayment),
		startDate: details.startDate ?? "",
		termMonths: termMonths === null ? "" : String(termMonths),
		rateType: details.rateType ?? "",
		interestRate: rateOrBlank(details.interestRate),
		insuranceRate: rateOrBlank(details.insuranceRate),
		insuranceRateType: details.insuranceRateType ?? "",
		rateChanges: details.rateChanges.map((change) => ({
			effectiveDate: change.effectiveDate,
			rate: rateToText(change.rate),
		})),
	};
}
