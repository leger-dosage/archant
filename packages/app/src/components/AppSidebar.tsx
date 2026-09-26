import type { AccountGroupData } from "@/hooks/useAccounts";

import { Link, useRouterState } from "@tanstack/react-router";
import {
	CalendarIcon,
	ChevronRightIcon,
	FunnelIcon,
	LayoutDashboardIcon,
	ReceiptIcon,
	WalletIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { AccountBalance } from "@/components/AccountBalance";
import { ArchLogo } from "@/components/ArchLogo";
import { Money } from "@/components/Money";
import { ThemeMenu } from "@/components/ThemeMenu";
import { TintedIcon } from "@/components/TintedIcon";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
	useSidebar,
} from "@/components/ui/sidebar";
import { UserMenu } from "@/components/UserMenu";
import { useAccounts } from "@/hooks/useAccounts";
import { useStoredFlag } from "@/hooks/useStoredFlag";
import { cn } from "@/lib/utils";

// DESIGN.md `sidebar-item`: 28 px, secondary text and a muted icon; the
// active entry takes the active background and the primary text, no bar.
const ENTRY =
	"h-7 font-medium text-foreground-secondary [&>svg]:text-muted-foreground data-active:[&>svg]:text-sidebar-accent-foreground";

function SidebarAccountGroup({ group, currency }: { group: AccountGroupData; currency: string }) {
	const { t } = useTranslation();
	const pathname = useRouterState({ select: (router) => router.location.pathname });
	const [open, setOpen] = useStoredFlag(`archant.sidebar.${group.classification}`, true);

	return (
		<SidebarGroup className="py-1">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				// The accounts page shows this notice in full; the sidebar has no room for it.
				title={
					group.excludedCount > 0
						? t("accounts.excluded", { count: group.excludedCount })
						: undefined
				}
				className="flex h-8 w-full items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground outline-hidden hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
			>
				<ChevronRightIcon
					className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
				/>
				<span className="flex-1 text-left">{t(`accounts.groups.${group.classification}`)}</span>
				<Money amount={group.total} currency={currency} className="font-medium" />
			</button>
			{open && (
				<SidebarMenu>
					{group.accounts.map((account) => (
						<SidebarMenuItem key={account.id}>
							<SidebarMenuButton
								asChild
								isActive={pathname === `/accounts/${account.id}`}
								className="h-7 gap-2 text-foreground-secondary"
							>
								<Link to="/accounts/$accountId" params={{ accountId: account.id }}>
									<TintedIcon subject={{ kind: "account", type: account.type }} size="sm" />
									<span className="min-w-0 flex-1 truncate">{account.name}</span>
									<AccountBalance account={account} className="text-xs" />
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			)}
		</SidebarGroup>
	);
}

function SidebarAccounts() {
	const accounts = useAccounts();

	if (accounts.isPending) {
		return (
			<SidebarGroup aria-hidden="true">
				<SidebarMenuSkeleton />
				<SidebarMenuSkeleton />
			</SidebarGroup>
		);
	}

	if (accounts.data === undefined) {
		return null;
	}

	const { groups, reportingCurrency } = accounts.data;

	// Inactive accounts are hidden here; the accounts page can still show them.
	return groups
		.map((group) => ({ ...group, accounts: group.accounts.filter((account) => account.active) }))
		.filter((group) => group.accounts.length > 0)
		.map((group) => (
			<SidebarAccountGroup key={group.classification} group={group} currency={reportingCurrency} />
		));
}

export function AppSidebar() {
	const { t } = useTranslation();
	const { state, isMobile } = useSidebar();
	const pathname = useRouterState({ select: (router) => router.location.pathname });
	// Collapsed to icons there is no room for names and balances; the accounts
	// page lists them instead (EXPERIENCE.md, 768 to 1023 px).
	const showAccounts = isMobile || state === "expanded";

	return (
		<Sidebar collapsible="icon" variant="inset">
			<SidebarHeader>
				<div className="flex h-8 items-center gap-2 px-2 font-semibold group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
					{/* The mark carries the name, so it stays named once collapsed to icons. */}
					<ArchLogo label={t("app.name")} />
					<span aria-hidden="true" className="truncate group-data-[collapsible=icon]:hidden">
						{t("app.name")}
					</span>
				</div>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								isActive={pathname === "/"}
								tooltip={t("nav.dashboard")}
								className={ENTRY}
							>
								<Link to="/">
									<LayoutDashboardIcon />
									<span>{t("nav.dashboard")}</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								// Exact: on an account page its own row is the active one.
								isActive={pathname === "/accounts" || pathname === "/accounts/"}
								tooltip={t("nav.accounts")}
								className={ENTRY}
							>
								<Link to="/accounts">
									<WalletIcon />
									<span>{t("nav.accounts")}</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								isActive={pathname === "/transactions"}
								tooltip={t("nav.operations")}
								className={ENTRY}
							>
								<Link to="/transactions">
									<ReceiptIcon />
									<span>{t("nav.operations")}</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								isActive={pathname === "/recurring"}
								tooltip={t("nav.recurring")}
								className={ENTRY}
							>
								<Link to="/recurring">
									<CalendarIcon />
									<span>{t("nav.recurring")}</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								isActive={pathname === "/rules"}
								tooltip={t("nav.rules")}
								className={ENTRY}
							>
								<Link to="/rules">
									<FunnelIcon />
									<span>{t("nav.rules")}</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
				{showAccounts && <SidebarAccounts />}
			</SidebarContent>
			<SidebarFooter>
				<SidebarMenu>
					<SidebarMenuItem>
						<ThemeMenu />
					</SidebarMenuItem>
					<SidebarMenuItem>
						<UserMenu />
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
		</Sidebar>
	);
}
