import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRightIcon, FileBracesIcon } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { InsetGroup } from "@/components/InsetGroup";
import { Page } from "@/components/Page";

export const Route = createFileRoute("/_authed/settings/imports")({
	component: ImportsPage,
});

/**
 * « Réglages › Importations »: the import sources, as Sure's « Nouvelle
 * importation » lists them. Archant keeps no list of past imports here: each
 * account's own history lists its statements.
 */
function ImportsPage() {
	const { t } = useTranslation();

	useEffect(() => {
		document.title = t("app.pageTitle", {
			page: t("sureImport.sources.title"),
			app: t("app.name"),
		});
	}, [t]);

	return (
		<Page
			centred
			title={t("sureImport.sources.title")}
			description={t("sureImport.sources.description")}
		>
			<InsetGroup level={2} title={t("sureImport.sources.heading")}>
				<ul>
					<li>
						<Link
							to="/settings/imports/sure"
							className="flex items-center justify-between gap-3 p-4 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
						>
							<span className="flex items-center gap-3">
								<span
									aria-hidden="true"
									className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
								>
									<FileBracesIcon className="size-4" />
								</span>
								<span className="flex flex-col">
									<span className="text-sm font-medium">{t("sureImport.sources.sure")}</span>
									<span className="text-xs text-muted-foreground">
										{t("sureImport.sources.sureDescription")}
									</span>
								</span>
							</span>
							<ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
						</Link>
					</li>
				</ul>
			</InsetGroup>
		</Page>
	);
}
