import type { TransactionData } from "@/hooks/useTransactions";

import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { isCurrencyCode } from "@archant/data/money";

import { Money } from "@/components/Money";
import { TransactionList, TransactionListSkeleton } from "@/components/TransactionList";
import { TransactionSheet } from "@/components/TransactionSheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccount } from "@/hooks/useAccount";
import { useAccountTransactions } from "@/hooks/useTransactions";
import { kindOf } from "@/lib/account-kinds";
import { errorCodeOf } from "@/lib/api";

// Absent means the first page, so links to an account need no search params.
const searchSchema = z.object({
	page: z.number().int().min(1).optional().catch(undefined),
});

export const Route = createFileRoute("/comptes/$accountId")({
	validateSearch: searchSchema,
	component: AccountPage,
});

type SheetState = { open: boolean; transaction: TransactionData | null };

function AccountPage() {
	const { t } = useTranslation();
	const { accountId } = Route.useParams();
	const { page = 1 } = Route.useSearch();
	const account = useAccount(accountId);
	const transactions = useAccountTransactions(accountId, page);
	const [sheet, setSheet] = useState<SheetState>({ open: false, transaction: null });
	const notFound = account.isError && errorCodeOf(account.error) === "NOT_FOUND";
	const name = account.data?.name;
	const navigate = Route.useNavigate();
	const loaded = transactions.isPlaceholderData ? undefined : transactions.data;
	const lastPage =
		loaded === undefined ? undefined : Math.max(1, Math.ceil(loaded.total / loaded.pageSize));

	// A page past the end, after deleting the only row of the last page or from
	// an old link, would show an empty list that is not the empty state.
	useEffect(() => {
		if (lastPage !== undefined && page > lastPage) {
			void navigate({
				to: "/comptes/$accountId",
				params: { accountId },
				search: lastPage === 1 ? {} : { page: lastPage },
				replace: true,
			});
		}
	}, [accountId, lastPage, navigate, page]);

	useEffect(() => {
		document.title = t("app.pageTitle", {
			page: name ?? t("accountDetail.title"),
			app: t("app.name"),
		});
	}, [name, t]);

	if (notFound) {
		return (
			<div className="flex w-full max-w-[1200px] flex-col items-start gap-3 p-6">
				<h1 className="text-3xl font-semibold tracking-tight">{t("accountDetail.notFound")}</h1>
				<Button asChild variant="outline">
					<Link to="/comptes">{t("accountDetail.backToAccounts")}</Link>
				</Button>
			</div>
		);
	}

	const openNew = () => setSheet({ open: true, transaction: null });
	const data = transactions.data;
	const pageCount = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / data.pageSize));
	const currency = account.data?.currency;

	return (
		<div className="flex w-full max-w-[1200px] flex-col gap-6 p-6">
			{account.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(account.error)}`)}</p>
					<Button variant="outline" onClick={() => void account.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{account.isPending && (
				<div className="flex flex-col gap-2" aria-hidden="true">
					<Skeleton className="h-8 w-48" />
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-9 w-40" />
				</div>
			)}

			{account.data !== undefined && (
				<div className="flex flex-wrap items-end justify-between gap-4">
					<div className="flex min-w-0 flex-col gap-1">
						<h1 className="truncate text-3xl font-semibold tracking-tight">{account.data.name}</h1>
						<p className="text-sm text-muted-foreground">
							{t(`accounts.subtypes.${kindOf(account.data.type, account.data.subtype)}`)}
						</p>
						<Money
							amount={account.data.balance}
							currency={account.data.currency}
							className="amount-hero mt-2"
						/>
					</div>
					<Button onClick={openNew}>{t("transactions.add")}</Button>
				</div>
			)}

			<section aria-labelledby="transactions-heading" className="flex flex-col gap-3">
				<h2 id="transactions-heading" className="text-lg font-semibold">
					{t("transactions.title")}
				</h2>

				{transactions.isPending && <TransactionListSkeleton />}

				{transactions.isError && (
					<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
						<p className="text-muted-foreground">
							{t(`errors.${errorCodeOf(transactions.error)}`)}
						</p>
						<Button variant="outline" onClick={() => void transactions.refetch()}>
							{t("common.retry")}
						</Button>
					</div>
				)}

				{data !== undefined && data.total === 0 && (
					<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
						<p className="text-muted-foreground">{t("transactions.empty")}</p>
						<Button onClick={openNew} disabled={account.data === undefined}>
							{t("transactions.add")}
						</Button>
					</div>
				)}

				{data !== undefined && data.total > 0 && (
					<TransactionList
						items={data.items}
						onOpen={(transaction) => setSheet({ open: true, transaction })}
					/>
				)}

				{data !== undefined && pageCount > 1 && (
					<nav
						aria-label={t("transactions.pagination.label")}
						className="flex items-center justify-between gap-4 border-t pt-3"
					>
						<Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
							{page > 1 ? (
								<Link
									to="/comptes/$accountId"
									params={{ accountId }}
									search={page - 1 === 1 ? {} : { page: page - 1 }}
								>
									{t("transactions.pagination.previous")}
								</Link>
							) : (
								<span>{t("transactions.pagination.previous")}</span>
							)}
						</Button>
						<p className="text-xs text-muted-foreground">
							{t("transactions.pagination.status", { page, pages: pageCount })}
						</p>
						<Button
							variant="outline"
							size="sm"
							disabled={page >= pageCount}
							asChild={page < pageCount}
						>
							{page < pageCount ? (
								<Link to="/comptes/$accountId" params={{ accountId }} search={{ page: page + 1 }}>
									{t("transactions.pagination.next")}
								</Link>
							) : (
								<span>{t("transactions.pagination.next")}</span>
							)}
						</Button>
					</nav>
				)}
			</section>

			{account.data !== undefined && currency !== undefined && isCurrencyCode(currency) && (
				<TransactionSheet
					account={{ id: account.data.id, currency, openingDate: account.data.openingDate }}
					open={sheet.open}
					transaction={sheet.transaction}
					onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
				/>
			)}
		</div>
	);
}
