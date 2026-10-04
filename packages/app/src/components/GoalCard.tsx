import type { Status } from "@/components/StatusBadge";
import type { GoalData, GoalStatus } from "@/hooks/useGoals";
import type { TFunction } from "i18next";

import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { formatMoney } from "@archant/data/money";

import { ProgressRing } from "@/components/ProgressRing";
import { StatusBadge } from "@/components/StatusBadge";
import { formatShortDate } from "@/lib/balance-change";

const GOAL_BADGES = {
	behind: "goalBehind",
	on_track: "goalOnTrack",
	no_target_date: "goalNoTargetDate",
	reached: "goalReached",
} as const satisfies Record<GoalStatus, Status>;

const STATE_BADGES = {
	paused: "goalPaused",
	completed: "goalCompleted",
	archived: "goalArchived",
} as const satisfies Record<Exclude<GoalData["state"], "active">, Status>;

/** An active goal's progress status, or the state of one that is not active. */
export function goalBadge(goal: Pick<GoalData, "state" | "status">): Status {
	return goal.state === "active" ? GOAL_BADGES[goal.status] : STATE_BADGES[goal.state];
}

/** « 200 € sur 1 000 € », what is saved against the target. */
function savedOf(goal: GoalData, t: TFunction): string {
	return t("goals.savedOf", {
		saved: formatMoney({ amount: goal.saved, currency: goal.currency }),
		target: formatMoney({ amount: goal.targetAmount, currency: goal.currency }),
	});
}

/**
 * One goal in the list, as Sure's card: its ring, its name, saved against
 * target, its status, or its state when it is not active, and what to put
 * aside each month by its date, when it has one: « Sans échéance » already
 * says it has none. The whole card leads to the goal's page.
 */
export function GoalCard({ goal }: { goal: GoalData }) {
	const { t } = useTranslation();
	// A reached goal asks for nothing more, nor one that stopped saving.
	const monthly = goal.state === "active" && goal.remaining > 0 ? goal.monthlyNeeded : null;

	return (
		<Link
			to="/goals/$goalId"
			params={{ goalId: goal.id }}
			data-goal-id={goal.id}
			className="flex h-full items-center gap-4 rounded-xl border bg-card p-4 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
		>
			<ProgressRing
				percent={goal.percent}
				subject={{ kind: "category", color: goal.color, icon: goal.icon }}
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<h2 className="truncate card-title">{goal.name}</h2>
				<p className="tabular-nums">{savedOf(goal, t)}</p>
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
					<StatusBadge status={goalBadge(goal)} />
					{monthly !== null && (
						<span className="tabular-nums">
							{t("goals.monthly", {
								amount: formatMoney({ amount: monthly, currency: goal.currency }),
							})}
						</span>
					)}
					{goal.targetDate !== null && (
						<span>{t("goals.until", { date: formatShortDate(goal.targetDate) })}</span>
					)}
				</div>
			</div>
		</Link>
	);
}
