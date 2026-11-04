import type { MinorUnits } from "@archant/data/money";

import { formatMoney, formatWholeMoney } from "@/lib/format-money";
import { cn } from "@/lib/utils";

type MoneyProps = {
	amount: MinorUnits;
	currency: string;
	/**
	 * A transaction amount rather than a balance: an inflow gets a plus sign
	 * and the income colour, an outflow stays in the foreground colour.
	 */
	signed?: boolean;
	/**
	 * A signed total, such as a filtered list's: the plus sign of an inflow,
	 * without the colour, since totals are never coloured.
	 */
	plusSign?: boolean;
	/** An amount left out of reports: muted, whatever its sign. */
	muted?: boolean;
	/** Rounded to the whole unit, as Sure's `precision: 0` in its balance sheet. */
	whole?: boolean;
	className?: string;
};

/**
 * Every amount on screen goes through here. Balances and totals render
 * unsigned and uncoloured (DESIGN.md); tabular figures keep a column of
 * amounts aligned on the decimal comma.
 */
export function Money({
	amount,
	currency,
	signed = false,
	plusSign = false,
	muted = false,
	whole = false,
	className,
}: MoneyProps) {
	const inflow = amount > 0;
	const tone = muted
		? "text-muted-foreground"
		: signed && (inflow ? "text-money-income" : "text-money-expense");

	return (
		<span className={cn("font-medium whitespace-nowrap tabular-nums", tone, className)}>
			{(signed || plusSign) && inflow ? "+" : ""}
			{whole ? formatWholeMoney(amount, currency) : formatMoney({ amount, currency })}
		</span>
	);
}
