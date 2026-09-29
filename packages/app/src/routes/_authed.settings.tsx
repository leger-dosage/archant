import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Page } from "@/components/Page";

export const Route = createFileRoute("/_authed/settings")({
	component: SettingsLayout,
});

/**
 * The settings sections. Their navigation sits in the shell's column
 * (`SettingsNav`), and the section is centred, at most 896 px wide, as in Sure.
 */
function SettingsLayout() {
	const { t } = useTranslation();

	return (
		<Page title={t("settings.title")}>
			<div className="mx-auto w-full max-w-4xl min-w-0">
				<Outlet />
			</div>
		</Page>
	);
}
