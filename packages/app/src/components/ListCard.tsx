import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * DESIGN.md's card around a page's list, as Sure's settings lists sit in
 * one: its inset groups stacked inside, then what acts on them.
 */
export function ListCard({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<div
			data-slot="list-card"
			className={cn("flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4", className)}
		>
			{children}
		</div>
	);
}
