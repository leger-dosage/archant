import { useTranslation } from "react-i18next";

import type { BalancePeriod } from "@archant/api/schemas/balances";
import { BALANCE_PERIODS } from "@archant/api/schemas/balances";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

function isPeriod(value: string): value is BalancePeriod {
	return BALANCE_PERIODS.some((period) => period === value);
}

/** The « 1 M, 3 M, 6 M, 1 A, Tout » segmented control. */
export function PeriodToggle({
	period,
	onPeriodChange,
}: {
	period: BalancePeriod;
	onPeriodChange: (period: BalancePeriod) => void;
}) {
	const { t } = useTranslation();

	return (
		<ToggleGroup
			type="single"
			variant="outline"
			size="sm"
			spacing={0}
			aria-label={t("balances.period")}
			value={period}
			// Radix reports an empty value when the pressed item is pressed
			// again; a period is always selected.
			onValueChange={(value) => {
				if (isPeriod(value)) {
					onPeriodChange(value);
				}
			}}
		>
			{BALANCE_PERIODS.map((option) => (
				<ToggleGroupItem key={option} value={option}>
					{t(`balances.periods.${option}`)}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}
