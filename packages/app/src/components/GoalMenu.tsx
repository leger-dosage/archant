import type { GoalData } from "@/hooks/useGoals";
import type { LucideIcon } from "lucide-react";

import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	CircleCheckBigIcon,
	CirclePauseIcon,
	CirclePlayIcon,
	EllipsisIcon,
	RotateCcwIcon,
	Trash2Icon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { GoalEvent } from "@archant/data/goals";
import { GOAL_EVENTS, goalTransition } from "@archant/data/goals";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Sure's icons for each event of its goal menu. */
const EVENT_ICONS = {
	pause: CirclePauseIcon,
	resume: CirclePlayIcon,
	complete: CircleCheckBigIcon,
	archive: ArchiveIcon,
	restore: ArchiveRestoreIcon,
	reopen: RotateCcwIcon,
} as const satisfies Record<GoalEvent, LucideIcon>;

/** The events the server accepts from the goal's state, in Sure's menu order. */
function allowedEvents(goal: Pick<GoalData, "state" | "kind">): GoalEvent[] {
	return GOAL_EVENTS.filter((event) => goalTransition(goal.state, goal.kind, event) !== null);
}

/**
 * The « … » menu beside a goal's name, as Sure's `goals/show`: the events its
 * state allows, then « Supprimer », which every state allows. The page runs
 * each choice, confirming the ones Sure confirms.
 */
export function GoalMenu({
	goal,
	pending,
	onEvent,
	onDelete,
}: {
	goal: GoalData;
	pending: boolean;
	onEvent: (event: GoalEvent) => void;
	onDelete: () => void;
}) {
	const { t } = useTranslation();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="icon" aria-label={t("goals.menu", { name: goal.name })}>
					<EllipsisIcon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-auto">
				{allowedEvents(goal).map((event) => {
					const Icon = EVENT_ICONS[event];

					return (
						<DropdownMenuItem key={event} disabled={pending} onSelect={() => onEvent(event)}>
							<Icon aria-hidden="true" className="size-3.5" />
							{t(`goals.events.${event}.action`)}
						</DropdownMenuItem>
					);
				})}
				<DropdownMenuSeparator />
				<DropdownMenuItem variant="destructive" onSelect={onDelete}>
					<Trash2Icon aria-hidden="true" className="size-3.5" />
					{t("goals.delete")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
