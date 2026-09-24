import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authed/reglages")({
	component: SettingsLayout,
});

const SECTIONS = [
	{ to: "/reglages/banques", label: "settings.sections.banks" },
	{ to: "/reglages/categories", label: "settings.sections.categories" },
	{ to: "/reglages/marchands", label: "settings.sections.merchants" },
	{ to: "/reglages/etiquettes", label: "settings.sections.tags" },
	{ to: "/reglages/securite", label: "settings.sections.security" },
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
									activeProps={{ className: "bg-accent text-accent-foreground" }}
									className="block rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
								>
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
