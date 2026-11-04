import type { AccountListData } from "@/hooks/useAccounts";
import type { BalanceSheetGroup, BalanceSheetRow } from "@/lib/balance-sheet";

import { Link } from "@tanstack/react-router";
import {
	ChevronRightIcon,
	ChevronsDownUpIcon,
	ChevronsUpDownIcon,
	MinusIcon,
	PlusIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AccountType } from "@archant/data/account-types";

import { AccountBalance } from "@/components/AccountBalance";
import { Money } from "@/components/Money";
import { Section } from "@/components/Section";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import { WEIGHT_BARS, balanceSheet, litBars } from "@/lib/balance-sheet";
import { intlLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

/** Sure's `number_to_percentage(precision: 0)`, in the legend and the weights. */
const shareFormat = new Intl.NumberFormat(intlLocale, {
	style: "percent",
	maximumFractionDigits: 0,
});

/** DESIGN.md's `type-*` tokens, so the bar and the dots follow the theme. */
const TYPE_COLOURS = {
	depository: "var(--type-depository)",
	investment: "var(--type-investment)",
	crypto: "var(--type-crypto)",
	property: "var(--type-property)",
	vehicle: "var(--type-vehicle)",
	credit_card: "var(--type-credit-card)",
	loan: "var(--type-loan)",
	other_asset: "var(--type-other-asset)",
	other_liability: "var(--type-other-liability)",
} as const satisfies Record<AccountType, string>;

/** Sure's empty side: its classification's icon, its sentence and its hint. */
const EMPTY_SIDES = {
	asset: {
		icon: PlusIcon,
		title: "dashboard.balanceSheet.noAsset",
		hint: "dashboard.balanceSheet.addAssetAccounts",
	},
	liability: {
		icon: MinusIcon,
		title: "dashboard.balanceSheet.noLiability",
		hint: "dashboard.balanceSheet.addLiabilityAccounts",
	},
} as const;

// Sure's columns: a 160 px name, an 80 px weight, a 96 px value. On a phone,
// where Sure's table scrolls its values out of view, the name shrinks and the
// weight keeps its percent without the bars, so a name stays readable.
const WEIGHT_COLUMN = "w-12 shrink-0 sm:w-20";
const VALUE_COLUMN = "flex w-24 shrink-0 justify-end";

const rowKey = (group: BalanceSheetGroup, row: BalanceSheetRow) =>
	`${group.classification}:${row.type}`;

/** Sure's `_group_weight`: five bars, one lit per 20 % begun, then the weight. */
function GroupWeight({ weight, colour }: { weight: number; colour: string }) {
	const lit = litBars(weight);

	return (
		<span className="flex w-full items-center justify-end gap-2 sm:justify-between">
			<span aria-hidden="true" className="hidden gap-[3px] sm:flex">
				{Array.from({ length: WEIGHT_BARS }, (_, index) => (
					<span
						key={index}
						data-slot="weight-bar"
						className={cn("h-2.5 w-0.5 rounded-lg", index >= lit && "opacity-20")}
						style={{ backgroundColor: colour }}
					/>
				))}
			</span>
			<span className="text-sm whitespace-nowrap tabular-nums">
				{/* CLDR's minus is a hyphen; an overdrawn account's weight takes U+2212, as its amount. */}
				{shareFormat.format(weight / 100).replace("-", "−")}
			</span>
		</span>
	);
}

function TypeRow({
	row,
	currency,
	open,
	onOpenChange,
}: {
	row: BalanceSheetRow;
	currency: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { t } = useTranslation();
	const name = t(`dashboard.balanceSheet.types.${row.type}`);
	const colour = TYPE_COLOURS[row.type];

	return (
		<details
			className="group"
			open={open}
			onToggle={(event) => onOpenChange(event.currentTarget.open)}
		>
			<summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg p-4 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
				<span className="flex w-40 min-w-0 items-center gap-1">
					<ChevronRightIcon
						aria-hidden="true"
						className="size-4 shrink-0 transition-transform group-open:rotate-90"
					/>
					<span className="truncate">{name}</span>
				</span>
				<span className="flex items-center gap-2 text-right">
					<span className={WEIGHT_COLUMN}>
						<GroupWeight weight={row.weight} colour={colour} />
					</span>
					<span className={VALUE_COLUMN}>
						<Money amount={row.total} currency={currency} whole />
					</span>
				</span>
			</summary>
			<ul aria-label={name} className="flex flex-col divide-y divide-line">
				{row.accounts.map(({ account, weight }) => (
					<li key={account.id} className="flex items-center justify-between gap-2 py-3 pr-4 pl-7">
						<span className="flex min-w-0 items-center gap-2">
							<TintedIcon subject={{ kind: "account", type: account.type }} size="sm" />
							<Link
								to="/accounts/$accountId"
								params={{ accountId: account.id }}
								className="truncate rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
							>
								{account.name}
							</Link>
						</span>
						<span className="ml-auto flex items-center gap-2 text-right">
							{/* A foreign account has no converted balance to weigh. */}
							<span className={WEIGHT_COLUMN}>
								{weight !== null && <GroupWeight weight={weight} colour={colour} />}
							</span>
							<span className={VALUE_COLUMN}>
								<AccountBalance account={account} whole />
							</span>
						</span>
					</li>
				))}
			</ul>
		</details>
	);
}

function Group({
	group,
	currency,
	isOpen,
	onOpenChange,
}: {
	group: BalanceSheetGroup;
	currency: string;
	isOpen: (row: BalanceSheetRow) => boolean;
	onOpenChange: (row: BalanceSheetRow, open: boolean) => void;
}) {
	const { t } = useTranslation();
	const nameId = useId();
	const empty = EMPTY_SIDES[group.classification];

	return (
		<div role="group" aria-labelledby={nameId} className="flex flex-col gap-4">
			<h3 className="flex items-baseline gap-1.5 text-lg font-medium">
				<span id={nameId}>
					{t(`dashboard.balanceSheet.classifications.${group.classification}`)}
				</span>
				{group.rows.length > 0 && (
					<>
						<span aria-hidden="true" className="text-muted-foreground">
							·
						</span>
						<Money
							amount={group.total}
							currency={currency}
							whole
							className="text-muted-foreground"
						/>
					</>
				)}
			</h3>
			{group.types.length > 0 && (
				<div className="flex flex-col gap-3">
					{/* The legend below carries the same shares as text. */}
					<div aria-hidden="true" className="flex h-1.5 gap-1">
						{group.types.map((entry) => (
							<span
								key={entry.type}
								data-type={entry.type}
								className="h-full rounded-sm"
								style={{ flexGrow: entry.amount, backgroundColor: TYPE_COLOURS[entry.type] }}
							/>
						))}
					</div>
					<ul
						aria-label={t("dashboard.balanceSheet.legend")}
						className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"
					>
						{group.types.map((entry) => (
							<li key={entry.type} className="flex items-center gap-2">
								<span
									aria-hidden="true"
									className="size-2.5 shrink-0 rounded-full"
									style={{ backgroundColor: TYPE_COLOURS[entry.type] }}
								/>
								{t(`dashboard.balanceSheet.types.${entry.type}`)}{" "}
								<span className="text-foreground tabular-nums">
									{shareFormat.format(entry.share)}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
			{group.rows.length > 0 ? (
				<div className="overflow-x-auto rounded-xl bg-inset p-1">
					<div className="flex items-center px-4 py-2 type-overline text-muted-foreground">
						<span className="w-40 min-w-0">{t("dashboard.balanceSheet.name")}</span>
						<span className="ml-auto flex items-center gap-2 text-right">
							<span className={WEIGHT_COLUMN}>{t("dashboard.balanceSheet.weight")}</span>
							<span className={VALUE_COLUMN}>{t("dashboard.balanceSheet.value")}</span>
						</span>
					</div>
					<div className="flex flex-col divide-y divide-line rounded-lg border bg-card text-sm font-medium">
						{group.rows.map((row) => (
							<TypeRow
								key={row.type}
								row={row}
								currency={currency}
								open={isOpen(row)}
								onOpenChange={(open) => onOpenChange(row, open)}
							/>
						))}
					</div>
				</div>
			) : (
				<div className="flex flex-col items-center py-10">
					<span
						aria-hidden="true"
						className="grid size-9 place-items-center rounded-lg bg-inset text-muted-foreground"
					>
						<empty.icon className="size-5" />
					</span>
					<p className="mt-4 mb-1 text-sm font-medium">{t(empty.title)}</p>
					<p className="text-center text-sm text-muted-foreground">{t(empty.hint)}</p>
				</div>
			)}
		</div>
	);
}

/**
 * « Bilan »: assets then liabilities, each with its total, a weight bar by
 * account type and its legend, then Sure's table of one collapsible row per
 * type over its accounts. Computed from `/accounts`, the query the accounts
 * column reads (lib/balance-sheet.ts). Amounts read in whole units, as Sure's.
 */
export function BalanceSheetSection({ list }: { list: AccountListData }) {
	const { t } = useTranslation();
	const groups = balanceSheet(list);
	const [openRows, setOpenRows] = useState<ReadonlySet<string>>(() => new Set());
	const keys = groups.flatMap((group) => group.rows.map((row) => rowKey(group, row)));
	// Derived, never stored: closing one row by hand brings « Tout développer » back.
	const allOpen = keys.length > 0 && keys.every((key) => openRows.has(key));

	const setRowOpen = (key: string, open: boolean) =>
		setOpenRows((current) => {
			if (current.has(key) === open) {
				return current;
			}

			const next = new Set(current);

			if (open) {
				next.add(key);
			} else {
				next.delete(key);
			}

			return next;
		});

	return (
		<Section
			id="balance-sheet-heading"
			title={t("dashboard.balanceSheet.title")}
			action={
				<div className="flex items-center gap-3">
					{keys.length > 0 && (
						<Button
							variant="outline"
							size="icon-sm"
							aria-expanded={allOpen}
							aria-label={t(
								allOpen ? "dashboard.balanceSheet.collapseAll" : "dashboard.balanceSheet.expandAll",
							)}
							onClick={() => setOpenRows(allOpen ? new Set() : new Set(keys))}
						>
							{allOpen ? <ChevronsDownUpIcon /> : <ChevronsUpDownIcon />}
						</Button>
					)}
					<Link to="/accounts" className="text-sm text-link hover:underline">
						{t("dashboard.balanceSheet.allAccounts")}
					</Link>
				</div>
			}
		>
			<div className="flex flex-col gap-6 p-4">
				{groups.map((group) => (
					<Group
						key={group.classification}
						group={group}
						currency={list.reportingCurrency}
						isOpen={(row) => openRows.has(rowKey(group, row))}
						onOpenChange={(row, open) => setRowOpen(rowKey(group, row), open)}
					/>
				))}
			</div>
		</Section>
	);
}
