import type { PageParam, RulesPageParam } from "@/lib/page-search";
import type { ReactNode } from "react";

import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { pageSearch } from "@/lib/page-search";

/** The list the pages belong to: one of an account page's, `/transactions`, or the runs on `/rules`. */
export type PageTarget =
	| { to: "/accounts/$accountId"; accountId: string; param: PageParam }
	| { to: "/transactions" }
	| { to: "/rules"; param: RulesPageParam };

type PaginationProps = {
	target: PageTarget;
	page: number;
	pageCount: number;
	/** Names the list the pages belong to, for screen readers. */
	label: string;
};

function PageLink({
	target,
	page,
	children,
}: {
	target: PageTarget;
	page: number;
	children: ReactNode;
}) {
	if (target.to === "/transactions") {
		return (
			<Link
				to="/transactions"
				search={(previous) => ({ ...previous, ...pageSearch("page", page) })}
			>
				{children}
			</Link>
		);
	}

	if (target.to === "/rules") {
		return (
			<Link to="/rules" search={(previous) => ({ ...previous, ...pageSearch(target.param, page) })}>
				{children}
			</Link>
		);
	}

	return (
		<Link
			to="/accounts/$accountId"
			params={{ accountId: target.accountId }}
			search={(previous) => ({ ...previous, ...pageSearch(target.param, page) })}
		>
			{children}
		</Link>
	);
}

/** Précédent and Suivant under a list, pages of 50 (AD-15). */
export function Pagination({ target, page, pageCount, label }: PaginationProps) {
	const { t } = useTranslation();

	return (
		<nav aria-label={label} className="flex items-center justify-between gap-4 border-t pt-3">
			<Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
				{page > 1 ? (
					<PageLink target={target} page={page - 1}>
						{t("pagination.previous")}
					</PageLink>
				) : (
					<span>{t("pagination.previous")}</span>
				)}
			</Button>
			<p className="text-xs text-muted-foreground">
				{t("pagination.status", { page, pages: pageCount })}
			</p>
			<Button variant="outline" size="sm" disabled={page >= pageCount} asChild={page < pageCount}>
				{page < pageCount ? (
					<PageLink target={target} page={page + 1}>
						{t("pagination.next")}
					</PageLink>
				) : (
					<span>{t("pagination.next")}</span>
				)}
			</Button>
		</nav>
	);
}
