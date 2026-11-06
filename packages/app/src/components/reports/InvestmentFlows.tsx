import type { ReportsPageData } from "@/hooks/useReportsPage";

import { useTranslation } from "react-i18next";

import { LeftOutNotice } from "@/components/LeftOutNotice";
import { Money } from "@/components/Money";

/** Sure's labeled cash funding, independent from securities bought or sold. */
export function InvestmentFlows({ data }: { data: ReportsPageData }) {
	const { t } = useTranslation();
	const flows = data.investmentFlows;
	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">{t("reports.investmentFlows.description")}</p>
			<div className="grid gap-4 sm:grid-cols-3">
				{(
					[
						["contributions", flows.contributions, "text-trend-up"],
						["withdrawals", flows.withdrawals, "text-chart-5"],
						["netFlow", flows.netFlow, "text-foreground"],
					] as const
				).map(([key, amount, tone]) => (
					<div
						key={key}
						role="group"
						aria-label={t(`reports.investmentFlows.${key}`)}
						className="space-y-2 rounded-lg border p-4"
					>
						<h3 className="text-sm text-muted-foreground">{t(`reports.investmentFlows.${key}`)}</h3>
						<p className={`text-2xl ${tone}`}>
							<Money amount={amount} currency={flows.currency} />
						</p>
						<p className="text-xs text-muted-foreground">
							{t(`reports.investmentFlows.${key}Description`)}
						</p>
					</div>
				))}
			</div>
			<LeftOutNotice accounts={flows.leftOut} />
		</div>
	);
}
