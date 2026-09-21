import type { MinorUnits } from "@archant/data/money";
import { formatMoney } from "@archant/data/money";

import { cn } from "@/lib/utils";

type MoneyProps = {
	amount: MinorUnits;
	currency: string;
	/**
	 * A transaction amount rather than a balance: an inflow gets a plus sign
	 * and the income colour, an outflow stays in the foreground colour.
	 */
	signed?: boolean;
	className?: string;
};

/**
 * Every amount on screen goes through here. Balances and totals render
 * unsigned and uncoloured (DESIGN.md); tabular figures keep a column of
 * amounts aligned on the decimal comma.
 */
export function Money({ amount, currency, signed = false, className }: MoneyProps) {
	const inflow = signed && amount > 0;

	return (
		<span
			className={cn(
				"font-medium whitespace-nowrap tabular-nums",
				signed && (inflow ? "text-money-income" : "text-money-expense"),
				className,
			)}
		>
			{inflow ? "+" : ""}
			{formatMoney({ amount, currency })}
		</span>
	);
}
