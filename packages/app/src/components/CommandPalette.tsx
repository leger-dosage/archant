import type { ShortcutId } from "@/lib/shortcuts";
import type { ReactNode } from "react";

import { useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { AccountBalance } from "@/components/AccountBalance";
import { ShortcutKeys } from "@/components/ShortcutHint";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "@/components/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useAccounts } from "@/hooks/useAccounts";
import { useCommands } from "@/hooks/useCommands";
import { useSignOut } from "@/hooks/useSignOut";
import { matchesCommand } from "@/lib/shortcuts";
import { THEME_CHOICES, setThemeChoice } from "@/lib/theme";

type Item = {
	id: string;
	label: string;
	shortcut?: ShortcutId;
	run: () => void;
	extra?: ReactNode;
};

// cmdk's own filter scores fuzzy matches and knows nothing of accents:
// « operations » must find « Opérations ».
const filter = (_value: string, search: string, keywords?: string[]) =>
	matchesCommand((keywords ?? []).join(" "), search) ? 1 : 0;

function PaletteGroup({
	heading,
	items,
	onSelect,
}: {
	heading: string;
	items: readonly Item[];
	onSelect: (item: Item) => void;
}) {
	if (items.length === 0) {
		return null;
	}

	return (
		<CommandGroup heading={heading}>
			{items.map((item) => (
				<CommandItem
					key={item.id}
					value={item.id}
					keywords={[item.label]}
					onSelect={() => onSelect(item)}
				>
					<span className="min-w-0 flex-1 truncate">{item.label}</span>
					{item.extra}
					{item.shortcut !== undefined && (
						<CommandShortcut className="tracking-normal">
							<ShortcutKeys id={item.shortcut} main />
						</CommandShortcut>
					)}
				</CommandItem>
			))}
		</CommandGroup>
	);
}

/** The `⌘K` palette: pages, actions and active accounts. */
export function CommandPalette() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const accounts = useAccounts();
	const signOut = useSignOut();
	const { paletteOpen, setPaletteOpen, setCreatingAccount, setShortcutsOpen, pageCommands } =
		useCommands();
	// Radix returns focus to a `DialogTrigger`; the palette opens from a
	// shortcut anywhere, so it remembers where focus was itself.
	const opener = useRef<HTMLElement | null>(null);
	// Runs once the palette is gone, so a sheet it opens sees the page's focus
	// as its opener rather than the palette's field, and a dialog never stacks
	// on the palette.
	const pending = useRef<(() => void) | null>(null);

	const goTo: Item[] = [
		{
			id: "go-dashboard",
			label: t("nav.dashboard"),
			shortcut: "goDashboard",
			run: () => void navigate({ to: "/" }),
		},
		{
			id: "go-accounts",
			label: t("nav.accounts"),
			shortcut: "goAccounts",
			run: () => void navigate({ to: "/accounts" }),
		},
		{
			id: "go-operations",
			label: t("nav.operations"),
			shortcut: "goOperations",
			run: () => void navigate({ to: "/transactions" }),
		},
		{
			id: "go-recurring",
			label: t("nav.recurring"),
			shortcut: "goRecurring",
			run: () => void navigate({ to: "/recurring" }),
		},
		{
			id: "go-rules",
			label: t("nav.rules"),
			shortcut: "goRules",
			run: () => void navigate({ to: "/rules" }),
		},
		{
			id: "go-settings",
			label: t("nav.settings"),
			shortcut: "goSettings",
			run: () => void navigate({ to: "/settings" }),
		},
		{
			id: "go-categories",
			label: t("settings.sections.categories"),
			run: () => void navigate({ to: "/settings/categories" }),
		},
		{
			id: "go-merchants",
			label: t("settings.sections.merchants"),
			run: () => void navigate({ to: "/settings/merchants" }),
		},
		{
			id: "go-tags",
			label: t("settings.sections.tags"),
			run: () => void navigate({ to: "/settings/tags" }),
		},
	];
	const actions: Item[] = [
		{ id: "add-account", label: t("accounts.add"), run: () => setCreatingAccount(true) },
		...pageCommands,
		...THEME_CHOICES.map((choice) => ({
			id: `theme-${choice}`,
			label: t(`commands.themes.${choice}`),
			run: () => setThemeChoice(choice),
		})),
		{ id: "sign-out", label: t("nav.signOut"), run: () => void signOut() },
		{
			id: "show-shortcuts",
			label: t("commands.showShortcuts"),
			shortcut: "shortcuts",
			run: () => setShortcutsOpen(true),
		},
	];
	const accountItems: Item[] = (accounts.data?.groups ?? [])
		.flatMap((group) => group.accounts)
		.filter((account) => account.active)
		.map((account) => ({
			id: `account-${account.id}`,
			label: account.name,
			extra: <AccountBalance account={account} className="text-xs" />,
			run: () => void navigate({ to: "/accounts/$accountId", params: { accountId: account.id } }),
		}));

	const select = (item: Item) => {
		pending.current = item.run;
		setPaletteOpen(false);
	};

	return (
		<Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
			<DialogContent
				showCloseButton={false}
				className="top-1/4 translate-y-0 overflow-hidden rounded-xl! p-0 sm:max-w-lg"
				onOpenAutoFocus={() => {
					opener.current =
						document.activeElement instanceof HTMLElement ? document.activeElement : null;
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					if (opener.current?.isConnected === true) {
						opener.current.focus();
					}
					const run = pending.current;
					pending.current = null;
					run?.();
				}}
			>
				<DialogHeader className="sr-only">
					<DialogTitle>{t("commands.title")}</DialogTitle>
					<DialogDescription>{t("commands.description")}</DialogDescription>
				</DialogHeader>
				<Command filter={filter}>
					<CommandInput placeholder={t("commands.placeholder")} />
					<CommandList>
						<CommandEmpty>{t("commands.empty")}</CommandEmpty>
						<PaletteGroup heading={t("commands.groups.goTo")} items={goTo} onSelect={select} />
						<PaletteGroup
							heading={t("commands.groups.actions")}
							items={actions}
							onSelect={select}
						/>
						<PaletteGroup
							heading={t("commands.groups.accounts")}
							items={accountItems}
							onSelect={select}
						/>
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
