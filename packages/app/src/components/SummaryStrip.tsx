import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type SummaryCell = {
	/** The cell's muted label, which also names its group. */
	label: string;
	/** The figure, usually a `Money`. */
	value: ReactNode;
};

/**
 * DESIGN.md's summary strip: equal cells split by lines, each a muted label
 * over a figure in `amount-summary`. The cells stack while the strip itself
 * is under 576 px wide, where three 20 px amounts no longer fit side by side:
 * the viewport says nothing about a half-width card on a wide screen.
 */
export function SummaryStrip({ cells, className }: { cells: SummaryCell[]; className?: string }) {
	return (
		<div data-slot="summary-strip" className={cn("@container", className)}>
			<div className="grid grid-cols-1 divide-y divide-line @xl:grid-flow-col @xl:grid-cols-none @xl:auto-cols-fr @xl:divide-x @xl:divide-y-0">
				{cells.map((cell) => (
					<div
						key={cell.label}
						role="group"
						aria-label={cell.label}
						className="flex min-w-0 flex-col gap-1 px-4 py-3"
					>
						<span className="text-sm text-muted-foreground">{cell.label}</span>
						<div className="amount-summary">{cell.value}</div>
					</div>
				))}
			</div>
		</div>
	);
}
