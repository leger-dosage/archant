import type { GoalsSummaryData } from "@/hooks/useGoals";

import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { goalBadge } from "@/components/GoalCard";
import { GoalDialog } from "@/components/GoalDialog";
import { LeftOutNotice } from "@/components/LeftOutNotice";
import { Money } from "@/components/Money";
import { PlanProgress } from "@/components/PlanProgress";
import { Section } from "@/components/Section";
import { StatusBadge } from "@/components/StatusBadge";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFundableAccounts, useGoalsSummary } from "@/hooks/useGoals";
import { useCanWrite } from "@/hooks/usePermissions";
import { errorCodeOf } from "@/lib/api";
import { formatMoney } from "@/lib/format-money";
import { percentOf } from "@/lib/plan-summary";

function Goals({ summary }: { summary: GoalsSummaryData }) {
	const { t } = useTranslation();
	const listId = useId();

	return (
		<>
			<div className="flex flex-col gap-2">
				<p className="flex flex-wrap items-baseline gap-x-2">
					<Money amount={summary.saved} currency={summary.currency} className="amount-hero" />
					<span className="text-sm text-muted-foreground">
						{summary.target === null
							? t("plan.goals.targetOutOfRange")
							: t("plan.goals.ofTargets", {
									target: formatMoney({ amount: summary.target, currency: summary.currency }),
								})}
					</span>
				</p>
				<p className="text-xs text-muted-foreground">
					{t("plan.goals.count", { count: summary.count })}
					{summary.behind > 0 && ` · ${t("plan.goals.behind", { count: summary.behind })}`}
					{summary.paceUnknown > 0 &&
						` · ${t("plan.goals.paceUnknown", { count: summary.paceUnknown })}`}
					{summary.behind === 0 && summary.paceUnknown === 0 && ` · ${t("plan.goals.onPace")}`}
				</p>
				{summary.target !== null && (
					<PlanProgress percent={percentOf(summary.saved, summary.target)} />
				)}
				<LeftOutNotice accounts={summary.leftOut} />
			</div>
			<div className="flex flex-col gap-1">
				<h3 id={listId} className="type-overline text-muted-foreground">
					{t("plan.goals.list")}
				</h3>
				<ul aria-labelledby={listId} className="flex flex-col divide-y divide-line">
					{summary.goals.map((goal) => (
						<li key={goal.id} className="flex items-center gap-3 py-2.5">
							<TintedIcon
								subject={{ kind: "goal", color: goal.color, icon: goal.icon, name: goal.name }}
							/>
							<div className="flex min-w-0 flex-1 flex-col gap-1">
								<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
									<Link
										to="/goals/$goalId"
										params={{ goalId: goal.id }}
										className="truncate font-medium hover:underline"
									>
										{goal.name}
									</Link>
									<StatusBadge status={goalBadge(goal)} />
								</div>
								<PlanProgress percent={percentOf(goal.saved, goal.targetAmount)} className="h-1" />
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
		</>
	);
}

function NewGoal() {
	const { t } = useTranslation();
	const fundable = useFundableAccounts();
	const [open, setOpen] = useState(false);

	return (
		<>
			<Button
				size="sm"
				variant="outline"
				onClick={() => setOpen(true)}
				disabled={fundable.data === undefined}
			>
				<PlusIcon aria-hidden="true" />
				{t("goals.add")}
			</Button>
			{open && fundable.data !== undefined && (
				<GoalDialog
					open={open}
					onOpenChange={setOpen}
					accounts={fundable.data.accounts}
					reportingCurrency={fundable.data.reportingCurrency}
				/>
			)}
		</>
	);
}

export function PlanGoals() {
	const { t } = useTranslation();
	const canWrite = useCanWrite();
	const summary = useGoalsSummary();

	return (
		<Section title={t("plan.goals.title")} action={canWrite ? <NewGoal /> : undefined}>
			<div className="flex flex-1 flex-col gap-4 p-4">
				{summary.isPending && <Skeleton aria-hidden="true" className="h-20" />}
				{summary.isError && summary.data === undefined && (
					<div role="alert" className="space-y-2">
						<p className="text-muted-foreground">{t(`errors.${errorCodeOf(summary.error)}`)}</p>
						<Button variant="outline" onClick={() => void summary.refetch()}>
							{t("common.retry")}
						</Button>
					</div>
				)}
				{summary.data !== undefined &&
					(summary.data.count === 0 ? (
						<p className="my-auto py-4 text-center text-muted-foreground">
							{t("plan.goals.empty")}
						</p>
					) : (
						<Goals summary={summary.data} />
					))}
				<Button variant="outline" asChild className="mt-auto w-full">
					<Link to="/goals">
						{t("plan.goals.all")}
						<ChevronRightIcon aria-hidden="true" />
					</Link>
				</Button>
			</div>
		</Section>
	);
}
