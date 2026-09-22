import { Link, useRouteContext } from "@tanstack/react-router";
import { LogOutIcon, SettingsIcon, UserIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { useSignOut } from "@/hooks/useSignOut";

/** The administrator's menu in the sidebar footer: settings and sign-out. */
export function UserMenu() {
	const { t } = useTranslation();
	// The layout's `beforeLoad` already has the session; asking Better Auth
	// again here would add a round trip to every page.
	const { session } = useRouteContext({ from: "/_authed" });
	const signOut = useSignOut();
	const email = session.user.email;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<SidebarMenuButton tooltip={email}>
					<UserIcon />
					<span className="truncate">{email}</span>
				</SidebarMenuButton>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="top" align="start" className="min-w-56">
				<DropdownMenuLabel className="truncate font-normal text-muted-foreground">
					{email}
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link to="/reglages">
						<SettingsIcon />
						{t("nav.settings")}
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => void signOut()}>
					<LogOutIcon />
					{t("nav.signOut")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
