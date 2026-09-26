import type { AccountListData } from "@/hooks/useAccounts";
import type { BalanceSheetGroup } from "@/lib/balance-sheet";

import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { AccountBalance } from "@/components/AccountBalance";
import { Money } from "@/components/Money";
import { TintedIcon } from "@/components/TintedIcon";
import { kindOf } from "@/lib/account-kinds";
import { balanceSheet } from "@/lib/balance-sheet";

const shareFormat = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });

/** DESIGN.md's `type-*` tokens, so the bar and the dots follow the theme. */
const TYPE_COLOURS = {
	depository: "var(--type-depository)",
	investment: "var(--type-investment)",
	property: "var(--type-property)",
	vehicle: "var(--type-vehicle)",
	credit_card: "var(--type-credit-card)",
	loan: "var(--type-loan)",
} as const;

function Group({ group, currency }: { group: BalanceSheetGroup; currency: string }) {
	const { t } = useTranslation();
	const headingId = useId();

	return (
		<div role="group" aria-labelledby={headingId} className="flex flex-col gap-2.5 p-4">
			<div className="flex items-baseline justify-between gap-4">
				<h3 id={headingId} className="font-medium">
					{t(`accounts.groups.${group.classification}`)}
				</h3>
				<Money amount={group.total} currency={currency} />
			</div>
			{group.types.length > 0 && (
				<>
					{/* The legend below carries the same shares as text. */}
					<div aria-hidden="true" className="flex h-1 gap-0.5 overflow-hidden rounded-full">
						{group.types.map((entry) => (
							<span
								key={entry.type}
								data-type={entry.type}
								className="h-full rounded-full"
								style={{ flexGrow: entry.amount, backgroundColor: TYPE_COLOURS[entry.type] }}
							/>
						))}
					</div>
					<ul
						aria-label={t("dashboard.balanceSheet.legend")}
						className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
					>
						{group.types.map((entry) => (
							<li key={entry.type} className="flex items-center gap-1.5">
								<span
									aria-hidden="true"
									className="size-2 shrink-0 rounded-full"
									style={{ backgroundColor: TYPE_COLOURS[entry.type] }}
								/>
								{t(`dashboard.balanceSheet.types.${entry.type}`)}{" "}
								<span className="tabular-nums">{shareFormat.format(entry.share)}</span>
							</li>
						))}
					</ul>
				</>
			)}
			<ul aria-label={t("dashboard.balanceSheet.accounts")} className="flex flex-col">
				{group.accounts.map((account) => (
					<li key={account.id}>
						<Link
							to="/accounts/$accountId"
							params={{ accountId: account.id }}
							className="-mx-2 flex min-h-9 items-center gap-3 rounded-md px-2 py-1 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						>
							<TintedIcon subject={{ kind: "account", type: account.type }} />
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="truncate">{account.name}</span>
								<span className="truncate text-xs text-muted-foreground">
									{t(`accounts.subtypes.${kindOf(account.type, account.subtype)}`)}
								</span>
							</span>
							<AccountBalance account={account} />
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * « Bilan »: assets then liabilities, each with its total, a weight bar by
 * account type and its legend, then the group's active accounts. Computed from
 * `/accounts`, the query the sidebar reads (lib/balance-sheet.ts).
 */
export function BalanceSheetSection({ list }: { list: AccountListData }) {
	const { t } = useTranslation();
	const groups = balanceSheet(list).filter((group) => group.accounts.length > 0);

	return (
		<section
			aria-labelledby="balance-sheet-heading"
			className="flex min-w-0 flex-col rounded-lg border bg-section"
		>
			<div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
				<h2 id="balance-sheet-heading" className="type-title">
					{t("dashboard.balanceSheet.title")}
				</h2>
				<Link to="/accounts" className="text-sm text-link hover:underline">
					{t("dashboard.balanceSheet.allAccounts")}
				</Link>
			</div>
			<div className="flex flex-col divide-y divide-line">
				{groups.map((group) => (
					<Group key={group.classification} group={group} currency={list.reportingCurrency} />
				))}
			</div>
		</section>
	);
}
