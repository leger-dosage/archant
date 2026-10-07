import type { ReactNode } from "react";

/**
 * Sure's `accounts/_summary_card`: one figure in a card of its own, a muted
 * title over it in `amount-summary`. A loan's overview, schedule and chart lay
 * them in a grid, as Sure's do. A group named by its title, so a figure is
 * found by what it is.
 */
export function SummaryCard({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div
			role="group"
			aria-label={title}
			className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4 shadow-xs"
		>
			<span className="text-sm text-muted-foreground">{title}</span>
			<div className="amount-summary break-words">{children}</div>
		</div>
	);
}
