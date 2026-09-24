import type { BulkPicker } from "@/components/BulkBar";
import type { CategoryData } from "@/hooks/useCategories";
import type { Selection } from "@/hooks/useSelection";
import type { TransactionData } from "@/hooks/useTransactions";

import { ArrowLeftRightIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { CategoryCombobox } from "@/components/CategoryCombobox";
import { CategoryDot } from "@/components/CategoryDot";
import { DuplicateFlag } from "@/components/DuplicateFlag";
import { ExcludedMarker } from "@/components/ExcludedMarker";
import { MerchantCombobox } from "@/components/MerchantCombobox";
import { Money } from "@/components/Money";
import { ShortcutHint } from "@/components/ShortcutHint";
import { TagCombobox } from "@/components/TagCombobox";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCategories, useCategoryShown } from "@/hooks/useCategories";
import { useListNavigation } from "@/hooks/useListNavigation";
import { useMerchants } from "@/hooks/useMerchants";
import { useShortcut } from "@/hooks/useShortcut";
import { useTags } from "@/hooks/useTags";
import {
	useSetTransactionCategory,
	useSetTransactionMerchant,
	useSetTransactionTags,
} from "@/hooks/useTransactions";
import { dayHeading } from "@/lib/dates";
import { TRANSFER_COLOR, transferCaption } from "@/lib/transfers";
import { cn } from "@/lib/utils";

type TransactionListProps = {
	items: readonly TransactionData[];
	onOpen: (transaction: TransactionData) => void;
	/** Shows each row's account, for a list spanning several. */
	showAccount?: boolean;
	/** Ticks rows for a bulk action; without it, rows have no checkbox. */
	selection?: Selection;
	/** With rows ticked, `c`, `m` and `t` open the bulk bar's picker rather than the row's. */
	onBulkPick?: (picker: BulkPicker) => void;
};

function groupByDay(items: readonly TransactionData[]) {
	const days: { date: string; items: TransactionData[] }[] = [];

	for (const item of items) {
		const last = days.at(-1);

		// The API sorts by date first, so a day's rows are always adjacent.
		if (last?.date === item.date) {
			last.items.push(item);
		} else {
			days.push({ date: item.date, items: [item] });
		}
	}

	return days;
}

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
	onCloseFocus: (event: Event) => void;
};

/**
 * The row's category: its dot and name, or « Sans catégorie ». A button of its
 * own beside the row's, never inside it, that opens the combobox in place.
 */
function CategoryChip({
	transaction,
	categories,
	open,
	onOpenChange,
	onPick,
	onCloseFocus,
}: CategoryChipProps) {
	const { t } = useTranslation();
	const { color, name } = useCategoryShown(transaction.categoryId);

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
							className="ml-2 flex min-h-7 max-w-full min-w-0 items-center gap-1.5 self-start rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:ml-0 md:w-44 md:shrink-0 md:self-center"
						>
							<CategoryDot color={color} />
							{name === null ? (
								<Skeleton className="h-3 w-20" />
							) : (
								<span className="truncate">{name}</span>
							)}
						</button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					<ShortcutHint id="categoriseRow" label={t("transactions.category.change")} />
				</TooltipContent>
			</Tooltip>
			<PopoverContent align="start" className="w-72 p-0" onCloseAutoFocus={onCloseFocus}>
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
 * A transfer side's chip, where a standard row has its category: not a
 * button, since a transfer has no category to pick until it is dissociated.
 */
function TransferChip({ kind }: { kind: NonNullable<TransactionData["transfer"]>["kind"] }) {
	const { t } = useTranslation();

	return (
		<span className="ml-2 flex min-h-7 max-w-full min-w-0 items-center gap-1.5 self-start px-2 text-xs text-muted-foreground md:ml-0 md:w-44 md:shrink-0 md:self-center">
			<CategoryDot color={TRANSFER_COLOR} />
			<span className="truncate">{t(`transactions.transfer.kinds.${kind}`)}</span>
		</span>
	);
}

/**
 * « Virement possible »: automatic matching found several candidates and left
 * the pick to the user. Neutral, as the warning colour belongs to states that
 * need attention (DESIGN.md), and a suggestion does not.
 */
function TransferSuggestedFlag() {
	const { t } = useTranslation();

	return (
		<span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
			<ArrowLeftRightIcon className="size-3.5" aria-hidden="true" />
			{t("transactions.transfer.suggested")}
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
			<TooltipContent side="bottom">
				<ShortcutHint id="toggleRow" label={t("shortcuts.labels.toggleRow")} />
			</TooltipContent>
		</Tooltip>
	);
}

const rowButton = (id: string) =>
	document.querySelector<HTMLElement>(`[data-transaction-id="${CSS.escape(id)}"]`);

/** Past this many, a row shows « +N » rather than squeezing its label. */
const SHOWN_TAGS = 3;

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

function sameTags(a: readonly string[], b: readonly string[]): boolean {
	const set = new Set(a);

	return set.size === b.length && b.every((id) => set.has(id));
}

/** The combobox hanging from a row, opened by `m` or `t`: the row has no button for either. */
type RowPicker = { id: string; kind: "merchant" | "tags" };

/**
 * Transactions, most recent first, under a header per day. `j` / `k` and the
 * arrows move between rows, `e` or `Enter` opens one, `c` opens its category,
 * `m` its merchant, `t` its tags. With a selection, `x` ticks the focused
 * row, `Shift` with a move ticks the row reached, and `Esc` unticks them all.
 */
export function TransactionList({
	items,
	onOpen,
	showAccount = false,
	selection,
	onBulkPick,
}: TransactionListProps) {
	const { t } = useTranslation();
	const container = useRef<HTMLDivElement>(null);
	const categories = useCategories();
	const setCategory = useSetTransactionCategory();
	const merchants = useMerchants();
	const setMerchant = useSetTransactionMerchant();
	const merchantNames = new Map(
		(merchants.data ?? []).map((merchant) => [merchant.id, merchant.name]),
	);
	const tags = useTags();
	const setTags = useSetTransactionTags();
	const tagNames = new Map((tags.data ?? []).map((tag) => [tag.id, tag.name]));
	// The row whose merchant or tag combobox is open; it hangs from the row and
	// gives focus back to it.
	const [rowPicker, setRowPicker] = useState<RowPicker | null>(null);
	// The tags picked so far: saved once, when the combobox closes, so an edit
	// makes one request and one « Annuler », not one per tag.
	const [tagDraft, setTagDraft] = useState<string[]>([]);
	// The row whose combobox is open, and the one `c` opened it from, which
	// gets focus back so `j` carries on from there.
	const [picking, setPicking] = useState<string | null>(null);
	const openedFromRow = useRef<string | null>(null);

	const bulk = () => (selection?.target ?? null) !== null;

	useListNavigation(container, selection === undefined ? {} : { onExtend: selection.add });

	const focusedRowId = () => {
		const active = document.activeElement;

		return active instanceof HTMLElement && container.current?.contains(active) === true
			? active.dataset["transactionId"]
			: undefined;
	};

	useShortcut(
		"toggleRow",
		() => {
			const id = focusedRowId();

			if (id !== undefined) {
				selection?.toggle(id);
			}
		},
		{ enabled: selection !== undefined, when: () => focusedRowId() !== undefined },
	);

	useShortcut("clearSelection", () => selection?.clear(), {
		enabled: selection !== undefined,
		when: bulk,
	});

	// With rows ticked, the key acts on them all, not on the focused row.
	const rowOrBulk = () => bulk() || focusedRowId() !== undefined;

	useShortcut(
		"categoriseRow",
		() => {
			const id = focusedRowId();
			// A transfer side shows no category to change.
			const transfer = items.find((item) => item.id === id)?.transfer ?? null;

			if (bulk()) {
				onBulkPick?.("category");
			} else if (id !== undefined && transfer === null) {
				openedFromRow.current = id;
				setPicking(id);
			}
		},
		{ when: rowOrBulk },
	);

	useShortcut(
		"setMerchantRow",
		() => {
			const id = focusedRowId();

			if (bulk()) {
				onBulkPick?.("merchant");
			} else if (id !== undefined) {
				setRowPicker({ id, kind: "merchant" });
			}
		},
		{ when: rowOrBulk },
	);

	useShortcut(
		"setTagsRow",
		() => {
			const item = items.find((candidate) => candidate.id === focusedRowId());

			if (bulk()) {
				onBulkPick?.("tags");
			} else if (item !== undefined) {
				setTagDraft(item.tagIds);
				setRowPicker({ id: item.id, kind: "tags" });
			}
		},
		{ when: rowOrBulk },
	);

	const closeRowPicker = (item: TransactionData) => {
		if (rowPicker?.kind === "tags" && !sameTags(tagDraft, item.tagIds)) {
			setTags.mutate({ id: item.id, value: tagDraft, previous: item.tagIds });
		}
		setRowPicker(null);
	};

	const toggleTag = (tagId: string) =>
		setTagDraft((draft) =>
			draft.includes(tagId) ? draft.filter((id) => id !== tagId) : [...draft, tagId],
		);

	return (
		<div ref={container} className="flex flex-col gap-4">
			{groupByDay(items).map((day) => {
				const headingId = `day-${day.date}`;

				return (
					<section key={day.date} aria-labelledby={headingId}>
						<h3 id={headingId} className="border-b pb-1 text-xs font-medium text-muted-foreground">
							<DayTitle date={day.date} />
						</h3>
						<ul>
							{day.items.map((item) => {
								const caption = transferCaption(item);
								// A transfer side names the other account where a purchase names its merchant.
								const subtitle =
									caption !== null
										? t(caption.key, { account: caption.account })
										: item.merchantId === null
											? undefined
											: merchantNames.get(item.merchantId);
								const rowTags = item.tagIds
									.flatMap((id) => {
										const name = tagNames.get(id);

										return name === undefined ? [] : [name];
									})
									.toSorted((a, b) => byName.compare(a, b));
								const picker = rowPicker?.id === item.id ? rowPicker.kind : null;
								const selected = selection?.isSelected(item.id) === true;

								return (
									<li
										key={item.id}
										className={cn(
											"flex rounded-md hover:bg-muted has-[[data-transaction-id]:focus-visible]:bg-muted",
											selected && "bg-muted",
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
										{/* Two lines below 768 px: label, merchant and amount, then the category. */}
										<div className="flex min-w-0 flex-1 flex-col pb-1 md:flex-row md:items-center md:gap-2 md:pb-0">
											<Popover
												open={picker !== null}
												onOpenChange={(open) => {
													if (!open) {
														closeRowPicker(item);
													}
												}}
											>
												<PopoverAnchor asChild>
													<button
														type="button"
														// Lets the sheet give focus back to this row after an edit
														// moved it under another day, which remounts it.
														data-transaction-id={item.id}
														onClick={() => onOpen(item)}
														className="flex min-h-9 w-full min-w-0 items-center justify-between gap-4 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex-1"
													>
														<span className="flex min-w-0 flex-1 flex-col">
															<span className="flex min-w-0 items-center gap-1.5">
																<span className="truncate" title={item.label}>
																	{item.label}
																</span>
																{item.transfer === null && item.transferSuggested && (
																	<TransferSuggestedFlag />
																)}
																{item.possibleDuplicate && <DuplicateFlag />}
															</span>
															{(subtitle !== undefined || rowTags.length > 0) && (
																<span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
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
														{showAccount && (
															<span
																className="w-40 shrink-0 truncate text-xs text-muted-foreground max-md:w-24"
																title={item.accountName}
															>
																{item.accountName}
															</span>
														)}
														<span className="flex shrink-0 items-center gap-1.5">
															{item.excluded && (
																<ExcludedMarker label={t("transactions.excluded")} />
															)}
															{/* Named in words beside the muted amount, never by colour alone. */}
															{item.pending && (
																<Badge
																	variant="outline"
																	className="font-normal text-muted-foreground"
																>
																	{t("transactions.pending")}
																</Badge>
															)}
															<Money
																amount={item.amount}
																currency={item.currency}
																signed
																muted={item.excluded || item.pending}
															/>
														</span>
													</button>
												</PopoverAnchor>
												<PopoverContent
													align="start"
													className="w-72 p-0"
													onCloseAutoFocus={(event) => {
														event.preventDefault();
														rowButton(item.id)?.focus();
													}}
												>
													{picker === "merchant" && (
														<MerchantCombobox
															merchants={merchants.data ?? []}
															value={item.merchantId}
															onSelect={(merchantId) => {
																setRowPicker(null);
																if (merchantId !== item.merchantId) {
																	setMerchant.mutate({
																		id: item.id,
																		value: merchantId,
																		previous: item.merchantId,
																	});
																}
															}}
														/>
													)}
													{picker === "tags" && (
														<TagCombobox
															tags={tags.data ?? []}
															value={tagDraft}
															onToggle={toggleTag}
														/>
													)}
												</PopoverContent>
											</Popover>
											{item.transfer !== null ? (
												<TransferChip kind={item.transfer.kind} />
											) : (
												<CategoryChip
													transaction={item}
													categories={categories.data}
													open={picking === item.id}
													onOpenChange={(open) => {
														if (open) {
															openedFromRow.current = null;
														}
														setPicking(open ? item.id : null);
													}}
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
													onCloseFocus={(event) => {
														if (openedFromRow.current === item.id) {
															openedFromRow.current = null;
															event.preventDefault();
															rowButton(item.id)?.focus();
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
		<div className="flex flex-col gap-2" aria-hidden="true">
			<Skeleton className="h-4 w-32" />
			<Skeleton className="h-9 w-full" />
			<Skeleton className="h-9 w-full" />
			<Skeleton className="h-9 w-full" />
			<Skeleton className="h-4 w-32" />
			<Skeleton className="h-9 w-full" />
		</div>
	);
}
