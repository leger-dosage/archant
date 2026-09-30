import type { ReactNode } from "react";

import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * DESIGN.md's card: a bordered block on the container colour, a header row
 * with its heading and an optional action, a line, then the content. The
 * `section` is named by its heading, so it reads as a region, one level
 * under the page's `h1`.
 */
export function Section({
	title,
	id,
	action,
	className,
	children,
}: {
	title: ReactNode;
	/** The heading's id, for a table or a list inside that takes its name. */
	id?: string;
	action?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	const generatedId = useId();
	const headingId = id ?? generatedId;

	return (
		<section
			aria-labelledby={headingId}
			data-slot="section"
			className={cn("flex min-w-0 flex-col rounded-xl border bg-card", className)}
		>
			<div className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2">
				<h2 id={headingId} className="card-title">
					{title}
				</h2>
				{action}
			</div>
			{children}
		</section>
	);
}
