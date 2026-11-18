import type { GoalIndicatorsData } from "@/hooks/useGoals";

import { useTranslation } from "react-i18next";

import { LeftOutNotice } from "@/components/LeftOutNotice";
import { Money } from "@/components/Money";
import { formatTenthPercent } from "@/lib/percent";

const TILE = "flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4";
const LABEL = "text-sm font-medium text-muted-foreground";
const AMOUNT = "text-2xl font-medium tabular-nums";
const DETAIL = "text-xs text-muted-foreground";

export function GoalIndicators({ data }: { data: GoalIndicatorsData }) {
	const { t } = useTranslation();
	const delta = data.contributed - data.priorContribution;
	const comparison =
		data.priorContribution === 0
			? t("goals.indicators.firstWindow")
			: delta === 0
				? t("goals.indicators.flat")
				: t(delta > 0 ? "goals.indicators.up" : "goals.indicators.down", {
						percent: formatTenthPercent((Math.abs(delta) / Math.abs(data.priorContribution)) * 100),
					});

	return (
		<ul aria-label={t("goals.indicators.label")} className="grid gap-3 md:grid-cols-3">
			<li className={TILE}>
				<p className={LABEL}>{t("goals.indicators.contributed")}</p>
				<Money amount={data.contributed} currency={data.currency} className={AMOUNT} />
				<p className={DETAIL}>{comparison}</p>
				<LeftOutNotice accounts={data.contributionLeftOut} />
			</li>
			<li className={TILE}>
				<p className={LABEL}>{t("goals.indicators.needed")}</p>
				<Money amount={data.monthlyNeeded} currency={data.currency} className={AMOUNT} />
				<p className={DETAIL}>{t("goals.indicators.behind", { count: data.behind })}</p>
				<LeftOutNotice accounts={data.monthlyLeftOut} />
			</li>
			<li className={TILE}>
				<p className={LABEL}>{t("goals.indicators.onTrack")}</p>
				<p className={AMOUNT}>
					{t("goals.indicators.fraction", { onTrack: data.onTrack, total: data.tracked })}
				</p>
				{data.paceUnknown > 0 && (
					<p className={DETAIL}>{t("goals.indicators.paceUnknown", { count: data.paceUnknown })}</p>
				)}
			</li>
		</ul>
	);
}
