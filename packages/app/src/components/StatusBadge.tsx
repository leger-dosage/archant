import type { LucideIcon } from "lucide-react";

import {
	ArrowLeftRightIcon,
	CircleCheckIcon,
	CirclePauseIcon,
	ClockAlertIcon,
	ClockIcon,
	HandIcon,
	RefreshCwOffIcon,
	RepeatIcon,
	SparklesIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

/**
 * Each status a row names in words: the text carries the meaning, the icon
 * and the tint only repeat it, so nothing rests on colour.
 */
const STATUSES = {
	pending: { icon: ClockIcon, key: "transactions.pending", warning: false },
	recurring: { icon: RepeatIcon, key: "transactions.recurringBadge", warning: false },
	transfer: { icon: ArrowLeftRightIcon, key: "transactions.transfer.internal", warning: false },
	// Neutral: a suggestion waits for a pick but needs no attention.
	transferSuggested: {
		icon: ArrowLeftRightIcon,
		key: "transactions.transfer.suggested",
		warning: false,
	},
	// The warning tint, which DESIGN.md keeps for states that need attention.
	duplicate: { icon: TriangleAlertIcon, key: "transactions.duplicate.flag", warning: true },
	// A series' state is information, never an alarm: all neutral.
	recurringDetected: { icon: SparklesIcon, key: "recurring.statuses.detected", warning: false },
	recurringConfirmed: {
		icon: CircleCheckIcon,
		key: "recurring.statuses.confirmed",
		warning: false,
	},
	recurringInactive: { icon: CirclePauseIcon, key: "recurring.statuses.inactive", warning: false },
	recurringManual: { icon: HandIcon, key: "recurring.manual", warning: false },
	// A connection that needs the user, as BankAlerts' strip says above the page.
	consentExpiring: { icon: ClockAlertIcon, key: "banks.consentExpiring", warning: true },
	consentExpired: { icon: TriangleAlertIcon, key: "banks.consentExpired", warning: true },
	syncStale: { icon: RefreshCwOffIcon, key: "banks.syncStale", warning: true },
} as const satisfies Record<string, { icon: LucideIcon; key: string; warning: boolean }>;

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
	const { icon: Icon, key, warning } = STATUSES[status];

	return (
		<span
			data-slot="status-badge"
			data-status={status}
			className={cn(
				"inline-flex h-5.5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs whitespace-nowrap",
				// 6 % rather than the tints' 10 % in light mode: at 10 %, the warning
				// text falls to 4.4:1 on a hovered or selected row.
				warning
					? "bg-warning/6 text-warning dark:bg-warning/17"
					: "bg-badge text-foreground-secondary",
				className,
			)}
		>
			<Icon aria-hidden="true" className="size-3 shrink-0" />
			<span className={cn(iconBelowMd && "max-md:sr-only")}>{t(key)}</span>
		</span>
	);
}
