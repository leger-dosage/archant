import { cn } from "@/lib/utils";

/**
 * The arch mark of DESIGN.md, one colour, drawn in `--logo`. With a `label`
 * it is an image of that name; without one, decoration beside a visible name.
 */
export function ArchLogo({ label, className }: { label?: string; className?: string }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 32 32"
			fill="currentColor"
			className={cn("size-5 shrink-0 text-logo", className)}
			{...(label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
		>
			<path
				fillRule="evenodd"
				d="M4 28V15C4 8.4 9.4 3 16 3s12 5.4 12 12v13h-6.5v-7h-11v7H4ZM10.5 17V15a5.5 5.5 0 0 1 11 0v2Z"
			/>
		</svg>
	);
}
