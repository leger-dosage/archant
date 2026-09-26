import type { Tint } from "@/lib/tint";

import { tintFill } from "@/lib/pill-text-color";
import { cn } from "@/lib/utils";

// DESIGN.md `tinted-icon`: the tile's side and its radius; the icon is half the side.
const SIZES = {
	sm: { side: 22, radius: "rounded-sm" },
	md: { side: 32, radius: "rounded-md" },
	lg: { side: 36, radius: "rounded-lg" },
} as const;

type TintedIconProps = {
	tint: Tint;
	size?: keyof typeof SIZES;
	className?: string;
};

/** A lucide icon, or a merchant's letter, in its colour on the same colour at 10 %. */
export function TintedIcon({ tint, size = "md", className }: TintedIconProps) {
	const { side, radius } = SIZES[size];
	// Inline, because a parent's `[&_svg]:size-4`, as in the sidebar's buttons,
	// outranks a class on the icon itself.
	const inner = { width: side / 2, height: side / 2 };

	return (
		<span
			aria-hidden="true"
			data-slot="tinted-icon"
			className={cn("grid shrink-0 place-items-center", radius, className)}
			style={{
				width: side,
				height: side,
				color: tint.color,
				backgroundColor: tintFill(tint.color),
			}}
		>
			{"icon" in tint ? (
				<tint.icon style={inner} />
			) : (
				<span className="leading-none font-semibold" style={{ fontSize: side / 2 }}>
					{tint.letter}
				</span>
			)}
		</span>
	);
}
