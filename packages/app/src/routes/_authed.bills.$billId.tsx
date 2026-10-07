import type { BillDetailData } from "@/hooks/useRecurring";
import type { ReactNode } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { formatMoney } from "@archant/data/money";

import { canDelete, useBillActions } from "@/components/BillActions";
import { CurrentOccurrence, PriceChangeAmounts } from "@/components/BillLabels";
import { RecurringAmount } from "@/components/RecurringSuggestions";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { recurringName, useBill } from "@/hooks/useRecurring";
import { errorCodeOf } from "@/lib/api";
import { formatTableDate } from "@/lib/balance-change";
import { dayAndMonth } from "@/lib/dates";
import { cn } from "@/lib/utils";

// A child of `/bills`, so the table or the month stays behind the sheet and
// closing it keeps their search, where Sure renders a page or a frame.
export const Route = createFileRoute("/_authed/bills/$billId")({
	component: BillDrawer,
});

const monthFormat = new Intl.DateTimeFormat("fr-FR", {
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});
const shortMonth = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });

const firstOf = (month: string) => new Date(`${month}-01T00:00:00Z`);

/** A block of the drawer: its uppercase heading over its content. */
function Block({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section aria-label={title} className="flex flex-col gap-1.5">
			<h3 className="type-overline text-muted-foreground">{title}</h3>
			{children}
		</section>
	);
}

/**
 * Sure's sparkline of the twelve months to this one: one dot per month, full
 * when something was paid toward the occurrences due in it and hollow at
 * zero, its height the month's share of the largest, the short name under
 * every other month. Each month names its amount for assistive technology.
 */
function Months({ months, currency }: { months: BillDetailData["months"]; currency: string }) {
	const { t } = useTranslation();
	const peak = Math.max(...months.map((month) => month.paid), 1);

	return (
		<ol aria-label={t("bills.detail.months")} className="grid grid-cols-12 gap-1">
			{months.map((month, index) => (
				<li
					key={month.month}
					aria-label={t("bills.detail.monthPaid", {
						month: monthFormat.format(firstOf(month.month)),
						amount: formatMoney({ amount: month.paid, currency }),
					})}
					className="flex flex-col items-center gap-1"
				>
					<span aria-hidden="true" className="relative h-12 w-full">
						<span
							data-paid={month.paid > 0}
							className={cn(
								"absolute left-1/2 size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-money-income",
								month.paid > 0 ? "bg-money-income" : "bg-card",
							)}
							style={{ bottom: `${(month.paid / peak) * 100}%` }}
						/>
					</span>
					<span aria-hidden="true" className="h-4 text-xs text-muted-foreground">
						{index % 2 === 0 ? shortMonth.format(firstOf(month.month)) : ""}
					</span>
				</li>
			))}
		</ol>
	);
}

/** What comes next: the current occurrence's remaining amount and date, else the series'. */
function NextPayment({ detail }: { detail: BillDetailData }) {
	const { t } = useTranslation();
	const { record } = detail;
	const occurrence = record.currentOccurrence;

	return (
		<Block title={t("bills.detail.nextPayment")}>
			<div className="flex flex-col gap-0.5 rounded-lg border bg-card p-3">
				<span className="text-lg">
					{occurrence !== null && occurrence.status === "scheduled" ? (
						<span className="font-medium tabular-nums">
							{formatMoney({ amount: occurrence.remaining, currency: record.currency })}
						</span>
					) : (
						<RecurringAmount item={record} />
					)}
				</span>
				<span className="text-sm text-muted-foreground">
					{occurrence === null ? (
						record.status === "ended" ? (
							t("recurring.statuses.ended")
						) : (
							t("bills.detail.around", { date: dayAndMonth(record.nextExpectedDate) })
						)
					) : (
						<CurrentOccurrence occurrence={occurrence} />
					)}
				</span>
			</div>
		</Block>
	);
}

/**
 * Sure's `bills#show` as a drawer over `/bills`: the next payment, the
 * average paid and its range, the twelve months, the price changes, an
 * installment's progress, the last account used, the notes and the payment
 * link in a new tab; for an administrator, edit, pause or resume, and
 * delete. Closing or deleting goes back to `/bills` with the same search.
 */
function BillDrawer() {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const { billId } = Route.useParams();
	const navigate = Route.useNavigate();
	const [open, setOpen] = useState(true);
	const bill = useBill(billId);
	const actions = useBillActions(() => setOpen(false));
	const data = bill.data;
	const record = data?.record;

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetContent
				// The transaction sheet's frame: 550 px, 12 px off the viewport's edges from 768 px.
				className="data-[side=right]:w-full data-[side=right]:border-l-0 data-[side=right]:sm:max-w-none data-[side=right]:md:inset-y-3 data-[side=right]:md:right-3 data-[side=right]:md:h-auto data-[side=right]:md:w-[550px] data-[side=right]:md:rounded-xl data-[side=right]:md:border motion-reduce:transition-none motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none"
				// Once the sheet has left, so it closes with its animation.
				onCloseAutoFocus={() =>
					void navigate({ to: "/bills", search: (previous) => previous, resetScroll: false })
				}
			>
				<SheetHeader className="border-b">
					<p className="text-sm text-muted-foreground">{t("bills.detail.kicker")}</p>
					<SheetTitle className="text-2xl">
						{record === undefined ? t("bills.sheet.loading") : recurringName(record)}
					</SheetTitle>
					<SheetDescription>
						{record === undefined
							? ""
							: `${t(`recurring.billTypes.${record.billType}`)} · ${t(`recurring.frequencyPresets.${record.frequency.key}`)}`}
					</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-5 overflow-y-auto p-4">
					{bill.isPending && <Skeleton className="h-40 w-full" aria-hidden="true" />}
					{bill.isError && (
						<p role="alert" className="text-sm text-muted-foreground">
							{t(`errors.${errorCodeOf(bill.error)}`)}
						</p>
					)}
					{data !== undefined && record !== undefined && (
						<>
							<NextPayment detail={data} />

							{data.installment !== null && (
								<p className="text-sm">
									{t("bills.detail.installment", {
										current: Math.min(data.installment.paid + 1, data.installment.total),
										total: data.installment.total,
									})}
								</p>
							)}

							{data.averagePaid !== null && (
								<Block title={t("bills.detail.average")}>
									<p className="text-lg font-medium tabular-nums">
										{formatMoney({ amount: data.averagePaid.average, currency: record.currency })}
									</p>
									<p className="text-xs text-muted-foreground tabular-nums">
										{t("bills.detail.range", {
											min: formatMoney({
												amount: data.averagePaid.lowest,
												currency: record.currency,
											}),
											max: formatMoney({
												amount: data.averagePaid.highest,
												currency: record.currency,
											}),
										})}
									</p>
								</Block>
							)}

							<Block title={t("bills.detail.months")}>
								<Months months={data.months} currency={record.currency} />
							</Block>

							{data.priceChanges.length > 0 && (
								<Block title={t("bills.detail.priceChanges")}>
									<ul className="flex flex-col divide-y divide-line rounded-lg border bg-card">
										{data.priceChanges.map((change) => (
											<li
												key={change.id}
												className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
											>
												<span>{formatTableDate(change.effectiveOn)}</span>
												<PriceChangeAmounts change={change} />
											</li>
										))}
									</ul>
								</Block>
							)}

							{data.lastAccount !== null && (
								<Block title={t("bills.detail.lastAccount")}>
									<p className="text-sm">{data.lastAccount.name}</p>
								</Block>
							)}

							{record.notes !== null && (
								<Block title={t("bills.detail.notes")}>
									<p className="text-sm whitespace-pre-line">{record.notes}</p>
								</Block>
							)}

							{record.paymentUrl !== null && (
								<a
									href={record.paymentUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1.5 self-start rounded-sm text-sm text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
								>
									{t("bills.detail.openSite")}
									<ExternalLinkIcon aria-hidden="true" className="size-3.5" />
								</a>
							)}

							{admin && record.status === "suggested" && (
								// A suggestion the transaction sheet links to: added or dismissed, as its strip does.
								<div className="flex flex-wrap gap-2 border-t pt-4">
									<Button
										variant="outline"
										disabled={actions.pending}
										onClick={() => actions.settle(record, "ended")}
									>
										{t("recurring.suggested.dismiss")}
									</Button>
									<Button
										disabled={actions.pending}
										onClick={() => actions.settle(record, "active")}
									>
										{t("recurring.suggested.confirm")}
									</Button>
								</div>
							)}

							{admin && record.status !== "suggested" && (
								<div className="flex flex-wrap gap-2 border-t pt-4">
									<Button variant="outline" onClick={() => actions.edit(record)}>
										{t("recurring.edit")}
									</Button>
									<Button
										variant="outline"
										disabled={actions.pending}
										onClick={() => actions.toggle(record)}
									>
										{t(record.status === "active" ? "recurring.pause" : "recurring.resume")}
									</Button>
									{canDelete(record) && (
										<Button
											variant="outline"
											className="text-destructive"
											disabled={actions.pending}
											onClick={() => actions.remove(record)}
										>
											{t("recurring.delete")}
										</Button>
									)}
								</div>
							)}
						</>
					)}
				</div>
				{actions.dialogs}
			</SheetContent>
		</Sheet>
	);
}
