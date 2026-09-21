import { EyeOffIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The eye-off icon of an amount left out of reports (EXPERIENCE.md). The label
 * is in the accessible name too, so the meaning never rests on the icon.
 */
export function ExcludedMarker({ label }: { label: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex text-muted-foreground">
					<EyeOffIcon className="size-3.5" aria-hidden="true" />
					<span className="sr-only">{label}</span>
				</span>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
