import type { BillDialogSubject } from "@/components/BillDialog";
import type {
	AllBillsQuery,
	BillRowData,
	BillsData,
	SuggestedPaymentData,
} from "@/hooks/useRecurring";
import type { TFunction } from "i18next";

import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { ReceiptIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { BILL_SORTS, BILL_STATUS_FILTERS } from "@archant/api/schemas/bills";
import { BILL_TYPES } from "@archant/data/recurring";

import { AllBills } from "@/components/AllBills";
import { useBillActions } from "@/components/BillActions";
import { BillDialog } from "@/components/BillDialog";
import {
	AmountRange,
	MatchReasons,
	PartialLabel,
	confidenceText,
	dueLabel,
	isPartial,
} from "@/components/BillLabels";
import { EmptyState } from "@/components/EmptyState";
import { InsetGroup } from "@/components/InsetGroup";
import { LeftOutNotice } from "@/components/LeftOutNotice";
import { Money } from "@/components/Money";
import { OccurrenceSheet } from "@/components/OccurrenceSheet";
import { Page } from "@/components/Page";
import { RecurringSuggestions } from "@/components/RecurringSuggestions";
import { StatusBadge } from "@/components/StatusBadge";
import { SuggestionActions } from "@/components/SuggestionActions";
import { SummaryStrip } from "@/components/SummaryStrip";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/hooks/useAccounts";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useBills, useDetectRecurring, useRecurring } from "@/hooks/useRecurring";
import { errorCodeOf } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";
import { dayAndMonth } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { cn } from "@/lib/utils";

// The router reads `?q=2024` as JSON, so a number, while a value set by the
// page is a string: both mean the same text.
const text = z.union([z.string(), z.number()]).transform(String);

// The occurrence whose sheet is open, as Sure's `?occurrence=`; with
// `view=all`, « Toutes les factures » and its search, filters and sort, as
// Sure's `bills?view=all&q[...]`. A value an old or hand-edited link holds
// that no longer exists is dropped rather than failing the page.
const searchSchema = z.object({
	occurrence: z.string().min(1).optional().catch(undefined),
	view: z.literal("all").optional().catch(undefined),
	// The API's own cap: a longer value is dropped rather than failing the table.
	q: text
		.transform((value) => value.trim())
		.pipe(z.string().min(1).max(200))
		.optional()
		.catch(undefined),
	status: z.enum(BILL_STATUS_FILTERS).optional().catch(undefined),
	type: z.enum(BILL_TYPES).optional().catch(undefined),
	// By due date when absent, the default.
	// `due` is the default, so the URL never carries it.
	sort: z.enum(BILL_SORTS).exclude(["due"]).optional().catch(undefined),
});

export const Route = createFileRoute("/_authed/bills")({
	validateSearch: searchSchema,
	component: BillsPage,
});

/** The amount the row's next decision turns on: paid, what remains, else what is expected. */
function rowAmount(row: BillRowData) {
	if (row.state === "paid") {
		return row.confirmed;
	}

	return isPartial(row) ? row.remaining : row.expected;
}

/** The series' band when the row shows its expected amount and that amount is an estimate. */
const estimateOf = (row: BillRowData) =>
	row.state === "paid" || isPartial(row) ? null : row.amountRange;

/** `rowAmount`, with Sure's « ~ » before an estimate. */
function RowAmount({ row, className = "" }: { row: BillRowData; className?: string }) {
	const money = <Money amount={rowAmount(row)} currency={row.currency} className={className} />;

	return estimateOf(row) === null ? (
		money
	) : (
		<span className="whitespace-nowrap">
			<span className={cn("font-medium", className)}>~</span>
			{money}
		</span>
	);
}

/** One occurrence, a link that opens its sheet. */
function BillRow({ row }: { row: BillRowData }) {
	const { t } = useTranslation();
	const paid = row.state === "paid";
	const range = estimateOf(row);

	return (
		<li>
			<Link
				to="/bills"
				search={{ occurrence: row.occurrenceId }}
				resetScroll={false}
				className="flex min-h-14 items-center gap-3 px-4 py-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
			>
				<TintedIcon subject={{ kind: "merchant", name: row.name }} size="md" />
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="truncate font-medium">{row.name}</span>
					<span
						className={cn(
							"flex flex-wrap items-center gap-x-1.5 text-xs",
							row.state === "overdue" ? "text-destructive" : "text-muted-foreground",
						)}
					>
						<span>{dueLabel(row, t)}</span>
						{isPartial(row) && (
							<>
								<span aria-hidden="true">·</span>
								<PartialLabel row={row} />
							</>
						)}
					</span>
				</span>
				<span className="flex shrink-0 items-center gap-2">
					{row.state === "due" && <StatusBadge status="billDueSoon" />}
					{paid && <StatusBadge status="billPaid" />}
					<span className="flex flex-col items-end">
						<RowAmount row={row} />
						{/* Sure shows the band only from `@lg`: on a phone it squeezes the name, and the drawer has it. */}
						{range !== null && (
							<AmountRange range={range} currency={row.currency} className="hidden @lg:block" />
						)}
					</span>
				</span>
			</Link>
		</li>
	);
}

/** A section of rows; nothing when it has none. */
function BillSection({ title, rows }: { title: string; rows: readonly BillRowData[] }) {
	if (rows.length === 0) {
		return null;
	}

	return (
		<InsetGroup level={2} title={title} count={rows.length}>
			<ul
				aria-label={title}
				className="@container flex flex-col divide-y divide-line overflow-hidden rounded-lg border bg-card"
			>
				{rows.map((row) => (
					<BillRow key={row.occurrenceId} row={row} />
				))}
			</ul>
		</InsetGroup>
	);
}

/** « Prochaine »: today, tomorrow, else the date. */
function nextDate(row: BillRowData, t: TFunction) {
	if (row.days === 0) {
		return t("bills.next.today");
	}

	return row.days === 1 ? t("bills.next.tomorrow") : dayAndMonth(row.effectiveDueOn);
}

/** Sure's month pulse: the month's four totals, then « Prochaine », the next four from today. */
function Totals({ bills }: { bills: BillsData }) {
	const { t } = useTranslation();
	const money = (amount: BillsData["totals"]["paid"]) => (
		<Money amount={amount} currency={bills.currency} />
	);

	return (
		<section
			aria-label={t("bills.totals.title")}
			className="flex flex-col overflow-hidden rounded-xl border bg-card"
		>
			<SummaryStrip
				cells={[
					{ label: t("bills.totals.remaining"), value: money(bills.totals.remaining) },
					{ label: t("bills.totals.overdue"), value: money(bills.totals.overdue) },
					{ label: t("bills.totals.dueSoon"), value: money(bills.totals.dueSoon) },
					{ label: t("bills.totals.paid"), value: money(bills.totals.paid) },
				]}
			/>
			{bills.next.length > 0 && (
				<div className="flex flex-col gap-2 border-t border-line p-4">
					<h2 id="bills-next" className="type-overline text-muted-foreground">
						{t("bills.next.title")}
					</h2>
					<ul
						aria-labelledby="bills-next"
						className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
					>
						{bills.next.map((row) => (
							<li key={row.occurrenceId}>
								<Link
									to="/bills"
									search={{ occurrence: row.occurrenceId }}
									resetScroll={false}
									className="flex flex-col rounded-lg px-2 py-1.5 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
								>
									<span className="truncate text-xs text-muted-foreground">{nextDate(row, t)}</span>
									<span className="truncate text-sm">{row.name}</span>
									<RowAmount row={row} className="text-sm" />
								</Link>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}

/**
 * Sure's review queue: each suggested payment as « PRLV CREDIT AGRICOLE
 * ressemble à un paiement de Prêt immobilier », its amount, date, percentage
 * and signals, the surest first. A viewer reads it without its buttons.
 */
function ReviewQueue({ items, admin }: { items: readonly SuggestedPaymentData[]; admin: boolean }) {
	const { t } = useTranslation();
	const title = t("bills.review.title");

	return (
		<InsetGroup level={2} title={title} count={items.length}>
			<ul
				aria-label={title}
				className="flex flex-col divide-y divide-line rounded-lg border bg-card"
			>
				{items.map((item) => (
					<li key={item.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
						<div className="flex min-w-0 flex-1 flex-col gap-1.5">
							<p className="text-sm">
								{t("bills.review.line", {
									label: item.label ?? t("bills.review.unknown"),
									bill: item.seriesName,
								})}
							</p>
							<p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
								<Money amount={item.amount} currency={item.currency} className="text-foreground" />
								{item.paidOn !== null && (
									<>
										<span aria-hidden="true">·</span>
										<span>{formatShortDate(item.paidOn)}</span>
									</>
								)}
								{item.confidence !== null && (
									<>
										<span aria-hidden="true">·</span>
										<span className="tabular-nums">{confidenceText(item.confidence)}</span>
									</>
								)}
							</p>
							<MatchReasons
								signals={item.signals}
								currency={item.currency}
								expected={item.expected}
								actual={item.entryAmount}
								dueOn={item.effectiveDueOn}
								paidOn={item.paidOn}
							/>
						</div>
						{admin && <SuggestionActions paymentId={item.id} className="shrink-0" />}
					</li>
				))}
			</ul>
		</InsetGroup>
	);
}

/** `/bills`, or with `view=all` Sure's `bills/all`. */
function BillsPage() {
	const { view } = Route.useSearch();

	return view === "all" ? <AllBillsPage /> : <OverviewPage />;
}

/**
 * Sure's `bills/all`: every bill, its filters, search and sort in the URL,
 * « Ajouter une facture » and « Ajouter un revenu » for an administrator. A
 * bill's drawer, `/bills/$billId`, opens over it and keeps the search.
 */
function AllBillsPage() {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const actions = useBillActions();
	const changeQuery = useCallback(
		(next: AllBillsQuery) =>
			void navigate({
				search: (previous) => ({ ...previous, ...next }),
				replace: true,
				resetScroll: false,
			}),
		[navigate],
	);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("bills.all"), app: t("app.name") });
	}, [t]);

	return (
		<Page
			title={t("bills.title")}
			description={t("bills.allView.description")}
			actions={
				<>
					<Button variant="outline" asChild>
						<Link to="/bills">{t("bills.overview")}</Link>
					</Button>
					{admin && (
						<>
							<Button variant="outline" onClick={() => actions.declare("income")}>
								{t("recurring.addIncome")}
							</Button>
							<Button onClick={() => actions.declare("bill")}>{t("recurring.addBill")}</Button>
						</>
					)}
				</>
			}
		>
			<AllBills
				query={{ q: search.q, status: search.status, type: search.type, sort: search.sort }}
				onQuery={changeQuery}
				admin={admin}
				actions={actions}
			/>
			{actions.dialogs}
			<Outlet />
		</Page>
	);
}

/**
 * Sure's `bills#index`, in its order: the month's totals and « Prochaine »,
 * the series the totals leave out, the review queue, the possible bills
 * detection found, then « Requiert votre attention », « Ce mois-ci »,
 * « Après ce mois-ci » and « Inactive ». A row opens its occurrence's sheet.
 * A viewer reads it all without any action. A bill's drawer,
 * `/bills/$billId`, opens over it.
 */
function OverviewPage() {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const { occurrence } = Route.useSearch();
	const navigate = Route.useNavigate();
	const bills = useBills();
	const recurring = useRecurring();
	const detect = useDetectRecurring();
	// Kept while the sheet closes, so its content does not vanish mid-animation.
	const [shown, setShown] = useState<string | null>(occurrence ?? null);
	// Kept while the dialog closes; the key mounts a fresh form per opening.
	const [subject, setSubject] = useState<{ key: number; of: BillDialogSubject } | null>(null);
	const [billOpen, setBillOpen] = useState(false);
	const accounts = useAccounts({
		select: (data) => data.groups.flatMap((group) => group.accounts),
	});
	const offered = useMemo(
		() => (accounts.data ?? []).filter((account) => account.active),
		[accounts.data],
	);
	const suggestions = (recurring.data ?? []).filter((item) => item.status === "suggested");
	const data = bills.data;
	const listed =
		data !== undefined &&
		[data.attention, data.month, data.later, data.inactive].some((rows) => rows.length > 0);
	// Sure's `bill_rows_empty` without a suggestion: an income alone lists no bill either.
	const empty =
		data !== undefined && recurring.data !== undefined && !listed && suggestions.length === 0;
	const ready = data !== undefined && recurring.data !== undefined;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("bills.title"), app: t("app.name") });
	}, [t]);

	if (occurrence !== undefined && occurrence !== shown) {
		setShown(occurrence);
	}

	const declare = () => {
		setSubject((current) => ({
			key: (current?.key ?? 0) + 1,
			of: { mode: "declare", kind: "bill", prefill: null },
		}));
		setBillOpen(true);
	};

	const runDetection = () =>
		detect.mutate(undefined, {
			onSuccess: ({ detected }) => toast.success(t("recurring.detected", { count: detected })),
			onError: (error) => showErrorToast(errorCodeOf(error)),
		});

	return (
		<Page
			title={t("bills.title")}
			description={t("bills.description")}
			actions={
				<>
					<Button variant="outline" asChild>
						<Link to="/bills" search={{ view: "all" }}>
							{t("bills.all")}
						</Link>
					</Button>
					{/* An empty page offers its own « Ajouter une facture ». */}
					{admin && ready && !empty && <Button onClick={declare}>{t("recurring.addBill")}</Button>}
				</>
			}
		>
			{bills.isPending && (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-32 w-full" />
					<Skeleton className="h-14 w-full" />
					<Skeleton className="h-14 w-full" />
				</div>
			)}

			{bills.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border bg-card p-4">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(bills.error)}`)}</p>
					<Button variant="outline" onClick={() => void bills.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{data !== undefined && (
				<>
					{listed && <Totals bills={data} />}
					<LeftOutNotice accounts={data.leftOut} />
					{data.review.length > 0 && <ReviewQueue items={data.review} admin={admin} />}
					{suggestions.length > 0 && <RecurringSuggestions items={suggestions} admin={admin} />}
					{empty && (
						<EmptyState
							level={2}
							icon={{ kind: "transfer", icon: ReceiptIcon }}
							title={t("bills.empty.title")}
							description={t(
								data.hasTransactions ? "bills.empty.description" : "bills.empty.noTransactions",
							)}
							action={
								admin ? (
									<span className="flex flex-wrap justify-center gap-2">
										{data.hasTransactions && (
											<Button disabled={detect.isPending} onClick={runDetection}>
												{t("bills.empty.detect")}
											</Button>
										)}
										<Button
											variant={data.hasTransactions ? "outline" : "default"}
											onClick={declare}
										>
											{t("recurring.addBill")}
										</Button>
									</span>
								) : null
							}
						/>
					)}
					<BillSection title={t("bills.sections.attention")} rows={data.attention} />
					<BillSection title={t("bills.sections.month")} rows={data.month} />
					<BillSection title={t("bills.sections.later")} rows={data.later} />
					<BillSection title={t("bills.sections.inactive")} rows={data.inactive} />
				</>
			)}

			{shown !== null && (
				<OccurrenceSheet
					key={shown}
					occurrenceId={shown}
					open={occurrence !== undefined}
					onOpenChange={(open) => {
						if (!open) {
							void navigate({ search: {}, replace: true, resetScroll: false });
						}
					}}
				/>
			)}

			{subject !== null && (
				<BillDialog
					key={subject.key}
					open={billOpen}
					onOpenChange={setBillOpen}
					subject={subject.of}
					accounts={offered}
				/>
			)}

			<Outlet />
		</Page>
	);
}
