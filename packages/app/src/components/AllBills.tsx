import type { BillActions } from "@/components/BillActions";
import type { Status } from "@/components/StatusBadge";
import type { AllBillsData, AllBillsQuery, BillRecordData } from "@/hooks/useRecurring";

import { Link } from "@tanstack/react-router";
import { ReceiptIcon, SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { BILL_SORTS, BILL_STATUS_FILTERS } from "@archant/api/schemas/bills";
import { formatMoney } from "@archant/data/money";
import { BILL_TYPES } from "@archant/data/recurring";

import { BillMenu } from "@/components/BillActions";
import { CurrentOccurrence, PriceChangeAmounts } from "@/components/BillLabels";
import { EmptyState } from "@/components/EmptyState";
import { GROUP_TABLE_INSET, InsetGroup } from "@/components/InsetGroup";
import { LeftOutNotice } from "@/components/LeftOutNotice";
import { ListCard } from "@/components/ListCard";
import { Money } from "@/components/Money";
import { StatusBadge } from "@/components/StatusBadge";
import { SummaryStrip } from "@/components/SummaryStrip";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { recurringName, useAllBills } from "@/hooks/useRecurring";
import { errorCodeOf } from "@/lib/api";
import { formatTableDate } from "@/lib/balance-change";
import { dayAndMonth } from "@/lib/dates";

// Long enough to skip the keystrokes of one word, short enough to feel live.
const SEARCH_DELAY_MS = 300;

// Radix's select has no empty value: this one stands for « every ».
const ANY = "any";

const BADGES = {
	active: "recurringActive",
	inactive: "recurringInactive",
	ended: "recurringEnded",
} as const satisfies Partial<Record<BillRecordData["status"], Status>>;

const badgeOf = (bill: BillRecordData): Status =>
	bill.status === "suggested" ? "recurringActive" : BADGES[bill.status];

/** The search field, bound to `q`, written to the URL once typing pauses. */
function SearchField({ q, onChange }: { q: string | undefined; onChange: (q?: string) => void }) {
	const { t } = useTranslation();
	const [text, setText] = useState(q ?? "");
	const [shown, setShown] = useState(q);

	// Follows the URL when it changes from elsewhere, such as the back button.
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

		const timer = setTimeout(() => onChange(next), SEARCH_DELAY_MS);

		return () => clearTimeout(timer);
	}, [onChange, q, text]);

	return (
		<div className="relative w-full max-w-xs">
			<SearchIcon
				aria-hidden="true"
				className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				type="search"
				aria-label={t("bills.allView.search")}
				placeholder={t("bills.allView.search")}
				className="pl-8"
				maxLength={200}
				value={text}
				onChange={(event) => setText(event.target.value)}
			/>
		</div>
	);
}

/** One of the three selects, « every » first unless the select has a default. */
function Choice<Value extends string>({
	label,
	value,
	values,
	labelOf,
	any,
	onChange,
}: {
	label: string;
	value: Value | undefined;
	values: readonly Value[];
	labelOf: (value: Value) => string;
	/** The label of « every », for a select whose absence means every value. */
	any?: string;
	onChange: (value: Value | undefined) => void;
}) {
	return (
		<Select
			value={value ?? ANY}
			onValueChange={(next) => onChange(values.find((candidate) => candidate === next))}
		>
			<SelectTrigger aria-label={label} className="w-auto">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{any !== undefined && <SelectItem value={ANY}>{any}</SelectItem>}
				{values.map((candidate) => (
					<SelectItem key={candidate} value={candidate}>
						{labelOf(candidate)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** Sure's subscription rollup: per month, per year, how many, and the year's price changes. */
function SubscriptionRollup({ rollup }: { rollup: NonNullable<AllBillsData["subscriptions"]> }) {
	const { t } = useTranslation();
	const money = (amount: typeof rollup.monthly) =>
		amount === null ? "–" : <Money amount={amount} currency={rollup.currency} />;

	return (
		<>
			<section aria-label={t("bills.allView.rollup")} className="flex flex-col gap-2">
				<SummaryStrip
					className="rounded-xl border bg-card"
					cells={[
						{ label: t("bills.allView.monthly"), value: money(rollup.monthly) },
						{ label: t("bills.allView.annual"), value: money(rollup.annual) },
						{ label: t("bills.allView.active"), value: String(rollup.count) },
					]}
				/>
				<LeftOutNotice accounts={rollup.leftOut} />
			</section>
			{rollup.priceChanges.length > 0 && (
				<InsetGroup level={2} title={t("bills.allView.priceChanges")}>
					<ul
						aria-label={t("bills.allView.priceChanges")}
						className="flex flex-col divide-y divide-line rounded-lg border bg-card"
					>
						{rollup.priceChanges.map((change) => (
							<li key={change.id} className="flex items-center justify-between gap-3 px-4 py-2">
								<span className="flex min-w-0 flex-col">
									<span className="truncate text-sm">{change.name}</span>
									<span className="text-xs text-muted-foreground">
										{formatTableDate(change.effectiveOn)}
									</span>
								</span>
								<PriceChangeAmounts change={change} />
							</li>
						))}
					</ul>
				</InsetGroup>
			)}
		</>
	);
}

/** The next due date, as `CurrentOccurrence` reads it, else the series' date; none once ended. */
function NextDue({ bill }: { bill: BillRecordData }) {
	if (bill.currentOccurrence !== null) {
		return <CurrentOccurrence occurrence={bill.currentOccurrence} />;
	}

	return <span>{bill.status === "ended" ? "–" : dayAndMonth(bill.nextExpectedDate)}</span>;
}

/**
 * Sure's `bills/all`: every series but the suggestions, with its type,
 * frequency, amount or band and monthly equivalent, next due date and
 * status, filtered, searched and sorted from the URL. With the type
 * « Abonnement », Sure's rollup sits above the table. A name opens the
 * bill's drawer; an administrator's row has a menu.
 */
export function AllBills({
	query,
	onQuery,
	admin,
	actions,
}: {
	query: AllBillsQuery;
	onQuery: (next: AllBillsQuery) => void;
	admin: boolean;
	actions: BillActions;
}) {
	const { t } = useTranslation();
	const bills = useAllBills(query);
	const data = bills.data;
	const title = t("bills.all");

	return (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<SearchField q={query.q} onChange={(q) => onQuery({ ...query, q })} />
				<Choice
					label={t("bills.allView.status")}
					value={query.status}
					values={BILL_STATUS_FILTERS}
					labelOf={(value) => t(`bills.allView.statuses.${value}`)}
					any={t("bills.allView.anyStatus")}
					onChange={(status) => onQuery({ ...query, status })}
				/>
				<Choice
					label={t("bills.allView.type")}
					value={query.type}
					values={BILL_TYPES}
					labelOf={(value) => t(`recurring.billTypes.${value}`)}
					any={t("bills.allView.anyType")}
					onChange={(type) => onQuery({ ...query, type })}
				/>
				<Choice
					label={t("bills.allView.sort")}
					value={query.sort ?? "due"}
					values={BILL_SORTS}
					labelOf={(value) => t(`bills.allView.sorts.${value}`)}
					onChange={(sort) => onQuery({ ...query, sort: sort === "due" ? undefined : sort })}
				/>
			</div>

			{bills.isPending && (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-14 w-full" />
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

			{data !== undefined && data.subscriptions !== null && (
				<SubscriptionRollup rollup={data.subscriptions} />
			)}

			{data !== undefined && data.bills.length === 0 && (
				<EmptyState
					level={2}
					icon={{ kind: "transfer", icon: ReceiptIcon }}
					title={t("bills.allView.noMatch")}
					description={t("bills.allView.noMatchDescription")}
					action={null}
				/>
			)}

			{data !== undefined && data.bills.length > 0 && (
				<ListCard>
					<InsetGroup level={2} title={title} count={data.bills.length}>
						<Table aria-label={title} className={GROUP_TABLE_INSET}>
							<TableHeader>
								<TableRow className="border-line hover:bg-transparent">
									{(["name", "type", "frequency", "amount", "next", "status"] as const).map(
										(column) => (
											<TableHead
												key={column}
												scope="col"
												className={
													column === "amount"
														? "type-overline text-right text-muted-foreground"
														: "type-overline text-muted-foreground"
												}
											>
												{t(`bills.allView.columns.${column}`)}
											</TableHead>
										),
									)}
									{admin && (
										<TableHead scope="col">
											<span className="sr-only">{t("bills.allView.columns.actions")}</span>
										</TableHead>
									)}
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.bills.map((bill) => (
									<TableRow key={bill.id} className="h-14 border-line hover:bg-hover">
										<TableCell className="max-w-72">
											<span className="flex min-w-0 items-center gap-3">
												<TintedIcon
													subject={{ kind: "merchant", name: recurringName(bill) }}
													size="md"
												/>
												<Link
													to="/bills/$billId"
													params={{ billId: bill.id }}
													search={(previous) => previous}
													resetScroll={false}
													className="truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
												>
													{recurringName(bill)}
												</Link>
											</span>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{t(`recurring.billTypes.${bill.billType}`)}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{t(`recurring.frequencyPresets.${bill.frequency.key}`)}
										</TableCell>
										<TableCell className="text-right">
											<span className="flex flex-col items-end">
												<Money amount={bill.amount} currency={bill.currency} signed />
												{/* A monthly bill's equivalent is its own amount: said only when it differs. */}
												{bill.monthlyEquivalent !== Math.abs(bill.amount) && (
													<span className="text-xs text-muted-foreground tabular-nums">
														{t("bills.allView.perMonth", {
															amount: formatMoney({
																amount: bill.monthlyEquivalent,
																currency: bill.currency,
															}),
														})}
													</span>
												)}
											</span>
										</TableCell>
										<TableCell className="whitespace-nowrap">
											<NextDue bill={bill} />
										</TableCell>
										<TableCell>
											<span className="flex items-center gap-1.5">
												<StatusBadge status={badgeOf(bill)} />
												{bill.manual && <StatusBadge status="recurringManual" />}
											</span>
										</TableCell>
										{admin && (
											<TableCell className="w-10 text-right">
												<BillMenu bill={bill} actions={actions} />
											</TableCell>
										)}
									</TableRow>
								))}
							</TableBody>
						</Table>
					</InsetGroup>
				</ListCard>
			)}
		</>
	);
}
