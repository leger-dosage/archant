import { cn } from "@/lib/utils";

/**
 * The 8 px dot before a category's name, in its colour. Without a category,
 * a dashed outline: « Sans catégorie » is a state, not a colour.
 */
export function CategoryDot({ color, className }: { color: string | null; className?: string }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"size-2 shrink-0 rounded-full",
				color === null && "border border-dashed border-muted-foreground",
				className,
			)}
			style={color === null ? undefined : { backgroundColor: color }}
		/>
	);
}
