import type { CategoryData } from "@/hooks/useCategories";
import type { Selection } from "@/hooks/useSelection";
import type { TransactionData } from "@/hooks/useTransactions";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { CategoryCombobox } from "@/components/CategoryCombobox";
import { CategoryPill, TransferPill } from "@/components/CategoryPill";
import { ExcludedMarker } from "@/components/ExcludedMarker";
import { Money } from "@/components/Money";
import { StatusBadge } from "@/components/StatusBadge";
import { TintedIcon } from "@/components/TintedIcon";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCategories, useCategoryShown } from "@/hooks/useCategories";
import { useMerchants } from "@/hooks/useMerchants";
import { useTags } from "@/hooks/useTags";
import { useSetTransactionCategory } from "@/hooks/useTransactions";
import { dayHeading } from "@/lib/dates";
import { rowSubject } from "@/lib/tint";
import { groupByDay } from "@/lib/transaction-days";
import { showsCategory, transferCaption } from "@/lib/transfers";
import { cn } from "@/lib/utils";

type TransactionListProps = {
	items: readonly TransactionData[];
	onOpen: (transaction: TransactionData) => void;
	/** Shows each row's account, for a list spanning several. */
	showAccount?: boolean;
	/** Ticks rows for a bulk action; without it, rows have no checkbox. */
	selection?: Selection;
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

// From 768 px, over the row button's empty cell, so the pill sits in its column.
const CATEGORY_SLOT =
	"ml-2 flex min-h-7 max-w-full min-w-0 items-center self-start md:col-start-2 md:row-start-1 md:ml-0 md:self-center md:justify-self-start";

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
								"rounded-full outline-none hover:ring-1 hover:ring-border-strong focus-visible:ring-2 focus-visible:ring-ring md:relative md:z-10",
							)}
						>
							{name === null ? (
								<Skeleton className="h-5 w-24 rounded-full" />
							) : (
								<CategoryPill
									category={color === null || icon === null ? null : { name, color, icon }}
									fallback={name}
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
					className="mt-2.5 ml-1 shrink-0 after:-inset-1 md:mt-0 md:self-center"
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

/**
 * Transactions, most recent first, under a header per day. Each row is a
 * button that opens its sheet; its category chip opens the category picker.
 */
export function TransactionList({
	items,
	onOpen,
	showAccount = false,
	selection,
}: TransactionListProps) {
	const { t } = useTranslation();
	const categories = useCategories();
	const categoryOf = new Map((categories.data ?? []).map((category) => [category.id, category]));
	const setCategory = useSetTransactionCategory();
	const merchants = useMerchants();
	const merchantNames = new Map(
		(merchants.data ?? []).map((merchant) => [merchant.id, merchant.name]),
	);
	const tags = useTags();
	const tagNames = new Map((tags.data ?? []).map((tag) => [tag.id, tag.name]));
	// The row whose category combobox is open, so a pick closes it.
	const [picking, setPicking] = useState<string | null>(null);

	return (
		// Headers and rows share their lines, as one table: no gap between days.
		<div className="flex flex-col border-t border-line">
			{groupByDay(items).map((day) => {
				const headingId = `day-${day.date}`;

				return (
					<section key={day.date} aria-labelledby={headingId}>
						{/* Not a list item: the list holds the rows alone. */}
						<div
							data-slot="day-header"
							className="flex min-h-9 items-center gap-2 border-b border-line bg-section px-2"
						>
							<h3 id={headingId} className="font-medium">
								<DayTitle date={day.date} />
							</h3>
							<span className="text-muted-foreground">
								<span aria-hidden="true">{day.items.length}</span>
								<span className="sr-only">
									{t("transactions.days.count", { count: day.items.length })}
								</span>
							</span>
							<span className="ml-auto flex flex-wrap justify-end gap-x-3 text-foreground-secondary">
								{day.subtotals.map((subtotal) => (
									<Money
										key={subtotal.currency}
										amount={subtotal.amount}
										currency={subtotal.currency}
										plusSign
									/>
								))}
							</span>
						</div>
						<ul>
							{day.items.map((item) => {
								const caption = transferCaption(item);
								const categoryShown = showsCategory(item.amount, item.transfer);
								const merchantName =
									item.merchantId === null ? undefined : merchantNames.get(item.merchantId);
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
								const category =
									item.categoryId === null ? undefined : categoryOf.get(item.categoryId);
								const rowTags = item.tagIds
									.flatMap((id) => {
										const name = tagNames.get(id);

										return name === undefined ? [] : [name];
									})
									.toSorted((a, b) => byName.compare(a, b));
								const selected = selection?.isSelected(item.id) === true;

								return (
									<li
										key={item.id}
										data-selected={selected || undefined}
										className={cn(
											"relative flex border-b border-line hover:bg-hover has-[[data-transaction-id]:focus-visible]:bg-hover md:h-9 md:items-center",
											selected &&
												"bg-selection before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent-brand hover:bg-selection has-[[data-transaction-id]:focus-visible]:bg-selection",
										)}
									>
										{selection !== undefined && (
											<RowCheckbox
												label={item.label}
												checked={selected}
												onToggle={(range) =>
													range ? selection.extendTo(item.id) : selection.toggle(item.id)
												}
											/>
										)}
										{/*
										 * Two lines below 768 px: label, caption and amount, then the
										 * category. From 768 px one line of columns: the row button spans
										 * them all, and the category button sits over its empty cell.
										 */}
										<div
											className={cn(
												"flex min-w-0 flex-1 flex-col pb-1 md:grid md:h-full md:items-center md:gap-x-3 md:pb-0",
												// The label's column stays wider than the other three together
												// at 1280 px, so the row button's centre, where a pointer or a
												// test aims, lies on the label rather than under the pill.
												showAccount
													? "md:grid-cols-[minmax(0,1fr)_9rem_9rem_7.5rem]"
													: "md:grid-cols-[minmax(0,1fr)_9rem_7.5rem]",
											)}
										>
											<button
												type="button"
												// Lets the sheet give focus back to this row after an edit
												// moved it under another day, which remounts it.
												data-transaction-id={item.id}
												onClick={() => onOpen(item)}
												className="flex min-h-9 w-full min-w-0 items-center justify-between gap-4 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring md:col-span-full md:row-start-1 md:grid md:h-full md:min-h-0 md:grid-cols-subgrid md:gap-x-3"
											>
												<span className="flex min-w-0 flex-1 items-center gap-2">
													<TintedIcon
														subject={rowSubject(
															item,
															category === undefined ? null : category,
															merchantName ?? null,
														)}
														className="max-md:self-start max-md:mt-2"
													/>
													<span className="flex min-w-0 flex-1 flex-col md:flex-row md:items-center md:gap-2">
														{/* Below 768 px the badges wrap under the label rather than squeeze it. */}
														<span className="flex min-w-0 items-center gap-1.5 max-md:flex-wrap">
															<span className="truncate font-medium" title={item.label}>
																{item.label}
															</span>
															{item.pending && <StatusBadge status="pending" />}
															{/* The sheet's own condition: a side it shows no category for has no series. */}
															{item.recurring && categoryShown && (
																<StatusBadge status="recurring" />
															)}
															{item.transfer !== null && <StatusBadge status="transfer" />}
															{item.transfer === null && item.transferSuggested && (
																<StatusBadge status="transferSuggested" />
															)}
															{item.possibleDuplicate && <StatusBadge status="duplicate" />}
														</span>
														{(subtitle !== undefined || rowTags.length > 0) && (
															// The caption gives way before the label on one line.
															<span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground md:shrink-[4]">
																{subtitle !== undefined && (
																	<span className="truncate">{subtitle}</span>
																)}
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
																	<Badge
																		variant="outline"
																		className="font-normal text-muted-foreground"
																	>
																		{t("transactions.tags.more", {
																			count: rowTags.length - SHOWN_TAGS,
																		})}
																	</Badge>
																)}
															</span>
														)}
													</span>
												</span>
												{/* Left empty: the category button stays outside this one, keeping its own name, and sits over it. */}
												<span aria-hidden="true" className="hidden md:block" />
												{showAccount && (
													<span
														data-slot="row-account"
														className="flex w-40 min-w-0 shrink-0 items-center gap-1.5 text-xs text-foreground-secondary max-md:w-24 md:w-auto"
														title={item.accountName}
													>
														<TintedIcon
															size="sm"
															subject={{ kind: "account", type: item.accountType }}
														/>
														<span className="truncate">{item.accountName}</span>
													</span>
												)}
												<span className="flex shrink-0 items-center justify-end gap-1.5">
													{item.excluded && <ExcludedMarker label={t("transactions.excluded")} />}
													{/* Named in words by its badge, never by colour alone. */}
													<Money
														amount={item.amount}
														currency={item.currency}
														signed
														muted={item.excluded || item.pending}
													/>
												</span>
											</button>
											{item.transfer !== null && !categoryShown ? (
												<TransferChip kind={item.transfer.kind} />
											) : (
												<CategoryChip
													transaction={item}
													categories={categories.data}
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
									</li>
								);
							})}
						</ul>
					</section>
				);
			})}
		</div>
	);
}

export function TransactionListSkeleton() {
	return (
		// The list's own shape, so the page does not jump when the rows land.
		<div className="flex flex-col border-t border-line" aria-hidden="true">
			<div className="flex h-9 items-center border-b border-line bg-section px-2">
				<Skeleton className="h-4 w-32" />
			</div>
			{[0, 1, 2].map((index) => (
				<div key={index} className="flex h-9 items-center border-b border-line px-2">
					<Skeleton className="h-5 w-full" />
				</div>
			))}
		</div>
	);
}
