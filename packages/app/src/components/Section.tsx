import type { ReactNode } from "react";

import { useId } from "react";

import { useDashboardWidget } from "@/components/DashboardWidget";
import { cn } from "@/lib/utils";

/**
 * DESIGN.md's card: a bordered block on the container colour, a header row
 * with its heading and an optional action, a line, then the content. The
 * `section` is named by its heading, so it reads as a region, one level
 * under the page's `h1`. On the dashboard, the widget around it lends the
 * header its chevron and controls, and hides the content once collapsed.
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
	const widget = useDashboardWidget();
	const heading = (
		<h2 id={headingId} className="card-title">
			{title}
		</h2>
	);

	return (
		<section
			aria-labelledby={headingId}
			data-slot="section"
			className={cn("flex min-w-0 flex-col rounded-xl border bg-card", className)}
		>
			<div
				className={cn(
					"flex min-h-11 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2",
					widget?.collapsed === true && "border-b-0",
				)}
			>
				{widget?.toggle === undefined || widget.toggle === null ? (
					heading
				) : (
					<div className="flex min-w-0 items-center gap-2">
						{widget.toggle}
						{heading}
					</div>
				)}
				{widget?.controls === undefined || widget.controls === null ? (
					action
				) : (
					<div className="ml-auto flex items-center gap-3">
						{widget.controls}
						{action}
					</div>
				)}
			</div>
			{widget === null ? (
				children
			) : (
				// Kept mounted when collapsed, as Sure only hides it: its state and queries stay.
				<div id={widget.contentId} hidden={widget.collapsed} className="contents">
					{children}
				</div>
			)}
		</section>
	);
}
