import type { BillActions } from "@/components/BillActions";
import type { BillRowData, PaymentCandidateData, SuggestedPaymentData } from "@/hooks/useRecurring";
import type { ReactNode } from "react";

import {
	AlarmClockIcon,
	ChevronRightIcon,
	EllipsisIcon,
	PauseIcon,
	PencilIcon,
	PlayIcon,
	SearchIcon,
	SkipForwardIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { formatMoney, toMinorUnits } from "@archant/data/money";

import { useBillActions } from "@/components/BillActions";
import {
	MatchReasons,
	confidenceText,
	matchReasons,
	dueLabel,
	isClosed,
	isPartial,
} from "@/components/BillLabels";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateField } from "@/components/DateField";
import { FieldMessage } from "@/components/FieldMessage";
import { InsetGroup } from "@/components/InsetGroup";
import { Money } from "@/components/Money";
import { SuggestionActions } from "@/components/SuggestionActions";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
	useAddPayment,
	useBill,
	useEditOccurrence,
	useMarkPaid,
	useOccurrence,
	useOtherPaymentCandidates,
	usePaymentCandidates,
	useRemovePayment,
	useSetOccurrenceClosed,
} from "@/hooks/useRecurring";
import { amountToText } from "@/lib/amount-sign";
import { ApiError, errorCodeOf } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";
import { dayAndMonth, toIsoDate, weekFromToday } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { settle } from "@/lib/settle";
import { cn } from "@/lib/utils";

/** A failure on one field shown under it; any other one as a toast. */
function useFieldError(path: string) {
	const [code, setCode] = useState<string | null>(null);

	const fail = (error: unknown) => {
		const field =
			error instanceof ApiError ? error.fields.find((one) => one.path === path) : undefined;

		if (field === undefined) {
			showErrorToast(errorCodeOf(error));
		} else {
			setCode(field.code);
		}
	};

	return { code, setCode, fail };
}

/** One action of the sheet: its heading, a sentence, its fields and its button. */
function Action({ title, children }: { title: string; children: ReactNode }) {
	return (
		<InsetGroup level={3} title={title}>
			<div className="flex flex-col gap-3 rounded-lg border bg-card p-4">{children}</div>
		</InsetGroup>
	);
}

/** The matcher's suggestion, with « Appliquer » and « Pas cette facture » for an administrator. */
function Suggestion({ suggestion, admin }: { suggestion: SuggestedPaymentData; admin: boolean }) {
	const { t } = useTranslation();
	return (
		<InsetGroup level={3} title={t("bills.sheet.suggestion")}>
			<div className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-sm">
				<div className="flex items-start justify-between gap-3">
					<div className="flex min-w-0 flex-col">
						<span className="truncate font-medium">
							{suggestion.label ?? t("bills.review.unknown")}
						</span>
						{suggestion.paidOn !== null && (
							<span className="text-xs text-muted-foreground">
								{formatShortDate(suggestion.paidOn)}
							</span>
						)}
					</div>
					<span className="flex shrink-0 items-center gap-2">
						{suggestion.confidence !== null && (
							<span className="text-xs text-muted-foreground tabular-nums">
								{confidenceText(suggestion.confidence)}
							</span>
						)}
						<Money amount={suggestion.amount} currency={suggestion.currency} />
					</span>
				</div>
				<MatchReasons
					signals={suggestion.signals}
					currency={suggestion.currency}
					expected={suggestion.expected}
					actual={suggestion.entryAmount}
					dueOn={suggestion.effectiveDueOn}
					paidOn={suggestion.paidOn}
				/>
				{admin && <SuggestionActions paymentId={suggestion.id} />}
			</div>
		</InsetGroup>
	);
}

/** One transaction a press links, as Sure's `_candidate` row: the whole row is the button. */
function CandidateRow({
	label,
	detail,
	amount,
	currency,
	disabled,
	onLink,
}: {
	label: string;
	detail: string;
	amount: number;
	currency: string;
	disabled: boolean;
	onLink: () => void;
}) {
	const { t } = useTranslation();

	return (
		<li>
			<button
				type="button"
				disabled={disabled}
				aria-label={t("bills.sheet.linkCandidate", {
					label,
					detail,
					amount: formatMoney({ amount: toMinorUnits(Math.abs(amount)), currency }),
				})}
				className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
				onClick={onLink}
			>
				<span className="flex min-w-0 flex-col">
					<span className="truncate text-sm">{label}</span>
					<span className="truncate text-xs text-muted-foreground">{detail}</span>
				</span>
				<Money amount={toMinorUnits(Math.abs(amount))} currency={currency} />
			</button>
		</li>
	);
}

/**
 * « Rechercher dans toutes les transactions », Sure's disclosure under the
 * suggestions: the nearby transactions nearest what remains, or every one
 * whose label holds the words searched, on Enter.
 */
function SearchAll({
	occurrenceId,
	defaultOpen,
	disabled,
	onLink,
}: {
	occurrenceId: string;
	defaultOpen: boolean;
	disabled: boolean;
	onLink: (entryId: string) => void;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(defaultOpen);
	const [text, setText] = useState("");
	const [query, setQuery] = useState("");
	// Read once unfolded: each read scores the matcher's candidates again, to leave them out.
	const others = useOtherPaymentCandidates(occurrenceId, query, open);

	return (
		<details className="group" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
			<summary className="flex cursor-pointer items-center gap-1 py-1 text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
				<ChevronRightIcon
					aria-hidden="true"
					className="size-4 transition-transform group-open:rotate-90"
				/>
				{t("bills.sheet.searchAll")}
			</summary>
			<div className="flex flex-col gap-2 pt-2">
				<form
					role="search"
					onSubmit={(event) => {
						event.preventDefault();
						setQuery(text.trim());
					}}
				>
					<InputGroup>
						<InputGroupAddon>
							<SearchIcon aria-hidden />
						</InputGroupAddon>
						<InputGroupInput
							type="search"
							maxLength={200}
							aria-label={t("bills.sheet.search")}
							placeholder={t("bills.sheet.search")}
							value={text}
							onChange={(event) => setText(event.target.value)}
						/>
					</InputGroup>
				</form>
				{others.isPending ? (
					<Skeleton className="h-12 w-full" aria-hidden="true" />
				) : others.isError ? (
					<p role="alert" className="text-sm text-muted-foreground">
						{t(`errors.${errorCodeOf(others.error)}`)}
					</p>
				) : others.data.length === 0 ? (
					<p className="px-1 text-sm text-muted-foreground">
						{query === "" ? t("bills.sheet.noNearby") : t("bills.sheet.noResults", { query })}
					</p>
				) : (
					<ul
						aria-label={t("bills.sheet.searchAll")}
						className="flex flex-col divide-y divide-line"
					>
						{others.data.map((entry) => (
							<CandidateRow
								key={entry.entryId}
								label={entry.label}
								detail={`${formatShortDate(entry.date)} · ${entry.accountName}`}
								amount={entry.amount}
								currency={entry.currency}
								disabled={disabled}
								onLink={() => onLink(entry.entryId)}
							/>
						))}
					</ul>
				)}
			</div>
		</details>
	);
}

/**
 * Sure's « Trouver un paiement », « Ajouter un autre paiement » once part is
 * paid: the transaction the matcher's `explain` scores highest as a card,
 * the others it scores under « Autres correspondances probables », then
 * « Rechercher dans toutes les transactions », open when nothing scores;
 * and an amount and a date with no transaction. Read only by an
 * administrator, the one who may link one.
 */
function AddPayment({ occurrence }: { occurrence: BillRowData }) {
	const { t } = useTranslation();
	const candidates = usePaymentCandidates(occurrence.occurrenceId);
	const add = useAddPayment(occurrence.occurrenceId);
	const [amount, setAmount] = useState(() =>
		occurrence.remaining > 0 ? amountToText(occurrence.remaining, occurrence.currency) : "",
	);
	const [paidOn, setPaidOn] = useState(() => toIsoDate());
	const amountError = useFieldError("amount");

	const added = () => toast.success(t("bills.sheet.added"));
	const link = (entryId: string) =>
		void settle(add.mutateAsync({ entryId }), added, (error) => showErrorToast(errorCodeOf(error)));
	const reasonsOf = (candidate: PaymentCandidateData) => ({
		signals: candidate.signals,
		currency: candidate.currency,
		expected: occurrence.expected,
		actual: toMinorUnits(Math.abs(candidate.amount)),
		dueOn: occurrence.effectiveDueOn,
		paidOn: candidate.date,
	});
	const [best, ...rest] = candidates.data ?? [];
	const bestId = useId();

	return (
		<Action title={t(isPartial(occurrence) ? "bills.sheet.addAnother" : "bills.sheet.find")}>
			<div className="flex flex-col gap-2">
				{candidates.isPending && <Skeleton className="h-12 w-full" aria-hidden="true" />}
				{candidates.isError && (
					<p role="alert" className="text-sm text-muted-foreground">
						{t(`errors.${errorCodeOf(candidates.error)}`)}
					</p>
				)}
				{candidates.data !== undefined &&
					(best === undefined ? (
						<p className="px-1 text-sm text-muted-foreground">{t("bills.sheet.noCandidates")}</p>
					) : (
						<>
							<div
								role="group"
								aria-labelledby={bestId}
								className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3 text-sm"
							>
								<div className="flex items-start justify-between gap-3">
									<div className="flex min-w-0 flex-col">
										<span id={bestId} className="truncate font-medium">
											{best.label}
										</span>
										<span className="text-xs text-muted-foreground">
											{formatShortDate(best.date)}
										</span>
									</div>
									<span className="flex shrink-0 items-center gap-2">
										<span className="text-xs text-muted-foreground tabular-nums">
											{confidenceText(best.score)}
										</span>
										<Money amount={toMinorUnits(Math.abs(best.amount))} currency={best.currency} />
									</span>
								</div>
								<MatchReasons {...reasonsOf(best)} />
								<Button
									className="w-full"
									disabled={add.isPending}
									onClick={() => link(best.entryId)}
								>
									{t("bills.sheet.link")}
								</Button>
							</div>
							{rest.length > 0 && (
								<>
									<h4 className="pt-1 text-xs font-medium text-muted-foreground uppercase">
										{t("bills.sheet.otherMatches")}
									</h4>
									<ul
										aria-label={t("bills.sheet.otherMatches")}
										className="flex flex-col divide-y divide-line"
									>
										{rest.map((candidate) => (
											<CandidateRow
												key={candidate.entryId}
												label={candidate.label}
												detail={[
													formatShortDate(candidate.date),
													...matchReasons(reasonsOf(candidate), t),
												].join(" · ")}
												amount={candidate.amount}
												currency={candidate.currency}
												disabled={add.isPending}
												onLink={() => link(candidate.entryId)}
											/>
										))}
									</ul>
								</>
							)}
						</>
					))}
				{candidates.data !== undefined && (
					<SearchAll
						occurrenceId={occurrence.occurrenceId}
						defaultOpen={best === undefined}
						disabled={add.isPending}
						onLink={link}
					/>
				)}
			</div>
			<form
				noValidate
				className="flex flex-col gap-3 border-t border-line pt-3"
				onSubmit={(event) => {
					event.preventDefault();
					amountError.setCode(null);
					void settle(add.mutateAsync({ amount, paidOn }), added, amountError.fail);
				}}
			>
				<p className="text-xs text-muted-foreground">{t("bills.sheet.manualHint")}</p>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="payment-amount">{t("bills.sheet.amount")}</Label>
						<Input
							id="payment-amount"
							inputMode="decimal"
							autoComplete="off"
							className="text-right tabular-nums"
							value={amount}
							aria-invalid={amountError.code !== null}
							{...(amountError.code === null ? {} : { "aria-describedby": "payment-amount-error" })}
							onChange={(event) => setAmount(event.target.value)}
						/>
						<FieldMessage
							id="payment-amount-error"
							error={amountError.code === null ? undefined : { type: amountError.code }}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="payment-date">{t("bills.sheet.paymentDate")}</Label>
						<DateField id="payment-date" value={paidOn} onChange={setPaidOn} />
					</div>
				</div>
				<Button type="submit" variant="outline" className="self-start" disabled={add.isPending}>
					{t("bills.sheet.record")}
				</Button>
			</form>
		</Action>
	);
}

const failed = (error: unknown) => showErrorToast(errorCodeOf(error));

/**
 * An open occurrence's actions, as Sure's `show.html.erb:270-300`: mark it
 * paid and add a payment, then a menu with « Ignorer » and « Reporter d'une
 * semaine » and, below a separator, the bill's « Modifier la facture » and
 * « Mettre en pause » or « Reprendre ». No view of Sure overrides an
 * occurrence's amount.
 */
function OpenActions({
	occurrence,
	billActions,
	onLeave,
}: {
	occurrence: BillRowData;
	billActions: BillActions;
	/** Closes the sheet: a pause or a resume regenerates the occurrences, as Sure's `_top` frame leaves. */
	onLeave: () => void;
}) {
	const { t } = useTranslation();
	const id = occurrence.occurrenceId;
	const markPaid = useMarkPaid(id);
	const close = useSetOccurrenceClosed(id);
	const edit = useEditOccurrence(id);
	const [paidOn, setPaidOn] = useState(() => toIsoDate());
	const busy = close.isPending || edit.isPending;
	const bill = useBill(occurrence.seriesId).data?.record;

	const postpone = () => {
		const until = weekFromToday(occurrence);

		void settle(
			edit.mutateAsync({ snoozedUntil: until }),
			() => toast.success(t("bills.sheet.postponed", { date: dayAndMonth(until) })),
			failed,
		);
	};

	return (
		<>
			<Action title={t("bills.sheet.markPaid")}>
				<p className="text-xs text-muted-foreground">
					{t("bills.sheet.markPaidHint", {
						amount: formatMoney({ amount: occurrence.remaining, currency: occurrence.currency }),
					})}
				</p>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="paid-on">{t("bills.sheet.paidOn")}</Label>
					<DateField id="paid-on" value={paidOn} onChange={setPaidOn} />
				</div>
				<div className="flex items-center justify-between gap-3">
					<Button
						disabled={markPaid.isPending}
						onClick={() =>
							void settle(
								markPaid.mutateAsync(paidOn),
								() => toast.success(t("bills.sheet.markedPaid")),
								failed,
							)
						}
					>
						{t("bills.sheet.markPaid")}
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								aria-label={t("bills.sheet.menu", { name: occurrence.name })}
							>
								<EllipsisIcon />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								disabled={busy}
								onSelect={() =>
									void settle(
										close.mutateAsync("skip"),
										() => toast.success(t("bills.sheet.skippedToast")),
										failed,
									)
								}
							>
								<SkipForwardIcon />
								{t("bills.sheet.skip")}
							</DropdownMenuItem>
							<DropdownMenuItem disabled={busy} onSelect={postpone}>
								<AlarmClockIcon />
								{t("bills.sheet.postpone")}
							</DropdownMenuItem>
							{bill !== undefined && bill.status !== "suggested" && (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuItem onSelect={() => billActions.edit(bill)}>
										<PencilIcon />
										{t("bills.detail.edit")}
									</DropdownMenuItem>
									<DropdownMenuItem
										disabled={billActions.pending}
										onSelect={() => billActions.toggle(bill, onLeave)}
									>
										{bill.status === "active" ? <PauseIcon /> : <PlayIcon />}
										{t(bill.status === "active" ? "recurring.pause" : "recurring.resume")}
									</DropdownMenuItem>
								</>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</Action>

			<AddPayment occurrence={occurrence} />
		</>
	);
}

/**
 * Sure's occurrence drawer: what is owed or paid, the payments that settle
 * it, the matcher's suggestion, then, for an administrator, Sure's
 * `recurring_occurrences` and `recurring_allocations` actions. A closed
 * occurrence offers only « Rouvrir ». A viewer reads it without any action,
 * and never asks for the candidates.
 */
export function OccurrenceSheet({
	occurrenceId,
	open,
	onOpenChange,
}: {
	occurrenceId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const detail = useOccurrence(occurrenceId);
	const remove = useRemovePayment();
	const reopen = useSetOccurrenceClosed(occurrenceId);
	// Here rather than in `OpenActions`, which remounts once a payment changes what it owes.
	const billActions = useBillActions();
	// Kept while the dialog closes, so its title does not vanish mid-animation.
	const [removing, setRemoving] = useState<{ id: string; amount: string } | null>(null);
	const [removeOpen, setRemoveOpen] = useState(false);
	const data = detail.data;
	const occurrence = data?.occurrence;

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				// The transaction sheet's frame: 550 px, 12 px off the viewport's edges from 768 px.
				className="data-[side=right]:w-full data-[side=right]:border-l-0 data-[side=right]:sm:max-w-none data-[side=right]:md:inset-y-3 data-[side=right]:md:right-3 data-[side=right]:md:h-auto data-[side=right]:md:w-[550px] data-[side=right]:md:rounded-xl data-[side=right]:md:border motion-reduce:transition-none motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none"
			>
				<SheetHeader className="border-b">
					<p className="text-sm text-muted-foreground">{t("bills.sheet.kicker")}</p>
					<SheetTitle className="text-2xl">
						{occurrence?.name ?? t("bills.sheet.loading")}
					</SheetTitle>
					<SheetDescription className={cn(occurrence?.state === "overdue" && "text-destructive")}>
						{occurrence === undefined ? "" : dueLabel(occurrence, t)}
					</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-4 overflow-y-auto p-4">
					{detail.isPending && <Skeleton className="h-40 w-full" aria-hidden="true" />}
					{detail.isError && (
						<p role="alert" className="text-sm text-muted-foreground">
							{t(`errors.${errorCodeOf(detail.error)}`)}
						</p>
					)}
					{data !== undefined && occurrence !== undefined && (
						<>
							<div className="flex flex-col gap-1">
								<p className="text-2xl font-medium tabular-nums">
									{occurrence.state === "paid"
										? t("bills.sheet.paidHeadline", {
												amount: formatMoney({
													amount: occurrence.confirmed,
													currency: occurrence.currency,
												}),
											})
										: occurrence.state === "skipped"
											? t("bills.skipped")
											: occurrence.state === "missed"
												? t("bills.missed")
												: t("bills.sheet.remaining", {
														amount: formatMoney({
															amount: occurrence.remaining,
															currency: occurrence.currency,
														}),
													})}
								</p>
								<p className="text-sm text-muted-foreground tabular-nums">
									{t("bills.sheet.paidOf", {
										paid: formatMoney({
											amount: occurrence.confirmed,
											currency: occurrence.currency,
										}),
										expected: formatMoney({
											amount: occurrence.expected,
											currency: occurrence.currency,
										}),
									})}
									{isPartial(occurrence) ? ` · ${t("bills.sheet.partial")}` : ""}
								</p>
							</div>

							{data.payments.length > 0 && (
								<InsetGroup level={3} title={t("bills.sheet.payments")}>
									<ul
										aria-label={t("bills.sheet.payments")}
										className="flex flex-col divide-y divide-line rounded-lg border bg-card"
									>
										{data.payments.map((payment) => {
											const amount = formatMoney({
												amount: payment.amount,
												currency: occurrence.currency,
											});

											return (
												<li
													key={payment.id}
													className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
												>
													<div className="flex min-w-0 flex-col">
														<span className="truncate">
															{payment.label ?? t("bills.sheet.manualPayment")}
														</span>
														{payment.paidOn !== null && (
															<span className="text-xs text-muted-foreground">
																{formatShortDate(payment.paidOn)}
															</span>
														)}
													</div>
													<span className="flex shrink-0 items-center gap-2">
														<Money amount={payment.amount} currency={occurrence.currency} />
														{admin && (
															<Button
																size="sm"
																variant="ghost"
																aria-label={t("bills.sheet.removePaymentOf", { amount })}
																onClick={() => {
																	setRemoving({ id: payment.id, amount });
																	setRemoveOpen(true);
																}}
															>
																{t("bills.sheet.removePayment")}
															</Button>
														)}
													</span>
												</li>
											);
										})}
									</ul>
								</InsetGroup>
							)}

							{data.suggestion !== null && (
								<Suggestion suggestion={data.suggestion} admin={admin} />
							)}

							{admin &&
								(isClosed(occurrence) ? (
									<Button
										variant="outline"
										className="self-start"
										disabled={reopen.isPending}
										onClick={() =>
											void settle(
												reopen.mutateAsync("reopen"),
												() => toast.success(t("bills.sheet.reopened")),
												(error) => showErrorToast(errorCodeOf(error)),
											)
										}
									>
										{t("bills.sheet.reopen")}
									</Button>
								) : (
									// Keyed by what it owes, so the payment's amount starts from what remains.
									<OpenActions
										key={`${occurrence.expected} ${occurrence.remaining}`}
										occurrence={occurrence}
										billActions={billActions}
										onLeave={() => onOpenChange(false)}
									/>
								))}
						</>
					)}
				</div>
			</SheetContent>

			{removing !== null && (
				<ConfirmDialog
					open={removeOpen}
					onOpenChange={setRemoveOpen}
					title={t("bills.sheet.removeDialog.title", { amount: removing.amount })}
					description={t("bills.sheet.removeDialog.description")}
					confirmLabel={t("bills.sheet.removeDialog.action")}
					destructive
					pending={remove.isPending}
					onConfirm={() =>
						void settle(
							remove.mutateAsync(removing.id),
							() => {
								toast.success(t("bills.sheet.removeDialog.done"));
								setRemoveOpen(false);
							},
							(error) => {
								showErrorToast(errorCodeOf(error));
								setRemoveOpen(false);
							},
						)
					}
				/>
			)}
			{billActions.dialogs}
		</Sheet>
	);
}
