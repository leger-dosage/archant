import { useResolvedTheme } from "@/lib/theme";
import { colorTint } from "@/lib/tint";
import { cn } from "@/lib/utils";

/**
 * Sure's `tags/_badge.html.erb`: the tag's name after a dot of its colour, on
 * its tint, the text adjusted to stay readable on any row as a category pill's.
 */
export function TagBadge({
	tag,
	className,
}: {
	tag: { name: string; color: string };
	className?: string | undefined;
}) {
	const tint = colorTint(tag.color, useResolvedTheme());

	return (
		<span
			className={cn(
				"inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full px-2.5 text-xs",
				className,
			)}
			style={{ backgroundColor: tint.fill, color: tint.text }}
		>
			<span
				aria-hidden="true"
				className="size-1.5 shrink-0 rounded-full"
				style={{ backgroundColor: tint.icon }}
			/>
			<span className="truncate">{tag.name}</span>
		</span>
	);
}
