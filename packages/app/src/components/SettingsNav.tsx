import { Link } from "@tanstack/react-router";
import {
	BanknoteIcon,
	BoltIcon,
	BotIcon,
	ChartLineIcon,
	DatabaseIcon,
	DownloadIcon,
	RepeatIcon,
	ShapesIcon,
	ShieldCheckIcon,
	StoreIcon,
	TagsIcon,
	UsersIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useRole } from "@/hooks/usePermissions";
import { useVersion } from "@/hooks/useVersion";
import { canWrite, isAdmin } from "@/lib/auth-client";
import { releaseUrl } from "@/lib/release";

// Sure's settings icons.
export const SETTINGS_SECTIONS = [
	{ to: "/settings/banks", adminOnly: true, label: "settings.sections.banks", icon: BanknoteIcon },
	{ to: "/settings/preferences", label: "settings.sections.preferences", icon: BoltIcon },
	{
		to: "/settings/investments",
		adminOnly: true,
		label: "settings.sections.investments",
		icon: ChartLineIcon,
	},
	{ to: "/settings/categories", label: "settings.sections.categories", icon: ShapesIcon },
	{ to: "/settings/merchants", label: "settings.sections.merchants", icon: StoreIcon },
	{ to: "/settings/tags", label: "settings.sections.tags", icon: TagsIcon },
	{ to: "/settings/recurring", label: "settings.sections.recurring", icon: RepeatIcon },
	{
		to: "/settings/assistants",
		adminOnly: true,
		label: "settings.sections.assistants",
		icon: BotIcon,
	},
	// Sure's « Importations », with its icon, beside the export.
	{ to: "/settings/imports", label: "settings.sections.imports", icon: DownloadIcon },
	{ to: "/settings/data", adminOnly: true, label: "settings.sections.data", icon: DatabaseIcon },
	{ to: "/settings/members", adminOnly: true, label: "settings.sections.members", icon: UsersIcon },
	{ to: "/settings/security", label: "settings.sections.security", icon: ShieldCheckIcon },
] as const;

/** The sidebar and the route guard use the same permissions, including nested pages. */
export function canAccessSettings(path: string, role: string | null | undefined): boolean {
	if (isAdmin(role)) {
		return true;
	}

	const section = SETTINGS_SECTIONS.find(({ to }) => path === to || path.startsWith(`${to}/`));

	if (section?.to === "/settings/security") {
		return true;
	}

	return (
		canWrite(role) &&
		(path === "/settings" ||
			path === "/settings/" ||
			(section !== undefined && !("adminOnly" in section)))
	);
}

/**
 * The settings sections, in the shell's column where the accounts list sits on
 * every other page, as in Sure. Not a route export: the router plugin splits
 * route files, and the shell renders this outside the settings route.
 */
export function SettingsNav() {
	const { t } = useTranslation();
	const role = useRole();
	const sections = SETTINGS_SECTIONS.filter(({ to }) => canAccessSettings(to, role));

	return (
		<nav aria-label={t("settings.title")} className="flex flex-col gap-4 p-3">
			<ul className="flex flex-col gap-1">
				{sections.map(({ to, label, icon: Icon }) => (
					<li key={to}>
						<Link
							to={to}
							className="flex h-9 items-center gap-2 rounded-lg px-3 font-medium text-foreground-secondary outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-foreground"
						>
							<Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
							{t(label)}
						</Link>
					</li>
				))}
			</ul>
			<AppVersion />
		</nav>
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
	const className = "block px-3 text-xs text-muted-foreground";

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
