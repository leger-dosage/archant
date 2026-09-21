import type { AccountGroupData } from "@/hooks/useAccounts";

import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRightIcon, ListIcon, WalletIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Money } from "@/components/Money";
import { ThemeMenu } from "@/components/ThemeMenu";
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
import { useAccounts } from "@/hooks/useAccounts";
import { useStoredFlag } from "@/hooks/useStoredFlag";
import { cn } from "@/lib/utils";

// DESIGN.md: the active entry carries a 2 px accent bar on its left edge.
const ACTIVE_INDICATOR =
	"data-active:bg-sidebar-accent data-active:before:absolute data-active:before:inset-y-1.5 data-active:before:left-0 data-active:before:w-0.5 data-active:before:rounded-full data-active:before:bg-accent-brand data-active:before:content-['']";

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
								isActive={pathname === `/comptes/${account.id}`}
								className={cn("justify-between gap-2 pl-6", ACTIVE_INDICATOR)}
							>
								<Link to="/comptes/$accountId" params={{ accountId: account.id }}>
									<span className="truncate">{account.name}</span>
									<Money amount={account.balance} currency={account.currency} className="text-xs" />
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

	return groups
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
		<Sidebar collapsible="icon">
			<SidebarHeader>
				<div className="flex h-8 items-center gap-2 px-2 font-semibold group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
					<span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary text-xs text-primary-foreground">
						{t("app.name").charAt(0)}
					</span>
					<span className="truncate group-data-[collapsible=icon]:hidden">{t("app.name")}</span>
				</div>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								// Exact: on an account page its own row carries the indicator.
								isActive={pathname === "/comptes" || pathname === "/comptes/"}
								tooltip={t("nav.accounts")}
								className={ACTIVE_INDICATOR}
							>
								<Link to="/comptes">
									<WalletIcon />
									<span>{t("nav.accounts")}</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton
								asChild
								isActive={pathname === "/operations"}
								tooltip={t("nav.operations")}
								className={ACTIVE_INDICATOR}
							>
								<Link to="/operations">
									<ListIcon />
									<span>{t("nav.operations")}</span>
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
				</SidebarMenu>
			</SidebarFooter>
		</Sidebar>
	);
}
