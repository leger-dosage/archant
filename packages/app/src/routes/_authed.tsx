import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AppSidebar } from "@/components/AppSidebar";
import { BankAlerts } from "@/components/BankAlerts";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { isSetupOpen, sessionQuery } from "@/lib/auth-client";

/**
 * Every page behind the sign-in, with the sidebar layout. Without a session,
 * the visitor goes to setup on a first launch, and to sign-in otherwise,
 * carrying the URL to come back to.
 */
export const Route = createFileRoute("/_authed")({
	beforeLoad: async ({ context, location }) => {
		const session = await context.queryClient.ensureQueryData(sessionQuery);

		if (session !== null) {
			return { session };
		}

		if (await isSetupOpen()) {
			throw redirect({ to: "/setup" });
		}

		throw redirect({ to: "/sign-in", search: { redirect: location.href } });
	},
	component: AuthedLayout,
});

function AuthedLayout() {
	const { t } = useTranslation();
	// EXPERIENCE.md: full sidebar from 1024 px, icons below, a sheet below 768 px
	// (the sidebar component handles that last step on its own).
	const isWide = useMediaQuery("(min-width: 1024px)");
	const [open, setOpen] = useState(isWide);

	useEffect(() => {
		setOpen(isWide);
	}, [isWide]);

	return (
		<SidebarProvider
			open={open}
			onOpenChange={setOpen}
			style={{ "--sidebar-width": "240px", "--sidebar-width-icon": "56px" }}
		>
			<AppSidebar />
			<SidebarInset>
				<header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
					<Tooltip>
						<TooltipTrigger asChild>
							<SidebarTrigger />
						</TooltipTrigger>
						<TooltipContent side="bottom">{t("nav.toggleSidebar")}</TooltipContent>
					</Tooltip>
				</header>
				<BankAlerts />
				<Outlet />
			</SidebarInset>
		</SidebarProvider>
	);
}
