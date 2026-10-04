import type { BudgetData } from "@/hooks/useBudget";
import type { ReactNode } from "react";

import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { monthSchema } from "@archant/api/schemas/reports";

import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MONTH_NAMES, monthLabel } from "@/lib/dates";

type MonthBounds = BudgetData["bounds"];

const pad = (value: number) => String(value).padStart(2, "0");

/** An arrow to a neighbouring month, or a disabled one past a bound. */
function MonthArrow({ to, label, next }: { to: string | null; label: string; next: boolean }) {
	const Icon = next ? ChevronRightIcon : ChevronLeftIcon;

	if (to === null) {
		return (
			<Button variant="outline" size="icon-sm" aria-label={label} disabled>
				<Icon />
			</Button>
		);
	}

	return (
		<Button variant="outline" size="icon-sm" asChild>
			<Link to="/budgets/$month" params={{ month: to }} aria-label={label}>
				<Icon />
			</Link>
		</Button>
	);
}

/**
 * Sure's picker: a year with arrows, then its twelve months, those out of
 * bounds disabled, as Sure's `budget_date_valid?` greys them out.
 */
function YearOfMonths({
	month,
	bounds,
	onPick,
}: {
	month: string;
	bounds: MonthBounds;
	onPick: () => void;
}) {
	const { t } = useTranslation();
	const [year, setYear] = useState(Number(month.slice(0, 4)));

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t("budgets.picker.previousYear")}
					disabled={`${year - 1}-12` < bounds.from}
					onClick={() => setYear(year - 1)}
				>
					<ChevronLeftIcon />
				</Button>
				<span aria-live="polite" className="font-medium tabular-nums">
					{year}
				</span>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t("budgets.picker.nextYear")}
					disabled={`${year + 1}-01` > bounds.to}
					onClick={() => setYear(year + 1)}
				>
					<ChevronRightIcon />
				</Button>
			</div>
			<ul aria-label={t("budgets.picker.months", { year })} className="grid grid-cols-3 gap-1">
				{MONTH_NAMES.map((name, index) => {
					const value = `${year}-${pad(index + 1)}`;
					const current = value === month;

					return (
						<li key={value}>
							{value < bounds.from || value > bounds.to ? (
								<Button variant="ghost" size="sm" className="w-full" disabled>
									{name}
								</Button>
							) : (
								<Button
									variant={current ? "secondary" : "ghost"}
									size="sm"
									className="w-full"
									asChild
								>
									<Link to="/budgets/$month" params={{ month: value }} onClick={onPick}>
										{name}
									</Link>
								</Button>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

/**
 * The month page's header, as Sure's `_budget_header`: arrows to the
 * neighbouring months, the month's name opening a picker by year, and
 * « Aujourd'hui ». Until the bounds arrive, or for a month out of them, the
 * arrows and the picker are disabled.
 */
export function BudgetMonthPicker({
	month,
	current,
	previousMonth,
	nextMonth,
	bounds,
}: {
	month: string;
	/** This month in the browser's zone, « Aujourd'hui »'s target. */
	current: string;
	previousMonth: string | null;
	nextMonth: string | null;
	bounds: MonthBounds | null;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const label = monthSchema.safeParse(month).success ? monthLabel(month) : month;

	return (
		<div className="flex flex-wrap items-center gap-2">
			<div className="flex gap-1">
				<MonthArrow to={previousMonth} label={t("budgets.previous")} next={false} />
				<MonthArrow to={nextMonth} label={t("budgets.next")} next />
			</div>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						className="text-base font-medium"
						aria-label={t("budgets.picker.label", { month: label })}
						disabled={bounds === null}
					>
						{label}
						<ChevronDownIcon aria-hidden="true" />
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start">
					{bounds !== null && (
						<YearOfMonths month={month} bounds={bounds} onPick={() => setOpen(false)} />
					)}
				</PopoverContent>
			</Popover>
			<Button variant="outline" size="sm" className="ml-auto" asChild>
				<Link to="/budgets/$month" params={{ month: current }}>
					{t("budgets.today")}
				</Link>
			</Button>
		</div>
	);
}

/**
 * What a month out of bounds, or not a month at all, shows in place of its
 * budget. The month page's header already offers « Aujourd'hui »; a page
 * without one passes it as `action`.
 */
export function BudgetOutOfRange({ action = null }: { action?: ReactNode }) {
	const { t } = useTranslation();

	return (
		<EmptyState
			icon={{ kind: "uncategorised" }}
			title={t("budgets.outOfRange.title")}
			description={t("budgets.outOfRange.description")}
			action={action}
		/>
	);
}
