import type { Envelope } from "@/components/BudgetCategories";
import type { BudgetData } from "@/hooks/useBudget";
import type { TransactionFilters } from "@/lib/transaction-filters";

import { Link } from "@tanstack/react-router";
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UNCATEGORISED } from "@archant/api/schemas/transactions";
import type { MinorUnits } from "@archant/data/money";
import { formatMoney, toMinorUnits } from "@archant/data/money";

import { InsetGroup } from "@/components/InsetGroup";
import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentTransactions } from "@/hooks/useTransactions";
import { errorCodeOf } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";
import { ofMonth } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * The list a category's sheet links to: the category, its children with it,
 * over the month. « Sans catégorie » keeps the expense side only, as the
 * dashboard's drill-down does, since its income has its own line.
 */
function filtersOf(envelope: Envelope, budget: BudgetData): TransactionFilters {
	return envelope.kind === "category"
		? { category: [envelope.line.categoryId], from: budget.from, to: budget.to }
		: { category: [UNCATEGORISED], direction: ["expense"], from: budget.from, to: budget.to };
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-4 text-sm">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="font-medium tabular-nums">{children}</dd>
		</div>
	);
}

/**
 * Sure's budget category drawer: what the category spent against its
 * budget, its status, its monthly average and median, then the month's three
 * latest rows and a link to all of them in `/transactions`.
 */
export function BudgetCategorySheet({
	budget,
	envelope,
	name,
	open,
	onOpenChange,
}: {
	budget: BudgetData;
	envelope: Envelope;
	name: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { t } = useTranslation();
	const { line } = envelope;
	const filters = filtersOf(envelope, budget);
	const recent = useRecentTransactions(filters, open);
	const shared = envelope.kind === "category" && envelope.line.shared;
	const money = (amount: MinorUnits) => formatMoney({ amount, currency: budget.currency });
	const budgeted = shared ? t("budgets.categories.shared") : money(line.budgetedSpending);
	const optional = (amount: MinorUnits | null) =>
		amount === null ? t("budgets.sheet.none") : money(amount);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				// The transaction sheet's frame: 550 px, 12 px off the viewport's edges from 768 px.
				className="data-[side=right]:w-full data-[side=right]:border-l-0 data-[side=right]:sm:max-w-none data-[side=right]:md:inset-y-3 data-[side=right]:md:right-3 data-[side=right]:md:h-auto data-[side=right]:md:w-[550px] data-[side=right]:md:rounded-xl data-[side=right]:md:border motion-reduce:transition-none motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none"
			>
				<SheetHeader className="border-b">
					<p className="text-sm text-muted-foreground">{t("budgets.sheet.category")}</p>
					<SheetTitle className="text-2xl">{name}</SheetTitle>
					<SheetDescription className="tabular-nums">
						{t("budgets.sheet.ofBudget", { spent: money(line.spent), budgeted })}
					</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-4 overflow-y-auto p-4">
					<InsetGroup level={3} title={t("budgets.sheet.overview")}>
						<dl className="flex flex-col gap-3 p-4">
							<Figure label={t("budgets.sheet.spending", { ofMonth: ofMonth(budget.month) })}>
								{money(line.spent)}
							</Figure>
							<Figure label={t("budgets.sheet.status")}>
								<span
									className={cn(
										"flex items-center gap-1",
										line.available < 0
											? "text-destructive"
											: line.status === "near" && "text-warning",
									)}
								>
									{line.available < 0 ? (
										<CircleAlertIcon aria-hidden="true" className="size-4" />
									) : (
										<CircleCheckIcon aria-hidden="true" className="size-4" />
									)}
									{line.available < 0
										? t("budgets.sheet.overBy", {
												amount: money(toMinorUnits(Math.abs(line.available))),
											})
										: t("budgets.sheet.left", { amount: money(line.available) })}
								</span>
							</Figure>
							<Figure label={t("budgets.sheet.budgeted")}>{budgeted}</Figure>
							{envelope.kind === "category" && envelope.line.rolledOver > 0 && (
								<Figure label={t("budgets.rollover.sheet")}>
									{money(envelope.line.rolledOver)}
								</Figure>
							)}
							<Figure label={t("budgets.sheet.average")}>{optional(line.average)}</Figure>
							<Figure label={t("budgets.sheet.median")}>{optional(line.median)}</Figure>
						</dl>
					</InsetGroup>
					<InsetGroup level={3} title={t("budgets.sheet.recent")}>
						<div className="flex flex-col gap-4 p-4">
							{recent.isPending && <Skeleton className="h-24 w-full" aria-hidden="true" />}
							{recent.isError && (
								<p role="alert" className="text-sm text-muted-foreground">
									{t(`errors.${errorCodeOf(recent.error)}`)}
								</p>
							)}
							{recent.data !== undefined &&
								(recent.data.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										{t("budgets.sheet.noTransactions")}
									</p>
								) : (
									<ul aria-label={t("budgets.sheet.recent")} className="flex flex-col gap-3">
										{recent.data.map((item) => (
											<li key={item.id} className="flex items-start justify-between gap-4 text-sm">
												<div className="flex min-w-0 flex-col">
													<span className="text-xs text-muted-foreground uppercase">
														{formatShortDate(item.date)}
													</span>
													<span className="truncate">{item.label}</span>
												</div>
												<Money amount={item.amount} currency={item.currency} signed />
											</li>
										))}
									</ul>
								))}
							<Button variant="outline" asChild>
								<Link to="/transactions" search={filters}>
									{t("budgets.sheet.all")}
								</Link>
							</Button>
						</div>
					</InsetGroup>
				</div>
			</SheetContent>
		</Sheet>
	);
}
