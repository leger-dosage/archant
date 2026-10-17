import type { LucideIcon } from "lucide-react";

import { Link, createFileRoute } from "@tanstack/react-router";
import {
	BuildingIcon,
	ChevronRightIcon,
	FileBracesIcon,
	ShapesIcon,
	SquarePercentIcon,
	StoreIcon,
	WorkflowIcon,
} from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { CsvImportType } from "@archant/api/schemas/csv-imports";

import { InsetGroup } from "@/components/InsetGroup";
import { Page } from "@/components/Page";
import { useAccounts } from "@/hooks/useAccounts";

export const Route = createFileRoute("/_authed/settings/imports")({
	component: ImportsPage,
});

/** Sure's « Données brutes », in its order, each with its icon. */
const RAW_DATA: readonly { type: CsvImportType; icon: LucideIcon }[] = [
	{ type: "trades", icon: SquarePercentIcon },
	{ type: "accounts", icon: BuildingIcon },
	{ type: "categories", icon: ShapesIcon },
	{ type: "merchants", icon: StoreIcon },
	{ type: "rules", icon: WorkflowIcon },
];

const ROW = "flex items-center justify-between gap-3 p-4";

function SourceLabel({
	icon: Icon,
	label,
	description,
}: {
	icon: LucideIcon;
	label: string;
	description?: string | undefined;
}) {
	return (
		<span className="flex items-center gap-3">
			<span
				aria-hidden="true"
				className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
			>
				<Icon className="size-4" />
			</span>
			<span className="flex flex-col">
				<span className="text-sm font-medium">{label}</span>
				{description !== undefined && (
					<span className="text-xs text-muted-foreground">{description}</span>
				)}
			</span>
		</span>
	);
}

/**
 * « Réglages › Importations »: the import sources, as Sure's « Nouvelle
 * importation » lists them, its two tabs as two groups. Archant keeps no
 * list of past imports here: each account's own history lists its
 * statements. Trades wait for an account, as Sure's `requires_account`.
 */
function ImportsPage() {
	const { t } = useTranslation();
	const accounts = useAccounts();
	const hasAccounts = accounts.data?.groups.some((group) => group.accounts.length > 0) ?? false;

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
			<div className="flex flex-col gap-6">
				<InsetGroup level={2} title={t("sureImport.sources.heading")}>
					<ul>
						<li>
							<Link
								to="/settings/imports/sure"
								className={`${ROW} outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`}
							>
								<SourceLabel
									icon={FileBracesIcon}
									label={t("sureImport.sources.sure")}
									description={t("sureImport.sources.sureDescription")}
								/>
								<ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
							</Link>
						</li>
					</ul>
				</InsetGroup>
				<InsetGroup level={2} title={t("csvImport.sources.heading")}>
					<ul className="divide-y divide-line">
						{RAW_DATA.map(({ type, icon }) => (
							<li key={type}>
								{type === "trades" && !hasAccounts ? (
									<div className={`${ROW} text-muted-foreground`} aria-disabled="true">
										<SourceLabel
											icon={icon}
											label={t(`csvImport.sources.${type}`)}
											description={t("csvImport.sources.requiresAccount")}
										/>
									</div>
								) : (
									<Link
										to="/settings/imports/$kind"
										params={{ kind: type }}
										className={`${ROW} outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`}
									>
										<SourceLabel icon={icon} label={t(`csvImport.sources.${type}`)} />
										<ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
									</Link>
								)}
							</li>
						))}
					</ul>
				</InsetGroup>
			</div>
		</Page>
	);
}
