import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { ArchLogo } from "@/components/ArchLogo";
import { layoutForRole } from "@/lib/role-layout";

declare module "@tanstack/react-router" {
	interface HistoryState {
		introGuestOnly?: true;
	}
}

export const Route = createFileRoute("/_authed/intro")({
	beforeLoad: ({ context }) => {
		if (layoutForRole(context.session.user.role) !== "intro") {
			throw redirect({ to: "/", state: { introGuestOnly: true }, replace: true });
		}
	},
	component: IntroPage,
});

function IntroPage() {
	const { t } = useTranslation();

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("nav.intro"), app: t("app.name") });
	}, [t]);

	return (
		<div className="flex flex-col gap-6 px-3 py-6 lg:px-10">
			<h1 className="page-title">{t("intro.welcome")}</h1>
			<div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 rounded-2xl border bg-card p-8 text-center">
				<ArchLogo className="size-16" />
				<h2 className="text-xl font-semibold">{t("intro.comingSoon")}</h2>
			</div>
		</div>
	);
}
