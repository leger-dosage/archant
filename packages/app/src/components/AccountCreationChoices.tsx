import type { KeyboardEvent, ReactNode } from "react";

import {
	ArrowDownIcon,
	ArrowUpIcon,
	ChevronRightIcon,
	CornerDownLeftIcon,
	KeyboardIcon,
	Link2Icon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AccountType } from "@archant/data/account-types";

import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import { NEW_ACCOUNT_TYPES, linksBank } from "@/lib/account-creation";
import { cn } from "@/lib/utils";

/** Marks a row the arrow keys move between. */
const CHOICE = "[data-choice]";

/**
 * Sure's `list-keyboard-navigation` hotkeys: ↑, ← or `k` to the row before,
 * ↓, → or `j` to the row after, from wherever focus sits in the dialog.
 */
export function moveBetweenChoices(event: KeyboardEvent<HTMLElement>): void {
	if (event.altKey || event.ctrlKey || event.metaKey) {
		return;
	}

	const delta =
		event.key === "ArrowDown" ||
		event.key === "ArrowRight" ||
		event.key === "j" ||
		event.key === "J"
			? 1
			: event.key === "ArrowUp" ||
				  event.key === "ArrowLeft" ||
				  event.key === "k" ||
				  event.key === "K"
				? -1
				: 0;

	if (delta === 0) {
		return;
	}

	const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(CHOICE)];
	const index = rows.findIndex((row) => row === document.activeElement);
	const target =
		index === -1
			? rows[delta > 0 ? 0 : rows.length - 1]
			: rows[Math.min(Math.max(index + delta, 0), rows.length - 1)];

	if (target !== undefined) {
		event.preventDefault();
		target.focus();
	}
}

/** The first row of a list step, focused as the step opens. */
export const FIRST_CHOICE = CHOICE;

function ChoiceRow({
	icon,
	label,
	onSelect,
}: {
	icon: ReactNode;
	label: string;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			data-choice=""
			className="group flex w-full items-center gap-4 rounded-lg border border-transparent p-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-hidden focus-visible:border-border"
			onClick={onSelect}
		>
			{icon}
			{label}
			<ChevronRightIcon
				aria-hidden="true"
				className="ml-auto size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
			/>
		</button>
	);
}

/** Sure's `accounts/new.html.erb`: each type with its icon and colour, in Sure's order. */
export function AccountTypeChoices({ onChoose }: { onChoose: (type: AccountType) => void }) {
	const { t } = useTranslation();

	return (
		<div className="flex flex-col">
			{NEW_ACCOUNT_TYPES.map((type) => (
				<ChoiceRow
					key={type}
					icon={<TintedIcon subject={{ kind: "account", type }} size="lg" />}
					label={t(`accounts.types.${type}`)}
					onSelect={() => onChoose(type)}
				/>
			))}
		</div>
	);
}

// Sure's plain tile around the keyboard and link icons.
function MethodIcon({ children }: { children: ReactNode }) {
	return (
		<span
			aria-hidden="true"
			className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-muted [&_svg]:size-5"
		>
			{children}
		</span>
	);
}

/**
 * Sure's `accounts/new/_method_selector.html.erb`: the balance typed by
 * hand, and Enable Banking for the types it links.
 */
export function MethodChoices({
	type,
	onManual,
	onLink,
}: {
	type: AccountType;
	onManual: () => void;
	onLink: () => void;
}) {
	const { t } = useTranslation();

	return (
		<div className="flex flex-col">
			<ChoiceRow
				icon={
					<MethodIcon>
						<KeyboardIcon />
					</MethodIcon>
				}
				label={t("accounts.new.method.manualEntry")}
				onSelect={onManual}
			/>
			{linksBank(type) && (
				<ChoiceRow
					icon={
						<MethodIcon>
							<Link2Icon />
						</MethodIcon>
					}
					label={t("accounts.new.method.linkWithProvider")}
					onSelect={onLink}
				/>
			)}
		</div>
	);
}

function Key({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
	return (
		<kbd
			className={cn(
				"grid h-5 shrink-0 place-items-center rounded-md bg-muted p-1 text-xs shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.1)] [&_svg]:size-3",
				wide ? "w-8" : "w-5",
			)}
		>
			{children}
		</kbd>
	);
}

/** Sure's `accounts/new/_container.html.erb` footer, from `md` up. */
export function ChoicesFooter({ onClose }: { onClose: () => void }) {
	const { t } = useTranslation();

	return (
		<div className="-mx-4 -mb-4 hidden justify-between border-t px-4 py-3 text-sm text-muted-foreground md:flex">
			<div className="flex gap-5">
				<div className="flex items-center gap-2">
					<span>{t("accounts.new.select")}</span>
					<Key>
						<CornerDownLeftIcon aria-hidden="true" />
					</Key>
				</div>
				<div className="flex items-center gap-2">
					<span>{t("accounts.new.navigate")}</span>
					<Key>
						<ArrowUpIcon aria-hidden="true" />
					</Key>
					<Key>
						<ArrowDownIcon aria-hidden="true" />
					</Key>
				</div>
			</div>
			<div className="flex items-center gap-2">
				{/* DESIGN.md's 28 px floor for a control, where Sure's is the text's height. */}
				<Button type="button" variant="ghost" size="sm" onClick={onClose}>
					{t("accounts.new.close")}
				</Button>
				<Key wide>ESC</Key>
			</div>
		</div>
	);
}
