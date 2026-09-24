import { TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * « Doublon possible »: an import or a sync found two entries equally near
 * this line and created it rather than guess. In the warning colour, which
 * DESIGN.md keeps for states that need attention, with the words beside the
 * icon so the meaning never rests on colour.
 */
export function DuplicateFlag() {
	const { t } = useTranslation();

	return (
		<span className="inline-flex shrink-0 items-center gap-1 text-xs text-warning">
			<TriangleAlertIcon className="size-3.5" aria-hidden="true" />
			{t("transactions.duplicate.flag")}
		</span>
	);
}
