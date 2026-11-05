import type { DashboardCashFlowData } from "@/hooks/useDashboardCashFlow";

import { Link, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";

import { UNCATEGORISED } from "@archant/api/schemas/transactions";
import { toMinorUnits } from "@archant/data/money";

import { Money } from "@/components/Money";
import { Section } from "@/components/Section";
import { TintedIcon } from "@/components/TintedIcon";
import { formatMoney } from "@/lib/format-money";
import { intlLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

type ExpenseLine = DashboardCashFlowData["lines"]["expense"][number];

/** Sure's weights, `ct.weight.round(1)`. */
const shareFormat = new Intl.NumberFormat(intlLocale, {
	style: "percent",
	maximumFractionDigits: 1,
});

/** Sure's ring sits in a 300 px box; a card of the dashboard's column leaves a little less. */
const DONUT_SIZE = 260;

// Recharts weighs more than the rest of the dashboard: the ring arrives after
// the figures, in a box of its own size.
const CashFlowChart = lazy(async () => ({
	default: (await import("@/components/CashFlowChart")).CashFlowChart,
}));

const keyOf = (line: ExpenseLine) => line.categoryId ?? UNCATEGORISED;

/** Sure's `Category::UNCATEGORIZED_COLOR`, as the Sankey draws « Sans catégorie ». */
const UNCATEGORISED_COLOR = "#737373";

/**
 * Sure's `outflows_donut`: the period's net expense lines as a ring, their
 * total in its centre, then one row per line, largest first, each opening
 * its transactions of the period. Hovering a segment or a row names it in
 * the centre and dims the others. Not shown without a net expense line, as
 * Sure's `visible`.
 */
export function OutflowsDonut({
	data,
	placeholder,
}: {
	data: DashboardCashFlowData;
	/** The previous period's lines, shown while the next loads. */
	placeholder: boolean;
}) {
	const { t } = useTranslation();
	const [highlighted, setHighlighted] = useState<string | null>(null);
	const navigate = useNavigate();
	const lines = data.lines.expense;

	if (lines.length === 0) {
		return null;
	}

	const total = toMinorUnits(Math.abs(data.expenses));
	const shown = lines.find((line) => keyOf(line) === highlighted);
	const nameOf = (line: ExpenseLine) => line.name ?? t("dashboard.uncategorised");

	return (
		<Section title={t("dashboard.outflowsDonut.title")}>
			{/* The previous period's rows would open the wrong dates: visible, not clickable. */}
			<div
				className={cn("@container", placeholder && "opacity-60")}
				inert={placeholder}
				aria-busy={placeholder}
			>
				<div className="flex flex-col items-center gap-8 p-4 @2xl:flex-row">
					<div
						role="img"
						aria-label={t("dashboard.outflowsDonut.chart", {
							total: formatMoney({ amount: total, currency: data.currency }),
							count: lines.length,
						})}
						className="relative shrink-0"
						style={{ width: DONUT_SIZE, height: DONUT_SIZE }}
					>
						<Suspense fallback={<div style={{ width: DONUT_SIZE, height: DONUT_SIZE }} />}>
							<CashFlowChart
								segments={lines.map((line) => ({
									key: keyOf(line),
									value: Math.abs(line.amount),
									fill: line.color ?? UNCATEGORISED_COLOR,
								}))}
								size={DONUT_SIZE}
								thickness={15}
								highlighted={highlighted}
								onHighlight={setHighlighted}
								// A segment opens its rows, as its row below does.
								onSelect={(key) =>
									void navigate({
										to: "/transactions",
										search: { category: [key], from: data.from, to: data.to },
									})
								}
							/>
						</Suspense>
						<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
							{shown === undefined ? (
								<>
									<span className="text-sm text-muted-foreground">
										{t("dashboard.outflowsDonut.totalOutflows")}
									</span>
									<Money amount={total} currency={data.currency} className="text-3xl" />
								</>
							) : (
								<>
									<span className="max-w-40 truncate text-sm text-muted-foreground">
										{nameOf(shown)}
									</span>
									<Money
										amount={toMinorUnits(Math.abs(shown.amount))}
										currency={data.currency}
										className="text-3xl"
									/>
									<span className="text-sm text-muted-foreground tabular-nums">
										{shareFormat.format(shown.share ?? 0)}
									</span>
								</>
							)}
						</div>
					</div>

					<div className="w-full min-w-0 overflow-x-auto rounded-xl bg-inset p-1 @2xl:flex-1">
						<div className="flex items-center px-4 py-2 type-overline text-muted-foreground">
							<span>
								{t("dashboard.outflowsDonut.categories")}
								<span aria-hidden="true" className="mx-1">
									·
								</span>
								{lines.length}
							</span>
							<span className="ml-auto flex items-center gap-4 text-right">
								<span>{t("dashboard.outflowsDonut.value")}</span>
								<span className="w-14">{t("dashboard.outflowsDonut.weight")}</span>
							</span>
						</div>
						<ul
							aria-label={t("dashboard.outflowsDonut.title")}
							className="flex flex-col divide-y divide-line rounded-lg border bg-card text-sm font-medium"
						>
							{lines.map((line) => (
								<li key={keyOf(line)}>
									<Link
										to="/transactions"
										search={{
											// A net line holds both signs: its list shows every row it nets.
											category: [keyOf(line)],
											from: data.from,
											to: data.to,
										}}
										onMouseEnter={() => setHighlighted(keyOf(line))}
										onMouseLeave={() => setHighlighted(null)}
										onFocus={() => setHighlighted(keyOf(line))}
										onBlur={() => setHighlighted(null)}
										className="flex min-h-12 items-center justify-between gap-3 px-4 py-3 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
									>
										<span className="flex min-w-0 flex-1 items-center gap-3">
											<TintedIcon
												subject={
													line.color === null || line.icon === null
														? { kind: "uncategorised" }
														: { kind: "category", color: line.color, icon: line.icon }
												}
											/>
											<span className="truncate" title={nameOf(line)}>
												{nameOf(line)}
											</span>
										</span>
										<span className="flex shrink-0 items-center gap-4 text-right">
											<Money
												amount={toMinorUnits(Math.abs(line.amount))}
												currency={data.currency}
											/>
											<span className="w-14 text-muted-foreground tabular-nums">
												{shareFormat.format(line.share ?? 0)}
											</span>
										</span>
									</Link>
								</li>
							))}
						</ul>
					</div>
				</div>
			</div>
		</Section>
	);
}
