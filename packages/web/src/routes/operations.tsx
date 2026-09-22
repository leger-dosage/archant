import type { FilterAccount, FilterChange } from "@/components/TransactionFilters";
import type { TransactionData } from "@/hooks/useTransactions";
import type { FilterKind } from "@/lib/transaction-filters";

import { createFileRoute } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { isCurrencyCode } from "@archant/data/money";

import { Money } from "@/components/Money";
import { Pagination } from "@/components/Pagination";
import { ShortcutHint } from "@/components/ShortcutHint";
import { TransactionFilters } from "@/components/TransactionFilters";
import { TransactionList, TransactionListSkeleton } from "@/components/TransactionList";
import { TransactionSheet } from "@/components/TransactionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccount } from "@/hooks/useAccount";
import { useAccounts } from "@/hooks/useAccounts";
import { pageCountOf, useClampPage } from "@/hooks/useClampPage";
import { useShortcut } from "@/hooks/useShortcut";
import { useTransactions } from "@/hooks/useTransactions";
import { errorCodeOf } from "@/lib/api";
import {
	filtersOf,
	hasFilters,
	operationsSearchSchema,
	withoutFilter,
} from "@/lib/transaction-filters";

export const Route = createFileRoute("/operations")({
	validateSearch: operationsSearchSchema,
	component: OperationsPage,
});

// Long enough to skip the keystrokes of one word, short enough to feel live.
const SEARCH_DELAY_MS = 300;

/**
 * The search field, bound to `q`. It keeps what is typed, trailing spaces
 * included, and writes the trimmed text to the URL once typing pauses. `/`
 * focuses it from anywhere on the page.
 */
function SearchField({ q }: { q: string | undefined }) {
	const { t } = useTranslation();
	const navigate = Route.useNavigate();
	const [text, setText] = useState(q ?? "");
	const [shown, setShown] = useState(q);
	const input = useRef<HTMLInputElement>(null);

	useShortcut("search", () => {
		input.current?.focus();
		input.current?.select();
	});

	// Follows the URL when it changes from elsewhere: « Effacer les filtres »,
	// the back button.
	if (q !== shown) {
		setShown(q);
		if ((q ?? "") !== text.trim()) {
			setText(q ?? "");
		}
	}

	useEffect(() => {
		const next = text.trim() === "" ? undefined : text.trim();

		if (next === q) {
			return undefined;
		}

		const timer = setTimeout(() => {
			void navigate({
				search: (previous) => ({ ...previous, q: next, page: undefined }),
				replace: true,
			});
		}, SEARCH_DELAY_MS);

		return () => clearTimeout(timer);
	}, [navigate, q, text]);

	return (
		<div className="relative w-full max-w-sm">
			<SearchIcon
				aria-hidden="true"
				className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Tooltip>
				<TooltipTrigger
					asChild
					// Hover only: a hint opening on focus would sit over the filters
					// while the user types.
					onFocus={(event) => event.preventDefault()}
				>
					<Input
						ref={input}
						type="search"
						aria-label={t("operations.search")}
						placeholder={t("operations.searchPlaceholder")}
						className="pl-8"
						value={text}
						onChange={(event) => setText(event.target.value)}
					/>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					<ShortcutHint id="search" label={t("operations.search")} />
				</TooltipContent>
			</Tooltip>
		</div>
	);
}

type SheetState = { open: boolean; transaction: TransactionData | null };

/** The transaction sheet, with the account the row belongs to. */
function OperationSheet({
	transaction,
	open,
	onOpenChange,
}: {
	transaction: TransactionData;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const account = useAccount(transaction.accountId);
	const data = account.data;

	if (data === undefined || !isCurrencyCode(data.currency)) {
		return null;
	}

	return (
		<TransactionSheet
			account={{ id: data.id, currency: data.currency, openingDate: data.openingDate }}
			open={open}
			transaction={transaction}
			onOpenChange={onOpenChange}
		/>
	);
}

function OperationsPage() {
	const { t } = useTranslation();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const page = search.page ?? 1;
	const filters = useMemo(() => filtersOf(search), [search]);
	const filtered = hasFilters(filters);
	const transactions = useTransactions(filters, page);
	const accounts = useAccounts();
	const data = transactions.data;
	const pageCount = pageCountOf(data);
	const [sheet, setSheet] = useState<SheetState>({ open: false, transaction: null });
	const accountOptions: FilterAccount[] = useMemo(
		() =>
			accounts.data?.groups.flatMap((group) =>
				group.accounts.map((account) => ({
					id: account.id,
					name: account.name,
					active: account.active,
				})),
			) ?? [],
		[accounts.data],
	);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("operations.title"), app: t("app.name") });
	}, [t]);

	const goToPage = useCallback(
		(lastPage: number) =>
			void navigate({
				search: (previous) => ({ ...previous, page: lastPage === 1 ? undefined : lastPage }),
				replace: true,
			}),
		[navigate],
	);

	useClampPage(page, transactions.isPlaceholderData ? undefined : data, goToPage);

	const change = (next: FilterChange) =>
		void navigate({ search: (previous) => ({ ...previous, ...next, page: undefined }) });
	const remove = (kind: FilterKind) =>
		void navigate({ search: (previous) => withoutFilter(previous, kind) });
	const clear = () => void navigate({ search: {} });

	return (
		<div className="flex w-full max-w-[1200px] flex-col gap-4 p-6">
			<h1 className="text-3xl font-semibold tracking-tight">{t("operations.title")}</h1>

			<div className="flex flex-wrap items-center gap-2">
				<SearchField q={search.q} />
				<TransactionFilters
					filters={filters}
					accounts={accountOptions}
					onChange={change}
					onRemove={remove}
				/>
				{data !== undefined && (
					<div className="ml-auto flex flex-col items-end gap-0.5 text-xs text-muted-foreground">
						<p aria-live="polite" className="whitespace-nowrap">
							{t("operations.results", { count: data.total })}
							{" · "}
							{t("operations.total")}{" "}
							<Money
								amount={data.sum.amount}
								currency={data.sum.currency}
								plusSign
								className="text-foreground"
							/>
						</p>
						{data.sum.skippedCount > 0 && (
							<p>{t("operations.skipped", { count: data.sum.skippedCount })}</p>
						)}
					</div>
				)}
			</div>

			{transactions.isPending && <TransactionListSkeleton />}

			{transactions.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(transactions.error)}`)}</p>
					<div className="flex gap-2">
						<Button variant="outline" onClick={() => void transactions.refetch()}>
							{t("common.retry")}
						</Button>
						{/* A filter the API refuses fails every retry; this is the way out. */}
						{filtered && (
							<Button variant="outline" onClick={clear}>
								{t("operations.clearFilters")}
							</Button>
						)}
					</div>
				</div>
			)}

			{data !== undefined && data.total === 0 && !filtered && (
				<div className="rounded-lg border border-dashed p-8">
					<p className="text-muted-foreground">{t("operations.empty")}</p>
				</div>
			)}

			{data !== undefined && data.total === 0 && filtered && (
				<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
					<p className="text-muted-foreground">{t("operations.noMatch")}</p>
					<Button variant="outline" onClick={clear}>
						{t("operations.clearFilters")}
					</Button>
				</div>
			)}

			{data !== undefined && data.total > 0 && (
				<TransactionList
					items={data.items}
					showAccount
					onOpen={(transaction) => setSheet({ open: true, transaction })}
				/>
			)}

			{data !== undefined && pageCount > 1 && (
				<Pagination
					target={{ to: "/operations" }}
					page={page}
					pageCount={pageCount}
					label={t("transactions.paginationLabel")}
				/>
			)}

			{sheet.transaction !== null && (
				<OperationSheet
					transaction={sheet.transaction}
					open={sheet.open}
					onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
				/>
			)}
		</div>
	);
}
