import type { AccountTab, AccountTypeGroup } from "@/lib/account-group-totals";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Link, useRouterState } from "@tanstack/react-router";
import {
	CalendarIcon,
	EllipsisIcon,
	FunnelIcon,
	GoalIcon,
	LayoutDashboardIcon,
	MenuIcon,
	PiggyBankIcon,
	PlusIcon,
	ReceiptIcon,
	SettingsIcon,
	WalletIcon,
} from "lucide-react";
import { createContext, useContext, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { AccountBalance } from "@/components/AccountBalance";
import { ArchLogo } from "@/components/ArchLogo";
import { LazyCreateAccountDialog } from "@/components/LazyCreateAccountDialog";
import { Money } from "@/components/Money";
import { SettingsNav } from "@/components/SettingsNav";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserMenu } from "@/components/UserMenu";
import { useAccounts } from "@/hooks/useAccounts";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useStoredFlag } from "@/hooks/useStoredFlag";
import { ACCOUNT_TABS, accountTypeGroups, isAccountTab } from "@/lib/account-group-totals";
import { kindOf } from "@/lib/account-kinds";
import { cn } from "@/lib/utils";

export const ACCOUNTS_COLUMN_ID = "accounts-column";

type ShellState = {
	/** Whether the page has the accounts column: settings put their navigation there. */
	hasAccountsColumn: boolean;
	columnOpen: boolean;
	setColumnOpen: (open: boolean) => void;
};

const ShellContext = createContext<ShellState | null>(null);

/** The shell around the page, for `Page`'s fold button; `null` outside it. */
export function useShell(): ShellState | null {
	return useContext(ShellContext);
}

// Sure's order: the home, then the lists, then the settings. `exact` for
// Comptes: on an account page the column's row is the current entry.
// `phone`: one of the bottom bar's four; the others wait under « Plus ».
const DESTINATIONS = [
	{ to: "/", label: "nav.dashboard", icon: LayoutDashboardIcon, exact: false, phone: true },
	{ to: "/transactions", label: "nav.operations", icon: ReceiptIcon, exact: false, phone: true },
	{ to: "/accounts", label: "nav.accounts", icon: WalletIcon, exact: true, phone: false },
	{ to: "/budgets", label: "nav.budgets", icon: PiggyBankIcon, exact: false, phone: true },
	{ to: "/goals", label: "nav.goals", icon: GoalIcon, exact: false, phone: true },
	{ to: "/bills", label: "nav.bills", icon: CalendarIcon, exact: false, phone: false },
	{ to: "/rules", label: "nav.rules", icon: FunnelIcon, exact: false, phone: false },
	{ to: "/settings", label: "nav.settings", icon: SettingsIcon, exact: false, phone: false },
] as const satisfies readonly {
	to: string;
	label: string;
	icon: LucideIcon;
	exact: boolean;
	phone: boolean;
}[];

type Destination = (typeof DESTINATIONS)[number];

const ENTRY =
	"group flex min-w-0 flex-1 flex-col items-center gap-1 py-1.5 text-[11px] leading-[1.27] font-medium text-muted-foreground outline-none hover:text-foreground aria-[current=page]:text-foreground lg:flex-none";

/** An entry's icon tile and label, a link's or the « Plus » button's. */
function EntryContent({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
	return (
		<>
			<span className="grid size-8 place-items-center rounded-lg border border-transparent group-hover:bg-hover group-focus-visible:ring-2 group-focus-visible:ring-ring group-aria-[current=page]:border-border group-aria-[current=page]:bg-card group-aria-expanded:bg-hover">
				<Icon aria-hidden="true" className="size-4" />
			</span>
			<span className="max-w-full truncate">{label}</span>
		</>
	);
}

function DestinationLink({ destination }: { destination: Destination }) {
	const { t } = useTranslation();
	const { to, label, icon, exact } = destination;

	return (
		<Link to={to} activeOptions={{ exact, includeSearch: false }} className={ENTRY}>
			<EntryContent icon={icon} label={t(label)} />
		</Link>
	);
}

/** Whether `pathname` is `destination`'s page, as the router's `Link` decides it. */
function isAt(pathname: string, { to, exact }: Destination): boolean {
	return pathname === to || (!exact && pathname.startsWith(`${to}/`));
}

/**
 * The rail: every destination. The router's `Link` sets `aria-current="page"`
 * on the current one; the search params never decide it.
 */
function MainNav({ className }: { className?: string }) {
	const { t } = useTranslation();

	return (
		<nav aria-label={t("nav.main")} className={className}>
			{DESTINATIONS.map((destination) => (
				<DestinationLink key={destination.to} destination={destination} />
			))}
		</nav>
	);
}

/**
 * Below 1024 px, Sure's bottom bar of four to six entries: « Accueil »,
 * « Opérations », « Budgets » and « Objectifs », then « Plus », a menu of
 * the others, marked current when the page is one of them. Eight entries cut
 * their labels at 390 px. The accounts list and the settings are also in the
 * top bar's menu and avatar, as Sure's.
 */
function BottomNav({ className }: { className?: string }) {
	const { t } = useTranslation();
	const pathname = useRouterState({ select: (router) => router.location.pathname });
	const more = DESTINATIONS.filter((destination) => !destination.phone);
	const inMore = more.some((destination) => isAt(pathname, destination));

	return (
		<nav aria-label={t("nav.main")} className={className}>
			{DESTINATIONS.filter((destination) => destination.phone).map((destination) => (
				<DestinationLink key={destination.to} destination={destination} />
			))}
			<DropdownMenu>
				<DropdownMenuTrigger aria-current={inMore ? "page" : undefined} className={ENTRY}>
					<EntryContent icon={EllipsisIcon} label={t("nav.more")} />
				</DropdownMenuTrigger>
				<DropdownMenuContent side="top" align="end" aria-label={t("nav.moreMenu")}>
					{more.map(({ to, label, icon: Icon, exact }) => (
						<DropdownMenuItem key={to} asChild>
							<Link to={to} activeOptions={{ exact, includeSearch: false }}>
								<Icon aria-hidden="true" />
								{t(label)}
							</Link>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</nav>
	);
}

function AccountGroup({ group, currency }: { group: AccountTypeGroup; currency: string }) {
	const { t } = useTranslation();
	// Unique: the wide column stays mounted, hidden, while the sheet shows its copy.
	const labelId = useId();

	return (
		// A group, not a region or a heading: the page's own regions and
		// headings keep their names to themselves.
		<div role="group" aria-labelledby={labelId} className="flex flex-col gap-0.5">
			<div className="flex items-center justify-between gap-2 px-3 py-1.5 type-overline text-muted-foreground">
				<span id={labelId}>{t(`dashboard.balanceSheet.types.${group.type}`)}</span>
				{/* The accounts page says it in full; the column has no room for it. */}
				<span
					title={
						group.excludedCount > 0
							? t("accounts.excluded", { count: group.excludedCount })
							: undefined
					}
				>
					<Money amount={group.total} currency={currency} />
				</span>
			</div>
			<ul className="flex flex-col gap-0.5">
				{group.accounts.map((account) => (
					<li key={account.id}>
						<Link
							to="/accounts/$accountId"
							params={{ accountId: account.id }}
							className="flex items-center gap-3 rounded-lg px-3 py-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-sidebar-accent"
						>
							<TintedIcon subject={{ kind: "account", type: account.type }} size="md" />
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="truncate font-medium">{account.name}</span>
								<span className="truncate text-xs text-muted-foreground">
									{t(`accounts.subtypes.${kindOf(account.type, account.subtype)}`)}
								</span>
							</span>
							<AccountBalance account={account} className="font-medium" />
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}

function AccountGroups({ groups, currency }: { groups: AccountTypeGroup[]; currency: string }) {
	const { t } = useTranslation();

	if (groups.length === 0) {
		return <p className="px-3 text-muted-foreground">{t("accountsColumn.empty")}</p>;
	}

	return groups.map((group) => <AccountGroup key={group.type} group={group} currency={currency} />);
}

function AccountList() {
	const { t } = useTranslation();
	const accounts = useAccounts();
	const [tab, setTab] = useState<AccountTab>("all");

	if (accounts.isPending) {
		return (
			<div aria-hidden="true" className="flex flex-col gap-2">
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
			</div>
		);
	}

	// The accounts page and the dashboard say what failed; the column stays quiet.
	if (accounts.data === undefined) {
		return null;
	}

	const list = accounts.data;

	// A fresh instance: « Ajouter un compte » alone, no empty tabs.
	if (accountTypeGroups(list, "all").length === 0) {
		return null;
	}

	return (
		<Tabs
			value={tab}
			onValueChange={(value) => {
				if (isAccountTab(value)) {
					setTab(value);
				}
			}}
			className="gap-3"
		>
			<TabsList aria-label={t("accountsColumn.tabs.label")} className="w-full">
				{ACCOUNT_TABS.map((value) => (
					<TabsTrigger key={value} value={value}>
						{t(`accountsColumn.tabs.${value}`)}
					</TabsTrigger>
				))}
			</TabsList>
			{ACCOUNT_TABS.map((value) => (
				<TabsContent key={value} value={value} className="flex flex-col gap-3">
					<AccountGroups
						groups={accountTypeGroups(list, value)}
						currency={list.reportingCurrency}
					/>
				</TabsContent>
			))}
		</Tabs>
	);
}

/**
 * Sure's accounts column: « Ajouter un compte », for an administrator, then
 * the active accounts by type with each type's total, filtered by the Tout,
 * Actifs and Passifs tabs.
 */
function AccountsColumn({ id }: { id?: string }) {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const [creating, setCreating] = useState(false);

	return (
		<aside id={id} aria-label={t("accountsColumn.label")} className="flex flex-col gap-3 p-3">
			{admin && (
				<>
					<Button variant="outline" className="w-full" onClick={() => setCreating(true)}>
						<PlusIcon aria-hidden="true" />
						{t("accounts.add")}
					</Button>
					<LazyCreateAccountDialog open={creating} onOpenChange={setCreating} />
				</>
			)}
			<AccountList />
		</aside>
	);
}

/**
 * Every signed-in page's frame, Sure's « frame A »: from 1024 px the rail,
 * then the accounts column, or the settings navigation on a settings page,
 * then the page; below, a top bar, a bottom navigation and the column in a
 * full-screen sheet. The page draws its own top bar and header through `Page`.
 */
export function AppShell({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const pathname = useRouterState({ select: (router) => router.location.pathname });
	const [columnOpen, setColumnOpen] = useStoredFlag("archant.accountsColumn", true);
	const [menuOpen, setMenuOpen] = useState(false);
	const isSettings = pathname === "/settings" || pathname.startsWith("/settings/");
	// One id, on the wide column the fold button controls; the sheet's copy has none.
	const column = (id?: string) =>
		isSettings ? <SettingsNav /> : <AccountsColumn {...(id === undefined ? {} : { id })} />;

	const isWide = useMediaQuery("(min-width: 1024px)");

	// Past 1024 px the rail and the column take over from the sheet.
	useEffect(() => {
		if (isWide) {
			setMenuOpen(false);
		}
	}, [isWide]);

	return (
		<ShellContext.Provider value={{ hasAccountsColumn: !isSettings, columnOpen, setColumnOpen }}>
			{/* Around the whole frame, so the menu button is the sheet's trigger and gets the focus back. */}
			<Sheet open={menuOpen} onOpenChange={setMenuOpen}>
				<div className="flex min-h-svh bg-background">
					<div className="sticky top-0 hidden h-svh w-[84px] shrink-0 flex-col items-center gap-4 border-r py-4 lg:flex">
						<ArchLogo label={t("app.name")} className="size-7" />
						<MainNav className="flex w-full flex-col gap-1" />
						<div className="mt-auto">
							<UserMenu side="right" />
						</div>
					</div>
					{(isSettings || columnOpen) && (
						<div
							className={cn(
								"sticky top-0 hidden h-svh shrink-0 overflow-y-auto border-r lg:block",
								isSettings ? "w-64" : "w-80",
							)}
						>
							{column(ACCOUNTS_COLUMN_ID)}
						</div>
					)}
					<div className="flex min-w-0 flex-1 flex-col">
						<header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-background px-3 lg:hidden">
							<SheetTrigger asChild>
								<Button variant="ghost" size="icon" aria-label={t("nav.openMenu")}>
									<MenuIcon />
								</Button>
							</SheetTrigger>
							<ArchLogo label={t("app.name")} className="size-7" />
							<div className="ml-auto">
								<UserMenu side="bottom" />
							</div>
						</header>
						{/* Room for the bottom navigation, which covers the page's foot. */}
						<main className="flex min-w-0 flex-1 flex-col pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
							{children}
						</main>
					</div>
					<BottomNav className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background px-1 pb-[env(safe-area-inset-bottom)] lg:hidden" />
					<SheetContent
						side="left"
						aria-describedby={undefined}
						// A link in the sheet, even to the current page, has done its job.
						onClick={(event) => {
							if (event.target instanceof Element && event.target.closest("a") !== null) {
								setMenuOpen(false);
							}
						}}
						className="overflow-y-auto bg-background pt-12 motion-reduce:transition-none data-[side=left]:w-full data-[side=left]:border-r-0 data-[side=left]:sm:max-w-none motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none"
					>
						<SheetTitle className="sr-only">
							{isSettings ? t("settings.title") : t("accountsColumn.label")}
						</SheetTitle>
						{column()}
					</SheetContent>
				</div>
			</Sheet>
		</ShellContext.Provider>
	);
}
