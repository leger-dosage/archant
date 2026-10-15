import { useTranslation } from "react-i18next";

import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import { INVESTMENT_REGIONS, kindOf } from "@/lib/account-kinds";

/**
 * The investment choices of a « Type » select: the blank one first, as
 * Sure's `include_blank`, then one group per region under Sure's region name,
 * each subtype read by Sure's long label, as Sure's
 * `Investment.subtypes_grouped_for_select`.
 */
export function InvestmentKindGroups({ blankLabel }: { blankLabel: string }) {
	const { t } = useTranslation();

	return (
		<>
			<SelectItem value={kindOf("investment", null)}>{blankLabel}</SelectItem>
			{INVESTMENT_REGIONS.map((region) => (
				<SelectGroup key={region.id}>
					<SelectLabel>{t(`accounts.subtypeRegions.${region.id}`)}</SelectLabel>
					{region.kinds.map((kind) => (
						<SelectItem key={kind} value={kind}>
							{t(`accounts.subtypeLongs.${kind}`)}
						</SelectItem>
					))}
				</SelectGroup>
			))}
		</>
	);
}
