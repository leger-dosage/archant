import type { AccountListData } from "@/hooks/useAccounts";

import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Money } from "@/components/Money";
import { Skeleton } from "@/components/ui/skeleton";
import { kindOf } from "@/lib/account-kinds";

/** The accounts page body: Actifs then Passifs, each with its total. */
export function AccountGroups({ list }: { list: AccountListData }) {
	const { t } = useTranslation();

	return (
		<div className="flex flex-col gap-8">
			{list.groups
				.filter((group) => group.accounts.length > 0)
				.map((group) => {
					const headingId = `account-group-${group.classification}`;

					return (
						<section key={group.classification} aria-labelledby={headingId}>
							<div className="flex items-baseline justify-between gap-4 border-b pb-2">
								<h2 id={headingId} className="text-lg font-semibold">
									{t(`accounts.groups.${group.classification}`)}
								</h2>
								<Money amount={group.total} currency={list.reportingCurrency} className="text-lg" />
							</div>
							{group.excludedCount > 0 && (
								<p className="mt-2 text-xs text-muted-foreground">
									{t("accounts.excluded", { count: group.excludedCount })}
								</p>
							)}
							<ul className="divide-y">
								{group.accounts.map((account) => (
									<li key={account.id}>
										<Link
											to="/comptes/$accountId"
											params={{ accountId: account.id }}
											className="-mx-2 flex min-h-11 items-center justify-between gap-4 rounded-md px-2 py-2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
										>
											<div className="min-w-0">
												<p className="truncate font-medium">{account.name}</p>
												<p className="text-xs text-muted-foreground">
													{t(`accounts.subtypes.${kindOf(account.type, account.subtype)}`)}
												</p>
											</div>
											<Money amount={account.balance} currency={account.currency} />
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
		<div className="flex flex-col gap-3" aria-hidden="true">
			<Skeleton className="h-7 w-full" />
			<Skeleton className="h-11 w-full" />
			<Skeleton className="h-11 w-full" />
			<Skeleton className="h-11 w-full" />
		</div>
	);
}
