import type { ReportsPageData } from "@/hooks/useReportsPage";

import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ReportPeriodType } from "@archant/data/report-periods";
import { REPORT_PERIOD_TYPES, quarterOf } from "@archant/data/report-periods";

import { DateField } from "@/components/DateField";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MONTH_NAMES } from "@/lib/dates";
import { periodLabelText } from "@/lib/reports";
import { cn } from "@/lib/utils";

type Period = ReportsPageData["period"];

const pad = (value: number) => String(value).padStart(2, "0");

function lastDay(year: number, month: number): string {
	return `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
}

/**
 * Whether a key press is the reports' arrow hotkey, as Sure's `hotkey`
 * controller reads it: no modifier, no repeat, not in a field, not under an
 * open dialog, and not already taken by a grabbed section.
 */
function isPeriodHotkey(event: KeyboardEvent): boolean {
	const target = event.target instanceof HTMLElement ? event.target : null;

	return (
		!event.defaultPrevented &&
		!event.repeat &&
		!event.altKey &&
		!event.ctrlKey &&
		!event.metaKey &&
		!event.shiftKey &&
		!(
			target !== null &&
			(target.isContentEditable || target.closest("input, textarea, select, [role=combobox]"))
		) &&
		document.querySelector("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]") ===
			null
	);
}

/** A segment of Sure's `DS::SegmentedControl`, a link to the type's default dates. */
function TypeTabs({ active }: { active: ReportPeriodType }) {
	const { t } = useTranslation();

	return (
		<nav
			aria-label={t("reports.periodAria")}
			className="no-scrollbar flex w-fit max-w-full overflow-x-auto rounded-lg bg-inset p-1"
		>
			{REPORT_PERIOD_TYPES.map((type) => (
				<Link
					key={type}
					to="/reports"
					search={{ periodType: type }}
					aria-current={type === active ? "page" : undefined}
					className={cn(
						"rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
						type === active && "bg-card text-foreground shadow-xs",
					)}
				>
					{t(`reports.periods.${type}`)}
				</Link>
			))}
		</nav>
	);
}

/** One choice of the picker: a link to that period, or greyed out once in the future. */
function PickerChoice({
	label,
	type,
	from,
	to,
	current,
	future,
	onPick,
}: {
	label: string;
	type: ReportPeriodType;
	from: string;
	to: string;
	current: boolean;
	future: boolean;
	onPick: () => void;
}) {
	if (future) {
		return (
			<Button variant="ghost" size="sm" className="w-full" disabled>
				{label}
			</Button>
		);
	}

	return (
		<Button variant={current ? "secondary" : "ghost"} size="sm" className="w-full" asChild>
			<Link
				to="/reports"
				search={{ periodType: type, startDate: from, endDate: to }}
				aria-current={current ? "true" : undefined}
				onClick={onPick}
			>
				{label}
			</Link>
		</Button>
	);
}

/** Sure's `_period_picker`: months, quarters or the years of a decade, the future greyed out. */
function PeriodPickerGrid({
	period,
	today,
	onPick,
}: {
	period: Period;
	today: string;
	onPick: () => void;
}) {
	const { t } = useTranslation();
	const startYear = Number(period.from.slice(0, 4));
	const thisYear = Number(today.slice(0, 4));
	const thisMonth = today.slice(0, 7);
	const decades = period.type === "ytd";
	const [year, setYear] = useState(decades ? Math.floor(startYear / 10) * 10 : startYear);
	const step = decades ? 10 : 1;
	const nextReachable = decades ? year + 10 <= thisYear : year + 1 <= thisYear;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t(decades ? "reports.picker.previousDecade" : "reports.picker.previousYear")}
					onClick={() => setYear(year - step)}
				>
					<ChevronLeftIcon />
				</Button>
				<span aria-live="polite" className="font-medium tabular-nums">
					{decades ? `${year}–${year + 9}` : year}
				</span>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t(decades ? "reports.picker.nextDecade" : "reports.picker.nextYear")}
					disabled={!nextReachable}
					onClick={() => setYear(year + step)}
				>
					<ChevronRightIcon />
				</Button>
			</div>
			{period.type === "monthly" && (
				<ul aria-label={t("reports.picker.months", { year })} className="grid grid-cols-3 gap-1">
					{MONTH_NAMES.map((name, index) => {
						const month = `${year}-${pad(index + 1)}`;

						return (
							<li key={month}>
								<PickerChoice
									label={name}
									type="monthly"
									from={`${month}-01`}
									to={lastDay(year, index + 1)}
									current={month === period.from.slice(0, 7)}
									future={month > thisMonth}
									onPick={onPick}
								/>
							</li>
						);
					})}
				</ul>
			)}
			{period.type === "quarterly" && (
				<ul aria-label={t("reports.picker.quarters", { year })} className="grid grid-cols-2 gap-1">
					{[1, 2, 3, 4].map((quarter) => {
						const from = `${year}-${pad((quarter - 1) * 3 + 1)}-01`;

						return (
							<li key={quarter}>
								<PickerChoice
									label={t("reports.picker.quarter", { quarter, year })}
									type="quarterly"
									from={from}
									to={lastDay(year, quarter * 3)}
									current={year === startYear && quarter === quarterOf(period.from)}
									future={from > today}
									onPick={onPick}
								/>
							</li>
						);
					})}
				</ul>
			)}
			{decades && (
				<ul
					aria-label={t("reports.picker.years", { start: year, end: year + 9 })}
					className="grid grid-cols-2 gap-1"
				>
					{Array.from({ length: 10 }, (_, index) => year + index)
						.filter((each) => each <= thisYear)
						.map((each) => (
							<li key={each}>
								<PickerChoice
									label={each === thisYear ? t("reports.picker.ytd", { year: each }) : String(each)}
									type="ytd"
									from={`${each}-01-01`}
									to={each === thisYear ? today : `${each}-12-31`}
									current={each === startYear}
									future={false}
									onPick={onPick}
								/>
							</li>
						))}
				</ul>
			)}
		</div>
	);
}

/** An arrow of Sure's period navigation, with its tooltip and hotkey. */
function PeriodArrow({
	next,
	period,
	range,
	disabled,
	hotkeysOff,
}: {
	next: boolean;
	period: Period;
	range: { from: string; to: string };
	disabled: boolean;
	hotkeysOff: boolean;
}) {
	const { t } = useTranslation();
	const link = useRef<HTMLAnchorElement>(null);
	const key = next ? "ArrowRight" : "ArrowLeft";
	const label = t(next ? "reports.nextPeriod" : "reports.previousPeriod");
	const Icon = next ? ChevronRightIcon : ChevronLeftIcon;

	useEffect(() => {
		if (disabled || hotkeysOff) {
			return undefined;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === key && isPeriodHotkey(event)) {
				event.preventDefault();
				link.current?.click();
			}
		};

		window.addEventListener("keydown", onKeyDown);

		return () => window.removeEventListener("keydown", onKeyDown);
	}, [disabled, hotkeysOff, key]);

	if (disabled) {
		return (
			<Button variant="ghost" size="icon" aria-label={label} disabled>
				<Icon />
			</Button>
		);
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="ghost" size="icon" asChild>
					<Link
						ref={link}
						to="/reports"
						search={{ periodType: period.type, startDate: range.from, endDate: range.to }}
						aria-label={label}
						aria-keyshortcuts={key}
					>
						<Icon />
					</Link>
				</Button>
			</TooltipTrigger>
			<TooltipContent>
				{t("reports.shortcutHint", { action: label, key: next ? "→" : "←" })}
			</TooltipContent>
		</Tooltip>
	);
}

const isWholeDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/u.test(value);

/** Sure's custom range: « Du » and « Au », each applied once it is a whole date. */
function CustomRange({
	period,
	onChange,
}: {
	period: Period;
	onChange: (from: string, to: string) => void;
}) {
	const { t } = useTranslation();

	return (
		<div className="flex flex-wrap items-center gap-3 rounded-lg bg-inset p-3">
			<div className="flex items-center gap-2">
				<label htmlFor="reports-from" className="text-sm font-medium text-muted-foreground">
					{t("reports.dateRange.from")}
				</label>
				<DateField
					key={period.from}
					id="reports-from"
					value={period.from}
					onChange={(value) => isWholeDate(value) && onChange(value, period.to)}
				/>
			</div>
			<span aria-hidden="true" className="text-muted-foreground">
				—
			</span>
			<div className="flex items-center gap-2">
				<label htmlFor="reports-to" className="text-sm font-medium text-muted-foreground">
					{t("reports.dateRange.to")}
				</label>
				<DateField
					key={period.to}
					id="reports-to"
					value={period.to}
					onChange={(value) => isWholeDate(value) && onChange(period.from, value)}
				/>
			</div>
		</div>
	);
}

/**
 * Sure's period header: the type tabs, the custom range when picked, then
 * the arrows, the period's name opening a picker, and « Aujourd'hui ». `←`
 * and `→` click the arrows, unless `hotkeysOff`, while a section is held.
 */
export function ReportsPeriodControls({
	data,
	hotkeysOff,
	onCustomRange,
}: {
	data: Pick<ReportsPageData, "period" | "navigation" | "today">;
	hotkeysOff: boolean;
	onCustomRange: (from: string, to: string) => void;
}) {
	const { t } = useTranslation();
	const { period, navigation, today } = data;
	const [picking, setPicking] = useState(false);
	const label = navigation === null ? null : periodLabelText(navigation.label, t);

	return (
		<div className="flex flex-col gap-4">
			<TypeTabs active={period.type} />
			{period.type === "custom" && <CustomRange period={period} onChange={onCustomRange} />}
			{navigation !== null && label !== null && (
				<div className="flex flex-wrap items-center gap-1">
					<PeriodArrow
						next={false}
						period={period}
						range={navigation.previous}
						disabled={false}
						hotkeysOff={hotkeysOff}
					/>
					<PeriodArrow
						next
						period={period}
						range={navigation.next}
						disabled={navigation.atLatest}
						hotkeysOff={hotkeysOff}
					/>
					{period.type === "last_6_months" ? (
						<span className="px-2 text-lg font-medium lg:text-base">{label}</span>
					) : (
						<Popover open={picking} onOpenChange={setPicking}>
							<PopoverTrigger asChild>
								<Button
									variant="ghost"
									className="text-lg font-medium lg:text-base"
									aria-label={`${label}, ${t("reports.picker.label")}`}
								>
									{label}
									<ChevronDownIcon aria-hidden="true" />
								</Button>
							</PopoverTrigger>
							<PopoverContent align="start" className="w-72 p-3">
								<PeriodPickerGrid period={period} today={today} onPick={() => setPicking(false)} />
							</PopoverContent>
						</Popover>
					)}
					<Button variant="outline" className="ml-auto" asChild>
						{/* Sure's « Today » drops the dates: the type's defaults are today's. */}
						<Link to="/reports" search={{ periodType: period.type }}>
							{t("reports.today")}
						</Link>
					</Button>
				</div>
			)}
		</div>
	);
}
