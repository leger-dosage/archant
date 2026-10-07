import { useTranslation } from "react-i18next";

import type { LoanDetails } from "@archant/data/account-types";
import { formatMoney } from "@archant/data/money";

import { isoToFrench } from "@/lib/dates";
import { formatRate, termOf } from "@/lib/loan-details";

/**
 * The terms of a loan that are known, on one line under its type: the amount
 * borrowed, the rate and its type, and the term in years or months.
 */
export function LoanSummary({ details, currency }: { details: LoanDetails; currency: string }) {
	const { t } = useTranslation();
	const term = details.termMonths === null ? null : termOf(details.termMonths);
	const parts = [
		details.originalAmount === null
			? null
			: t("loanDetails.summary.originalAmount", {
					amount: formatMoney({ amount: details.originalAmount, currency }),
				}),
		details.interestRate === null
			? null
			: details.rateType === null
				? t("loanDetails.summary.interestRate", { rate: formatRate(details.interestRate) })
				: t("loanDetails.summary.interestRateTyped", {
						rate: formatRate(details.interestRate),
						type: t(`loanDetails.summary.rateTypes.${details.rateType}`),
					}),
		// A loan saved before Story 24.1 shows its end date until its term replaces it.
		term === null
			? details.endDate === null
				? null
				: t("loanDetails.summary.endDate", { date: isoToFrench(details.endDate) })
			: term.unit === "years"
				? t("loanDetails.summary.termYears", { count: term.count })
				: t("loanDetails.summary.termMonths", { count: term.count }),
	].filter((part) => part !== null);

	if (parts.length === 0) {
		return null;
	}

	return (
		<ul
			aria-label={t("loanDetails.label")}
			className="flex flex-wrap gap-x-4 text-sm text-muted-foreground"
		>
			{parts.map((part) => (
				<li key={part}>{part}</li>
			))}
		</ul>
	);
}
