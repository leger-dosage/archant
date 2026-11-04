import type { ChartPeriod } from "@/lib/periods";

import { ChevronDownIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { SurePeriod } from "@archant/data/periods";
import { SURE_PERIODS } from "@archant/data/periods";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toIsoDate } from "@/lib/dates";
import { rangeLabel } from "@/lib/periods";

// Never one of Sure's keys, so the custom row cannot be mistaken for a period.
const CUSTOM = "custom";

/**
 * Sure's `UI::PeriodPicker`: a menu of its periods under their short labels,
 * the selected one checked and named on the trigger. A custom range, dragged
 * on a chart, gets a last row of its own so one row is always checked, and
 * the trigger shows its days. `options` narrows the menu, as the loan chart's
 * does, and then offers no custom row: that chart cannot show one.
 */
export function PeriodPicker({
	selected,
	options,
	onPick,
}: {
	selected: ChartPeriod;
	options?: readonly SurePeriod[];
	onPick: (period: SurePeriod) => void;
}) {
	const { t } = useTranslation();
	const custom = "startDate" in selected;
	const customRow = options === undefined && custom;
	const label = custom
		? rangeLabel(t, selected.startDate, selected.endDate, toIsoDate())
		: t(`periods.${selected.period}.short`);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="sm" aria-label={t("periods.ariaLabel", { period: label })}>
					<span className="whitespace-nowrap">{label}</span>
					<ChevronDownIcon aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-auto min-w-36">
				<DropdownMenuRadioGroup
					value={custom ? CUSTOM : selected.period}
					onValueChange={(value) => {
						// The custom row stands for the range already shown; picking it changes nothing.
						const period = SURE_PERIODS.find((key) => key === value);

						if (period !== undefined) {
							onPick(period);
						}
					}}
				>
					{(options ?? SURE_PERIODS).map((key) => (
						<DropdownMenuRadioItem key={key} value={key}>
							{t(`periods.${key}.short`)}
						</DropdownMenuRadioItem>
					))}
					{customRow && (
						<DropdownMenuRadioItem value={CUSTOM}>
							{t("periods.custom.short")}
						</DropdownMenuRadioItem>
					)}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
