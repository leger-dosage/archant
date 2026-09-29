import type { ReactElement, ReactNode } from "react";

import { Link, useRouterState } from "@tanstack/react-router";
import { PanelLeftIcon } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import { ACCOUNTS_COLUMN_ID, useShell } from "@/components/AppShell";
import { BankAlerts } from "@/components/BankAlerts";
import { SETTINGS_SECTIONS } from "@/components/SettingsNav";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The `h1`'s id, for a region the page's title names. */
export const PAGE_TITLE_ID = "page-title";

type PageProps = {
	/**
	 * An icon beside the title, such as an account's tinted type icon. The
	 * other pages have none: the rail already shows their icon.
	 */
	icon?: ReactElement;
	/** The page's single `h1`. */
	title: ReactNode;
	/** The dashboard's greeting: the title at 30 px from 1024 px, as Sure's. */
	greeting?: boolean;
	/** One muted sentence under the title. */
	description?: ReactNode;
	/** The page's actions, on the right of the title. */
	actions?: ReactNode;
	/**
	 * The header, the bank alerts and the content in one centred column, at
	 * most 896 px wide, as Sure lays out its settings sections.
	 */
	centred?: boolean;
	/** The content's own layout, when the default column does not fit. */
	className?: string;
	children: ReactNode;
};

type Crumb = { label: ReactNode; to?: "/" | "/accounts" | "/settings" };

/**
 * The page and its parents, from the URL alone so that no page has to pass
 * them: « Accueil / Opérations », « Comptes / Compte joint », « Réglages /
 * Catégories ».
 */
function useCrumbs(title: ReactNode): Crumb[] {
	const { t } = useTranslation();
	const pathname = useRouterState({ select: (router) => router.location.pathname });

	if (pathname === "/") {
		return [{ label: t("nav.dashboard") }];
	}

	if (pathname.startsWith("/accounts/") && pathname !== "/accounts/") {
		return [{ label: t("nav.accounts"), to: "/accounts" }, { label: title }];
	}

	if (pathname.startsWith("/settings")) {
		const section = SETTINGS_SECTIONS.find(({ to }) => pathname.startsWith(to));

		return [
			{ label: t("nav.settings"), to: "/settings" },
			...(section === undefined ? [] : [{ label: t(section.label) }]),
		];
	}

	return [{ label: t("nav.dashboard"), to: "/" }, { label: title }];
}

function Breadcrumbs({ title }: { title: ReactNode }) {
	const { t } = useTranslation();
	const crumbs = useCrumbs(title);

	// Not a list: inside the page's `main`, its list items are its rows.
	return (
		<nav aria-label={t("nav.breadcrumbs")} className="flex min-w-0 items-center gap-2 font-medium">
			{crumbs.map((crumb, index) => (
				<Fragment key={index}>
					{index > 0 && (
						<span aria-hidden="true" className="text-muted-foreground">
							/
						</span>
					)}
					{crumb.to === undefined || index === crumbs.length - 1 ? (
						<span aria-current="page" className="min-w-0 truncate text-foreground">
							{crumb.label}
						</span>
					) : (
						<Link
							to={crumb.to}
							className="shrink-0 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
						>
							{crumb.label}
						</Link>
					)}
				</Fragment>
			))}
		</nav>
	);
}

/** Folds the accounts column; remembered on the device. */
function FoldButton() {
	const { t } = useTranslation();
	const shell = useShell();

	if (shell === null || !shell.hasAccountsColumn) {
		return null;
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					aria-label={t("nav.toggleAccounts")}
					aria-expanded={shell.columnOpen}
					aria-controls={shell.columnOpen ? ACCOUNTS_COLUMN_ID : undefined}
					onClick={() => shell.setColumnOpen(!shell.columnOpen)}
				>
					<PanelLeftIcon />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">{t("nav.toggleAccounts")}</TooltipContent>
		</Tooltip>
	);
}

/**
 * Every signed-in page, Sure's way: a sticky top bar with the fold button
 * and the breadcrumbs, then the page header (the `h1`, a sentence, the
 * actions), the bank alerts and the content, full width or in a centred
 * column. Below 1024 px the shell's own top bar replaces this one.
 */
export function Page({
	icon,
	title,
	greeting = false,
	description,
	actions,
	centred = false,
	className,
	children,
}: PageProps) {
	return (
		<>
			<div
				data-slot="top-bar"
				className="sticky top-0 z-20 hidden h-[69px] shrink-0 items-center gap-2 border-b border-line bg-background px-3 lg:flex lg:px-10"
			>
				<FoldButton />
				<Breadcrumbs title={title} />
			</div>
			<div className="flex flex-col px-3 py-6 lg:px-10">
				{/* The padding stays outside the column: 896 px is the content's width. */}
				<div className={cn("flex w-full min-w-0 flex-col gap-6", centred && "mx-auto max-w-4xl")}>
					{/* On a narrow screen the actions wrap below the title. */}
					<header data-slot="page-header" className="flex flex-wrap items-center gap-x-3 gap-y-2">
						{icon}
						<h1
							id={PAGE_TITLE_ID}
							className={cn(
								"min-w-24 flex-1 truncate text-2xl font-medium tracking-[-0.01em]",
								greeting && "lg:text-3xl",
							)}
						>
							{title}
						</h1>
						{actions !== undefined && (
							<div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
						)}
						{description !== undefined && (
							<p className="order-last basis-full text-muted-foreground">{description}</p>
						)}
					</header>
					<BankAlerts />
					<div className={cn("flex w-full flex-col gap-6", className)}>{children}</div>
				</div>
			</div>
		</>
	);
}
