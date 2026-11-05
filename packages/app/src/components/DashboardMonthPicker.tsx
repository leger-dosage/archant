import { ChevronDownIcon, InfoIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { capitalised, pickerMonths } from "@/lib/dashboard-months";
import { monthLabel, toIsoMonth } from "@/lib/dates";

/**
 * Sure's `period_scope_hint` and month menu of « Entrées / sorties d'argent »
 * and « Dépenses »: this month and the eleven before it, the one shown
 * checked and named on the trigger. The widget's month is its own, apart
 * from the dashboard's period, as the hint says.
 */
export function DashboardMonthPicker({
	month,
	hint,
	onPick,
}: {
	month: string;
	hint: string;
	onPick: (month: string) => void;
}) {
	const { t } = useTranslation();
	const months = pickerMonths(toIsoMonth());
	const label = capitalised(monthLabel(month));

	return (
		<div className="flex items-center gap-2">
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="ghost" size="icon-sm" aria-label={hint}>
						<InfoIcon aria-hidden="true" className="text-muted-foreground" />
					</Button>
				</TooltipTrigger>
				<TooltipContent className="max-w-64">{hint}</TooltipContent>
			</Tooltip>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="outline"
						size="sm"
						aria-label={t("dashboard.monthPicker", { month: label })}
					>
						<span className="whitespace-nowrap">{label}</span>
						<ChevronDownIcon aria-hidden="true" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="max-h-72 w-auto min-w-40 overflow-y-auto">
					<DropdownMenuRadioGroup value={month} onValueChange={onPick}>
						{months.map((each) => (
							<DropdownMenuRadioItem key={each} value={each}>
								{capitalised(monthLabel(each))}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
