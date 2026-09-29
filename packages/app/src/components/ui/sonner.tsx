import type { ToasterProps } from "sonner";

import {
	CircleCheckIcon,
	InfoIcon,
	TriangleAlertIcon,
	OctagonXIcon,
	Loader2Icon,
} from "lucide-react";
import { Toaster as Sonner } from "sonner";

import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useResolvedTheme } from "@/lib/theme";

// Adapted from shadcn: the theme comes from Archant's own store rather than
// next-themes, which targets Next.js and would be a second source of truth.
const Toaster = ({ ...props }: ToasterProps) => {
	const theme = useResolvedTheme();
	const isWide = useMediaQuery("(min-width: 1024px)");
	// Below 1024 px the shell's bottom navigation covers the foot of the screen.
	const clearNavigation = isWide
		? {}
		: {
				offset: { bottom: "calc(5rem + env(safe-area-inset-bottom))" },
				mobileOffset: { bottom: "calc(5rem + env(safe-area-inset-bottom))" },
			};

	return (
		<Sonner
			theme={theme}
			className="toaster group"
			icons={{
				success: <CircleCheckIcon className="size-4" />,
				info: <InfoIcon className="size-4" />,
				warning: <TriangleAlertIcon className="size-4" />,
				error: <OctagonXIcon className="size-4" />,
				loading: <Loader2Icon className="size-4 animate-spin" />,
			}}
			style={{
				"--normal-bg": "var(--popover)",
				"--normal-text": "var(--popover-foreground)",
				"--normal-border": "var(--border)",
				"--border-radius": "var(--radius)",
			}}
			toastOptions={{
				classNames: {
					toast: "cn-toast",
				},
			}}
			{...clearNavigation}
			{...props}
		/>
	);
};

export { Toaster };
