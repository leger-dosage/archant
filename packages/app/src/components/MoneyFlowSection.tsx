import type { AccountListData } from "@/hooks/useAccounts";
import type { MoneyFlowData } from "@/hooks/useMoneyFlow";

import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, ListFilterIcon } from "lucide-react";
import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";

import { toMinorUnits } from "@archant/data/money";

import { DashboardMonthPicker } from "@/components/DashboardMonthPicker";
import { Money } from "@/components/Money";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useMoneyFlow } from "@/hooks/useMoneyFlow";
import { errorCodeOf } from "@/lib/api";
import { capitalised, drilldownAccounts } from "@/lib/dashboard-months";
import { longDate, monthLabel } from "@/lib/dates";
import { FLOW_COLOURS } from "@/lib/money-flow";
import { matchesSearch } from "@/lib/search-match";
import { cn } from "@/lib/utils";

const MoneyFlowChart = lazy(async () => ({
	default: (await import("@/components/MoneyFlowChart")).MoneyFlowChart,
}));

/**
 * Sure's account filter: a search over the widget's accounts, one box each,
 * « Appliquer » sending the ticked ones. Every box ticked, or none, is no
 * filter.
 */
function AccountFilter({
	data,
	onApply,
}: {
	data: MoneyFlowData;
	onApply: (accountIds: string[] | undefined) => void;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const selected = data.accountIds ?? data.accounts.map((account) => account.id);
	const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set(selected));
	const all = selected.length === data.accounts.length;

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);

				if (next) {
					setTicked(new Set(selected));
					setQuery("");
				}
			}}
		>
			<PopoverTrigger asChild>
				<Button variant="outline" size="sm">
					<ListFilterIcon aria-hidden="true" />
					{all
						? t("dashboard.moneyFlow.filterAccountsAll")
						: t("dashboard.moneyFlow.filterAccounts", { count: selected.length })}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="flex w-56 flex-col gap-2 p-3">
				<form
					className="flex flex-col gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						const ids = data.accounts.flatMap((account) =>
							ticked.has(account.id) ? [account.id] : [],
						);
						onApply(ids.length === 0 || ids.length === data.accounts.length ? undefined : ids);
						setOpen(false);
					}}
				>
					<Input
						type="search"
						aria-label={t("dashboard.moneyFlow.searchAccounts")}
						placeholder={t("dashboard.moneyFlow.searchAccounts")}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
					<ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
						{data.accounts
							.filter((account) => matchesSearch(account.name, query))
							.map((account) => (
								<li key={account.id}>
									<label className="flex cursor-pointer items-center gap-2 rounded-md p-1.5 hover:bg-hover">
										<Checkbox
											checked={ticked.has(account.id)}
											onCheckedChange={(checked) =>
												setTicked((current) => {
													const next = new Set(current);

													if (checked === true) {
														next.add(account.id);
													} else {
														next.delete(account.id);
													}

													return next;
												})
											}
										/>
										<span className="truncate text-sm">{account.name}</span>
									</label>
								</li>
							))}
					</ul>
					<Button type="submit" className="w-full">
						{t("dashboard.moneyFlow.apply")}
					</Button>
				</form>
			</PopoverContent>
		</Popover>
	);
}

/** A row of the month picked's summary, opening its income or expenses in « Opérations ». */
function FlowRow({
	direction,
	data,
	accounts,
}: {
	direction: "income" | "expense";
	data: MoneyFlowData;
	accounts: string[] | undefined;
}) {
	const { t } = useTranslation();
	const income = direction === "income";
	const amount = toMinorUnits(Math.abs(income ? data.income : data.expenses));

	return (
		<Link
			to="/transactions"
			search={{
				direction: [direction],
				status: ["confirmed"],
				from: data.from,
				to: data.to,
				...(accounts === undefined ? {} : { account: accounts }),
			}}
			className="group flex items-center justify-between rounded-lg border p-3 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
		>
			<span className="flex items-center gap-2 text-sm">
				<span
					aria-hidden="true"
					className="size-2.5 rounded-full"
					style={{ backgroundColor: income ? FLOW_COLOURS.income : FLOW_COLOURS.muted }}
				/>
				{t(income ? "dashboard.moneyFlow.income" : "dashboard.moneyFlow.expenses")}
			</span>
			<span className="flex items-center gap-2">
				<Money
					amount={amount}
					currency={data.currency}
					className={cn("text-sm", income && "text-money-income")}
				/>
				<ChevronRightIcon
					aria-hidden="true"
					className="size-4 text-muted-foreground group-hover:text-foreground"
				/>
			</span>
		</Link>
	);
}

/**
 * Sure's `money_flow`, « Entrées / sorties d'argent »: its own month, apart
 * from the dashboard's period, and its own accounts, as six monthly bars of
 * gross income and expenses, then the month's balance and a row to each
 * side's transactions.
 */
export function MoneyFlowSection({
	month,
	accountIds,
	accounts,
	onMonthChange,
	onAccountsChange,
}: {
	month: string | undefined;
	accountIds: string[] | undefined;
	/** Every account, to tell when a row's list needs no account filter. */
	accounts: AccountListData;
	onMonthChange: (month: string) => void;
	onAccountsChange: (accountIds: string[] | undefined) => void;
}) {
	const { t } = useTranslation();
	const flow = useMoneyFlow(month, accountIds);
	const data = flow.data;
	const placeholder = flow.isPlaceholderData;
	const everyAccount = accounts.groups.flatMap((group) => group.accounts.map((each) => each.id));

	return (
		<Section title={t("dashboard.moneyFlow.title")}>
			{flow.isPending && <Skeleton className="m-4 h-72" aria-hidden="true" />}

			{flow.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 p-4">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(flow.error)}`)}</p>
					<Button variant="outline" onClick={() => void flow.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{data !== undefined && (
				<div
					className={cn("flex flex-col gap-4 p-4", placeholder && "opacity-60")}
					inert={placeholder}
					aria-busy={placeholder}
				>
					<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
						<p className="text-sm text-muted-foreground">
							{t("dashboard.moneyFlow.dateRange", {
								startDate: longDate(data.from),
								endDate: longDate(data.to),
							})}
						</p>
						<div className="flex items-center gap-2">
							<DashboardMonthPicker
								month={data.month}
								hint={t("dashboard.moneyFlow.periodScopeHint")}
								onPick={onMonthChange}
							/>
							<AccountFilter
								key={data.accountIds?.join() ?? ""}
								data={data}
								onApply={onAccountsChange}
							/>
						</div>
					</div>

					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-4 px-1 text-xs text-muted-foreground">
							<div className="flex items-center gap-4">
								<span className="flex items-center gap-1.5">
									<span
										aria-hidden="true"
										className="size-2 rounded-full"
										style={{ backgroundColor: FLOW_COLOURS.income }}
									/>
									{t("dashboard.moneyFlow.income")}
								</span>
								<span className="flex items-center gap-1.5">
									<span
										aria-hidden="true"
										className="size-2 rounded-full"
										style={{ backgroundColor: FLOW_COLOURS.muted }}
									/>
									{t("dashboard.moneyFlow.expenses")}
								</span>
							</div>
							<span>{t("dashboard.moneyFlow.chartSpan", { months: data.bars.length })}</span>
						</div>
						<Suspense fallback={<div className="h-44" />}>
							<MoneyFlowChart data={data} />
						</Suspense>
					</div>

					<div className="flex flex-col gap-4">
						<p className="text-sm font-medium">{capitalised(monthLabel(data.month))}</p>
						<div className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground">{t("dashboard.moneyFlow.balance")}</span>
							<Money
								amount={data.balance}
								currency={data.currency}
								className={cn(
									"text-lg",
									data.balance < 0 && "text-destructive",
									data.balance > 0 && "text-money-income",
								)}
							/>
						</div>
						<FlowRow
							direction="income"
							data={data}
							accounts={drilldownAccounts(
								data.accountIds ?? data.accounts.map((each) => each.id),
								everyAccount,
							)}
						/>
						<FlowRow
							direction="expense"
							data={data}
							accounts={drilldownAccounts(
								data.accountIds ?? data.accounts.map((each) => each.id),
								everyAccount,
							)}
						/>
					</div>
				</div>
			)}
		</Section>
	);
}
