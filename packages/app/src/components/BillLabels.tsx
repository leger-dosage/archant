import type { BillRowData, RecurringData } from "@/hooks/useRecurring";
import type { TFunction } from "i18next";

import { useTranslation } from "react-i18next";

import type { MinorUnits } from "@archant/data/money";
import { formatMoney, toMinorUnits } from "@archant/data/money";

import { formatSignedPercent } from "@/lib/balance-change";
import { dayAndMonth, daysFrom } from "@/lib/dates";
import { cn } from "@/lib/utils";

const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });

/** An occurrence paid, skipped or missed: its status, never its dates, says what it is. */
export const isClosed = (row: Pick<BillRowData, "state">) =>
	row.state === "paid" || row.state === "skipped" || row.state === "missed";

/** An occurrence still open that payments have started to settle. */
export const isPartial = (row: BillRowData) =>
	!isClosed(row) && row.confirmed > 0 && row.remaining > 0;

/**
 * Sure's `occurrence_due_label`, relative first and snooze-aware: « Reportée
 * au 12 octobre », « 3 jours de retard, échéance le 5 octobre », « À payer
 * aujourd'hui », « Échéance le 5 octobre » inside the grace days, « À payer
 * dans 4 jours, 5 novembre ». A closed occurrence names its
 * effective due date only, as Sure's.
 */
export function dueLabel(
	row: Pick<BillRowData, "state" | "days" | "dueOn" | "effectiveDueOn" | "snoozedUntil">,
	t: TFunction,
): string {
	const date = dayAndMonth(row.effectiveDueOn);

	if (isClosed(row)) {
		return t("bills.due.settled", { date });
	}

	if (row.snoozedUntil !== null && row.snoozedUntil > row.dueOn && row.days > 0) {
		return t("bills.due.snoozed", { date });
	}

	if (row.state === "overdue") {
		return t("bills.due.overdue", { count: -row.days, date });
	}

	if (row.days === 0) {
		return t("bills.due.today");
	}

	return row.days < 0
		? t("bills.due.since", { date })
		: t("bills.due.upcoming", { count: row.days, date });
}

/** « Partiel · 120,00 € restant », Sure's attention reason for a partial occurrence. */
export function PartialLabel({ row }: { row: BillRowData }) {
	const { t } = useTranslation();

	return isPartial(row) ? (
		<span className="tabular-nums">
			{t("bills.partial", {
				amount: formatMoney({ amount: row.remaining, currency: row.currency }),
			})}
		</span>
	) : null;
}

/** A matcher score in ten-thousandths, as « 87 % ». */
export const confidenceText = (score: number) => percent.format(score / 10_000);

/**
 * Sure's `bills_match_reasons`: the signals the matcher wrote, in words.
 * The account signal is never said: every candidate shares it.
 */
export function MatchReasons({
	signals,
	currency,
	expected,
	actual,
	dueOn,
	paidOn,
}: {
	signals: {
		merchant?: number | undefined;
		name?: number | undefined;
		amount?: number | undefined;
		date?: number | undefined;
	};
	currency: string;
	expected: MinorUnits;
	/** The transaction's magnitude; `null` once it was deleted. */
	actual: MinorUnits | null;
	dueOn: string;
	paidOn: string | null;
}) {
	const { t } = useTranslation();
	const reasons: string[] = [];

	if (signals.merchant !== undefined) {
		reasons.push(t("bills.match.merchant"));
	}

	if (signals.name !== undefined) {
		reasons.push(t("bills.match.name"));
	}

	if (signals.amount !== undefined && actual !== null) {
		const gap = Math.abs(actual - expected);

		reasons.push(
			gap === 0
				? t("bills.match.exactAmount")
				: t("bills.match.amountOff", {
						amount: formatMoney({ amount: toMinorUnits(gap), currency }),
					}),
		);
	}

	if (signals.date !== undefined && paidOn !== null) {
		const days = daysFrom(dueOn, paidOn);

		reasons.push(
			days === 0
				? t("bills.match.onDate")
				: days < 0
					? t("bills.match.before", { count: -days })
					: t("bills.match.after", { count: days }),
		);
	}

	return reasons.length === 0 ? null : (
		<ul aria-label={t("bills.match.label")} className="flex flex-wrap gap-1.5">
			{reasons.map((reason) => (
				<li
					key={reason}
					className="rounded-md bg-badge px-1.5 py-0.5 text-xs text-foreground-secondary"
				>
					{reason}
				</li>
			))}
		</ul>
	);
}

/**
 * A series' current occurrence: « Payée » once closed, « 3 jours de retard »
 * past its grace days, else « À payer le 5 novembre ».
 */
export function CurrentOccurrence({
	occurrence,
}: {
	occurrence: NonNullable<RecurringData["currentOccurrence"]>;
}) {
	const { t } = useTranslation();

	if (occurrence.status !== "scheduled") {
		return <span>{t(`recurring.occurrence.${occurrence.status}`)}</span>;
	}

	return occurrence.state === "overdue" ? (
		<span className="text-destructive">
			{t("recurring.occurrence.overdue", { count: occurrence.daysLate ?? 0 })}
		</span>
	) : (
		<span>{t("recurring.occurrence.due", { date: dayAndMonth(occurrence.effectiveDueOn) })}</span>
	);
}

/**
 * Sure's price change line, « 13,49 € → 15,99 € (+18,5 %) », a rise in the
 * warning tone and a fall in the income one. `percent` is in tenths.
 */
export function PriceChangeAmounts({
	change,
	className,
}: {
	change: { previousAmount: MinorUnits; newAmount: MinorUnits; currency: string; percent: number };
	className?: string;
}) {
	const { t } = useTranslation();

	return (
		<span
			className={cn(
				"text-sm whitespace-nowrap tabular-nums",
				change.newAmount > change.previousAmount ? "text-warning" : "text-money-income",
				className,
			)}
		>
			{t("bills.priceChange", {
				from: formatMoney({ amount: change.previousAmount, currency: change.currency }),
				to: formatMoney({ amount: change.newAmount, currency: change.currency }),
				percent: formatSignedPercent(change.percent / 10),
			})}
		</span>
	);
}
