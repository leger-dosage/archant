import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import {
	BanknoteIcon,
	SettingsIcon,
	ShapesIcon,
	ShieldCheckIcon,
	StoreIcon,
	TagsIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Page } from "@/components/Page";
import { useVersion } from "@/hooks/useVersion";
import { releaseUrl } from "@/lib/release";

export const Route = createFileRoute("/_authed/settings")({
	component: SettingsLayout,
});

// Sure's settings icons.
const SECTIONS = [
	{ to: "/settings/banks", label: "settings.sections.banks", icon: BanknoteIcon },
	{ to: "/settings/categories", label: "settings.sections.categories", icon: ShapesIcon },
	{ to: "/settings/merchants", label: "settings.sections.merchants", icon: StoreIcon },
	{ to: "/settings/tags", label: "settings.sections.tags", icon: TagsIcon },
	{ to: "/settings/security", label: "settings.sections.security", icon: ShieldCheckIcon },
] as const;

function SettingsLayout() {
	const { t } = useTranslation();

	return (
		<Page icon={SettingsIcon} title={t("settings.title")}>
			<div className="flex flex-col gap-6 md:flex-row">
				<nav aria-label={t("settings.title")} className="md:w-48 md:shrink-0">
					<ul className="flex flex-col gap-1">
						{SECTIONS.map(({ to, label, icon: Icon }) => (
							<li key={to}>
								<Link
									to={to}
									activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
									className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
								>
									<Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
									{t(label)}
								</Link>
							</li>
						))}
					</ul>
					<AppVersion />
				</nav>
				<div className="min-w-0 flex-1">
					<Outlet />
				</div>
			</div>
		</Page>
	);
}

/**
 * The running release, linked to its notes. Nothing while loading or when the
 * route fails: the version is a detail, and the settings work without it.
 */
function AppVersion() {
	const { t } = useTranslation();
	const { data } = useVersion();

	if (data === undefined) {
		return null;
	}

	const url = releaseUrl(data.version);
	const className = "mt-4 block px-3 text-xs text-muted-foreground";

	return url === null ? (
		<p className={className}>{t("settings.developmentVersion")}</p>
	) : (
		<a
			href={url}
			target="_blank"
			rel="noreferrer"
			className={`${className} underline-offset-4 hover:underline`}
		>
			{t("settings.version", { version: data.version })}
		</a>
	);
}
