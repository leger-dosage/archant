import type { MinorUnits } from "@archant/data/money";
import { formatMoney } from "@archant/data/money";

import { cn } from "@/lib/utils";

type MoneyProps = {
	amount: MinorUnits;
	currency: string;
	className?: string;
};

/**
 * Every amount on screen goes through here. Balances and totals render
 * unsigned and uncoloured (DESIGN.md); tabular figures keep a column of
 * amounts aligned on the decimal comma.
 */
export function Money({ amount, currency, className }: MoneyProps) {
	return (
		<span className={cn("font-medium whitespace-nowrap tabular-nums", className)}>
			{formatMoney({ amount, currency })}
		</span>
	);
}
