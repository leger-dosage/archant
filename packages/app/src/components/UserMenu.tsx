import { Link, useRouteContext } from "@tanstack/react-router";
import { LogOutIcon, SettingsIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ThemeMenu } from "@/components/ThemeMenu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSignOut } from "@/hooks/useSignOut";

/**
 * The administrator's avatar, at the foot of the rail and on the right of the
 * narrow screens' top bar: the theme, Réglages and Se déconnecter.
 */
export function UserMenu({ side }: { side: "right" | "bottom" }) {
	const { t } = useTranslation();
	// The layout's `beforeLoad` already has the session; asking Better Auth
	// again here would add a round trip to every page.
	const { session } = useRouteContext({ from: "/_authed" });
	const signOut = useSignOut();
	const { email, name } = session.user;
	const initial = (name.trim() || email).charAt(0).toUpperCase();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				// The address names the button: the initial alone says nothing.
				aria-label={email}
				className="grid size-9 shrink-0 place-items-center rounded-full border bg-card text-sm font-medium text-foreground outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-hover"
			>
				<span aria-hidden="true">{initial}</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent side={side} align="end">
				<DropdownMenuLabel className="truncate font-normal">{email}</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<ThemeMenu />
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link to="/settings">
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
