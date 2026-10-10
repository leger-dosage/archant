import type { CategoryData } from "@/hooks/useCategories";
import type { Selection } from "@/hooks/useSelection";
import type { TransactionData } from "@/hooks/useTransactions";
import type { ReactNode } from "react";

import { CheckIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { CategoryCombobox } from "@/components/CategoryCombobox";
import { CategoryPill, TransferPill } from "@/components/CategoryPill";
import { ExcludedMarker } from "@/components/ExcludedMarker";
import { InsetGroup } from "@/components/InsetGroup";
import { Money } from "@/components/Money";
import { OneTimeMarker } from "@/components/OneTimeMarker";
import { StatusBadge } from "@/components/StatusBadge";
import { TintedIcon } from "@/components/TintedIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCategories, useCategoryShown } from "@/hooks/useCategories";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useMerchants } from "@/hooks/useMerchants";
import { useTags } from "@/hooks/useTags";
import { useSetTransactionCategory } from "@/hooks/useTransactions";
import { useConfirmTransfer, useRejectTransfer } from "@/hooks/useTransfers";
import { errorCodeOf } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";
import { dayHeading } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { rowSubject } from "@/lib/tint";
import { groupByDay } from "@/lib/transaction-days";
import { showsCategory, transferCaption } from "@/lib/transfers";
import { cn } from "@/lib/utils";

type TransactionListProps = {
	items: readonly TransactionData[];
	/** The parents of the split lines in `items`, shown above them and never counted. */
	splitParents?: readonly TransactionData[];
	onOpen: (transaction: TransactionData) => void;
	/** Shows each row's account, for a list spanning several. */
	showAccount?: boolean;
	/** Ticks rows for a bulk action; without it, rows have no checkbox. */
	selection?: Selection;
	/** The day headings' level: `h2` directly under the page's `h1`, `h3` under a card's `h2`. */
	headingLevel?: 2 | 3;
};

function DayTitle({ date }: { date: string }) {
	const { t } = useTranslation();
	const heading = dayHeading(date);

	if (heading.kind === "date") {
		return <>{heading.text}</>;
	}

	return <>{t(`transactions.days.${heading.kind}`)}</>;
}

type CategoryChipProps = {
	transaction: TransactionData;
	/** `undefined` while the category list loads. */
	categories: readonly CategoryData[] | undefined;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onPick: (categoryId: string | null) => void;
};

// Over the row button, never inside it: beside the date below 768 px, under
// the amount's column too, and in the category column from 768 px, where the
// button leaves that cell empty.
const CATEGORY_SLOT =
	"relative z-10 col-start-3 col-end-5 row-start-2 -my-0.5 flex min-h-7 max-w-full min-w-0 items-center self-start justify-self-start md:col-end-4 md:row-start-1 md:self-center";

/**
 * The columns from 768 px: the icon, the label, the category, the account
 * from 1024 px when shown, the amount. The label takes as much as the
 * columns on its right together, so the row button's centre, where a pointer
 * or a test aims, lies on the label rather than under the category pill. The
 * icon's column holds the row button's 12 px padding too: a subgrid's
 * padding is its edge items' margin.
 */
function columnsOf(showAccount: boolean) {
	return showAccount
		? "md:grid-cols-[3rem_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[3rem_minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
		: "md:grid-cols-[3rem_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]";
}

/**
 * The row's category pill, or « Sans catégorie ». A button of its own beside
 * the row's, never inside it, that opens the combobox in place.
 */
function CategoryChip({ transaction, categories, open, onOpenChange, onPick }: CategoryChipProps) {
	const { t } = useTranslation();
	const { color, icon, name } = useCategoryShown(transaction.categoryId);

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<button
							type="button"
							aria-label={
								name === null
									? t("transactions.category.change")
									: t("transactions.category.chip", { name })
							}
							className={cn(
								CATEGORY_SLOT,
								// A 28 px target around the 24 px pill; the ring hugs the pill.
								"group outline-none md:relative md:z-10",
							)}
						>
							{name === null ? (
								<Skeleton className="h-6 w-24 rounded-full" />
							) : (
								<CategoryPill
									category={color === null || icon === null ? null : { name, color, icon }}
									fallback={name}
									className="group-hover:ring-1 group-hover:ring-border-strong group-focus-visible:ring-2 group-focus-visible:ring-ring"
								/>
							)}
						</button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">{t("transactions.category.change")}</TooltipContent>
			</Tooltip>
			<PopoverContent align="start" className="w-72 p-0">
				<CategoryCombobox
					categories={categories ?? []}
					value={transaction.categoryId}
					onSelect={onPick}
				/>
			</PopoverContent>
		</Popover>
	);
}

/**
 * The row's category for a viewer, who changes none: the pill alone, not a
 * button, letting a click through to the row as the transfer pill does.
 */
function CategoryLabel({ categoryId }: { categoryId: string | null }) {
	const { color, icon, name } = useCategoryShown(categoryId);

	return (
		<span className={cn(CATEGORY_SLOT, "pointer-events-none")}>
			{name === null ? (
				<Skeleton className="h-6 w-24 rounded-full" />
			) : (
				<CategoryPill
					category={color === null || icon === null ? null : { name, color, icon }}
					fallback={name}
				/>
			)}
		</span>
	);
}

/**
 * A transfer side's pill, where a standard row has its category: not a
 * button, since a side the dashboard does not count has no category to pick
 * until it is dissociated. A spent outflow shows its category instead
 * (`showsCategory`), and its kind moves to the caption.
 */
function TransferChip({ kind }: { kind: NonNullable<TransactionData["transfer"]>["kind"] }) {
	const { t } = useTranslation();

	return (
		// Lets a click through to the row button beneath, as the rest of the row does.
		<span className={cn(CATEGORY_SLOT, "pointer-events-none")}>
			<TransferPill name={t(`transactions.transfer.kinds.${kind}`)} />
		</span>
	);
}

/**
 * The room after the row button where an administrator confirms or rejects a
 * proposed transfer, kept on every row of a list that holds a proposal so the
 * amounts stay in one column.
 */
const MATCH_ACTIONS_SLOT = "flex w-16 shrink-0 items-center justify-end gap-1 pr-1";

const failed = (error: unknown) => showErrorToast(errorCodeOf(error));

/**
 * Sure's `_transfer_match` buttons on a side of a transfer the matcher
 * proposed: beside the row button, never inside it, as the checkbox is.
 * Rejecting refuses the pair for good, as the sheet's « Ne plus proposer ».
 * The toast follows the promise, not `mutate`'s callbacks: the refreshed list
 * unmounts these buttons first, and an unmounted observer calls none.
 */
function MatchActions({ transferId }: { transferId: string }) {
	const { t } = useTranslation();
	const confirmTransfer = useConfirmTransfer();
	const rejectTransfer = useRejectTransfer();
	const pending = confirmTransfer.isPending || rejectTransfer.isPending;
	const actions = [
		{
			label: t("transactions.transfer.confirmMatch"),
			icon: CheckIcon,
			run: async () =>
				confirmTransfer
					.mutateAsync(transferId)
					.then(() => toast.success(t("transactions.transfer.confirmed")), failed),
		},
		{
			label: t("transactions.transfer.rejectMatch"),
			icon: XIcon,
			run: async () =>
				rejectTransfer
					.mutateAsync(transferId)
					.then(() => toast.success(t("transactions.transfer.rejected")), failed),
		},
	];

	return (
		// On a phone, under the amount, on the row's second line: beside it they
		// left the label a few letters and pushed the amount out of its column.
		<span className={cn(MATCH_ACTIONS_SLOT, "max-md:absolute max-md:right-0 max-md:bottom-1")}>
			{actions.map(({ label, icon: Icon, run }) => (
				<Tooltip key={label}>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={label}
							disabled={pending}
							onClick={() => void run()}
						>
							<Icon aria-hidden="true" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">{label}</TooltipContent>
				</Tooltip>
			))}
		</span>
	);
}

/**
 * The row's checkbox, before its label, always shown: a touch screen has no
 * hover to reveal it. `Shift`+click ticks the range from the last row toggled.
 */
function RowCheckbox({
	label,
	checked,
	onToggle,
}: {
	label: string;
	checked: boolean;
	onToggle: (range: boolean) => void;
}) {
	const { t } = useTranslation();

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Checkbox
					aria-label={t("operations.bulk.selectRow", { label })}
					checked={checked}
					// Beside the row button, as the category chip is, never inside it.
					// A 24 px target, as WCAG 2.2 asks, rather than the 16 px box.
					className="ml-3 shrink-0 after:-inset-1"
					onClick={(event) => {
						// The parent decides: a Shift+click ticks a range, not this box alone.
						event.preventDefault();
						onToggle(event.shiftKey);
					}}
				/>
			</TooltipTrigger>
			<TooltipContent side="bottom">{t("operations.bulk.toggleRow")}</TooltipContent>
		</Tooltip>
	);
}

/** Past this many, a row shows « +N » rather than squeezing its label. */
const SHOWN_TAGS = 3;

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

const ROW_DIVIDER = "border-b border-line last:border-b-0";

/** What every row of one list reads, built once per render of the list. */
type RowContext = {
	onOpen: (transaction: TransactionData) => void;
	showAccount: boolean;
	selection: Selection | undefined;
	/** Whether the category chip opens its picker; a viewer's is a plain pill. */
	admin: boolean;
	/** Whether rows keep room after them for confirming a proposed transfer. */
	matchActions: boolean;
	columns: string;
	categories: readonly CategoryData[] | undefined;
	categoryOf: ReadonlyMap<string, CategoryData>;
	merchantNames: ReadonlyMap<string, string>;
	tagNames: ReadonlyMap<string, string>;
	/** The row whose category combobox is open, so a pick closes it. */
	picking: string | null;
	setPicking: (id: string | null) => void;
	setCategory: ReturnType<typeof useSetTransactionCategory>;
};

/**
 * One transaction's line: a row of its own, a split's parent above its
 * lines, or one of those lines. A parent is muted with « Divisée », and has
 * neither a checkbox nor a category chip: the list's figures, its selection
 * and a category all go to its lines, as Sure's `_split_parent_row`.
 */
function RowLine({
	item,
	kind,
	context,
}: {
	item: TransactionData;
	kind: "row" | "parent" | "child";
	context: RowContext;
}) {
	const { t } = useTranslation();
	const { selection, columns, showAccount, picking, setPicking, setCategory } = context;
	const parent = kind === "parent";
	const caption = transferCaption(item);
	const categoryShown = showsCategory(item.amount, item.transfer);
	const merchantName =
		item.merchantId === null ? undefined : context.merchantNames.get(item.merchantId);
	// A transfer side names the other account where a purchase names its
	// merchant. A spent outflow shows its category, so its kind joins the
	// caption, as Sure's « Loan payment • A → B ».
	const subtitle =
		caption === null
			? merchantName
			: categoryShown && item.transfer !== null
				? t("transactions.transfer.spentCaption", {
						kind: t(`transactions.transfer.kinds.${item.transfer.kind}`),
						caption: t(caption.key, { account: caption.account }),
					})
				: t(caption.key, { account: caption.account });
	const category = item.categoryId === null ? undefined : context.categoryOf.get(item.categoryId);
	const rowTags = item.tagIds
		.flatMap((id) => {
			const name = context.tagNames.get(id);

			return name === undefined ? [] : [name];
		})
		.toSorted((a, b) => byName.compare(a, b));
	const selected = !parent && selection?.isSelected(item.id) === true;
	// A parent's item holds its lines' list too, so its line is a block inside it.
	const Line = parent ? "div" : "li";

	return (
		<Line
			data-selected={selected || undefined}
			className={cn(
				"relative flex items-center hover:bg-hover has-[[data-transaction-id]:focus-visible]:bg-hover md:h-14",
				!parent && ROW_DIVIDER,
				// A line sits under its parent's label, its own icon and label
				// pushed right: the amounts keep their column.
				kind === "child" && "pl-6",
				selected &&
					"bg-selection before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent-brand hover:bg-selection has-[[data-transaction-id]:focus-visible]:bg-selection",
			)}
		>
			{selection !== undefined &&
				(parent ? (
					// The checkbox's room, so the parent's icon lines up with its lines'.
					<span aria-hidden="true" className="ml-3 size-4 shrink-0" />
				) : (
					<RowCheckbox
						label={item.label}
						checked={selected}
						onToggle={(range) => (range ? selection.extendTo(item.id) : selection.toggle(item.id))}
					/>
				))}
			{/*
			 * Below 768 px two lines: the label and the amount, then the
			 * date and the category. From 768 px one line of columns. The
			 * row button spans every cell; the category button sits over
			 * the cell the row button leaves empty.
			 */}
			<div
				className={cn(
					"grid min-w-0 flex-1 grid-cols-[3rem_auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 md:h-full md:grid-rows-1 md:gap-y-0",
					columns,
				)}
			>
				<button
					type="button"
					// Lets the sheet give focus back to this row after an edit
					// moved it under another day, which remounts it.
					data-transaction-id={item.id}
					onClick={() => context.onOpen(item)}
					className="col-span-full row-start-1 row-end-3 grid grid-cols-subgrid grid-rows-subgrid items-center rounded-lg px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:row-end-2 md:py-0"
				>
					<TintedIcon
						size="lg"
						subject={rowSubject(
							item,
							category === undefined ? null : category,
							merchantName ?? null,
						)}
						className="col-start-1 row-start-1 row-end-3 md:row-end-2"
					/>
					<span className="col-start-2 col-end-4 row-start-1 flex min-w-0 flex-col md:col-end-3">
						<span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
							<span
								className={cn("truncate font-medium", parent && "text-muted-foreground")}
								title={item.label}
							>
								{item.label}
							</span>
							{item.oneTime && (
								<OneTimeMarker
									label={t(
										item.amount > 0
											? "transactions.oneTime.income"
											: "transactions.oneTime.expense",
									)}
								/>
							)}
							{parent && <StatusBadge status="split" iconBelowMd className="shrink-0" />}
							{item.pending && <StatusBadge status="pending" iconBelowMd className="shrink-0" />}
							{/* The sheet's own condition: a side it shows no category for has no series. */}
							{!parent && item.recurring && categoryShown && (
								<StatusBadge status="recurring" iconBelowMd className="shrink-0" />
							)}
							{item.transfer !== null && (
								<StatusBadge
									status={item.transfer.status === "pending" ? "autoMatched" : "transfer"}
									iconBelowMd
									className="shrink-0"
								/>
							)}
							{item.possibleDuplicate && (
								<StatusBadge status="duplicate" iconBelowMd className="shrink-0" />
							)}
						</span>
						{(subtitle !== undefined || rowTags.length > 0) && (
							<span className="hidden min-w-0 items-center gap-1 text-xs text-muted-foreground md:flex">
								{subtitle !== undefined && <span className="truncate">{subtitle}</span>}
								{rowTags.slice(0, SHOWN_TAGS).map((name) => (
									<Badge
										key={name}
										variant="outline"
										className="max-w-32 font-normal text-muted-foreground"
									>
										<span className="truncate">{name}</span>
									</Badge>
								))}
								{rowTags.length > SHOWN_TAGS && (
									<Badge variant="outline" className="font-normal text-muted-foreground">
										{t("transactions.tags.more", {
											count: rowTags.length - SHOWN_TAGS,
										})}
									</Badge>
								)}
							</span>
						)}
					</span>
					{/* The day's group already names it from 768 px. */}
					<span className="col-start-2 row-start-2 flex h-6 items-center self-start text-xs whitespace-nowrap text-muted-foreground md:hidden">
						{formatShortDate(item.date)}
					</span>
					{/* Left empty: the category button stays outside this one, keeping its own name, and sits over it. */}
					<span aria-hidden="true" className="hidden md:col-start-3 md:row-start-1 md:block" />
					{showAccount && (
						<span
							data-slot="row-account"
							className="hidden min-w-0 items-center gap-1.5 text-foreground-secondary lg:col-start-4 lg:row-start-1 lg:flex"
							title={item.accountName}
						>
							<TintedIcon size="sm" subject={{ kind: "account", type: item.accountType }} />
							<span className="truncate">{item.accountName}</span>
						</span>
					)}
					<span className="col-[-2/-1] row-start-1 flex items-center justify-end gap-1.5">
						{/* A parent's badge already says why it is not counted. */}
						{!parent && item.excluded && <ExcludedMarker label={t("transactions.excluded")} />}
						{/* Named in words by its badge, never by colour alone. */}
						<Money
							amount={item.amount}
							currency={item.currency}
							signed
							muted={parent || item.excluded || item.pending}
						/>
					</span>
				</button>
				{parent ? null : item.transfer !== null && !categoryShown ? (
					<TransferChip kind={item.transfer.kind} />
				) : !context.admin ? (
					<CategoryLabel categoryId={item.categoryId} />
				) : (
					<CategoryChip
						transaction={item}
						categories={context.categories}
						open={picking === item.id}
						onOpenChange={(open) => setPicking(open ? item.id : null)}
						onPick={(categoryId) => {
							setPicking(null);
							if (categoryId !== item.categoryId) {
								setCategory.mutate({
									id: item.id,
									value: categoryId,
									previous: item.categoryId,
								});
							}
						}}
					/>
				)}
			</div>
			{context.matchActions &&
				(!parent && item.transfer?.status === "pending" ? (
					<MatchActions transferId={item.transfer.id} />
				) : (
					// From 768 px only: on a phone the buttons sit under the amount.
					<span aria-hidden="true" className={cn(MATCH_ACTIONS_SLOT, "max-md:hidden")} />
				))}
		</Line>
	);
}

/**
 * Transactions, most recent first, under a header per day. Each row is a
 * button that opens its sheet; its category chip opens the category picker.
 * A split's lines sit in a list of their own under their parent, from
 * `splitParents`, which nothing counts.
 */
export function TransactionList({
	items,
	splitParents = [],
	onOpen,
	showAccount = false,
	selection,
	headingLevel = 3,
}: TransactionListProps) {
	const { t } = useTranslation();
	const categories = useCategories();
	const admin = useIsAdmin();
	const setCategory = useSetTransactionCategory();
	const merchants = useMerchants();
	const tags = useTags();
	const [picking, setPicking] = useState<string | null>(null);
	const columns = columnsOf(showAccount);
	const context: RowContext = {
		onOpen,
		showAccount,
		selection,
		admin,
		matchActions: admin && items.some((item) => item.transfer?.status === "pending"),
		columns,
		categories: categories.data,
		categoryOf: new Map((categories.data ?? []).map((category) => [category.id, category])),
		merchantNames: new Map((merchants.data ?? []).map((merchant) => [merchant.id, merchant.name])),
		tagNames: new Map((tags.data ?? []).map((tag) => [tag.id, tag.name])),
		picking,
		setPicking,
		setCategory,
	};

	return (
		<div className="flex flex-col gap-4">
			{/* Each row names its own cells: the header only guides the eye. */}
			<div
				aria-hidden="true"
				data-slot="column-header"
				className="hidden type-overline rounded-xl bg-inset p-1 text-muted-foreground md:block"
			>
				{/* The inner block's border, so the names line up with the cells. */}
				<div className="flex items-center border border-transparent py-2">
					{selection !== undefined && <span className="ml-3 size-4 shrink-0" />}
					{/* The edge cells take the row button's padding, so both grids share their tracks. */}
					<div className={cn("grid min-w-0 flex-1 gap-x-3", columns)}>
						<span className="col-start-1 col-end-3 truncate pl-3">
							{t("transactions.columns.label")}
						</span>
						<span className="col-start-3 truncate">{t("transactions.columns.category")}</span>
						{showAccount && (
							<span className="hidden truncate lg:col-start-4 lg:block">
								{t("transactions.columns.account")}
							</span>
						)}
						<span className="col-[-2/-1] truncate pr-3 text-right">
							{t("transactions.columns.amount")}
						</span>
					</div>
					{context.matchActions && <span className={MATCH_ACTIONS_SLOT} />}
				</div>
			</div>
			{groupByDay(items, splitParents).map((day) => (
				<InsetGroup
					key={day.date}
					id={`day-${day.date}`}
					level={headingLevel}
					title={<DayTitle date={day.date} />}
					count={day.items.length}
					countLabel={t("transactions.days.count", { count: day.items.length })}
					total={
						<span className="flex flex-wrap justify-end gap-x-3">
							{day.subtotals.map((subtotal) => (
								<Money
									key={subtotal.currency}
									amount={subtotal.amount}
									currency={subtotal.currency}
									plusSign
								/>
							))}
						</span>
					}
				>
					<ul>
						{day.entries.map((entry) =>
							entry.kind === "row" ? (
								<RowLine key={entry.row.id} item={entry.row} kind="row" context={context} />
							) : (
								<li key={`split-${entry.parent.id}`} className={ROW_DIVIDER}>
									<RowLine item={entry.parent} kind="parent" context={context} />
									<ul
										aria-label={t("transactions.split.lines", { label: entry.parent.label })}
										className="border-t border-line"
									>
										{entry.children.map((child) => (
											<RowLine key={child.id} item={child} kind="child" context={context} />
										))}
									</ul>
								</li>
							),
						)}
					</ul>
				</InsetGroup>
			))}
		</div>
	);
}

/** DESIGN.md's list card: the search, the filters and the list share it. */
export function TransactionListCard({ children }: { children: ReactNode }) {
	return (
		<div
			data-slot="list-card"
			className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card px-3 py-4 lg:p-4"
		>
			{children}
		</div>
	);
}

export function TransactionListSkeleton() {
	return (
		// The list's own shape, so the page does not jump when the rows land.
		<div className="flex flex-col gap-4" aria-hidden="true">
			<div className="hidden h-[42px] rounded-xl bg-inset md:block" />
			<div className="flex flex-col rounded-xl bg-inset p-1">
				<div className="px-4 py-2">
					<Skeleton className="h-4 w-32" />
				</div>
				<div className="overflow-hidden rounded-lg border bg-card">
					{[0, 1, 2].map((index) => (
						<div
							key={index}
							className="flex h-14 items-center gap-3 border-b border-line px-3 last:border-b-0"
						>
							<Skeleton className="size-9 shrink-0 rounded-[10px]" />
							<Skeleton className="h-4 w-full" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
