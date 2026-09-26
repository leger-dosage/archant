import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useTranslation } from "react-i18next";

import { BankAlerts } from "@/components/BankAlerts";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The `h1`'s id, for a region the page's title names. */
export const PAGE_TITLE_ID = "page-title";

type PageProps = {
	/** The page's lucide icon, as in the sidebar. */
	icon: LucideIcon;
	/** The page's single `h1`. */
	title: ReactNode;
	/** The page's actions, on the right of the title bar. */
	actions?: ReactNode;
	/** The content's own layout, when the default column does not fit. */
	className?: string;
	children: ReactNode;
};

/**
 * Every signed-in page's frame inside the inset panel: the title bar, the
 * bank alerts, then the content. The title is the page's `h1`, so a screen
 * reader still lands on one heading per page.
 */
export function Page({ icon: Icon, title, actions, className, children }: PageProps) {
	const { t } = useTranslation();

	return (
		<>
			{/* 44 px when everything fits; on a narrow screen the actions wrap below. */}
			<header className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-line py-1.5 pr-3 pl-2">
				<Tooltip>
					<TooltipTrigger asChild>
						<SidebarTrigger />
					</TooltipTrigger>
					<TooltipContent side="bottom">{t("nav.toggleSidebar")}</TooltipContent>
				</Tooltip>
				<Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
				<h1 id={PAGE_TITLE_ID} className="min-w-24 flex-1 truncate text-sm font-medium">
					{title}
				</h1>
				{actions !== undefined && (
					<div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
				)}
			</header>
			<BankAlerts />
			<div className={cn("flex w-full max-w-[1200px] flex-col gap-6 px-7 py-6", className)}>
				{children}
			</div>
		</>
	);
}
