import type { AccountListData } from "@/hooks/useAccounts";

import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { AccountBalance } from "@/components/AccountBalance";
import { Money } from "@/components/Money";
import { TintedIcon } from "@/components/TintedIcon";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { kindOf } from "@/lib/account-kinds";

type AccountGroupsProps = {
	list: AccountListData;
	/** Lists inactive accounts too, each with its « Inactif » badge. */
	showInactive: boolean;
};

/**
 * The accounts page body: Actifs then Passifs, each a section whose header
 * holds its total, each account with its tinted type icon. The
 * total comes from the API, which already leaves out inactive and excluded
 * accounts, so it does not change when inactive ones are shown.
 */
export function AccountGroups({ list, showInactive }: AccountGroupsProps) {
	const { t } = useTranslation();

	return (
		<div className="flex flex-col gap-4">
			{list.groups
				.map((group) => ({
					...group,
					accounts: group.accounts.filter((account) => showInactive || account.active),
				}))
				.filter((group) => group.accounts.length > 0)
				.map((group) => {
					const headingId = `account-group-${group.classification}`;

					return (
						<section
							key={group.classification}
							aria-labelledby={headingId}
							className="flex flex-col overflow-hidden rounded-lg border bg-section"
						>
							{/* The heading's parent holds the total, as the sidebar's group does. */}
							<div className="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5">
								<h2 id={headingId} className="type-title">
									{t(`accounts.groups.${group.classification}`)}
								</h2>
								<Money
									amount={group.total}
									currency={list.reportingCurrency}
									className="type-title"
								/>
							</div>
							{group.excludedCount > 0 && (
								<p className="px-4 pt-2 text-xs text-muted-foreground">
									{t("accounts.excluded", { count: group.excludedCount })}
								</p>
							)}
							<ul className="divide-y divide-line">
								{group.accounts.map((account) => (
									<li key={account.id}>
										<Link
											to="/accounts/$accountId"
											params={{ accountId: account.id }}
											className="flex min-h-11 items-center gap-3 px-4 py-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
										>
											<TintedIcon size="sm" subject={{ kind: "account", type: account.type }} />
											<div className="min-w-0 flex-1">
												<p className="flex min-w-0 items-center gap-2">
													<span className="truncate font-medium">{account.name}</span>
													{!account.active && (
														<Badge variant="outline">{t("accounts.inactive")}</Badge>
													)}
												</p>
												<p className="text-xs text-muted-foreground">
													{t(`accounts.subtypes.${kindOf(account.type, account.subtype)}`)}
												</p>
											</div>
											<AccountBalance account={account} />
										</Link>
									</li>
								))}
							</ul>
						</section>
					);
				})}
		</div>
	);
}

export function AccountGroupsSkeleton() {
	return (
		// A group's section, so the page does not jump when the accounts land.
		<div
			className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border bg-section"
			aria-hidden="true"
		>
			<div className="px-4 py-2.5">
				<Skeleton className="h-5 w-full" />
			</div>
			{[0, 1, 2].map((index) => (
				<div key={index} className="flex min-h-11 items-center px-4 py-2">
					<Skeleton className="h-7 w-full" />
				</div>
			))}
		</div>
	);
}
