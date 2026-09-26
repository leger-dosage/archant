import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { BanknoteIcon, ShapesIcon, ShieldCheckIcon, StoreIcon, TagsIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authed/settings")({
	component: SettingsLayout,
});

// Sure's icons, from `settings/_settings_nav.html.erb`.
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
		<div className="flex w-full max-w-[1200px] flex-col gap-6 p-6">
			<h1 className="text-3xl font-semibold tracking-tight">{t("settings.title")}</h1>
			<div className="flex flex-col gap-6 md:flex-row">
				<nav aria-label={t("settings.title")} className="md:w-48 md:shrink-0">
					<ul className="flex flex-col gap-1">
						{SECTIONS.map((section) => (
							<li key={section.to}>
								<Link
									to={section.to}
									// The sidebar's raised tile: `bg-accent` vanishes on the page grey.
									activeProps={{ className: "bg-card font-medium text-foreground shadow-ring" }}
									className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-card"
								>
									<section.icon className="size-4 shrink-0" />
									{t(section.label)}
								</Link>
							</li>
						))}
					</ul>
				</nav>
				<div className="min-w-0 flex-1">
					<Outlet />
				</div>
			</div>
		</div>
	);
}
