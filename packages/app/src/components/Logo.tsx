import { cn } from "@/lib/utils";

/**
 * The arch mark of `mockups/logo.svg`, in the `logo` token. Decorative: the
 * name « Archant » always sits beside it, or the page names it otherwise.
 */
export function Logo({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 32 32"
			aria-hidden="true"
			data-slot="logo"
			className={cn("size-6 shrink-0 text-logo", className)}
		>
			<path
				fill="currentColor"
				fillRule="evenodd"
				d="M4 28V15C4 8.4 9.4 3 16 3s12 5.4 12 12v13h-6.5v-7h-11v7H4ZM10.5 17V15a5.5 5.5 0 0 1 11 0v2Z"
			/>
		</svg>
	);
}
