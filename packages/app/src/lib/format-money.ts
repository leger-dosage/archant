import type { Money } from "@archant/data/money";
import { formatMoney as formatMoneyIn } from "@archant/data/money";

import { intlLocale } from "@/lib/locale";

/** `formatMoney` in the language of this page: `1 234,56 €`, or `€1,234.56`. */
export function formatMoney(money: Money): string {
	return formatMoneyIn(money, intlLocale);
}
