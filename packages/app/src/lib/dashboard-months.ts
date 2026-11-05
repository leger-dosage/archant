import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { shiftMonth } from "@archant/data/months";

/** Sure's `month_picker_months`: this month, then the eleven before it. */
export function pickerMonths(current: string): string[] {
	return Array.from({ length: 12 }, (_, index) => shiftMonth(current, -index));
}

/** « novembre 2026 » as « Novembre 2026 », Sure's `.capitalize` on a month's name. */
export function capitalised(text: string): string {
	return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/**
 * Sure's spending delta, on the unsigned figures it shows: what the month
 * spent beyond the previous one, negative when it spent less. The API signs
 * both totals as expenses (AD-5).
 */
export function spendingDelta(current: MinorUnits, previous: MinorUnits): MinorUnits {
	return toMinorUnits(Math.abs(current) - Math.abs(previous));
}

/**
 * The accounts a money flow row's drill-down filters on, as Sure's
 * `drilldown_account_ids`: none when the widget's accounts are every account
 * the list would show without a filter, else the widget's own, so the list
 * never shows rows outside the totals.
 */
export function drilldownAccounts(
	widget: readonly string[],
	everyAccount: readonly string[],
): string[] | undefined {
	const listed = new Set(everyAccount);

	return widget.length === listed.size && widget.every((id) => listed.has(id))
		? undefined
		: [...widget];
}
