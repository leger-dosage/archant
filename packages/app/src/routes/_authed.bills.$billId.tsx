import type { BillDetailData } from "@/hooks/useRecurring";
import type { ReactNode } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { ChevronRightIcon, ExternalLinkIcon, LinkIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { MinorUnits } from "@archant/data/money";
import { formatMoney, toMinorUnits } from "@archant/data/money";

import { BillMenu, useBillActions } from "@/components/BillActions";
import { AmountRange, CurrentOccurrence, PriceChangeAmounts } from "@/components/BillLabels";
import { Badge } from "@/components/ui/badge";
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

type BillRecord = BillDetailData["record"];

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

/** Sure's `DS::Disclosure`: a heading that folds its section. */
function Disclosure({
	title,
	defaultOpen = false,
	children,
}: {
	title: string;
	defaultOpen?: boolean;
	children: ReactNode;
}) {
	// Its own state, not `group-open`: « Indicateurs clés » nests inside « Aperçu ».
	const [open, setOpen] = useState(defaultOpen);

	return (
		<details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
			<summary className="flex cursor-pointer items-center gap-1 py-1 text-sm font-medium [&::-webkit-details-marker]:hidden">
				<ChevronRightIcon
					aria-hidden="true"
					className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")}
				/>
				{title}
			</summary>
			<div className="pt-2">{children}</div>
		</details>
	);
}

/**
 * Sure's `_pay_action`: « Paiement automatique » for an autopaid bill, a
 * quiet link when it has one; else « Payer » to its link; else, for an
 * administrator, « Ajouter un lien », which opens the edit dialog.
 */
function PayAction({ record, onAddLink }: { record: BillRecord; onAddLink: (() => void) | null }) {
	const { t } = useTranslation();
	const name = recurringName(record);
	const url = record.paymentUrl;

	if (record.autopay) {
		return url === null ? (
			<span className="inline-flex items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground">
				<RefreshCwIcon aria-hidden="true" className="size-3.5" />
				{t("bills.detail.autopay")}
			</span>
		) : (
			<Button asChild variant="ghost" size="sm">
				<a
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={t("bills.detail.autopayAria", { name })}
				>
					<RefreshCwIcon aria-hidden="true" />
					{t("bills.detail.autopay")}
				</a>
			</Button>
		);
	}

	if (url !== null) {
		return (
			<Button asChild size="sm">
				<a
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={t("bills.detail.payAria", { name })}
				>
					{t("bills.detail.pay")}
					<ExternalLinkIcon aria-hidden="true" />
				</a>
			</Button>
		);
	}

	return onAddLink === null ? null : (
		<Button
			variant="outline"
			size="sm"
			className="border-dashed"
			aria-label={t("bills.detail.addLinkAria", { name })}
			onClick={onAddLink}
		>
			<LinkIcon aria-hidden="true" />
			{t("bills.detail.addLink")}
		</Button>
	);
}

/**
 * Sure's `_summary`: the current occurrence's paid or remaining amount over
 * what its payments settle and its date, the band when its amount is an
 * estimate; else the series' amount, « ~ » before it when its amounts
 * spread. An installment's progress, then the pay action.
 */
function Summary({
	detail,
	onAddLink,
}: {
	detail: BillDetailData;
	onAddLink: (() => void) | null;
}) {
	const { t } = useTranslation();
	const { record } = detail;
	const occurrence = record.currentOccurrence;
	const currency = record.currency;
	const money = (amount: MinorUnits) => formatMoney({ amount, currency });
	const range = occurrence?.status === "scheduled" ? occurrence.amountRange : null;

	return (
		<section aria-label={t("bills.detail.nextPayment")} className="flex flex-col gap-3">
			<div className="flex flex-col gap-0.5">
				<p className="text-lg font-medium tabular-nums">
					{occurrence === null
						? `${varies(record) ? "~" : ""}${money(toMinorUnits(Math.abs(record.amount)))}`
						: occurrence.status === "paid"
							? t("bills.detail.paidHeadline", { amount: money(occurrence.confirmed) })
							: t("bills.detail.remaining", { amount: money(occurrence.remaining) })}
				</p>
				<p className="text-xs text-muted-foreground">
					{occurrence === null ? (
						record.status === "ended" ? (
							t("recurring.statuses.ended")
						) : (
							t("bills.detail.around", { date: dayAndMonth(record.nextExpectedDate) })
						)
					) : (
						<>
							<span className="tabular-nums">
								{t("bills.detail.progress", {
									paid: money(occurrence.confirmed),
									expected: money(occurrence.expected),
								})}
							</span>
							{" · "}
							<CurrentOccurrence occurrence={occurrence} />
						</>
					)}
				</p>
				{/* The list shows the band only from `@lg`: on a phone, this is where an estimate says how far it swings. */}
				{range !== null && <AmountRange range={range} currency={currency} />}
			</div>
			{detail.installment !== null && (
				<p className="text-xs text-muted-foreground">
					{t("bills.detail.installment", {
						current: Math.min(detail.installment.paid + 1, detail.installment.total),
						total: detail.installment.total,
					})}
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<PayAction record={record} onAddLink={onAddLink} />
			</div>
		</section>
	);
}

const varies = (record: BillRecord) =>
	record.expectedAmountMin !== null &&
	record.expectedAmountMax !== null &&
	record.expectedAmountMin < record.expectedAmountMax;

const tolerance = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });
const sentence = new Intl.ListFormat("fr", { type: "conjunction" });

/**
 * Sure's « Comment cette facture est reconnue »: the name the matcher reads,
 * the amount or its band, the frequency and the account, then what it
 * learned from the payments linked by hand.
 */
function Rules({ detail }: { detail: BillDetailData }) {
	const { t } = useTranslation();
	const { record, rules } = detail;
	const money = (amount: number) =>
		formatMoney({ amount: toMinorUnits(Math.abs(amount)), currency: record.currency });
	const [low, high] = [record.expectedAmountMin ?? 0, record.expectedAmountMax ?? 0]
		.map(Math.abs)
		.toSorted((a, b) => a - b);
	const pills = [
		record.merchantName ?? record.label,
		varies(record)
			? t("bills.detail.range", { min: money(low!), max: money(high!) })
			: money(record.amount),
		t(`recurring.frequencyPresets.${record.frequency.key}`),
		...(record.accountName === null ? [] : [record.accountName]),
	];

	return (
		<Block title={t("bills.detail.rules")}>
			<ul className="flex flex-wrap gap-1.5">
				{pills.map((pill, index) => (
					// By position: the name and the account may read the same.
					<li key={index}>
						<Badge variant="secondary" className="font-normal">
							{pill}
						</Badge>
					</li>
				))}
			</ul>
			{rules.aliases.length > 0 && (
				<p className="text-xs text-muted-foreground">
					{t("bills.detail.ruleAliases", { names: sentence.format(rules.aliases) })}
				</p>
			)}
			{rules.learnedTolerance !== null && rules.learnedTolerance > 0 && (
				<p className="text-xs text-muted-foreground">
					{t("bills.detail.ruleTolerance", {
						percent: tolerance.format(rules.learnedTolerance / 1000),
					})}
				</p>
			)}
		</Block>
	);
}

/** A figure of the overview: its label over its amount. */
function Figure({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			{children}
		</div>
	);
}

/**
 * Sure's « Aperçu »: the rules, then what the bill cost, the twelve months,
 * the average with its range, a year's worth and this year's payments, the
 * per-year table folded under « Indicateurs clés », the last account, and
 * the price changes.
 */
function Overview({ detail }: { detail: BillDetailData }) {
	const { t } = useTranslation();
	const { record, analytics } = detail;
	const money = (amount: MinorUnits) => formatMoney({ amount, currency: record.currency });

	return (
		<div className="flex flex-col gap-4">
			<Rules detail={detail} />

			<div className="flex flex-col divide-y divide-line rounded-lg border bg-card">
				<div className="flex flex-col gap-1 p-3">
					<h3 className="type-overline text-muted-foreground">{t("bills.detail.months")}</h3>
					<Months months={detail.months} currency={record.currency} />
				</div>
				{(analytics !== null || detail.yearly.length > 0 || detail.lastAccount !== null) && (
					<div className="flex flex-col gap-3 p-3">
						{analytics !== null && (
							<dl className="grid grid-cols-3 gap-2">
								<Figure label={t("bills.detail.average")}>
									<dd className="text-sm font-medium tabular-nums">{money(analytics.average)}</dd>
									<dd className="text-xs text-muted-foreground tabular-nums">
										{t("bills.detail.range", {
											min: money(analytics.lowest),
											max: money(analytics.highest),
										})}
									</dd>
								</Figure>
								<Figure label={t("bills.detail.annualized")}>
									<dd className="text-sm font-medium tabular-nums">
										{money(analytics.annualized)}
									</dd>
								</Figure>
								<Figure label={t("bills.detail.ytd")}>
									<dd className="text-sm font-medium tabular-nums">
										{money(analytics.paidThisYear)}
									</dd>
								</Figure>
							</dl>
						)}
						{detail.yearly.length > 0 && (
							<Disclosure title={t("bills.detail.keyMetrics")}>
								<table className="w-full text-sm tabular-nums">
									<thead>
										<tr className="text-xs text-muted-foreground">
											<th scope="col" className="pb-1 text-left font-normal">
												{t("bills.detail.year")}
											</th>
											<th scope="col" className="pb-1 text-right font-normal">
												{t("bills.detail.spent")}
											</th>
											<th scope="col" className="pb-1 text-right font-normal">
												{t("bills.detail.averagePayment")}
											</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-line">
										{detail.yearly.map((row) => (
											<tr key={row.year}>
												<th
													scope="row"
													className="py-1.5 text-left font-normal text-muted-foreground"
												>
													{row.year}
												</th>
												<td className="py-1.5 text-right">{money(row.total)}</td>
												<td className="py-1.5 text-right">{money(row.average)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</Disclosure>
						)}
						{detail.lastAccount !== null && (
							<section
								aria-label={t("bills.detail.lastAccount")}
								className="flex items-center justify-between gap-3"
							>
								<h3 className="text-xs text-muted-foreground">{t("bills.detail.lastAccount")}</h3>
								<p className="truncate text-sm">{detail.lastAccount.name}</p>
							</section>
						)}
					</div>
				)}
			</div>

			{detail.priceChanges.length > 0 && (
				<Block title={t("bills.detail.priceChanges")}>
					<ul className="flex flex-col divide-y divide-line rounded-lg border bg-card">
						{detail.priceChanges.map((change) => (
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
		</div>
	);
}

/** Sure's « Historique »: each settled cycle, what paid it and how much. */
function History({ detail }: { detail: BillDetailData }) {
	const { t } = useTranslation();

	return (
		<ul
			aria-label={t("bills.detail.history")}
			className="flex flex-col divide-y divide-line rounded-lg border bg-card"
		>
			{detail.history.map((occurrence) => (
				<li key={occurrence.id} className="flex items-center justify-between gap-3 px-3 py-2">
					<div className="flex min-w-0 flex-col">
						<span className="text-sm">{formatTableDate(occurrence.dueOn)}</span>
						<span className="truncate text-xs text-muted-foreground">
							{t(`recurring.occurrence.${occurrence.status}`)}
							{occurrence.payments > 1
								? ` · ${t("bills.detail.paymentCount", { count: occurrence.payments })}`
								: occurrence.payments === 1
									? ` · ${occurrence.label ?? t("bills.detail.manualPayment")}`
									: ""}
						</span>
					</div>
					<span className="shrink-0 text-sm tabular-nums">
						{formatMoney({ amount: occurrence.paid, currency: detail.record.currency })}
					</span>
				</li>
			))}
		</ul>
	);
}

/**
 * Sure's `bills#show` as a drawer over `/bills`: the summary with the pay
 * action, then « Aperçu », « À venir », « Historique » and « Remarques », as
 * Sure's `_detail`; for an administrator, a menu to edit, pause or resume,
 * and delete. Closing or deleting goes back to `/bills` with the same search.
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
				<SheetHeader className="border-b pr-24">
					<p className="text-sm text-muted-foreground">{t("bills.detail.kicker")}</p>
					<SheetTitle className="text-2xl">
						{record === undefined ? t("bills.sheet.loading") : recurringName(record)}
					</SheetTitle>
					<SheetDescription>
						{record === undefined
							? ""
							: `${t(`recurring.billTypes.${record.billType}`)} · ${t(`recurring.frequencyPresets.${record.frequency.key}`)}`}
					</SheetDescription>
					{admin && record !== undefined && record.status !== "suggested" && (
						// Beside the close button, as Sure's header menu.
						<div className="absolute top-2 right-12">
							<BillMenu bill={record} actions={actions} editLabel={t("bills.detail.edit")} />
						</div>
					)}
				</SheetHeader>
				<div className="flex flex-col gap-4 overflow-y-auto p-4">
					{bill.isPending && <Skeleton className="h-40 w-full" aria-hidden="true" />}
					{bill.isError && (
						<p role="alert" className="text-sm text-muted-foreground">
							{t(`errors.${errorCodeOf(bill.error)}`)}
						</p>
					)}
					{data !== undefined && record !== undefined && (
						<>
							<Summary
								detail={data}
								onAddLink={
									admin && record.status !== "suggested" ? () => actions.edit(record) : null
								}
							/>

							<Disclosure title={t("bills.detail.overview")} defaultOpen>
								<Overview detail={data} />
							</Disclosure>

							{data.upcoming.length > 0 && (
								<Disclosure title={t("bills.detail.upcoming")}>
									<ul
										aria-label={t("bills.detail.upcoming")}
										className="flex flex-col divide-y divide-line rounded-lg border bg-card"
									>
										{data.upcoming.map((date) => (
											<li
												key={date}
												className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
											>
												<span>{formatTableDate(date)}</span>
												<span className="text-muted-foreground tabular-nums">
													~
													{formatMoney({
														amount: toMinorUnits(Math.abs(record.amount)),
														currency: record.currency,
													})}
												</span>
											</li>
										))}
									</ul>
								</Disclosure>
							)}

							{data.history.length > 0 && (
								<Disclosure title={t("bills.detail.history")}>
									<History detail={data} />
								</Disclosure>
							)}

							{record.notes !== null && (
								<Disclosure title={t("bills.detail.notes")}>
									<p className="px-1 text-sm whitespace-pre-line">{record.notes}</p>
								</Disclosure>
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
						</>
					)}
				</div>
				{actions.dialogs}
			</SheetContent>
		</Sheet>
	);
}
