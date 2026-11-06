import type { ReportsPageData } from "@/hooks/useReportsPage";
import type { TintSubject } from "@/lib/tint";

import { Link } from "@tanstack/react-router";
import {
	ChevronDownIcon,
	ChevronUpIcon,
	CornerDownRightIcon,
	DownloadIcon,
	TrendingDownIcon,
	TrendingUpIcon,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { UNCATEGORISED } from "@archant/api/schemas/transactions";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { Money } from "@/components/Money";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import { useCategories } from "@/hooks/useCategories";
import { formatTenthPercent } from "@/lib/percent";
import { shareOf } from "@/lib/reports";
import { cn } from "@/lib/utils";

type Breakdown = ReportsPageData["breakdown"];
type Group = Breakdown["income"][number];
type Line = Omit<Group, "subcategories">;
type Side = keyof Breakdown;
type Sort = "asc" | "desc";

/** Sure's `Category.other_investments`: its colour and icon. */
const OTHER_INVESTMENTS: TintSubject = { kind: "category", color: "#e99537", icon: "trending-up" };

function subjectOf(line: Line): TintSubject {
	if (line.kind === "other_investments") {
		return OTHER_INVESTMENTS;
	}

	return line.color === null || line.icon === null
		? { kind: "uncategorised" }
		: { kind: "category", color: line.color, icon: line.icon };
}

function useLineName() {
	const { t } = useTranslation();

	return (line: Line) =>
		line.kind === "uncategorized"
			? t("reports.breakdown.uncategorized")
			: line.kind === "other_investments"
				? t("reports.breakdown.otherInvestments")
				: (line.name ?? "");
}

const bySort = (sort: Sort) => (a: Line, b: Line) =>
	sort === "asc" ? a.total - b.total : b.total - a.total;

/** Sure's `_category_row`: a category, its share of its side, and a link to its rows. */
function CategoryRow({
	line,
	filter,
	sideTotal,
	sub,
	period,
	currency,
	side,
}: {
	line: Line;
	/** The categories its link filters on: a parent's sub-categories with it, as Sure's `apply_category_filter`. */
	filter: string[];
	sideTotal: MinorUnits;
	sub: boolean;
	period: ReportsPageData["period"];
	currency: string;
	side: Side;
}) {
	const { t } = useTranslation();
	const nameOf = useLineName();
	const name = nameOf(line);

	return (
		<tr className="text-sm text-muted-foreground">
			<td className={cn("px-4 py-3 lg:px-6", sub && "pl-7 lg:pl-9")}>
				<div className="flex items-center gap-2">
					{sub && (
						<CornerDownRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
					)}
					<TintedIcon subject={subjectOf(line)} />
					{/* `/transactions` lists transactions only: a trade-only row has nowhere to lead. */}
					{line.hasTransactions ? (
						<Link
							to="/transactions"
							search={{
								category: filter,
								from: period.from,
								to: period.to,
							}}
							className="font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
						>
							{name}
						</Link>
					) : (
						<span className="font-medium text-foreground">{name}</span>
					)}
					<span className="text-xs whitespace-nowrap text-muted-foreground">
						({t("reports.breakdown.entries", { count: line.count })})
					</span>
				</div>
			</td>
			<td className="px-4 py-3 text-right lg:px-6">
				<Money
					amount={line.total}
					currency={currency}
					className={cn("font-normal", side === "income" ? "text-money-income" : "text-foreground")}
				/>
			</td>
			<td className="px-4 py-3 text-right tabular-nums lg:px-6">
				{formatTenthPercent(shareOf(line.total, sideTotal, 1))}
			</td>
		</tr>
	);
}

/** Sure's `_breakdown_table`: one side, its total, its categories sorted by amount. */
function SideTable({
	side,
	groups,
	sort,
	onSort,
	period,
	currency,
}: {
	side: Side;
	groups: readonly Group[];
	sort: Sort | null;
	onSort: () => void;
	period: ReportsPageData["period"];
	currency: string;
}) {
	const { t } = useTranslation();
	const total = toMinorUnits(groups.reduce((sum, group) => sum + group.total, 0));
	const title = t(side === "income" ? "reports.breakdown.income" : "reports.breakdown.expense");
	const Icon = side === "income" ? TrendingUpIcon : TrendingDownIcon;
	const order = bySort(sort ?? "desc");
	const categories = useCategories();
	// Every sub-category of the parent, those without a row on this side too;
	// the ones listed while the list loads.
	const filterOf = (group: Group) =>
		group.categoryId === null
			? [UNCATEGORISED]
			: [
					group.categoryId,
					...new Set([
						...group.subcategories.flatMap((sub) =>
							sub.categoryId === null ? [] : [sub.categoryId],
						),
						...(categories.data ?? [])
							.filter((category) => category.parentId === group.categoryId)
							.map((category) => category.id),
					]),
				];

	return (
		<div className="flex flex-col gap-4">
			<h3 className="flex items-center gap-2 text-lg">
				<Icon aria-hidden="true" className="size-5" />
				<span>{title}</span>
				<Money
					amount={total}
					currency={currency}
					className={side === "income" ? "text-money-income" : "text-muted-foreground"}
				/>
			</h3>
			<div className="overflow-x-auto rounded-xl bg-inset p-1">
				<div className="overflow-hidden rounded-lg border bg-card">
					<table aria-label={title} className="w-full">
						<thead className="bg-inset text-xs text-muted-foreground uppercase">
							<tr>
								<th scope="col" className="px-4 py-2 text-left font-medium">
									{t("reports.breakdown.category")}
								</th>
								<th
									scope="col"
									aria-sort={
										sort === null ? undefined : sort === "asc" ? "ascending" : "descending"
									}
									className="px-4 py-2 text-right font-medium"
								>
									<button
										type="button"
										onClick={onSort}
										className="inline-flex items-center gap-1 rounded-sm uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
									>
										{t("reports.breakdown.amount")}
										{sort === "desc" && <ChevronDownIcon aria-hidden="true" className="size-3" />}
										{sort === "asc" && <ChevronUpIcon aria-hidden="true" className="size-3" />}
									</button>
								</th>
								<th scope="col" className="px-4 py-2 text-right font-medium">
									{t("reports.breakdown.percentage")}
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-line">
							{groups
								.toSorted(order)
								.flatMap((group) => [
									<CategoryRow
										key={`${group.kind}-${group.categoryId}`}
										line={group}
										filter={filterOf(group)}
										sideTotal={total}
										sub={false}
										period={period}
										currency={currency}
										side={side}
									/>,
									...group.subcategories
										.toSorted(order)
										.map((sub) => (
											<CategoryRow
												key={`sub-${sub.categoryId}`}
												line={sub}
												filter={[sub.categoryId ?? UNCATEGORISED]}
												sideTotal={total}
												sub
												period={period}
												currency={currency}
												side={side}
											/>
										)),
								])}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

/**
 * Sure's `_transactions_breakdown`: income then expenses by category, « Montant »
 * sorting both ways, the entry count, and the « CSV » export of the period.
 */
export function ActivityBreakdown({
	data,
	csvHref,
}: {
	data: Pick<ReportsPageData, "breakdown" | "period" | "currency">;
	csvHref: string;
}) {
	const { t } = useTranslation();
	const [sort, setSort] = useState<Sort | null>(null);
	const { breakdown, period, currency } = data;
	const groups = [...breakdown.income, ...breakdown.expense];
	const count = groups.reduce((sum, group) => sum + group.count, 0);
	const toggleSort = () => setSort(sort === "desc" ? "asc" : "desc");

	return (
		<div className="flex flex-col gap-4">
			{groups.length === 0 ? (
				<p className="py-8 text-center text-muted-foreground">
					{t("reports.breakdown.noTransactions")}
				</p>
			) : (
				<>
					<div className="flex flex-col gap-8">
						{(["income", "expense"] as const).map(
							(side) =>
								breakdown[side].length > 0 && (
									<SideTable
										key={side}
										side={side}
										groups={breakdown[side]}
										sort={sort}
										onSort={toggleSort}
										period={period}
										currency={currency}
									/>
								),
						)}
					</div>
					<p className="text-xs text-muted-foreground">
						{t("reports.breakdown.showing", { count })}
					</p>
				</>
			)}
			<div className="flex justify-end">
				{/* A plain link: the browser saves the file under the server's name. */}
				<Button variant="outline" asChild>
					<a href={csvHref} download>
						<DownloadIcon aria-hidden="true" />
						{t("reports.breakdown.csv")}
					</a>
				</Button>
			</div>
		</div>
	);
}
