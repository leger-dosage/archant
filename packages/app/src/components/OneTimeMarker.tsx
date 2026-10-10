import { AsteriskIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Sure's orange asterisk beside a one-time transaction's name. The label is
 * in the accessible name too, so the meaning never rests on the icon.
 */
export function OneTimeMarker({ label }: { label: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex shrink-0 text-warning">
					<AsteriskIcon className="size-3.5" aria-hidden="true" />
					<span className="sr-only">{label}</span>
				</span>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
