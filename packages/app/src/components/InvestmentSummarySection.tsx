import type { InvestmentSummaryData } from "@/hooks/useInvestmentSummary";
import type { ChartPeriod } from "@/lib/periods";
import type { TFunction } from "i18next";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ArrowLeftRightIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { LeftOutNotice } from "@/components/LeftOutNotice";
import { Money } from "@/components/Money";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useInvestmentSummary } from "@/hooks/useInvestmentSummary";
import { errorCodeOf } from "@/lib/api";
import { formatShare } from "@/lib/trade-format";
import { cn } from "@/lib/utils";

type Summary = Extract<InvestmentSummaryData, { available: true }>;

/** Sure's `truncate(name, length: 20)`: 17 characters and an ellipsis past 20. */
const NAME_LENGTH = 20;

function truncated(name: string): string {
	const characters = Array.from(name);

	return characters.length > NAME_LENGTH
		? `${characters.slice(0, NAME_LENGTH - 3).join("")}...`
		: name;
}

/** Sure's `Trend#color`: up green, down red, flat grey. */
const TREND_CLASS = {
	up: "text-trend-up",
	down: "text-trend-down",
	flat: "text-muted-foreground",
} as const;

/** Sure's `Trend#percent_formatted`: one decimal, « ＋∞ » or « -∞ » on a zero book value. */
function percentText(t: TFunction, percent: string): string {
	const value = Number(percent);

	if (Number.isFinite(value)) {
		return formatShare(percent);
	}

	return t(
		value > 0
			? "dashboard.investmentSummary.infinityUp"
			: "dashboard.investmentSummary.infinityDown",
	);
}

function TotalReturn({ data }: { data: Summary }) {
	const { t } = useTranslation();

	if (data.totalReturn === null) {
		return null;
	}

	return (
		<p className="flex flex-wrap items-center gap-2 text-sm">
			<span className="text-muted-foreground">{t("dashboard.investmentSummary.totalReturn")}</span>
			<span className={cn("font-medium", TREND_CLASS[data.totalReturn.trend])}>
				<Money amount={data.totalReturn.gain} currency={data.currency} />{" "}
				<span className="tabular-nums">({percentText(t, data.totalReturn.percent)})</span>
			</span>
		</p>
	);
}

function Holdings({ data }: { data: Summary }) {
	const { t } = useTranslation();

	if (data.holdings.length === 0) {
		return null;
	}

	return (
		<div className="mx-4 rounded-xl bg-inset p-1">
			<div className="overflow-hidden rounded-lg border bg-card">
				<Table aria-labelledby="investment-summary-heading">
					<TableHeader className="bg-inset">
						<TableRow className="type-overline text-muted-foreground hover:bg-transparent">
							<TableHead scope="col">{t("dashboard.investmentSummary.holding")}</TableHead>
							<TableHead scope="col" className="text-right">
								{t("dashboard.investmentSummary.weight")}
							</TableHead>
							<TableHead scope="col" className="text-right">
								{t("dashboard.investmentSummary.value")}
							</TableHead>
							<TableHead scope="col" className="text-right">
								{t("dashboard.investmentSummary.return")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody className="font-medium">
						{data.holdings.map((holding) => (
							<TableRow key={holding.security.id}>
								<TableCell className="p-4">
									<div className="flex items-center gap-3">
										{/* Archant stores no logo: Sure's fallback, the ticker's first two letters. */}
										<span
											aria-hidden="true"
											className="grid size-8 shrink-0 place-items-center rounded-full bg-inset text-xs text-muted-foreground"
										>
											{holding.security.ticker?.slice(0, 2) ||
												t("dashboard.investmentSummary.noTicker")}
										</span>
										<div className="max-w-32 min-w-0">
											{holding.security.ticker !== null && (
												<p className="truncate">{holding.security.ticker}</p>
											)}
											<p
												className={cn(
													holding.security.ticker !== null && "text-xs text-muted-foreground",
												)}
												title={holding.security.name}
											>
												{truncated(holding.security.name)}
											</p>
										</div>
									</div>
								</TableCell>
								<TableCell className="p-4 text-right text-muted-foreground tabular-nums">
									{formatShare(holding.weight ?? "0")}
								</TableCell>
								<TableCell className="p-4 text-right">
									<Money amount={holding.amount} currency={data.currency} />
								</TableCell>
								<TableCell className="p-4 text-right tabular-nums">
									{holding.returnPercent === null || holding.returnTrend === null ? (
										<span className="text-muted-foreground">
											{t("dashboard.investmentSummary.none")}
										</span>
									) : (
										<span className={TREND_CLASS[holding.returnTrend]}>
											{percentText(t, holding.returnPercent)}
										</span>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}

function ActivityFigure({
	icon: Icon,
	tone,
	label,
	children,
}: {
	icon: LucideIcon;
	tone: string;
	label: string;
	children: ReactNode;
}) {
	return (
		<div role="group" aria-label={label} className="flex items-center gap-2">
			<span
				aria-hidden="true"
				className={cn("grid size-8 shrink-0 place-items-center rounded-full", tone)}
			>
				<Icon className="size-4" />
			</span>
			<div>
				<p className="text-xs text-muted-foreground">{label}</p>
				<p className="font-medium">{children}</p>
			</div>
		</div>
	);
}

/** Sure's period activity: shown once a trade, a contribution or a withdrawal is above zero. */
function Activity({ data }: { data: Summary }) {
	const { t } = useTranslation();
	const { contributions, withdrawals, trades } = data.activity;

	if (trades === 0 && contributions <= 0 && withdrawals <= 0) {
		return null;
	}

	const period =
		data.period === null ? t("periods.custom.label") : t(`periods.${data.period}.label`);
	const title = t("dashboard.investmentSummary.periodActivity", { period });

	return (
		<div role="group" aria-label={title} className="mx-4 rounded-xl bg-inset p-1">
			<div className="px-4 py-2 type-overline text-muted-foreground">{title}</div>
			<div className="grid grid-cols-1 gap-4 rounded-lg border bg-card p-4 text-sm sm:grid-cols-3">
				<ActivityFigure
					icon={TrendingUpIcon}
					tone="bg-trend-up/10 text-trend-up"
					label={t("dashboard.investmentSummary.contributions")}
				>
					<Money amount={contributions} currency={data.currency} />
				</ActivityFigure>
				<ActivityFigure
					icon={TrendingDownIcon}
					tone="bg-chart-5/10 text-chart-5"
					label={t("dashboard.investmentSummary.withdrawals")}
				>
					<Money amount={withdrawals} currency={data.currency} />
				</ActivityFigure>
				<ActivityFigure
					icon={ArrowLeftRightIcon}
					tone="bg-chart-2/10 text-chart-2"
					label={t("dashboard.investmentSummary.trades")}
				>
					<span className="tabular-nums">{trades}</span>
				</ActivityFigure>
			</div>
		</div>
	);
}

/**
 * Sure's `investment_summary` over the dashboard's period: the portfolio's
 * value, cash included, its total return, the five largest securities
 * rolled up across accounts, and the period's trades. Not shown without an
 * investment account, as Sure's.
 */
export function InvestmentSummarySection({
	period,
	ready,
}: {
	period: ChartPeriod;
	/** False while the saved period loads. */
	ready: boolean;
}) {
	const { t } = useTranslation();
	const summary = useInvestmentSummary(period, ready);
	const data = summary.data;
	const placeholder = summary.isPlaceholderData;

	if (summary.isError) {
		return (
			<Section id="investment-summary-heading" title={t("dashboard.investmentSummary.title")}>
				<div role="alert" className="flex flex-col items-start gap-3 p-4">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(summary.error)}`)}</p>
					<Button variant="outline" onClick={() => void summary.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			</Section>
		);
	}

	if (data === undefined || !data.available) {
		return null;
	}

	return (
		<Section id="investment-summary-heading" title={t("dashboard.investmentSummary.title")}>
			{/* The previous period's activity, shown while the next loads, stays out of reach. */}
			<div
				className={cn("flex flex-col gap-4 pb-4", placeholder && "opacity-60")}
				inert={placeholder}
				aria-busy={placeholder}
			>
				<div
					role="group"
					aria-labelledby="investment-summary-heading"
					className="flex flex-col gap-2 px-4 pt-4"
				>
					<Money amount={data.value} currency={data.currency} className="amount-hero" />
					<TotalReturn data={data} />
				</div>
				<Holdings data={data} />
				<Activity data={data} />
				{data.leftOut.length > 0 && (
					<div className="px-4">
						<LeftOutNotice accounts={data.leftOut} />
					</div>
				)}
			</div>
		</Section>
	);
}
