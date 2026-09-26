import type { NetWorthData } from "@/hooks/useNetWorth";

import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { BalancePeriod } from "@archant/api/schemas/balances";

import { BalanceChart, PeriodToggle, changeText } from "@/components/BalanceChart";
import { Money } from "@/components/Money";
import { Skeleton } from "@/components/ui/skeleton";
import { useNetWorth } from "@/hooks/useNetWorth";

const listFormat = new Intl.ListFormat("fr");

/**
 * « +2,1 % sur 3 mois » after a trend arrow. Only the arrow takes the trend
 * colour; the sign already says which way, so the arrow is decoration.
 */
function NetWorthChange({ data }: { data: NetWorthData }) {
	const { t } = useTranslation();

	if (data.change === null) {
		return null;
	}

	const Arrow =
		data.change.amount > 0 ? TrendingUpIcon : data.change.amount < 0 ? TrendingDownIcon : null;

	return (
		<p className="flex items-center gap-1.5 text-xs">
			{Arrow !== null && (
				<Arrow
					aria-hidden="true"
					className={`size-3.5 shrink-0 ${data.change.amount > 0 ? "text-trend-up" : "text-trend-down"}`}
				/>
			)}
			<span className="font-medium tabular-nums">
				{t("dashboard.change", {
					change: changeText(t, data.change, data.currency),
					over: t(`balances.over.${data.period}`),
				})}
			</span>
		</p>
	);
}

function Total({
	label,
	amount,
	currency,
}: {
	label: string;
	amount: NetWorthData["assets"];
	currency: string;
}) {
	return (
		<div role="group" aria-label={label} className="flex flex-col gap-0.5">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd>
				<Money amount={amount} currency={currency} />
			</dd>
		</div>
	);
}

/**
 * The household's net worth over a period: the value, its change, the two
 * group totals, then the area chart with its summary and table.
 */
export function NetWorthSection({
	period,
	onPeriodChange,
}: {
	period: BalancePeriod;
	onPeriodChange: (period: BalancePeriod) => void;
}) {
	const { t } = useTranslation();
	const netWorth = useNetWorth(period);
	const data = netWorth.data;

	return (
		<section
			aria-labelledby="net-worth-heading"
			className="flex flex-col rounded-lg border bg-section"
		>
			<div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
				<h2 id="net-worth-heading" className="type-title">
					{t("dashboard.netWorth")}
				</h2>
				<PeriodToggle period={period} onPeriodChange={onPeriodChange} />
			</div>
			<div className="flex flex-col gap-4 p-4">
				<div className="flex flex-wrap items-end justify-between gap-4">
					<div role="group" aria-labelledby="net-worth-heading" className="flex flex-col gap-1">
						{netWorth.isPending && <Skeleton className="h-9 w-48" aria-hidden="true" />}
						{data !== undefined && (
							<>
								<Money amount={data.netWorth} currency={data.currency} className="amount-hero" />
								<NetWorthChange data={data} />
							</>
						)}
					</div>
					{data !== undefined && (
						<dl className="flex flex-wrap gap-8">
							<Total label={t("dashboard.assets")} amount={data.assets} currency={data.currency} />
							<Total
								label={t("dashboard.liabilities")}
								amount={data.liabilities}
								currency={data.currency}
							/>
						</dl>
					)}
				</div>
				<BalanceChart
					history={netWorth}
					summaryKey="dashboard.summary"
					valueLabel={t("dashboard.netWorth")}
				/>
				{data !== undefined && data.leftOut.length > 0 && (
					<p className="text-xs text-muted-foreground">
						{t("dashboard.leftOut", {
							names: listFormat.format(data.leftOut.map((account) => account.name)),
						})}
					</p>
				)}
			</div>
		</section>
	);
}
