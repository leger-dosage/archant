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
 * over a figure in `amount-summary`. The cells stack below 640 px, where
 * three 20 px amounts no longer fit side by side.
 */
export function SummaryStrip({ cells, className }: { cells: SummaryCell[]; className?: string }) {
	return (
		<div
			data-slot="summary-strip"
			className={cn(
				"grid grid-cols-1 divide-y divide-line sm:grid-flow-col sm:grid-cols-none sm:auto-cols-fr sm:divide-x sm:divide-y-0",
				className,
			)}
		>
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
	);
}
