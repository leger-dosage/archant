import type { AccountListData } from "@/hooks/useAccounts";

import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { supportsDefault } from "@archant/data/account-types";

import { AccountRowMenu } from "@/components/AccountRowMenu";
import { ExcludedMarker } from "@/components/ExcludedMarker";
import { InsetGroup } from "@/components/InsetGroup";
import { Money } from "@/components/Money";
import { TintedIcon } from "@/components/TintedIcon";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { kindOf } from "@/lib/account-kinds";
import { cn } from "@/lib/utils";

/**
 * The accounts page body: Actifs then Passifs, each an inset group whose
 * header holds its total, each account with its tinted type icon. As Sure's
 * `Account.listable_manual`, an inactive account is listed among the others,
 * its name and balance muted. The total comes from the API, which leaves out
 * inactive and excluded accounts. An administrator gets a menu on each row.
 */
export function AccountGroups({ list }: { list: AccountListData }) {
	const { t } = useTranslation();
	const admin = useIsAdmin();

	return (
		<div className="flex flex-col gap-6">
			{list.groups
				.filter((group) => group.accounts.length > 0)
				.map((group) => {
					const headingId = `account-group-${group.classification}`;

					return (
						<InsetGroup
							key={group.classification}
							id={headingId}
							level={2}
							title={t(`accounts.groups.${group.classification}`)}
							total={<Money amount={group.total} currency={list.reportingCurrency} />}
							{...(group.excludedCount > 0
								? { note: t("accounts.excluded", { count: group.excludedCount }) }
								: {})}
						>
							<ul className="divide-y divide-line">
								{group.accounts.map((account) => (
									<li key={account.id} className="flex items-center hover:bg-hover">
										{/* The menu sits beside the link, never inside it: a button within a link is invalid and unreachable. */}
										<Link
											to="/accounts/$accountId"
											params={{ accountId: account.id }}
											className="flex min-w-0 flex-1 items-center gap-3 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
										>
											<TintedIcon size="lg" subject={{ kind: "account", type: account.type }} />
											<div className="min-w-0 flex-1">
												<p className="flex min-w-0 items-center gap-1.5">
													<span
														className={cn(
															"truncate font-medium",
															!account.active && "text-muted-foreground",
														)}
													>
														{account.name}
													</span>
													{/* The muted colour is not the only sign of the state. */}
													{!account.active && (
														<span className="sr-only">{t("accounts.inactiveHint")}</span>
													)}
													{account.excludedFromReports && (
														<ExcludedMarker label={t("accounts.excludedFromReports")} />
													)}
												</p>
												<p className="text-xs text-muted-foreground">
													{t(`accounts.subtypes.${kindOf(account.type, account.subtype)}`)}
												</p>
												{/* Sure's `supports_default? && is_default`, without its `opacity-50`, which fails contrast. */}
												{account.id === list.defaultAccountId && supportsDefault(account.type) && (
													<p className="text-xs text-muted-foreground">
														{t("accounts.defaultLabel")}
													</p>
												)}
											</div>
											<Money
												amount={account.balance}
												currency={account.currency}
												muted={!account.active}
												className="shrink-0"
											/>
										</Link>
										{admin && (
											<AccountRowMenu
												account={account}
												isDefault={account.id === list.defaultAccountId}
											/>
										)}
									</li>
								))}
							</ul>
						</InsetGroup>
					);
				})}
		</div>
	);
}

export function AccountGroupsSkeleton() {
	return (
		// A group's tray, so the page does not jump when the accounts land.
		<div className="flex flex-col rounded-xl bg-inset p-1" aria-hidden="true">
			<div className="px-4 py-2">
				<Skeleton className="h-4 w-full" />
			</div>
			<div className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border bg-card">
				{[0, 1, 2].map((index) => (
					<div key={index} className="flex items-center p-4">
						<Skeleton className="h-9 w-full" />
					</div>
				))}
			</div>
		</div>
	);
}
