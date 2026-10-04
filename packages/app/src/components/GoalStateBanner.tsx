import type { GoalData } from "@/hooks/useGoals";
import type { LucideIcon } from "lucide-react";

import { ArchiveIcon, CircleCheckBigIcon, CirclePauseIcon } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { GoalEvent } from "@archant/data/goals";
import { formatMoney } from "@archant/data/money";

import { Button } from "@/components/ui/button";

/** What each state that is not active says, and the event its button fires, as Sure's banners. */
const BANNERS = {
	paused: { icon: CirclePauseIcon, event: "resume" },
	archived: { icon: ArchiveIcon, event: "restore" },
	completed: { icon: CircleCheckBigIcon, event: "archive" },
} as const satisfies Record<
	Exclude<GoalData["state"], "active">,
	{ icon: LucideIcon; event: GoalEvent }
>;

/**
 * Sure's banner above a goal that is not active: paused, with « Reprendre
 * l'objectif »; archived, with « Restaurer l'objectif »; completed, with
 * « Archiver l'objectif ». A viewer reads it without the button.
 */
export function GoalStateBanner({
	goal,
	pending,
	onEvent,
}: {
	goal: GoalData;
	pending: boolean;
	/** `null` for a viewer. */
	onEvent: ((event: GoalEvent) => void) | null;
}) {
	const { t } = useTranslation();
	const titleId = useId();

	if (goal.state === "active") {
		return null;
	}

	const { icon: Icon, event } = BANNERS[goal.state];
	const money = (amount: GoalData["saved"]) => formatMoney({ amount, currency: goal.currency });

	return (
		<section
			aria-labelledby={titleId}
			className="flex flex-wrap items-start gap-3 rounded-xl border bg-card p-4"
		>
			<Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<h2 id={titleId} className="font-medium">
					{t(`goals.banner.${goal.state}.title`)}
				</h2>
				<p className="text-muted-foreground">
					{t(`goals.banner.${goal.state}.body`, {
						saved: money(goal.saved),
						target: money(goal.targetAmount),
					})}
				</p>
			</div>
			{onEvent !== null && (
				<Button size="sm" disabled={pending} onClick={() => onEvent(event)}>
					{t(`goals.banner.${goal.state}.action`)}
				</Button>
			)}
		</section>
	);
}
