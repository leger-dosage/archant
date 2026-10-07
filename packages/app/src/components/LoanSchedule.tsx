import type { LoanScheduleData } from "@/hooks/useLoanSchedule";

import { useTranslation } from "react-i18next";

import { Money } from "@/components/Money";
import { SummaryStrip } from "@/components/SummaryStrip";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { longDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Sure's `loans/tabs/_schedule`: the payment, the interest and the cost of a
 * loan, then every payment with what it repays. A payment on or before the
 * server's today is shaded, so the table and Story 24.4's projection agree on
 * one day whatever the browser's zone.
 */
export function LoanSchedule({ schedule }: { schedule: LoanScheduleData }) {
	const { t } = useTranslation();
	const { currency } = schedule;

	return (
		<div className="flex flex-col gap-4">
			<SummaryStrip
				className="rounded-xl border bg-card"
				cells={[
					{
						// A re-sized loan has no single monthly payment: the card says which one this is.
						label: schedule.reAmortising
							? t("loanSchedule.openingPayment")
							: t("loanSchedule.monthlyPayment"),
						value: <Money amount={schedule.periodicPayment} currency={currency} />,
					},
					{
						label: t("loanSchedule.totalInterest"),
						value: <Money amount={schedule.totalInterest} currency={currency} />,
					},
					{
						label: t("loanSchedule.totalCost"),
						value: <Money amount={schedule.totalPaid} currency={currency} />,
					},
				]}
			/>

			<p className="text-sm text-muted-foreground">
				{t("loanSchedule.description", { startDate: longDate(schedule.originationDate) })}
			</p>

			{schedule.variable && (
				<p className="text-sm text-muted-foreground">{t("loanSchedule.variableRateNotice")}</p>
			)}

			<Table aria-label={t("loanSchedule.label")}>
				<TableHeader>
					<TableRow>
						<TableHead scope="col">{t("loanSchedule.columns.number")}</TableHead>
						<TableHead scope="col">{t("loanSchedule.columns.date")}</TableHead>
						<TableHead scope="col" className="text-right">
							{t("loanSchedule.columns.payment")}
						</TableHead>
						<TableHead scope="col" className="text-right">
							{t("loanSchedule.columns.principal")}
						</TableHead>
						<TableHead scope="col" className="text-right">
							{t("loanSchedule.columns.interest")}
						</TableHead>
						<TableHead scope="col" className="text-right">
							{t("loanSchedule.columns.remainingBalance")}
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{schedule.payments.map((payment) => {
						const past = payment.date <= schedule.asOf;

						return (
							<TableRow
								key={payment.number}
								data-past={past ? "" : undefined}
								// Sure's `bg-container-inset`, kept on hover: the shade tells a past payment apart.
								className={cn(past && "bg-inset hover:bg-inset")}
							>
								<TableCell className="text-muted-foreground tabular-nums">
									{payment.number}
								</TableCell>
								<TableCell className="whitespace-nowrap">
									{longDate(payment.date)}
									{/* The shade alone would say it by colour only (WCAG 1.4.1). */}
									{past && <span className="sr-only">, {t("loanSchedule.past")}</span>}
								</TableCell>
								<TableCell className="text-right">
									<Money amount={payment.payment} currency={currency} />
								</TableCell>
								<TableCell className="text-right">
									<Money amount={payment.principal} currency={currency} />
								</TableCell>
								<TableCell className="text-right">
									<Money amount={payment.interest} currency={currency} muted />
								</TableCell>
								<TableCell className="text-right">
									<Money amount={payment.endingBalance} currency={currency} />
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}

export function LoanScheduleSkeleton() {
	return (
		<div className="flex flex-col gap-2" aria-hidden="true">
			<Skeleton className="h-20 w-full" />
			{[0, 1, 2].map((row) => (
				<Skeleton key={row} className="h-10 w-full" />
			))}
		</div>
	);
}
