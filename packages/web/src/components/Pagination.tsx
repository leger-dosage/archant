import type { PageParam } from "@/lib/page-search";

import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { pageSearch } from "@/lib/page-search";

type PaginationProps = {
	accountId: string;
	param: PageParam;
	page: number;
	pageCount: number;
	/** Names the list the pages belong to, for screen readers. */
	label: string;
};

/** Précédent and Suivant under a list of the account page, pages of 50 (AD-15). */
export function Pagination({ accountId, param, page, pageCount, label }: PaginationProps) {
	const { t } = useTranslation();

	return (
		<nav aria-label={label} className="flex items-center justify-between gap-4 border-t pt-3">
			<Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
				{page > 1 ? (
					<Link
						to="/comptes/$accountId"
						params={{ accountId }}
						search={(previous) => ({ ...previous, ...pageSearch(param, page - 1) })}
					>
						{t("pagination.previous")}
					</Link>
				) : (
					<span>{t("pagination.previous")}</span>
				)}
			</Button>
			<p className="text-xs text-muted-foreground">
				{t("pagination.status", { page, pages: pageCount })}
			</p>
			<Button variant="outline" size="sm" disabled={page >= pageCount} asChild={page < pageCount}>
				{page < pageCount ? (
					<Link
						to="/comptes/$accountId"
						params={{ accountId }}
						search={(previous) => ({ ...previous, ...pageSearch(param, page + 1) })}
					>
						{t("pagination.next")}
					</Link>
				) : (
					<span>{t("pagination.next")}</span>
				)}
			</Button>
		</nav>
	);
}
