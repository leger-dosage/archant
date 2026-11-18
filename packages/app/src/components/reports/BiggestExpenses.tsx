import type { ReportsPageData } from "@/hooks/useReportsPage";

import { useTranslation } from "react-i18next";

import type { BiggestExpensesLimit } from "@archant/data/reports-sections";
import { BIGGEST_EXPENSES_LIMITS } from "@archant/data/reports-sections";

import { Button } from "@/components/ui/button";
import { longDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format-money";
import { cn } from "@/lib/utils";

export function BiggestExpensesLimitControl({
	limit,
	onChange,
}: {
	limit: BiggestExpensesLimit;
	onChange: (limit: BiggestExpensesLimit) => void;
}) {
	const { t } = useTranslation();

	return (
		<div role="group" aria-label={t("reports.biggestExpenses.limit")} className="flex gap-1">
			{BIGGEST_EXPENSES_LIMITS.map((option) => (
				<Button
					key={option}
					type="button"
					variant={option === limit ? "secondary" : "ghost"}
					size="sm"
					aria-pressed={option === limit}
					onClick={() => onChange(option)}
				>
					{option}
				</Button>
			))}
		</div>
	);
}

export function BiggestExpenses({
	data,
	limit,
	print = false,
}: {
	data: Pick<ReportsPageData, "biggestExpenses" | "currency">;
	limit: BiggestExpensesLimit;
	print?: boolean;
}) {
	const { t } = useTranslation();

	return (
		<div className={print ? undefined : "overflow-x-auto"}>
			<table
				aria-label={t("reports.biggestExpenses.title")}
				className={print ? "tufte-table tufte-compact" : "w-full text-left text-sm"}
			>
				<thead className={print ? undefined : "bg-inset text-xs text-muted-foreground"}>
					<tr>
						<th scope="col" className={print ? undefined : "px-3 py-2"}>
							{t("reports.biggestExpenses.transaction")}
						</th>
						<th scope="col" className={print ? undefined : "px-3 py-2"}>
							{t("reports.breakdown.category")}
						</th>
						<th scope="col" className={print ? "tufte-right" : "px-3 py-2 text-right"}>
							{t("reports.breakdown.amount")}
						</th>
					</tr>
				</thead>
				<tbody className={print ? undefined : "divide-y divide-line"}>
					{data.biggestExpenses.slice(0, limit).map((expense) => (
						<tr key={expense.id}>
							<td className={print ? undefined : "px-3 py-2"}>
								<span className="font-medium">{expense.label}</span>
								{expense.oneTime && (
									<span
										className={cn("ml-2", print ? "tufte-muted" : "text-xs text-muted-foreground")}
									>
										{t("reports.biggestExpenses.oneTime")}
									</span>
								)}
								<div className={print ? "tufte-muted" : "text-xs text-muted-foreground"}>
									{longDate(expense.date)} · {expense.accountName}
								</div>
							</td>
							<td className={print ? undefined : "px-3 py-2"}>
								{expense.categoryName ?? t("reports.breakdown.uncategorized")}
							</td>
							<td
								className={
									print ? "tufte-right" : "px-3 py-2 text-right whitespace-nowrap tabular-nums"
								}
							>
								{formatMoney({ amount: expense.amount, currency: data.currency })}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
