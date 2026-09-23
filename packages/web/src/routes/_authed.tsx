import { Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { KeyboardIcon, SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AppSidebar } from "@/components/AppSidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { CommandsProvider } from "@/components/CommandsProvider";
import { CreateAccountDialog } from "@/components/CreateAccountDialog";
import { ShortcutHint } from "@/components/ShortcutHint";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCommands } from "@/hooks/useCommands";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useShortcut } from "@/hooks/useShortcut";
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

		throw redirect({ to: "/connexion", search: { redirect: location.href } });
	},
	component: AuthedLayout,
});

function GlobalShortcuts() {
	const navigate = useNavigate();
	const { setPaletteOpen, setShortcutsOpen } = useCommands();

	useShortcut("palette", () => setPaletteOpen(true));
	useShortcut("shortcuts", () => setShortcutsOpen(true));
	useShortcut("goDashboard", () => void navigate({ to: "/" }));
	useShortcut("goAccounts", () => void navigate({ to: "/comptes" }));
	useShortcut("goOperations", () => void navigate({ to: "/operations" }));
	useShortcut("goSettings", () => void navigate({ to: "/reglages" }));

	return null;
}

/** `⌘B`, inside `SidebarProvider` since it needs the sidebar's own toggle. */
function SidebarShortcut() {
	const { toggleSidebar } = useSidebar();

	useShortcut("toggleSidebar", toggleSidebar);

	return null;
}

/** The visible equivalents of `⌘K` and `?`, each showing its shortcut in a tooltip. */
function HeaderActions() {
	const { t } = useTranslation();
	const { setPaletteOpen, setShortcutsOpen } = useCommands();

	return (
		<div className="ml-auto flex items-center gap-1">
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="outline" size="sm" onClick={() => setPaletteOpen(true)}>
						<SearchIcon />
						{t("commands.open")}
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					<ShortcutHint id="palette" label={t("commands.title")} />
				</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("shortcuts.open")}
						onClick={() => setShortcutsOpen(true)}
					>
						<KeyboardIcon />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					<ShortcutHint id="shortcuts" label={t("shortcuts.open")} />
				</TooltipContent>
			</Tooltip>
		</div>
	);
}

function AccountDialog() {
	const { creatingAccount, setCreatingAccount } = useCommands();

	return <CreateAccountDialog open={creatingAccount} onOpenChange={setCreatingAccount} />;
}

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
		<CommandsProvider>
			<SidebarProvider
				open={open}
				onOpenChange={setOpen}
				style={{ "--sidebar-width": "240px", "--sidebar-width-icon": "56px" }}
			>
				<SidebarShortcut />
				<AppSidebar />
				<SidebarInset>
					<header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
						<Tooltip>
							<TooltipTrigger asChild>
								<SidebarTrigger />
							</TooltipTrigger>
							<TooltipContent side="bottom">
								<ShortcutHint id="toggleSidebar" label={t("nav.toggleSidebar")} />
							</TooltipContent>
						</Tooltip>
						<HeaderActions />
					</header>
					<Outlet />
				</SidebarInset>
			</SidebarProvider>
			<GlobalShortcuts />
			<CommandPalette />
			<ShortcutsDialog />
			<AccountDialog />
		</CommandsProvider>
	);
}
