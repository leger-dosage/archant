import type { GoalsSummaryData } from "@/hooks/useGoals";

import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { formatMoney } from "@archant/data/money";

import { goalBadge } from "@/components/GoalCard";
import { LeftOutNotice } from "@/components/LeftOutNotice";
import { Money } from "@/components/Money";
import { Section } from "@/components/Section";
import { StatusBadge } from "@/components/StatusBadge";
import { TintedIcon } from "@/components/TintedIcon";
import { useGoalsSummary } from "@/hooks/useGoals";

/** A share of a whole as a bar's width, 0 to 100 %. */
function widthOf(part: number, whole: number): string {
	return `${whole > 0 ? Math.min(Math.max((part / whole) * 100, 0), 100) : 0}%`;
}

/** Sure's thin bar; the figures beside it say the same in words. */
function Bar({ part, whole, size }: { part: number; whole: number; size: "md" | "sm" }) {
	return (
		<div
			aria-hidden="true"
			className={`${size === "md" ? "h-1.5" : "h-1"} overflow-hidden rounded-full bg-badge`}
		>
			<div className="h-full rounded-full bg-foreground" style={{ width: widthOf(part, whole) }} />
		</div>
	);
}

function Goals({ summary }: { summary: GoalsSummaryData }) {
	const { t } = useTranslation();
	const listId = useId();

	return (
		<div className="flex flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<p className="flex flex-wrap items-baseline gap-x-2">
					<Money
						amount={summary.saved}
						currency={summary.currency}
						className="text-3xl font-medium"
					/>
					<span className="text-sm text-muted-foreground">
						{t("dashboard.goals.ofTargets", {
							target: formatMoney({ amount: summary.target, currency: summary.currency }),
						})}
					</span>
				</p>
				<p className="text-xs text-muted-foreground">
					{t("dashboard.goals.count", { count: summary.count })}
					{" · "}
					{summary.behind > 0
						? t("dashboard.goals.behind", { count: summary.behind })
						: t("dashboard.goals.onPace")}
				</p>
				<Bar part={summary.saved} whole={summary.target} size="md" />
				<LeftOutNotice accounts={summary.leftOut} />
			</div>
			<div className="flex flex-col gap-1">
				<p id={listId} className="type-overline text-muted-foreground">
					{t("dashboard.goals.list")}
				</p>
				<ul aria-labelledby={listId} className="flex flex-col divide-y divide-line">
					{summary.goals.map((goal) => (
						<li key={goal.id} className="flex items-center gap-3 py-2.5">
							<TintedIcon subject={{ kind: "category", color: goal.color, icon: goal.icon }} />
							<div className="flex min-w-0 flex-1 flex-col gap-1">
								<div className="flex min-w-0 items-center gap-2">
									<Link
										to="/goals/$goalId"
										params={{ goalId: goal.id }}
										className="truncate font-medium hover:underline"
									>
										{goal.name}
									</Link>
									<StatusBadge status={goalBadge(goal)} />
								</div>
								<Bar part={goal.saved} whole={goal.targetAmount} size="sm" />
							</div>
							<span className="shrink-0 text-xs tabular-nums">
								<Money amount={goal.saved} currency={goal.currency} />
								<span className="text-muted-foreground">
									{" / "}
									{formatMoney({ amount: goal.targetAmount, currency: goal.currency })}
								</span>
							</span>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}

/**
 * « Objectifs », Sure's « Vos objectifs » card from its Plan page, on the
 * dashboard since Archant has no Plan page: the goals that hold their money,
 * how much they saved against their targets in the reporting currency, how
 * many are behind, and the first five. Nothing until such a goal exists.
 */
export function GoalsSection() {
	const { t } = useTranslation();
	const summary = useGoalsSummary();
	const data = summary.data;

	// The goals page says what failed; the dashboard stays quiet.
	if (data === undefined || data.count === 0) {
		return null;
	}

	return (
		<Section
			title={t("dashboard.goals.title")}
			action={
				<Link to="/goals" className="text-sm text-link hover:underline">
					{t("dashboard.goals.all")}
				</Link>
			}
		>
			<Goals summary={data} />
		</Section>
	);
}
