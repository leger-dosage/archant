import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppSidebar } from "@/components/AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { isSetupOpen, sessionQuery } from "@/lib/auth-client";

/**
 * Every page behind the sign-in: the sidebar on the base background and the
 * page in the inset panel. Without a session, the visitor goes to setup on a
 * first launch, and to sign-in otherwise, carrying the URL to come back to.
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
			{/* Each page draws its title bar and bank alerts through `Page`. */}
			<SidebarInset>
				<Outlet />
			</SidebarInset>
		</SidebarProvider>
	);
}
