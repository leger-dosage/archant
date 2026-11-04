import type { TFunction } from "i18next";

import type { SurePeriod } from "@archant/data/periods";
import { DEFAULT_PERIOD, LOAN_WINDOW_PERIODS, isCustomRange } from "@archant/data/periods";

import { formatShortDate, formatTick } from "@/lib/balance-change";

/** What a chart read asks for: one of Sure's keys, or a custom range of two days. */
export type ChartPeriod = { period: SurePeriod } | { startDate: string; endDate: string };

/** The chart's search params, as the dashboard and the account page read them. */
export type PeriodSearch = {
	period?: SurePeriod | undefined;
	startDate?: string | undefined;
	endDate?: string | undefined;
};

type LoanWindowPeriod = (typeof LOAN_WINDOW_PERIODS)[number];

/**
 * Sure's `Periodable#set_period`, read from the address first: both dates
 * make a custom range, or the default when they do not make one; then the
 * address's key, then the user's saved one, then the default.
 */
export function selectedPeriod(search: PeriodSearch, saved: SurePeriod | undefined): ChartPeriod {
	const { startDate, endDate } = search;

	if (startDate !== undefined && endDate !== undefined) {
		return isCustomRange(startDate, endDate) ? { startDate, endDate } : { period: DEFAULT_PERIOD };
	}

	return { period: search.period ?? saved ?? DEFAULT_PERIOD };
}

/** Whether the address names the period, so the chart need not wait for the saved one. */
export function namesPeriod(search: PeriodSearch): boolean {
	return (
		search.period !== undefined || (search.startDate !== undefined && search.endDate !== undefined)
	);
}

/**
 * Sure's `period_picker_selected` on a loan: a period the loan chart does not
 * offer, a custom range among them, shows the whole life, so « Tout » reads checked.
 */
export function loanPickerSelection(chart: ChartPeriod): LoanWindowPeriod {
	return (
		("period" in chart && LOAN_WINDOW_PERIODS.find((key) => key === chart.period)) || "all_time"
	);
}

/**
 * Sure's `label_range`, the trigger of a custom range: « 5 oct. – 20 oct. »,
 * the year dropped while both days sit in the current one, where it would
 * add width without telling anything apart.
 */
export function rangeLabel(t: TFunction, from: string, to: string, today: string): string {
	const year = today.slice(0, 4);
	const withinYear = from.slice(0, 4) === year && to.slice(0, 4) === year;
	const format = (date: string) => (withinYear ? formatTick(date, false) : formatShortDate(date));

	return t("periods.range", { startDate: format(from), endDate: format(to) });
}

/**
 * Sure's `UI::Account::Chart#comparison_label` test: the account's history
 * starts after the period does. Never for « Tout », whose start Sure moves to
 * the history's own, so an account opened today still reads « vs début ».
 */
export function isShortHistory(history: {
	period: SurePeriod | null;
	periodFrom: string;
	from: string | null;
}): boolean {
	return (
		history.period !== "all_time" && history.from !== null && history.from > history.periodFrom
	);
}

/**
 * Sure's `comparison_label`, after a change: « vs. 30 derniers jours », or
 * for a custom range « 5 oct. 2026 au 20 oct. 2026 ». `shortHistory` is
 * Sure's account chart's « par rapport à l'historique disponible », when the
 * account starts after the period does.
 */
export function comparisonText(
	t: TFunction,
	history: { period: SurePeriod | null; periodFrom: string; to: string },
	shortHistory = false,
): string {
	if (shortHistory) {
		return t("periods.availableHistory");
	}

	return history.period === null
		? t("periods.custom.comparison", {
				startDate: formatShortDate(history.periodFrom),
				endDate: formatShortDate(history.to),
			})
		: t(`periods.${history.period}.comparison`);
}
