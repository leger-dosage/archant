import { CircleCheckIcon, CircleDashedIcon, CircleDotIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ReconciliationStatus } from "@archant/data/reconciliation";

import { Badge } from "@/components/ui/badge";
import { useSetReconciliationStatus } from "@/hooks/useTransactions";
import { cn } from "@/lib/utils";

const appearances = {
	unreconciled: { Icon: CircleDashedIcon, next: "cleared" },
	cleared: { Icon: CircleDotIcon, next: "reconciled" },
	reconciled: { Icon: CircleCheckIcon, next: "unreconciled" },
} as const;

export function ReconciliationBadge({
	id,
	status: initialStatus,
	editable,
	compact = false,
}: {
	id: string;
	status: ReconciliationStatus;
	editable: boolean;
	compact?: boolean;
}) {
	const { t } = useTranslation();
	const update = useSetReconciliationStatus();
	// The sheet keeps the transaction as it was when opened, even if it leaves the filter.
	const status = compact ? initialStatus : (update.data?.reconciliationStatus ?? initialStatus);
	const { Icon, next } = appearances[status];
	const label = t(`transactions.reconciliation.statuses.${status}`);
	const labelText = <span className={cn(compact && "sr-only xl:not-sr-only")}>{label}</span>;
	const className = cn(
		"h-7",
		compact && "px-1.5",
		status === "reconciled" && "bg-muted font-semibold",
	);

	return editable ? (
		<Badge variant="outline" className={cn(className, "hover:bg-muted")} asChild>
			<button
				type="button"
				title={t("transactions.reconciliation.advance", {
					current: label,
					next: t(`transactions.reconciliation.statuses.${next}`),
				})}
				disabled={update.isPending}
				onClick={() => update.mutate({ id, reconciliationStatus: next })}
			>
				<Icon aria-hidden="true" />
				{labelText}
			</button>
		</Badge>
	) : (
		<Badge variant="outline" className={className} title={label}>
			<Icon aria-hidden="true" />
			{labelText}
		</Badge>
	);
}
