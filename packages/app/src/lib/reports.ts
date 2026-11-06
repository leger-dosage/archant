import type { TFunction } from "i18next";

import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import type { ReportPeriodLabel } from "@archant/data/report-periods";
import { DEFAULT_REPORT_PERIOD_TYPE, REPORT_PERIOD_TYPES } from "@archant/data/report-periods";

import { monthLabel } from "@/lib/dates";
import { intlLocale } from "@/lib/locale";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

/**
 * The search params of `/reports` and `/reports/print`, Sure's
 * `period_type`, `start_date` and `end_date`: an unknown type is `monthly`
 * and a date that does not parse is the type's default, as the server reads them.
 */
export const reportsSearchSchema = z.object({
	periodType: z.enum(REPORT_PERIOD_TYPES).optional().catch(undefined),
	startDate: isoDate.optional().catch(undefined),
	endDate: isoDate.optional().catch(undefined),
});

export type ReportsSearchParams = z.output<typeof reportsSearchSchema>;

/** The address's period with its type settled: absent is Sure's `monthly`. */
export function settledSearch(search: ReportsSearchParams) {
	return {
		periodType: search.periodType ?? DEFAULT_REPORT_PERIOD_TYPE,
		startDate: search.startDate,
		endDate: search.endDate,
	};
}

const shortMonthYear = new Intl.DateTimeFormat(intlLocale, {
	month: "short",
	year: "numeric",
	timeZone: "UTC",
});

/** Sure's `short_month_year` and `%b %Y`: « nov. 2026 », from a day or a month. */
export const shortMonth = (date: string) =>
	shortMonthYear.format(new Date(`${date.slice(0, 7)}-01T00:00:00Z`));

/** Half away from zero, as Ruby's `round` and `Money#format` round. */
function roundHalfAway(value: number): number {
	return Math.sign(value) * Math.round(Math.abs(value));
}

/** Sure's averages: each figure over the number of rows, rounded to the cent as `Money#format`. */
export function averageOf<Row>(rows: readonly Row[], pick: (row: Row) => MinorUnits): MinorUnits {
	const total = rows.reduce((sum, row) => sum + pick(row), 0);

	return toMinorUnits(rows.length === 0 ? 0 : roundHalfAway(total / rows.length));
}

/** Sure's savings rate, `net / income × 100` rounded to `digits` decimals, 0 without income. */
export function savingsRate(row: { income: MinorUnits; net: MinorUnits }, digits: 0 | 1): number {
	if (row.income <= 0) {
		return 0;
	}

	const scale = 10 ** digits;

	return roundHalfAway((row.net * 100 * scale) / row.income) / scale;
}

/** A side's share of its total, in percent, rounded to `digits` decimals as Sure's rows. */
export function shareOf(amount: MinorUnits, total: MinorUnits, digits: 0 | 1): number {
	if (total === 0) {
		return 0;
	}

	const scale = 10 ** digits;

	return roundHalfAway((amount * 100 * scale) / total) / scale;
}

/** Sure's `period_label`: « novembre 2026 », « Q4 2026 », « juin 2026 – nov. 2026 ». */
export function periodLabelText(label: ReportPeriodLabel, t: TFunction): string {
	if (label.kind === "monthly") {
		return monthLabel(label.month);
	}

	if (label.kind === "quarterly") {
		return t("reports.periodLabel.quarterly", { quarter: label.quarter, year: label.year });
	}

	if (label.kind === "ytd") {
		return t("reports.periodLabel.ytd", { year: label.year });
	}

	if (label.kind === "past_year") {
		return String(label.year);
	}

	return t("reports.periodLabel.last6Months", {
		start: shortMonth(label.from),
		end: shortMonth(label.to),
	});
}

const roundTenth = (value: number) => Math.round(value * 10) / 10;

/**
 * Sure's `sparkline_points`: an SVG polyline's points for `values` in a
 * `width` × `height` box, empty below two points or when all are zero.
 */
export function sparklinePoints(values: readonly number[], width: number, height: number): string {
	if (values.length < 2 || values.every((value) => value === 0)) {
		return "";
	}

	const max = Math.max(...values);
	const min = Math.min(...values);
	const range = max - min === 0 ? 1 : max - min;

	return values
		.map((value, index) => {
			const x = (index / Math.max(values.length - 1, 1)) * width;
			const y = height - ((value - min) / range) * (height - 2) - 1;

			return `${roundTenth(x)},${roundTenth(y)}`;
		})
		.join(" ");
}

/** Sure's `cumulative_net_values`: the running sum of each month's net. */
export function cumulativeNet(trends: readonly { net: MinorUnits }[]): MinorUnits[] {
	let running = toMinorUnits(0);

	return trends.map((trend) => {
		running = toMinorUnits(running + trend.net);

		return running;
	});
}
