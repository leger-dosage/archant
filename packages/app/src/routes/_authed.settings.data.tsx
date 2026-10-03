import { createFileRoute } from "@tanstack/react-router";
import { DownloadIcon } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Page } from "@/components/Page";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";

const EXPORT_GUIDE =
	"https://github.com/leger-dosage/archant/blob/main/docs/deployment.md#exporting-your-data";

export const Route = createFileRoute("/_authed/settings/data")({
	component: DataPage,
});

const HOLDS = [
	"data.holds.accounts",
	"data.holds.transactions",
	"data.holds.transfers",
	"data.holds.snapshots",
	"data.holds.taxonomy",
	"data.holds.recurring",
	"data.holds.budgets",
	"data.holds.rules",
] as const;

const LEAVES_OUT = [
	"data.leavesOut.secrets",
	"data.leavesOut.banks",
	"data.leavesOut.keys",
	"data.leavesOut.settings",
	"data.leavesOut.replacements",
] as const;

function Items({ keys }: { keys: readonly (typeof HOLDS | typeof LEAVES_OUT)[number][] }) {
	const { t } = useTranslation();

	return (
		<ul className="flex list-disc flex-col gap-1 py-4 pr-4 pl-9 text-sm">
			{keys.map((key) => (
				<li key={key}>{t(key)}</li>
			))}
		</ul>
	);
}

/**
 * « Réglages › Données »: what the archive holds and leaves out, its sign,
 * and the download. A plain link, never the `hc` client: the browser saves
 * the stream under the server's file name without holding it in memory.
 */
function DataPage() {
	const { t } = useTranslation();

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("data.title"), app: t("app.name") });
	}, [t]);

	return (
		<Page
			centred
			title={t("data.title")}
			description={t("data.description")}
			actions={
				<Button asChild>
					<a href="/api/export" download>
						<DownloadIcon aria-hidden="true" />
						{t("data.export")}
					</a>
				</Button>
			}
			className="gap-4"
		>
			<Section title={t("data.holds.title")}>
				<Items keys={HOLDS} />
			</Section>
			<Section title={t("data.leavesOut.title")}>
				<Items keys={LEAVES_OUT} />
			</Section>
			<div className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4 text-sm">
				<p>{t("data.sign")}</p>
				<p className="text-muted-foreground">{t("data.notBackup")}</p>
				<a
					href={EXPORT_GUIDE}
					target="_blank"
					rel="noreferrer"
					className="font-medium underline underline-offset-4"
				>
					{t("data.guide")}
				</a>
			</div>
		</Page>
	);
}
