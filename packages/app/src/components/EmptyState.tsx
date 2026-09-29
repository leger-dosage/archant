import type { TintSubject } from "@/lib/tint";
import type { ReactNode } from "react";

import { useId } from "react";

import { TintedIcon } from "@/components/TintedIcon";
import { cn } from "@/lib/utils";

/**
 * DESIGN.md's empty state, a card of its own as Sure's `DS::EmptyState` sits
 * in one: a large tinted icon, a heading, one sentence and the one action
 * that fills the list. Callers put it where the list would be; inside a
 * card already, such as an inset group's white block, it is `flush`.
 */
export function EmptyState({
	icon,
	title,
	description,
	action,
	level = 3,
	labelled = false,
	flush = false,
	className,
}: {
	icon: TintSubject;
	title: ReactNode;
	description: ReactNode;
	action: ReactNode;
	level?: 2 | 3;
	/** A region of its own, named by its heading, where no section names it. */
	labelled?: boolean;
	/** Inside a card already: no frame of its own. */
	flush?: boolean;
	className?: string;
}) {
	const headingId = useId();
	const Heading = level === 2 ? "h2" : "h3";
	const Wrapper = labelled ? "section" : "div";

	return (
		<Wrapper
			data-slot="empty-state"
			{...(labelled ? { "aria-labelledby": headingId } : {})}
			className={cn(
				"flex flex-col items-center gap-3 px-6 py-10 text-center",
				!flush && "rounded-xl border bg-card",
				className,
			)}
		>
			<TintedIcon subject={icon} size="lg" />
			<Heading id={headingId} className="card-title">
				{title}
			</Heading>
			<p className="max-w-sm text-muted-foreground">{description}</p>
			{action}
		</Wrapper>
	);
}

/**
 * A list with nothing to offer but a sentence, as Sure's secondary lists:
 * the card without its icon, heading or button.
 */
export function EmptyNote({
	flush = false,
	className,
	children,
}: {
	/** Inside a card already: no frame of its own. */
	flush?: boolean;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div
			data-slot="empty-note"
			className={cn("p-4 text-muted-foreground", !flush && "rounded-xl border bg-card", className)}
		>
			{children}
		</div>
	);
}
