import type { BillRowData, SuggestedPaymentData } from "@/hooks/useRecurring";
import type { ReactNode } from "react";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { formatMoney, toMinorUnits } from "@archant/data/money";

import {
	MatchReasons,
	confidenceText,
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
import { Input } from "@/components/ui/input";
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
	useEditOccurrence,
	useMarkPaid,
	useOccurrence,
	usePaymentCandidates,
	useRemovePayment,
	useSetOccurrenceClosed,
} from "@/hooks/useRecurring";
import { amountToText } from "@/lib/amount-sign";
import { ApiError, errorCodeOf } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";
import { dayAndMonth, toIsoDate } from "@/lib/dates";
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

/**
 * « Ajouter un paiement »: the transactions the matcher's `explain` scores,
 * each with its percentage and its signals, or an amount and a date with no
 * transaction. Read only by an administrator, the one who may add one.
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

	return (
		<Action title={t("bills.sheet.addPayment")}>
			<div className="flex flex-col gap-2">
				<h4 className="text-xs font-medium text-muted-foreground uppercase">
					{t("bills.sheet.candidates")}
				</h4>
				{candidates.isPending && <Skeleton className="h-12 w-full" aria-hidden="true" />}
				{candidates.isError && (
					<p role="alert" className="text-sm text-muted-foreground">
						{t(`errors.${errorCodeOf(candidates.error)}`)}
					</p>
				)}
				{candidates.data !== undefined &&
					(candidates.data.length === 0 ? (
						<p className="text-sm text-muted-foreground">{t("bills.sheet.noCandidates")}</p>
					) : (
						<ul
							aria-label={t("bills.sheet.candidates")}
							className="flex flex-col divide-y divide-line"
						>
							{candidates.data.map((candidate) => (
								<li key={candidate.entryId} className="flex flex-col gap-2 py-2 text-sm">
									<div className="flex items-start justify-between gap-3">
										<div className="flex min-w-0 flex-col">
											<span className="truncate font-medium">{candidate.label}</span>
											<span className="text-xs text-muted-foreground">
												{formatShortDate(candidate.date)}
											</span>
										</div>
										<span className="flex shrink-0 items-center gap-2">
											<span className="text-xs text-muted-foreground tabular-nums">
												{confidenceText(candidate.score)}
											</span>
											<Money amount={candidate.amount} currency={candidate.currency} signed />
										</span>
									</div>
									<MatchReasons
										signals={candidate.signals}
										currency={candidate.currency}
										expected={occurrence.expected}
										actual={toMinorUnits(Math.abs(candidate.amount))}
										dueOn={occurrence.effectiveDueOn}
										paidOn={candidate.date}
									/>
									<Button
										size="sm"
										variant="outline"
										className="self-start"
										disabled={add.isPending}
										aria-label={t("bills.sheet.useCandidate", { label: candidate.label })}
										onClick={() =>
											void settle(add.mutateAsync({ entryId: candidate.entryId }), added, (error) =>
												showErrorToast(errorCodeOf(error)),
											)
										}
									>
										{t("bills.sheet.use")}
									</Button>
								</li>
							))}
						</ul>
					))}
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

/** An open occurrence's actions: mark it paid, add a payment, postpone it, change its amount, skip it. */
function OpenActions({ occurrence }: { occurrence: BillRowData }) {
	const { t } = useTranslation();
	const id = occurrence.occurrenceId;
	const markPaid = useMarkPaid(id);
	const close = useSetOccurrenceClosed(id);
	const edit = useEditOccurrence(id);
	const [paidOn, setPaidOn] = useState(() => toIsoDate());
	const [until, setUntil] = useState(() => occurrence.snoozedUntil ?? occurrence.effectiveDueOn);
	const [expected, setExpected] = useState(() =>
		amountToText(occurrence.expected, occurrence.currency),
	);
	const expectedError = useFieldError("expectedAmount");

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
				<Button
					className="self-start"
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
			</Action>

			<AddPayment occurrence={occurrence} />

			<Action title={t("bills.sheet.postpone")}>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="snoozed-until">{t("bills.sheet.postponeTo")}</Label>
					<DateField id="snoozed-until" value={until} onChange={setUntil} />
				</div>
				<Button
					variant="outline"
					className="self-start"
					disabled={edit.isPending}
					onClick={() =>
						void settle(
							edit.mutateAsync({ snoozedUntil: until }),
							() => toast.success(t("bills.sheet.postponed", { date: dayAndMonth(until) })),
							failed,
						)
					}
				>
					{t("bills.sheet.postpone")}
				</Button>
			</Action>

			<Action title={t("bills.sheet.changeAmount")}>
				<p className="text-xs text-muted-foreground">{t("bills.sheet.changeAmountHint")}</p>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="expected-amount">{t("bills.sheet.expected")}</Label>
					<Input
						id="expected-amount"
						inputMode="decimal"
						autoComplete="off"
						className="text-right tabular-nums"
						value={expected}
						aria-invalid={expectedError.code !== null}
						{...(expectedError.code === null
							? {}
							: { "aria-describedby": "expected-amount-error" })}
						onChange={(event) => setExpected(event.target.value)}
					/>
					<FieldMessage
						id="expected-amount-error"
						error={expectedError.code === null ? undefined : { type: expectedError.code }}
					/>
				</div>
				<Button
					variant="outline"
					className="self-start"
					disabled={edit.isPending}
					onClick={() => {
						expectedError.setCode(null);
						void settle(
							edit.mutateAsync({ expectedAmount: expected }),
							() => toast.success(t("bills.sheet.amountChanged")),
							expectedError.fail,
						);
					}}
				>
					{t("bills.sheet.changeAmount")}
				</Button>
			</Action>

			<Button
				variant="outline"
				className="self-start"
				disabled={close.isPending}
				onClick={() =>
					void settle(
						close.mutateAsync("skip"),
						() => toast.success(t("bills.sheet.skippedToast")),
						failed,
					)
				}
			>
				{t("bills.sheet.skip")}
			</Button>
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
									// Keyed by the occurrence's amounts, so the fields start from what it owes now.
									<OpenActions
										key={`${occurrence.expected} ${occurrence.remaining} ${occurrence.snoozedUntil}`}
										occurrence={occurrence}
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
		</Sheet>
	);
}
