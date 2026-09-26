import type { ReactNode } from "react";

import { useId } from "react";

import { cn } from "@/lib/utils";

// A table's edge cells line up with the section header's 16 px padding.
export const SECTION_TABLE_INSET =
	"[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4";

/**
 * DESIGN.md's section: a bordered block on the section colour, a header row
 * with its heading and an optional action, a line, then the content. The
 * `section` is named by its heading, so it reads as a region. Level 3 where
 * it nests under a page's own `h2`, as in « Réglages ».
 */
export function Section({
	title,
	id,
	level = 2,
	action,
	className,
	children,
}: {
	title: ReactNode;
	/** The heading's id, for a table or a list inside that takes its name. */
	id?: string;
	level?: 2 | 3;
	action?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	const generatedId = useId();
	const headingId = id ?? generatedId;
	const Heading = level === 2 ? "h2" : "h3";

	return (
		<section
			aria-labelledby={headingId}
			data-slot="section"
			className={cn("flex min-w-0 flex-col rounded-lg border bg-section", className)}
		>
			<div className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2">
				<Heading id={headingId} className="type-title">
					{title}
				</Heading>
				{action}
			</div>
			{children}
		</section>
	);
}
