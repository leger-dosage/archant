import type { SummaryCell } from "@/components/SummaryStrip";
import type { LoanOverviewData } from "@/hooks/useLoanOverview";
import type { ReactNode } from "react";

import { useTranslation } from "react-i18next";

import type { MinorUnits } from "@archant/data/money";
import { formatMoney } from "@archant/data/money";

import { Money } from "@/components/Money";
import { ProgressRing } from "@/components/ProgressRing";
import { SummaryStrip } from "@/components/SummaryStrip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { longDate } from "@/lib/dates";
import { formatInsuranceRate, formatRate, truncatedTermOf } from "@/lib/loan-details";
import { formatWholePercent } from "@/lib/percent";
import { cn } from "@/lib/utils";

// Sure's `number_with_precision(ratio, precision: 1)`: 4,0x, never 4x.
const ratioFormat = new Intl.NumberFormat("fr-FR", {
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
});

// Sure's `grid-cols-3`: three figures to a row, so ten never crowd one line.
const CELLS_PER_ROW = 3;

// Sure's `loan_leverage_band_class`: success, warning and destructive. Sure's
// success green has no token here; the income green is the closest that keeps
// 4.5:1 on a card, where `--trend-up` reaches 3.2:1.
const LEVERAGE_BAND_CLASSES = {
	conservative: "text-money-income",
	moderate: "text-warning",
	high: "text-destructive",
} as const;

type LoanOverviewProps = {
	overview: LoanOverviewData;
	/** `null` for a viewer, who changes nothing: the button is left out. */
	onEdit: (() => void) | null;
};

/**
 * Sure's `loans/tabs/_overview` and `_repayment_progress`: what was borrowed,
 * what is owed, what the loan costs, how much is repaid and what the current
 * instalment pays. Every figure answers for the server's today; one it cannot
 * compute reads « Inconnu ».
 */
export function LoanOverview({ overview, onEdit }: LoanOverviewProps) {
	const { t } = useTranslation();
	const { currency, instalment } = overview;
	const unknown = t("loanOverview.unknown");
	const money = (amount: MinorUnits | null): ReactNode =>
		amount === null ? unknown : <Money amount={amount} currency={currency} />;
	const term = overview.termMonths === null ? null : truncatedTermOf(overview.termMonths);
	const cells: SummaryCell[] = [
		{ label: t("loanOverview.originalAmount"), value: money(overview.originalAmount) },
		{ label: t("loanOverview.remainingBalance"), value: money(overview.remainingBalance) },
		{
			label: t("loanOverview.interestRate"),
			value: overview.interestRate === null ? unknown : formatRate(overview.interestRate),
		},
		{
			label: t("loanOverview.monthlyPayment"),
			value:
				overview.monthlyPayment === "not_applicable"
					? t("loanOverview.notApplicable")
					: money(overview.monthlyPayment),
		},
		{
			label: t("loanOverview.term"),
			value:
				term === null
					? unknown
					: term.unit === "years"
						? t("loanOverview.termYears", { count: term.count })
						: t("loanOverview.termMonths", { count: term.count }),
		},
		{
			label: t("loanOverview.payoffDate"),
			value: overview.payoffDate === null ? unknown : longDate(overview.payoffDate),
		},
		{
			label: t("loanOverview.rateType"),
			value: overview.rateType === null ? unknown : t(`loanDetails.rateTypes.${overview.rateType}`),
		},
		{
			// Both tabs show on one page: the same title over two amounts would read as a mistake.
			label: overview.insured
				? t("loanOverview.totalCostWithInsurance")
				: t("loanOverview.totalCost"),
			value: money(overview.totalCost),
		},
	];

	// A card reading zero would say the insurance costs nothing rather than none is recorded.
	if (overview.insurance !== null) {
		cells.push({
			label: t("loanOverview.insurance"),
			value:
				"total" in overview.insurance
					? money(overview.insurance.total)
					: t("loanOverview.insuranceRateOnly", {
							rate: formatInsuranceRate(overview.insurance.rate),
						}),
		});
	}

	// A loan with no down payment recorded is not unleveraged, only one nobody has described.
	if (overview.leverage !== null) {
		cells.push({
			label: t("loanOverview.leverage"),
			// Named as well as coloured, so the band never rests on its colour alone.
			value: (
				<span
					className={cn(
						"flex flex-wrap items-baseline gap-x-2",
						LEVERAGE_BAND_CLASSES[overview.leverage.band],
					)}
				>
					{t("loanOverview.leverageMultiple", {
						ratio: ratioFormat.format(overview.leverage.tenths / 10),
					})}
					<span className="text-sm font-normal">
						{t(`loanOverview.leverageBands.${overview.leverage.band}`)}
					</span>
				</span>
			),
		});
	}

	const rows = Array.from({ length: Math.ceil(cells.length / CELLS_PER_ROW) }, (_, index) =>
		cells.slice(index * CELLS_PER_ROW, (index + 1) * CELLS_PER_ROW),
	);
	const repaid =
		overview.repaidPercent === null || overview.originalAmount === null
			? null
			: {
					percent: overview.repaidPercent,
					amount: formatMoney({ amount: overview.originalAmount, currency }),
				};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col divide-y divide-line rounded-xl border bg-card">
				{rows.map((row) => (
					<SummaryStrip key={row[0]?.label} cells={row} />
				))}
			</div>

			{(repaid !== null || instalment !== null) && (
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					{repaid !== null && (
						<div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
							<p className="text-sm text-muted-foreground">{t("loanOverview.repaid")}</p>
							<div className="flex justify-center">
								<ProgressRing
									size={160}
									percent={repaid.percent}
									color="var(--warning)"
									label={t("loanOverview.ring", {
										percent: formatWholePercent(repaid.percent),
										amount: repaid.amount,
									})}
								>
									<span className="text-3xl font-medium tabular-nums">
										{formatWholePercent(repaid.percent)}
									</span>
									<span className="text-sm text-muted-foreground tabular-nums">
										{t("loanOverview.ofOriginal", { amount: repaid.amount })}
									</span>
								</ProgressRing>
							</div>
						</div>
					)}

					{instalment !== null && (
						<div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
							<p className="text-sm text-muted-foreground">
								{t("loanOverview.instalment", {
									number: instalment.number,
									date: longDate(instalment.date),
								})}
							</p>
							<dl className="flex flex-col gap-2">
								<InstalmentPart
									label={t("loanOverview.principal")}
									amount={instalment.principal}
									share={instalment.shares.principal}
									currency={currency}
								/>
								<InstalmentPart
									label={t("loanOverview.interest")}
									amount={instalment.interest}
									share={instalment.shares.interest}
									currency={currency}
								/>
								{instalment.insurance > 0 && (
									<InstalmentPart
										label={t("loanOverview.insurance")}
										amount={instalment.insurance}
										share={instalment.shares.insurance}
										currency={currency}
									/>
								)}
								<div className="flex items-center justify-between gap-2 border-t pt-2">
									<dt className="text-sm text-muted-foreground">{t("loanOverview.total")}</dt>
									<dd className="text-sm font-medium tabular-nums">
										<Money amount={instalment.total} currency={currency} />
									</dd>
								</div>
							</dl>
						</div>
					)}
				</div>
			)}

			{onEdit !== null && (
				<div className="flex justify-center py-8">
					<Button variant="ghost" onClick={onEdit}>
						{t("loanOverview.edit")}
					</Button>
				</div>
			)}
		</div>
	);
}

function InstalmentPart({
	label,
	amount,
	share,
	currency,
}: {
	label: string;
	amount: MinorUnits;
	share: number;
	currency: string;
}) {
	return (
		<div className="flex items-center justify-between gap-2">
			<dt className="text-sm text-muted-foreground">{label}</dt>
			<dd className="flex items-baseline gap-2 text-sm tabular-nums">
				<Money amount={amount} currency={currency} />
				<span className="text-muted-foreground">{formatWholePercent(share)}</span>
			</dd>
		</div>
	);
}

export function LoanOverviewSkeleton() {
	return (
		<div className="flex flex-col gap-4" aria-hidden="true">
			<Skeleton className="h-48 w-full" />
			<Skeleton className="h-40 w-full" />
		</div>
	);
}
