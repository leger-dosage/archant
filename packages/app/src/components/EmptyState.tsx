import type { TintSubject } from "@/lib/tint";
import type { ReactNode } from "react";

import { useId } from "react";

import { TintedIcon } from "@/components/TintedIcon";
import { cn } from "@/lib/utils";

/**
 * DESIGN.md's empty state, inside a section: a large tinted icon, a heading,
 * one sentence and the one action that fills the list. Secondary lists keep
 * a sentence alone, as in Sure.
 */
export function EmptyState({
	icon,
	title,
	description,
	action,
	level = 3,
	labelled = false,
	className,
}: {
	icon: TintSubject;
	title: ReactNode;
	description: ReactNode;
	action: ReactNode;
	level?: 2 | 3;
	/** A region of its own, named by its heading, where no section names it. */
	labelled?: boolean;
	className?: string;
}) {
	const headingId = useId();
	const Heading = level === 2 ? "h2" : "h3";
	const Wrapper = labelled ? "section" : "div";

	return (
		<Wrapper
			data-slot="empty-state"
			{...(labelled ? { "aria-labelledby": headingId } : {})}
			className={cn("flex flex-col items-center gap-3 px-6 py-10 text-center", className)}
		>
			<TintedIcon subject={icon} size="lg" />
			<Heading id={headingId} className="type-title">
				{title}
			</Heading>
			<p className="max-w-sm text-muted-foreground">{description}</p>
			{action}
		</Wrapper>
	);
}
