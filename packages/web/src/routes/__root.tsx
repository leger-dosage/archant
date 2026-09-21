import { Outlet, createRootRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppSidebar } from "@/components/AppSidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useMediaQuery } from "@/hooks/useMediaQuery";

export const Route = createRootRoute({ component: RootLayout });

function RootLayout() {
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
				<header className="flex h-12 shrink-0 items-center border-b px-3">
					<SidebarTrigger />
				</header>
				<Outlet />
			</SidebarInset>
		</SidebarProvider>
	);
}
