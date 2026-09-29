import type { ReactNode } from "react";

import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * DESIGN.md's inset group: a grey tray whose uppercase header holds the
 * group's heading on the left and its total on the right, above a white
 * bordered block of rows. The caller's list separates its rows with `line`.
 * The `section` is named by its heading, so it reads as a region. Without a
 * `detail`, the header is the heading's parent and so holds the total; with
 * one, the heading and the detail share a wrapper, the total's sibling.
 */
export function InsetGroup({
	title,
	detail,
	level,
	total,
	note,
	id,
	className,
	children,
}: {
	title: ReactNode;
	/** Beside the heading, on the left and outside it, such as a day's count. */
	detail?: ReactNode;
	/**
	 * Directly under the page's `h1`, an `h2`; under a card's `h2`, an `h3`;
	 * under a card's `h3`, such as a balance sheet class, an `h4`.
	 */
	level: 2 | 3 | 4;
	/** The group's total, beside its heading, in the header's own colour. */
	total?: ReactNode;
	/** One muted sentence between the header and the rows. */
	note?: ReactNode;
	/** The heading's id, for a list inside that takes its name. */
	id?: string;
	className?: string;
	children: ReactNode;
}) {
	const generatedId = useId();
	const headingId = id ?? generatedId;
	const Heading = `h${level}` as const;

	return (
		<section
			aria-labelledby={headingId}
			data-slot="inset-group"
			className={cn("flex min-w-0 flex-col rounded-xl bg-inset p-1", className)}
		>
			<div className="flex items-center justify-between gap-4 px-4 py-2 text-xs font-medium tracking-[0.02em] text-muted-foreground uppercase">
				{detail === undefined ? (
					<Heading id={headingId} className="min-w-0 truncate">
						{title}
					</Heading>
				) : (
					<div className="flex min-w-0 items-center gap-1.5">
						<Heading id={headingId} className="min-w-0 truncate">
							{title}
						</Heading>
						{detail}
					</div>
				)}
				{total}
			</div>
			{note !== undefined && <p className="px-4 pb-2 text-xs text-muted-foreground">{note}</p>}
			<div className="overflow-hidden rounded-lg border bg-card">{children}</div>
		</section>
	);
}
