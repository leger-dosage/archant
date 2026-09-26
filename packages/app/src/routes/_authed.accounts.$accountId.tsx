import type { SnapshotData } from "@/hooks/useSnapshots";
import type { TransactionData } from "@/hooks/useTransactions";
import type { PageParam } from "@/lib/page-search";

import { Link, createFileRoute } from "@tanstack/react-router";
import { WalletIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import type { BalancePeriod } from "@archant/api/schemas/balances";
import { BALANCE_PERIODS, DEFAULT_BALANCE_PERIOD } from "@archant/api/schemas/balances";
import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode } from "@archant/data/money";

import { AccountMenu } from "@/components/AccountMenu";
import { BalanceChart, PeriodToggle } from "@/components/BalanceChart";
import { ImportDialog } from "@/components/ImportDialog";
import { ImportHistory, ImportHistorySkeleton } from "@/components/ImportHistory";
import { LoanSummary } from "@/components/LoanSummary";
import { Money } from "@/components/Money";
import { PAGE_TITLE_ID, Page } from "@/components/Page";
import { Pagination } from "@/components/Pagination";
import { SnapshotDialog } from "@/components/SnapshotDialog";
import { SnapshotList, SnapshotListSkeleton } from "@/components/SnapshotList";
import { TintedIcon } from "@/components/TintedIcon";
import { TransactionList, TransactionListSkeleton } from "@/components/TransactionList";
import { TransactionSheet } from "@/components/TransactionSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccount } from "@/hooks/useAccount";
import { useBalanceHistory } from "@/hooks/useBalanceHistory";
import { pageCountOf, useClampPage } from "@/hooks/useClampPage";
import { useAccountImports } from "@/hooks/useImports";
import { useAccountSnapshots } from "@/hooks/useSnapshots";
import { useAccountTransactions } from "@/hooks/useTransactions";
import { kindOf } from "@/lib/account-kinds";
import { errorCodeOf } from "@/lib/api";
import { toIsoDate } from "@/lib/dates";
import { pageSearch } from "@/lib/page-search";

const ACCOUNT_TABS = ["transactions", "snapshots", "imports"] as const;

type AccountTab = (typeof ACCOUNT_TABS)[number];

const DEFAULT_TAB: AccountTab = "transactions";

// DESIGN.md keeps shadows for popovers, menus, sheets and dialogs; shadcn's
// active tab has one, taken off here rather than in the copied component.
const FLAT_TAB = "group-data-[variant=default]/tabs-list:data-active:shadow-none";

// Absent means the first page, the default period and the Opérations tab, so
// links to an account need no search params. A value from an old or
// hand-edited link that no longer exists, such as the former `tab=settings`,
// falls back to the default rather than failing the page.
const searchSchema = z.object({
	page: z.number().int().min(1).optional().catch(undefined),
	period: z.enum(BALANCE_PERIODS).optional().catch(undefined),
	tab: z.enum(ACCOUNT_TABS).optional().catch(undefined),
	snapshotsPage: z.number().int().min(1).optional().catch(undefined),
	importsPage: z.number().int().min(1).optional().catch(undefined),
});

export const Route = createFileRoute("/_authed/accounts/$accountId")({
	validateSearch: searchSchema,
	component: AccountPage,
});

type SheetState = { open: boolean; transaction: TransactionData | null };

type SnapshotDialogState = { open: boolean; snapshot: SnapshotData | null };

/** Keeps a list of this page within its last page. */
function useClampAccountPage(
	accountId: string,
	param: PageParam,
	page: number,
	loaded: { total: number; pageSize: number } | undefined,
) {
	const navigate = Route.useNavigate();
	const goTo = useCallback(
		(lastPage: number) =>
			void navigate({
				to: "/accounts/$accountId",
				params: { accountId },
				search: (previous) => ({ ...previous, ...pageSearch(param, lastPage) }),
				replace: true,
			}),
		[accountId, navigate, param],
	);

	useClampPage(page, loaded, goTo);
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

	useClampAccountPage(
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
					target={{ to: "/accounts/$accountId", accountId, param: "page" }}
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

	useClampAccountPage(
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
					target={{ to: "/accounts/$accountId", accountId, param: "snapshotsPage" }}
					page={page}
					pageCount={pageCount}
					label={t("snapshots.paginationLabel")}
				/>
			)}
		</div>
	);
}

function ImportsPanel({ accountId, page }: { accountId: string; page: number }) {
	const { t } = useTranslation();
	const imports = useAccountImports(accountId, page);
	const data = imports.data;
	const pageCount = pageCountOf(data);

	useClampAccountPage(
		accountId,
		"importsPage",
		page,
		imports.isPlaceholderData ? undefined : imports.data,
	);

	return (
		<div className="flex flex-col gap-3">
			{imports.isPending && <ImportHistorySkeleton />}

			{imports.isError && (
				<ListError error={imports.error} onRetry={() => void imports.refetch()} />
			)}

			{data !== undefined && data.total === 0 && (
				<div className="rounded-lg border border-dashed p-8">
					<p className="text-muted-foreground">{t("imports.history.empty")}</p>
				</div>
			)}

			{data !== undefined && data.total > 0 && (
				<ImportHistory accountId={accountId} items={data.items} />
			)}

			{data !== undefined && pageCount > 1 && (
				<Pagination
					target={{ to: "/accounts/$accountId", accountId, param: "importsPage" }}
					page={page}
					pageCount={pageCount}
					label={t("imports.history.paginationLabel")}
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
		importsPage = 1,
	} = Route.useSearch();
	const account = useAccount(accountId);
	const balanceHistory = useBalanceHistory(accountId, period);
	const [sheet, setSheet] = useState<SheetState>({ open: false, transaction: null });
	const [snapshotDialog, setSnapshotDialog] = useState<SnapshotDialogState>({
		open: false,
		snapshot: null,
	});
	const [importing, setImporting] = useState(false);
	const notFound = account.isError && errorCodeOf(account.error) === "NOT_FOUND";
	const name = account.data?.name;
	const navigate = Route.useNavigate();

	useEffect(() => {
		document.title = t("app.pageTitle", {
			page: name ?? t("accountDetail.title"),
			app: t("app.name"),
		});
	}, [name, t]);

	const currency = account.data?.currency;
	const writable: { id: string; currency: CurrencyCode; openingDate: string } | undefined =
		account.data !== undefined && currency !== undefined && isCurrencyCode(currency)
			? { id: account.data.id, currency, openingDate: account.data.openingDate }
			: undefined;
	const canAddTransaction = account.data !== undefined;
	// A snapshot must fall after the opening date and not after today: an
	// account opened today or later has no valid date yet.
	const canAddSnapshot = writable !== undefined && writable.openingDate < toIsoDate();
	// The dialog needs the account's currency, like the two forms.
	const canImport = writable !== undefined;

	if (notFound) {
		return (
			<Page icon={WalletIcon} title={t("accountDetail.notFound")} className="items-start gap-3">
				<Button asChild variant="outline">
					<Link to="/accounts">{t("accountDetail.backToAccounts")}</Link>
				</Button>
			</Page>
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

	return (
		<Page
			icon={
				account.data === undefined ? (
					// The `md` tinted icon's box, so the title does not move once it loads.
					<span className="grid size-[22px] shrink-0 place-items-center">
						<WalletIcon aria-hidden="true" className="size-4 text-muted-foreground" />
					</span>
				) : (
					<TintedIcon subject={{ kind: "account", type: account.data.type }} />
				)
			}
			title={account.data?.name ?? t("accountDetail.title")}
			actions={
				account.data !== undefined ? (
					<>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="outline" onClick={() => setImporting(true)} disabled={!canImport}>
									{t("imports.open")}
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">{t("imports.title")}</TooltipContent>
						</Tooltip>
						<Button onClick={openNew}>{t("transactions.add")}</Button>
						<AccountMenu account={account.data} />
					</>
				) : undefined
			}
		>
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
				// Named by the title bar's `h1`: the account's name.
				<section aria-labelledby={PAGE_TITLE_ID} className="flex flex-col gap-1">
					<p className="flex items-center gap-2 text-sm text-muted-foreground">
						{t(`accounts.subtypes.${kindOf(account.data.type, account.data.subtype)}`)}
						{!account.data.active && <Badge variant="outline">{t("accounts.inactive")}</Badge>}
					</p>
					{account.data.details !== null && (
						<LoanSummary details={account.data.details} currency={account.data.currency} />
					)}
					<Money
						amount={account.data.balance}
						currency={account.data.currency}
						className="amount-hero mt-2"
					/>
				</section>
			)}

			<section aria-labelledby="balance-heading" className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 id="balance-heading" className="text-lg font-semibold">
						{t("balances.title")}
					</h2>
					<PeriodToggle period={period} onPeriodChange={changePeriod} />
				</div>
				<BalanceChart
					history={balanceHistory}
					summaryKey="balances.summary"
					valueLabel={t("balances.balance")}
				/>
			</section>

			<Tabs value={tab} onValueChange={changeTab} className="gap-3">
				<TabsList aria-label={t("accountDetail.tabs.label")}>
					<TabsTrigger value="transactions" className={FLAT_TAB}>
						{t("accountDetail.tabs.transactions")}
					</TabsTrigger>
					<TabsTrigger value="snapshots" className={FLAT_TAB}>
						{t("accountDetail.tabs.snapshots")}
					</TabsTrigger>
					<TabsTrigger value="imports" className={FLAT_TAB}>
						{t("accountDetail.tabs.imports")}
					</TabsTrigger>
				</TabsList>
				<TabsContent value="transactions">
					<TransactionsPanel
						accountId={accountId}
						page={page}
						canAdd={canAddTransaction}
						onAdd={openNew}
						onOpen={(transaction) => setSheet({ open: true, transaction })}
					/>
				</TabsContent>
				<TabsContent value="snapshots">
					<SnapshotsPanel
						accountId={accountId}
						page={snapshotsPage}
						canAdd={canAddSnapshot}
						onAdd={openNewSnapshot}
						onOpen={(snapshot) => setSnapshotDialog({ open: true, snapshot })}
					/>
				</TabsContent>
				<TabsContent value="imports">
					<ImportsPanel accountId={accountId} page={importsPage} />
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
					<ImportDialog account={writable} open={importing} onOpenChange={setImporting} />
				</>
			)}
		</Page>
	);
}
