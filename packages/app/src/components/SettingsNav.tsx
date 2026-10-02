import { Link } from "@tanstack/react-router";
import {
	BanknoteIcon,
	BotIcon,
	ShapesIcon,
	ShieldCheckIcon,
	StoreIcon,
	TagsIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useVersion } from "@/hooks/useVersion";
import { releaseUrl } from "@/lib/release";

// Sure's settings icons.
export const SETTINGS_SECTIONS = [
	{ to: "/settings/banks", label: "settings.sections.banks", icon: BanknoteIcon },
	{ to: "/settings/categories", label: "settings.sections.categories", icon: ShapesIcon },
	{ to: "/settings/merchants", label: "settings.sections.merchants", icon: StoreIcon },
	{ to: "/settings/tags", label: "settings.sections.tags", icon: TagsIcon },
	{ to: "/settings/assistants", label: "settings.sections.assistants", icon: BotIcon },
	{ to: "/settings/security", label: "settings.sections.security", icon: ShieldCheckIcon },
] as const;

/**
 * The settings sections, in the shell's column where the accounts list sits on
 * every other page, as in Sure. Not a route export: the router plugin splits
 * route files, and the shell renders this outside the settings route.
 */
export function SettingsNav() {
	const { t } = useTranslation();

	return (
		<nav aria-label={t("settings.title")} className="flex flex-col gap-4 p-3">
			<ul className="flex flex-col gap-1">
				{SETTINGS_SECTIONS.map(({ to, label, icon: Icon }) => (
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
