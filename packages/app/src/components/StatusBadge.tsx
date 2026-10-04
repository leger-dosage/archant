import type { LucideIcon } from "lucide-react";

import {
	ArchiveIcon,
	ArrowLeftRightIcon,
	CalendarOffIcon,
	CircleAlertIcon,
	CircleCheckBigIcon,
	CircleCheckIcon,
	CirclePauseIcon,
	ClockAlertIcon,
	ClockIcon,
	HandIcon,
	RefreshCwOffIcon,
	RepeatIcon,
	ShieldAlertIcon,
	ShieldCheckIcon,
	SparklesIcon,
	SplitIcon,
	TrendingUpIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

/**
 * Each status a row names in words: the text carries the meaning, the icon
 * and the tint only repeat it, so nothing rests on colour.
 */
const STATUSES = {
	pending: { icon: ClockIcon, key: "transactions.pending", tone: "neutral" },
	recurring: { icon: RepeatIcon, key: "transactions.recurringBadge", tone: "neutral" },
	transfer: { icon: ArrowLeftRightIcon, key: "transactions.transfer.internal", tone: "neutral" },
	// Neutral: a suggestion waits for a pick but needs no attention.
	transferSuggested: {
		icon: ArrowLeftRightIcon,
		key: "transactions.transfer.suggested",
		tone: "neutral",
	},
	// A split's parent, shown above its lines, as Sure's « Split » pill.
	split: { icon: SplitIcon, key: "transactions.split.badge", tone: "neutral" },
	// The warning tint, which DESIGN.md keeps for states that need attention.
	duplicate: { icon: TriangleAlertIcon, key: "transactions.duplicate.flag", tone: "warning" },
	// A series' state is information, never an alarm: all neutral.
	recurringDetected: { icon: SparklesIcon, key: "recurring.statuses.detected", tone: "neutral" },
	recurringConfirmed: {
		icon: CircleCheckIcon,
		key: "recurring.statuses.confirmed",
		tone: "neutral",
	},
	recurringInactive: { icon: CirclePauseIcon, key: "recurring.statuses.inactive", tone: "neutral" },
	recurringManual: { icon: HandIcon, key: "recurring.manual", tone: "neutral" },
	// What a viewer reads in place of a disabled rule's switch.
	ruleDisabled: { icon: CirclePauseIcon, key: "rules.disabledBadge", tone: "neutral" },
	// A connection that needs the user, as BankAlerts' strip says above the page.
	consentExpiring: { icon: ClockAlertIcon, key: "banks.consentExpiring", tone: "warning" },
	consentExpired: { icon: TriangleAlertIcon, key: "banks.consentExpired", tone: "warning" },
	syncStale: { icon: RefreshCwOffIcon, key: "banks.syncStale", tone: "warning" },
	// A budget's pills, as Sure's: over in the destructive colour, near the
	// limit in the warning one, on track neutral (DESIGN.md).
	budgetOver: { icon: CircleAlertIcon, key: "budgets.status.over", tone: "destructive" },
	budgetNear: { icon: TriangleAlertIcon, key: "budgets.status.near", tone: "warning" },
	budgetOnTrack: { icon: CircleCheckIcon, key: "budgets.status.onTrack", tone: "neutral" },
	// A goal's status, Sure's: a late goal needs attention, never an alarm, so
	// the warning tint rather than the destructive one (DESIGN.md).
	goalBehind: { icon: ClockAlertIcon, key: "goals.status.behind", tone: "warning" },
	goalOnTrack: { icon: TrendingUpIcon, key: "goals.status.on_track", tone: "neutral" },
	goalNoTargetDate: { icon: CalendarOffIcon, key: "goals.status.no_target_date", tone: "neutral" },
	goalReached: { icon: CircleCheckIcon, key: "goals.status.reached", tone: "neutral" },
	// A reserve's, Sure's `funded` and `depleted`: one below its target needs
	// refilling, which is attention, not an alarm.
	goalFunded: { icon: ShieldCheckIcon, key: "goals.status.funded", tone: "neutral" },
	goalDepleted: { icon: ShieldAlertIcon, key: "goals.status.depleted", tone: "warning" },
	// A goal that is not active says its state in place of its progress, as
	// Sure's card footer: « En pause », « Terminé », « Archivé ».
	goalPaused: { icon: CirclePauseIcon, key: "goals.states.paused", tone: "neutral" },
	goalCompleted: { icon: CircleCheckBigIcon, key: "goals.states.completed", tone: "neutral" },
	goalArchived: { icon: ArchiveIcon, key: "goals.states.archived", tone: "neutral" },
} as const satisfies Record<
	string,
	{ icon: LucideIcon; key: string; tone: "neutral" | "warning" | "destructive" }
>;

export type Status = keyof typeof STATUSES;

/** DESIGN.md's badge: 22 px, a 6 px radius, a 12 px icon and the status's name. */
export function StatusBadge({
	status,
	iconBelowMd = false,
	className,
}: {
	status: Status;
	/**
	 * Below 768 px, the icon alone, the name kept for assistive technology:
	 * a transaction row's line has no room for a label and two named badges.
	 */
	iconBelowMd?: boolean;
	className?: string;
}) {
	const { t } = useTranslation();
	const { icon: Icon, key, tone } = STATUSES[status];

	return (
		<span
			data-slot="status-badge"
			data-status={status}
			className={cn(
				"inline-flex h-5.5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs whitespace-nowrap",
				// 6 % rather than the tints' 10 % in light mode: at 10 %, the warning
				// text falls to 4.4:1 on a hovered or selected row.
				tone === "warning" && "bg-warning/6 text-warning dark:bg-warning/17",
				// 6 % in both modes, and on a card only: dark destructive has no
				// margin left over a hovered row (styles.spec.ts).
				tone === "destructive" && "bg-destructive/6 text-destructive",
				tone === "neutral" && "bg-badge text-foreground-secondary",
				className,
			)}
		>
			<Icon aria-hidden="true" className="size-3 shrink-0" />
			<span className={cn(iconBelowMd && "max-md:sr-only")}>{t(key)}</span>
		</span>
	);
}
