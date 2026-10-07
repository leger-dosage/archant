import type { SheetAccount } from "@/components/TransactionForm";
import type { HoldingsData, PositionData } from "@/hooks/useHoldings";
import type { SnapshotData } from "@/hooks/useSnapshots";
import type { TradeData } from "@/hooks/useTrades";
import type { TransactionData } from "@/hooks/useTransactions";
import type { PageParam } from "@/lib/page-search";

import { Link, createFileRoute } from "@tanstack/react-router";
import { ReceiptTextIcon, WalletIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import type { BalancePeriod } from "@archant/api/schemas/balances";
import { BALANCE_PERIODS, DEFAULT_BALANCE_PERIOD } from "@archant/api/schemas/balances";
import { isCurrencyCode } from "@archant/data/money";

import { AccountMenu } from "@/components/AccountMenu";
import { EmptyNote, EmptyState } from "@/components/EmptyState";
import { ImportDialog } from "@/components/ImportDialog";
import { ImportHistory, ImportHistorySkeleton } from "@/components/ImportHistory";
import { LazyBalanceChart } from "@/components/LazyBalanceChart";
import { LoanSchedule, LoanScheduleSkeleton } from "@/components/LoanSchedule";
import { LoanSummary } from "@/components/LoanSummary";
import { Money } from "@/components/Money";
import { PAGE_TITLE_ID, Page } from "@/components/Page";
import { Pagination } from "@/components/Pagination";
import { PeriodToggle } from "@/components/PeriodToggle";
import { PositionList, PositionListSkeleton } from "@/components/PositionList";
import { PositionSheet } from "@/components/PositionSheet";
import { Section } from "@/components/Section";
import { SnapshotDialog } from "@/components/SnapshotDialog";
import { SnapshotList, SnapshotListSkeleton } from "@/components/SnapshotList";
import { TintedIcon } from "@/components/TintedIcon";
import { TradeDialog } from "@/components/TradeDialog";
import { TradeList, TradeListSkeleton } from "@/components/TradeList";
import {
	TransactionList,
	TransactionListCard,
	TransactionListSkeleton,
} from "@/components/TransactionList";
import { TransactionSheet } from "@/components/TransactionSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccount } from "@/hooks/useAccount";
import { useBalanceHistory } from "@/hooks/useBalanceHistory";
import { pageCountOf, useClampPage } from "@/hooks/useClampPage";
import { useAccountHoldings } from "@/hooks/useHoldings";
import { useAccountImports } from "@/hooks/useImports";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useLoanSchedule } from "@/hooks/useLoanSchedule";
import { useAccountSnapshots } from "@/hooks/useSnapshots";
import { useAccountTrades } from "@/hooks/useTrades";
import { useAccountTransactions } from "@/hooks/useTransactions";
import { kindOf } from "@/lib/account-kinds";
import { errorCodeOf } from "@/lib/api";
import { toIsoDate } from "@/lib/dates";
import { pageSearch } from "@/lib/page-search";

const ACCOUNT_TABS = [
	"transactions",
	"snapshots",
	"schedule",
	"positions",
	"trades",
	"imports",
] as const;

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
	tradesPage: z.number().int().min(1).optional().catch(undefined),
	importsPage: z.number().int().min(1).optional().catch(undefined),
});

export const Route = createFileRoute("/_authed/accounts/$accountId")({
	validateSearch: searchSchema,
	component: AccountPage,
});

type SheetState = { open: boolean; transaction: TransactionData | null };

type SnapshotDialogState = { open: boolean; snapshot: SnapshotData | null };

type TradeDialogState = { open: boolean; trade: TradeData | null };

type PositionSheetState = { open: boolean; securityId: string | null };

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
	/** `null` for a viewer, who adds nothing: the empty state keeps its text alone. */
	onAdd: (() => void) | null;
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

	// No rows, no list card: the empty state is a card of its own.
	if (data !== undefined && data.total === 0) {
		return (
			<EmptyState
				icon={{ kind: "transfer", icon: ReceiptTextIcon }}
				title={t("transactions.empty.title")}
				description={t("transactions.empty.description")}
				action={
					onAdd === null ? null : (
						<Button onClick={onAdd} disabled={!canAdd}>
							{t("transactions.add")}
						</Button>
					)
				}
			/>
		);
	}

	return (
		<TransactionListCard>
			{transactions.isPending && <TransactionListSkeleton />}

			{transactions.isError && (
				<ListError error={transactions.error} onRetry={() => void transactions.refetch()} />
			)}

			{data !== undefined && data.total > 0 && (
				<TransactionList items={data.items} splitParents={data.splitParents} onOpen={onOpen} />
			)}

			{data !== undefined && pageCount > 1 && (
				<Pagination
					target={{ to: "/accounts/$accountId", accountId, param: "page" }}
					page={page}
					pageCount={pageCount}
					label={t("transactions.paginationLabel")}
				/>
			)}
		</TransactionListCard>
	);
}

type SnapshotsPanelProps = {
	accountId: string;
	page: number;
	canAdd: boolean;
	/** Both `null` for a viewer: no « Ajouter un solde », and rows that open nothing. */
	onAdd: (() => void) | null;
	onOpen: ((snapshot: SnapshotData) => void) | null;
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
			{onAdd !== null && (
				<div className="flex justify-end">
					<Button variant="outline" onClick={onAdd} disabled={!canAdd}>
						{t("snapshots.add")}
					</Button>
				</div>
			)}

			{snapshots.isPending && <SnapshotListSkeleton />}

			{snapshots.isError && (
				<ListError error={snapshots.error} onRetry={() => void snapshots.refetch()} />
			)}

			{data !== undefined && data.total === 0 && <EmptyNote>{t("snapshots.empty")}</EmptyNote>}

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

type TradesPanelProps = {
	accountId: string;
	page: number;
	canAdd: boolean;
	/** Both `null` for a viewer: no « Ajouter un ordre », and rows that open nothing. */
	onAdd: (() => void) | null;
	onOpen: ((trade: TradeData) => void) | null;
};

function TradesPanel({ accountId, page, canAdd, onAdd, onOpen }: TradesPanelProps) {
	const { t } = useTranslation();
	const trades = useAccountTrades(accountId, page);
	const data = trades.data;
	const pageCount = pageCountOf(data);

	useClampAccountPage(
		accountId,
		"tradesPage",
		page,
		trades.isPlaceholderData ? undefined : trades.data,
	);

	return (
		<div className="flex flex-col gap-3">
			{onAdd !== null && (
				<div className="flex justify-end">
					<Button variant="outline" onClick={onAdd} disabled={!canAdd}>
						{t("trades.add")}
					</Button>
				</div>
			)}

			{trades.isPending && <TradeListSkeleton />}

			{trades.isError && <ListError error={trades.error} onRetry={() => void trades.refetch()} />}

			{data !== undefined && data.total === 0 && <EmptyNote>{t("trades.empty")}</EmptyNote>}

			{data !== undefined && data.total > 0 && <TradeList items={data.items} onOpen={onOpen} />}

			{data !== undefined && pageCount > 1 && (
				<Pagination
					target={{ to: "/accounts/$accountId", accountId, param: "tradesPage" }}
					page={page}
					pageCount={pageCount}
					label={t("trades.paginationLabel")}
				/>
			)}
		</div>
	);
}

type PositionsPanelProps = {
	holdings: ReturnType<typeof useAccountHoldings>;
	onOpen: (position: PositionData) => void;
};

function PositionsPanel({ holdings, onOpen }: PositionsPanelProps) {
	const { t } = useTranslation();
	const data: HoldingsData | undefined = holdings.data;

	return (
		<div className="flex flex-col gap-3">
			{holdings.isPending && <PositionListSkeleton />}

			{holdings.isError && (
				<ListError error={holdings.error} onRetry={() => void holdings.refetch()} />
			)}

			{data !== undefined && data.positions.length === 0 && (
				<EmptyNote>{t("positions.empty")}</EmptyNote>
			)}

			{data !== undefined && <PositionList holdings={data} onOpen={onOpen} />}
		</div>
	);
}

function SchedulePanel({ schedule }: { schedule: ReturnType<typeof useLoanSchedule> }) {
	return (
		<div className="flex flex-col gap-3">
			{schedule.isPending && <LoanScheduleSkeleton />}

			{schedule.isError && (
				<ListError error={schedule.error} onRetry={() => void schedule.refetch()} />
			)}

			{schedule.data !== undefined && schedule.data !== null && (
				<LoanSchedule schedule={schedule.data} />
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
				<EmptyNote>{t("imports.history.empty")}</EmptyNote>
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
		tab: requestedTab = DEFAULT_TAB,
		snapshotsPage = 1,
		tradesPage = 1,
		importsPage = 1,
	} = Route.useSearch();
	const account = useAccount(accountId);
	const admin = useIsAdmin();
	const balanceHistory = useBalanceHistory(accountId, period);
	const [sheet, setSheet] = useState<SheetState>({ open: false, transaction: null });
	const [snapshotDialog, setSnapshotDialog] = useState<SnapshotDialogState>({
		open: false,
		snapshot: null,
	});
	const [tradeDialog, setTradeDialog] = useState<TradeDialogState>({ open: false, trade: null });
	const [positionSheet, setPositionSheet] = useState<PositionSheetState>({
		open: false,
		securityId: null,
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

	// Only an investment account holds securities: « Ordres » is its tab alone,
	// and a link to it on another account opens « Opérations ». « Positions »
	// shows once the account has traded, as Sure's holdings table; a link to it
	// before then opens « Opérations » too.
	const investment = account.data?.type === "investment";
	// Its answer says whether « Positions » shows; asked for by a link, the
	// tab shows while it loads or fails, with its skeleton or its error.
	const holdings = useAccountHoldings(accountId, investment);
	const traded =
		investment &&
		(holdings.data === undefined ? requestedTab === "positions" : holdings.data.date !== null);
	// « Échéancier » shows for a loan with a schedule, as Sure's `amortizable?`;
	// a link to it otherwise opens « Opérations », as « Positions » does.
	const loan = account.data?.type === "loan";
	const schedule = useLoanSchedule(accountId, loan);
	// A failed read shows the tab too, so its error and retry are reachable.
	const scheduled =
		loan &&
		(schedule.isError ||
			(schedule.data === undefined ? requestedTab === "schedule" : schedule.data !== null));
	const tab =
		(requestedTab === "trades" && account.data !== undefined && !investment) ||
		(requestedTab === "positions" && account.data !== undefined && !traded) ||
		(requestedTab === "schedule" && account.data !== undefined && !scheduled)
			? DEFAULT_TAB
			: requestedTab;
	// The sheet reads the position afresh, so a lock or a typed price shows at once.
	const openPosition =
		holdings.data?.positions.find(
			(position) => position.security.id === positionSheet.securityId,
		) ?? null;
	const currency = account.data?.currency;
	const writable: SheetAccount | undefined =
		account.data !== undefined && currency !== undefined && isCurrencyCode(currency)
			? {
					id: account.data.id,
					currency,
					openingDate: account.data.openingDate,
					type: account.data.type,
				}
			: undefined;
	const canAddTransaction = account.data !== undefined;
	// A snapshot or a trade must fall after the opening date and not after
	// today: an account opened today or later has no valid date yet.
	const canDateAfterOpening = writable !== undefined && writable.openingDate < toIsoDate();
	// The dialog needs the account's currency, like the two forms.
	const canImport = writable !== undefined;

	if (notFound) {
		return (
			<Page title={t("accountDetail.notFound")} className="items-start gap-3">
				<Button asChild variant="outline">
					<Link to="/accounts">{t("accountDetail.backToAccounts")}</Link>
				</Button>
			</Page>
		);
	}

	const openNew = () => setSheet({ open: true, transaction: null });
	const openNewSnapshot = () => setSnapshotDialog({ open: true, snapshot: null });
	const openNewTrade = () => setTradeDialog({ open: true, trade: null });
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
					// The `lg` tinted icon's box, so the title does not move once it loads.
					<span className="grid size-9 shrink-0 place-items-center">
						<WalletIcon aria-hidden="true" className="size-4 text-muted-foreground" />
					</span>
				) : (
					<TintedIcon size="lg" subject={{ kind: "account", type: account.data.type }} />
				)
			}
			title={account.data?.name ?? t("accountDetail.title")}
			actions={
				account.data !== undefined && admin ? (
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
				// Named by the page header's `h1`: the account's name.
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

			<Section
				id="balance-heading"
				title={t("balances.title")}
				action={<PeriodToggle period={period} onPeriodChange={changePeriod} />}
			>
				<div className="flex flex-col gap-4 p-4">
					<LazyBalanceChart
						history={balanceHistory}
						summaryKey="balances.summary"
						valueLabel={t("balances.balance")}
					/>
				</div>
			</Section>

			<Tabs value={tab} onValueChange={changeTab} className="gap-3">
				<TabsList aria-label={t("accountDetail.tabs.label")}>
					<TabsTrigger value="transactions" className={FLAT_TAB}>
						{t("accountDetail.tabs.transactions")}
					</TabsTrigger>
					<TabsTrigger value="snapshots" className={FLAT_TAB}>
						{t("accountDetail.tabs.snapshots")}
					</TabsTrigger>
					{scheduled && (
						<TabsTrigger value="schedule" className={FLAT_TAB}>
							{t("accountDetail.tabs.schedule")}
						</TabsTrigger>
					)}
					{traded && (
						<TabsTrigger value="positions" className={FLAT_TAB}>
							{t("accountDetail.tabs.positions")}
						</TabsTrigger>
					)}
					{investment && (
						<TabsTrigger value="trades" className={FLAT_TAB}>
							{t("accountDetail.tabs.trades")}
						</TabsTrigger>
					)}
					<TabsTrigger value="imports" className={FLAT_TAB}>
						{t("accountDetail.tabs.imports")}
					</TabsTrigger>
				</TabsList>
				<TabsContent value="transactions">
					<TransactionsPanel
						accountId={accountId}
						page={page}
						canAdd={canAddTransaction}
						onAdd={admin ? openNew : null}
						onOpen={(transaction) => setSheet({ open: true, transaction })}
					/>
				</TabsContent>
				<TabsContent value="snapshots">
					<SnapshotsPanel
						accountId={accountId}
						page={snapshotsPage}
						canAdd={canDateAfterOpening}
						onAdd={admin ? openNewSnapshot : null}
						onOpen={admin ? (snapshot) => setSnapshotDialog({ open: true, snapshot }) : null}
					/>
				</TabsContent>
				{scheduled && (
					<TabsContent value="schedule">
						<SchedulePanel schedule={schedule} />
					</TabsContent>
				)}
				{traded && (
					<TabsContent value="positions">
						<PositionsPanel
							holdings={holdings}
							onOpen={(position) =>
								setPositionSheet({ open: true, securityId: position.security.id })
							}
						/>
					</TabsContent>
				)}
				{investment && (
					<TabsContent value="trades">
						<TradesPanel
							accountId={accountId}
							page={tradesPage}
							canAdd={canDateAfterOpening}
							onAdd={admin ? openNewTrade : null}
							onOpen={admin ? (trade) => setTradeDialog({ open: true, trade }) : null}
						/>
					</TabsContent>
				)}
				<TabsContent value="imports">
					<ImportsPanel accountId={accountId} page={importsPage} />
				</TabsContent>
			</Tabs>

			{writable !== undefined && (
				<>
					{traded && (
						<PositionSheet
							account={writable}
							position={openPosition}
							open={positionSheet.open && openPosition !== null}
							canWrite={admin}
							onOpenChange={(open) => setPositionSheet((current) => ({ ...current, open }))}
						/>
					)}
					<TransactionSheet
						account={writable}
						open={sheet.open}
						transaction={sheet.transaction}
						onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
					/>
					{admin && (
						<>
							<SnapshotDialog
								account={writable}
								open={snapshotDialog.open}
								snapshot={snapshotDialog.snapshot}
								onOpenChange={(open) => setSnapshotDialog((current) => ({ ...current, open }))}
							/>
							{investment && (
								<TradeDialog
									account={writable}
									open={tradeDialog.open}
									trade={tradeDialog.trade}
									onOpenChange={(open) => setTradeDialog((current) => ({ ...current, open }))}
								/>
							)}
							<ImportDialog account={writable} open={importing} onOpenChange={setImporting} />
						</>
					)}
				</>
			)}
		</Page>
	);
}
