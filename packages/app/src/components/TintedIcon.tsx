import type { TintSubject } from "@/lib/tint";

import { useResolvedTheme } from "@/lib/theme";
import { resolveTint } from "@/lib/tint";
import { cn } from "@/lib/utils";

// DESIGN.md's 20, 28 and 36 px, each with its own radius. Important sizes: a
// button's `[&_svg]:size-4` would otherwise stretch the icon to its tile.
const SIZES = {
	sm: { box: "size-5 rounded-md", icon: "size-3!", letter: "text-xs" },
	md: { box: "size-7 rounded-lg", icon: "size-4!", letter: "text-xs" },
	lg: { box: "size-9 rounded-[10px]", icon: "size-5!", letter: "text-sm" },
} as const;

type TintedIconSize = keyof typeof SIZES;

/**
 * DESIGN.md's tinted icon: an account type, a transfer, a category or a
 * merchant's first letter, in its colour on the same colour's tint. Colours
 * follow the theme on screen, so a mode switch recolours it without a reload.
 */
export function TintedIcon({
	subject,
	size = "md",
	className,
}: {
	subject: TintSubject;
	size?: TintedIconSize;
	className?: string;
}) {
	const mode = useResolvedTheme();
	const tint = resolveTint(subject, mode);
	const sizes = SIZES[size];

	return (
		<span
			aria-hidden="true"
			data-slot="tinted-icon"
			className={cn("grid shrink-0 place-items-center", sizes.box, className)}
			style={{ backgroundColor: tint.fill, color: tint.icon }}
		>
			{"icon" in tint.glyph ? (
				<tint.glyph.icon className={sizes.icon} />
			) : (
				<span
					className={cn("leading-none font-semibold", sizes.letter)}
					style={{ color: tint.text }}
				>
					{tint.glyph.letter}
				</span>
			)}
		</span>
	);
}
