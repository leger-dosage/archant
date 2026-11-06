import type { ReportsPageData } from "@/hooks/useReportsPage";

import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { LeftOutNotice } from "@/components/LeftOutNotice";
import { Money } from "@/components/Money";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { kindOf } from "@/lib/account-kinds";
import { formatReturnPercent, formatShare } from "@/lib/trade-format";

const TREND_CLASS = {
	up: "text-trend-up",
	down: "text-trend-down",
	flat: "text-muted-foreground",
} as const;
type Investments = Extract<ReportsPageData["investments"], { available: true }>;

/** Sure's report summary keeps today's value beside explicitly period-scoped returns and activity. */
export function InvestmentPerformance({ data }: { data: ReportsPageData }) {
	const { t } = useTranslation();
	const investments = data.investments;
	if (!investments.available) {
		return null;
	}
	const { currency } = investments;
	const noData = t("reports.investments.noData");
	const metrics = [
		["portfolioValue", <Money key="value" amount={investments.value} currency={currency} />],
		["totalReturn", <Return key="total" value={investments.totalReturn} currency={currency} />],
		["periodReturn", <Return key="period" value={investments.periodReturn} currency={currency} />],
		[
			"contributions",
			<Money key="contributions" amount={investments.activity.contributions} currency={currency} />,
		],
		[
			"withdrawals",
			<Money key="withdrawals" amount={investments.activity.withdrawals} currency={currency} />,
		],
	] as const;
	return (
		<div className="space-y-6">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
				{metrics.map(([key, value]) => (
					<div
						key={key}
						role="group"
						aria-label={t(`reports.investments.${key}`)}
						className="min-w-0 rounded-lg bg-inset p-4"
					>
						<p className="mb-3 text-sm text-muted-foreground">{t(`reports.investments.${key}`)}</p>
						<p className="text-lg font-semibold">{value}</p>
					</div>
				))}
			</div>
			{investments.holdings.length > 0 && (
				<div className="space-y-3">
					<h3 className="font-medium">{t("reports.investments.topHoldings")}</h3>
					<div className="rounded-xl bg-inset p-1">
						<div className="overflow-hidden rounded-lg border bg-card">
							<Table aria-label={t("reports.investments.topHoldings")}>
								<TableHeader className="bg-inset">
									<TableRow>
										{(["holding", "weight", "value", "return"] as const).map((key, index) => (
											<TableHead key={key} className={index === 0 ? undefined : "text-right"}>
												{t(`reports.investments.${key}`)}
											</TableHead>
										))}
									</TableRow>
								</TableHeader>
								<TableBody>
									{investments.holdings.map((holding) => (
										<TableRow key={holding.security.id}>
											<TableCell>
												<div className="max-w-48 min-w-0">
													<p className="truncate font-medium" title={holding.security.name}>
														{holding.security.ticker ?? holding.security.name}
													</p>
													{holding.security.ticker && (
														<p
															className="truncate text-xs text-muted-foreground"
															title={holding.security.name}
														>
															{holding.security.name}
														</p>
													)}
												</div>
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatShare(holding.weight ?? "0")}
											</TableCell>
											<TableCell className="text-right">
												<Money amount={holding.amount} currency={currency} />
											</TableCell>
											<TableCell
												className={`text-right tabular-nums ${holding.returnTrend === null ? "text-muted-foreground" : TREND_CLASS[holding.returnTrend]}`}
											>
												{holding.returnPercent === null
													? noData
													: formatReturnPercent(t, holding.returnPercent)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</div>
				</div>
			)}
			{investments.gainsByTaxTreatment.length > 0 && (
				<div className="space-y-3">
					<h3 className="font-medium">{t("reports.investments.gainsByTaxTreatment")}</h3>
					<div className="flex flex-wrap gap-4">
						{investments.gainsByTaxTreatment.map((group) => (
							<TaxGains key={group.treatment} group={group} currency={currency} />
						))}
					</div>
				</div>
			)}
			{investments.accounts.length > 0 && (
				<div className="space-y-3">
					<h3 className="font-medium">{t("reports.investments.accounts")}</h3>
					<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{investments.accounts.map((account) => (
							<Link
								key={account.id}
								to="/accounts/$accountId"
								params={{ accountId: account.id }}
								className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-inset p-4 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
							>
								<div className="min-w-0">
									<p className="truncate text-sm font-medium" title={account.name}>
										{account.name}
									</p>
									<p className="text-xs text-muted-foreground">
										{t(`accounts.subtypes.${kindOf(account.type, account.subtype)}`)}
									</p>
								</div>
								<Money amount={account.balance} currency={currency} />
							</Link>
						))}
					</div>
				</div>
			)}
			<LeftOutNotice accounts={investments.leftOut} />
		</div>
	);
}

function Return({ value, currency }: { value: Investments["totalReturn"]; currency: string }) {
	const { t } = useTranslation();
	return value === null ? (
		<span className="text-muted-foreground">{t("reports.investments.noData")}</span>
	) : (
		<span className={TREND_CLASS[value.trend]}>
			<Money amount={value.gain} currency={currency} />{" "}
			<span className="whitespace-nowrap tabular-nums">
				({formatReturnPercent(t, value.percent)})
			</span>
		</span>
	);
}

function TaxGains({
	group,
	currency,
}: {
	group: Investments["gainsByTaxTreatment"][number];
	currency: string;
}) {
	const { t } = useTranslation();
	const gain = (value: Investments["gainsByTaxTreatment"][number]["holdings"][number]["gain"]) =>
		value === null ? (
			<span className="text-muted-foreground">{t("reports.investments.noData")}</span>
		) : (
			<span
				className={value > 0 ? TREND_CLASS.up : value < 0 ? TREND_CLASS.down : TREND_CLASS.flat}
			>
				<Money amount={value} currency={currency} />
			</span>
		);
	return (
		<div
			role="group"
			aria-label={t(`reports.investments.treatments.${group.treatment}`)}
			className="min-w-0 flex-1 basis-64 space-y-3 rounded-lg bg-inset p-4"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<Badge
					variant="secondary"
					title={t(`reports.investments.treatmentDescriptions.${group.treatment}`)}
				>
					{t(`reports.investments.treatments.${group.treatment}`)}
				</Badge>
				<Money amount={group.totalGain} currency={currency} />
			</div>
			<dl className="space-y-2 text-sm">
				{(
					[
						["unrealizedGains", group.unrealizedGain],
						["realizedGains", group.realizedGain],
					] as const
				).map(([key, amount]) => (
					<div key={key} className="flex justify-between gap-3">
						<dt className="text-muted-foreground">{t(`reports.investments.${key}`)}</dt>
						<dd>
							<Money amount={amount} currency={currency} />
						</dd>
					</div>
				))}
			</dl>
			{group.treatment === "taxable" && group.realizedGain > 0 && (
				<p className="text-xs text-chart-5">{t("reports.investments.taxableRealizedNote")}</p>
			)}
			<details className="text-xs">
				<summary className="cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
					{t("reports.investments.viewDetails")} (
					{t("reports.investments.holdingsCount", { count: group.holdings.length })},{" "}
					{t("reports.investments.salesCount", { count: group.sales.length })})
				</summary>
				<div className="mt-3 space-y-3">
					{(
						[
							["holdings", group.holdings],
							["sales", group.sales],
						] as const
					).map(
						([key, rows]) =>
							rows.length > 0 && (
								<div key={key} className="space-y-1">
									<p className="font-medium text-muted-foreground">
										{t(`reports.investments.${key}`)}
									</p>
									{rows.slice(0, 5).map((row, index) => (
										<div key={index} className="flex justify-between gap-3 pl-2">
											<span className="min-w-0 truncate" title={row.security.name}>
												{row.security.ticker ?? row.security.name}
											</span>
											{gain(row.gain)}
										</div>
									))}
									{rows.length > 5 && (
										<p className="pl-2 text-muted-foreground">
											{t("reports.investments.andMore", { count: rows.length - 5 })}
										</p>
									)}
								</div>
							),
					)}
				</div>
			</details>
		</div>
	);
}
