import type { AccountListData } from "@/hooks/useAccounts";
import type { BalanceSheetGroup } from "@/lib/balance-sheet";

import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { AccountBalance } from "@/components/AccountBalance";
import { InsetGroup } from "@/components/InsetGroup";
import { Money } from "@/components/Money";
import { Section } from "@/components/Section";
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
		<div role="group" aria-labelledby={headingId} className="flex flex-col gap-4">
			<div className="flex items-baseline justify-between gap-4 text-lg font-medium">
				<h3 id={headingId}>{t(`accounts.groups.${group.classification}`)}</h3>
				<Money amount={group.total} currency={currency} />
			</div>
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
			<InsetGroup level={4} title={t("dashboard.balanceSheet.accounts")}>
				<ul
					aria-label={t("dashboard.balanceSheet.accounts")}
					className="flex flex-col divide-y divide-line"
				>
					{group.accounts.map((account) => (
						<li key={account.id}>
							<Link
								to="/accounts/$accountId"
								params={{ accountId: account.id }}
								className="flex min-h-14 items-center gap-3 px-4 py-2.5 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
							>
								<TintedIcon subject={{ kind: "account", type: account.type }} />
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="truncate font-medium">{account.name}</span>
									<span className="truncate text-xs text-muted-foreground">
										{t(`accounts.subtypes.${kindOf(account.type, account.subtype)}`)}
									</span>
								</span>
								<AccountBalance account={account} />
							</Link>
						</li>
					))}
				</ul>
			</InsetGroup>
		</div>
	);
}

/**
 * « Bilan »: assets then liabilities, each with its total, a weight bar by
 * account type and its legend, then the group's active accounts. Computed from
 * `/accounts`, the query the accounts column reads (lib/balance-sheet.ts).
 */
export function BalanceSheetSection({ list }: { list: AccountListData }) {
	const { t } = useTranslation();
	const groups = balanceSheet(list).filter((group) => group.accounts.length > 0);

	return (
		<Section
			id="balance-sheet-heading"
			title={t("dashboard.balanceSheet.title")}
			action={
				<Link to="/accounts" className="text-sm text-link hover:underline">
					{t("dashboard.balanceSheet.allAccounts")}
				</Link>
			}
		>
			<div className="flex flex-col gap-6 p-4">
				{groups.map((group) => (
					<Group key={group.classification} group={group} currency={list.reportingCurrency} />
				))}
			</div>
		</Section>
	);
}
