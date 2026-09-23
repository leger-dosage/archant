import { useTranslation } from "react-i18next";

import type { LoanDetails } from "@archant/data/account-types";
import { formatMoney } from "@archant/data/money";

import { isoToFrench } from "@/lib/dates";
import { formatRate } from "@/lib/loan-details";

/** The details of a loan that are known, on one line under its type. */
export function LoanSummary({ details, currency }: { details: LoanDetails; currency: string }) {
	const { t } = useTranslation();
	const parts = [
		details.originalAmount === null
			? null
			: t("loanDetails.summary.originalAmount", {
					amount: formatMoney({ amount: details.originalAmount, currency }),
				}),
		details.interestRate === null
			? null
			: t("loanDetails.summary.interestRate", { rate: formatRate(details.interestRate) }),
		details.endDate === null
			? null
			: t("loanDetails.summary.endDate", { date: isoToFrench(details.endDate) }),
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
