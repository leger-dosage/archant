import type { SnapshotData } from "@/hooks/useSnapshots";
import type { TransactionData } from "@/hooks/useTransactions";
import type { PageParam } from "@/lib/page-search";

import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import type { BalancePeriod } from "@archant/api/schemas/balances";
import { BALANCE_PERIODS, DEFAULT_BALANCE_PERIOD } from "@archant/api/schemas/balances";
import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode } from "@archant/data/money";

import { BalanceChart } from "@/components/BalanceChart";
import { Money } from "@/components/Money";
import { Pagination } from "@/components/Pagination";
import { SnapshotDialog } from "@/components/SnapshotDialog";
import { SnapshotList, SnapshotListSkeleton } from "@/components/SnapshotList";
import { TransactionList, TransactionListSkeleton } from "@/components/TransactionList";
import { TransactionSheet } from "@/components/TransactionSheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAccount } from "@/hooks/useAccount";
import { useAccountSnapshots } from "@/hooks/useSnapshots";
import { useAccountTransactions } from "@/hooks/useTransactions";
import { kindOf } from "@/lib/account-kinds";
import { errorCodeOf } from "@/lib/api";
import { toIsoDate } from "@/lib/dates";
import { pageSearch } from "@/lib/page-search";

const ACCOUNT_TABS = ["transactions", "snapshots"] as const;

type AccountTab = (typeof ACCOUNT_TABS)[number];

const DEFAULT_TAB: AccountTab = "transactions";

// Absent means the first page, the default period and the Opérations tab, so
// links to an account need no search params. A value from an old or
// hand-edited link that no longer exists falls back to the default rather
// than failing the page.
const searchSchema = z.object({
	page: z.number().int().min(1).optional().catch(undefined),
	period: z.enum(BALANCE_PERIODS).optional().catch(undefined),
	tab: z.enum(ACCOUNT_TABS).optional().catch(undefined),
	snapshotsPage: z.number().int().min(1).optional().catch(undefined),
});

export const Route = createFileRoute("/comptes/$accountId")({
	validateSearch: searchSchema,
	component: AccountPage,
});

type SheetState = { open: boolean; transaction: TransactionData | null };

type SnapshotDialogState = { open: boolean; snapshot: SnapshotData | null };

const pageCountOf = (data: { total: number; pageSize: number } | undefined) =>
	data === undefined ? 1 : Math.max(1, Math.ceil(data.total / data.pageSize));

/**
 * A page past the end, after deleting the only row of the last page or from
 * an old link, would show an empty list that is not the empty state: go back
 * to the last page instead.
 */
function useClampPage(
	accountId: string,
	param: PageParam,
	page: number,
	loaded: { total: number; pageSize: number } | undefined,
) {
	const navigate = Route.useNavigate();
	const lastPage = loaded === undefined ? undefined : pageCountOf(loaded);

	useEffect(() => {
		if (lastPage !== undefined && page > lastPage) {
			void navigate({
				to: "/comptes/$accountId",
				params: { accountId },
				search: (previous) => ({ ...previous, ...pageSearch(param, lastPage) }),
				replace: true,
			});
		}
	}, [accountId, lastPage, navigate, page, param]);
}

function ListError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
	const { t } = useTranslation();

	return (
		<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
			<p className="text-muted-foreground">{t(`errors.${errorCodeOf(error)}`)}</p>
			<Button variant="outline" onClick={onRetry}>
				{t("common.retry")}
			</Button>
		</div>
	);
}

type TransactionsPanelProps = {
	accountId: string;
	page: number;
	canAdd: boolean;
	onAdd: () => void;
	onOpen: (transaction: TransactionData) => void;
};

function TransactionsPanel({ accountId, page, canAdd, onAdd, onOpen }: TransactionsPanelProps) {
	const { t } = useTranslation();
	const transactions = useAccountTransactions(accountId, page);
	const data = transactions.data;
	const pageCount = pageCountOf(data);

	useClampPage(
		accountId,
		"page",
		page,
		transactions.isPlaceholderData ? undefined : transactions.data,
	);

	return (
		<div className="flex flex-col gap-3">
			{transactions.isPending && <TransactionListSkeleton />}

			{transactions.isError && (
				<ListError error={transactions.error} onRetry={() => void transactions.refetch()} />
			)}

			{data !== undefined && data.total === 0 && (
				<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
					<p className="text-muted-foreground">{t("transactions.empty")}</p>
					<Button onClick={onAdd} disabled={!canAdd}>
						{t("transactions.add")}
					</Button>
				</div>
			)}

			{data !== undefined && data.total > 0 && (
				<TransactionList items={data.items} onOpen={onOpen} />
			)}

			{data !== undefined && pageCount > 1 && (
				<Pagination
					accountId={accountId}
					param="page"
					page={page}
					pageCount={pageCount}
					label={t("transactions.paginationLabel")}
				/>
			)}
		</div>
	);
}

type SnapshotsPanelProps = {
	accountId: string;
	page: number;
	canAdd: boolean;
	onAdd: () => void;
	onOpen: (snapshot: SnapshotData) => void;
};

function SnapshotsPanel({ accountId, page, canAdd, onAdd, onOpen }: SnapshotsPanelProps) {
	const { t } = useTranslation();
	const snapshots = useAccountSnapshots(accountId, page);
	const data = snapshots.data;
	const pageCount = pageCountOf(data);

	useClampPage(
		accountId,
		"snapshotsPage",
		page,
		snapshots.isPlaceholderData ? undefined : snapshots.data,
	);

	return (
		<div className="flex flex-col gap-3">
			<div className="flex justify-end">
				<Button variant="outline" onClick={onAdd} disabled={!canAdd}>
					{t("snapshots.add")}
				</Button>
			</div>

			{snapshots.isPending && <SnapshotListSkeleton />}

			{snapshots.isError && (
				<ListError error={snapshots.error} onRetry={() => void snapshots.refetch()} />
			)}

			{data !== undefined && data.total === 0 && (
				<div className="rounded-lg border border-dashed p-8">
					<p className="text-muted-foreground">{t("snapshots.empty")}</p>
				</div>
			)}

			{data !== undefined && data.total > 0 && <SnapshotList items={data.items} onOpen={onOpen} />}

			{data !== undefined && pageCount > 1 && (
				<Pagination
					accountId={accountId}
					param="snapshotsPage"
					page={page}
					pageCount={pageCount}
					label={t("snapshots.paginationLabel")}
				/>
			)}
		</div>
	);
}

function AccountPage() {
	const { t } = useTranslation();
	const { accountId } = Route.useParams();
	const {
		page = 1,
		period = DEFAULT_BALANCE_PERIOD,
		tab = DEFAULT_TAB,
		snapshotsPage = 1,
	} = Route.useSearch();
	const account = useAccount(accountId);
	const [sheet, setSheet] = useState<SheetState>({ open: false, transaction: null });
	const [snapshotDialog, setSnapshotDialog] = useState<SnapshotDialogState>({
		open: false,
		snapshot: null,
	});
	const notFound = account.isError && errorCodeOf(account.error) === "NOT_FOUND";
	const name = account.data?.name;
	const navigate = Route.useNavigate();

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
	const openNewSnapshot = () => setSnapshotDialog({ open: true, snapshot: null });
	const changePeriod = (next: BalancePeriod) =>
		void navigate({
			search: (previous) => ({
				...previous,
				period: next === DEFAULT_BALANCE_PERIOD ? undefined : next,
			}),
			replace: true,
		});
	const changeTab = (next: string) => {
		const value = ACCOUNT_TABS.find((candidate) => candidate === next);

		if (value !== undefined) {
			void navigate({
				search: (previous) => ({ ...previous, tab: value === DEFAULT_TAB ? undefined : value }),
			});
		}
	};
	const currency = account.data?.currency;
	const writable: { id: string; currency: CurrencyCode; openingDate: string } | undefined =
		account.data !== undefined && currency !== undefined && isCurrencyCode(currency)
			? { id: account.data.id, currency, openingDate: account.data.openingDate }
			: undefined;

	return (
		<div className="flex w-full max-w-[1200px] flex-col gap-6 p-6">
			{account.isError && (
				<ListError error={account.error} onRetry={() => void account.refetch()} />
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

			<BalanceChart accountId={accountId} period={period} onPeriodChange={changePeriod} />

			<Tabs value={tab} onValueChange={changeTab} className="gap-3">
				<TabsList aria-label={t("accountDetail.tabs.label")}>
					<TabsTrigger value="transactions">{t("accountDetail.tabs.transactions")}</TabsTrigger>
					<TabsTrigger value="snapshots">{t("accountDetail.tabs.snapshots")}</TabsTrigger>
				</TabsList>
				<TabsContent value="transactions">
					<TransactionsPanel
						accountId={accountId}
						page={page}
						canAdd={account.data !== undefined}
						onAdd={openNew}
						onOpen={(transaction) => setSheet({ open: true, transaction })}
					/>
				</TabsContent>
				<TabsContent value="snapshots">
					<SnapshotsPanel
						accountId={accountId}
						page={snapshotsPage}
						// A snapshot must fall after the opening date and not after today:
						// an account opened today or later has no valid date yet.
						canAdd={writable !== undefined && writable.openingDate < toIsoDate()}
						onAdd={openNewSnapshot}
						onOpen={(snapshot) => setSnapshotDialog({ open: true, snapshot })}
					/>
				</TabsContent>
			</Tabs>

			{writable !== undefined && (
				<>
					<TransactionSheet
						account={writable}
						open={sheet.open}
						transaction={sheet.transaction}
						onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
					/>
					<SnapshotDialog
						account={writable}
						open={snapshotDialog.open}
						snapshot={snapshotDialog.snapshot}
						onOpenChange={(open) => setSnapshotDialog((current) => ({ ...current, open }))}
					/>
				</>
			)}
		</div>
	);
}
