import type { Status } from "@/components/StatusBadge";
import type { BudgetCategoryData, BudgetData, UncategorisedData } from "@/hooks/useBudget";

import { Link } from "@tanstack/react-router";
import { CornerDownRightIcon, Settings2Icon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { MinorUnits } from "@archant/data/money";
import { formatMoney, toMinorUnits } from "@archant/data/money";

import { BudgetCategorySheet } from "@/components/BudgetCategorySheet";
import { InsetGroup } from "@/components/InsetGroup";
import { Money } from "@/components/Money";
import { Section } from "@/components/Section";
import { StatusBadge } from "@/components/StatusBadge";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/** The filter's values in the URL; « Toutes » is the absent one. */
export const BUDGET_FILTERS = ["over-budget", "on-track"] as const;

export type BudgetFilter = (typeof BUDGET_FILTERS)[number];

type CardSection = NonNullable<BudgetCategoryData["section"]>;

const SECTION_OF_FILTER = { "over-budget": "over", "on-track": "onTrack" } as const;

const BADGE_OF: Record<BudgetCategoryData["status"], Status> = {
	over: "budgetOver",
	near: "budgetNear",
	onTrack: "budgetOnTrack",
};

/** What a card or the sheet shows: a category's envelope, or « Sans catégorie »'s. */
export type Envelope =
	| { kind: "category"; line: BudgetCategoryData }
	| { kind: "uncategorised"; line: UncategorisedData };

const keyOf = (envelope: Envelope) =>
	envelope.kind === "category" ? envelope.line.categoryId : "uncategorised";

/**
 * Sure's `_budget_category`: the category, its status, a bar of what it
 * spent against its budget, then spent, budgeted and what is left or by how
 * much it went over. In « Dépassées », an envelope with no money of its own
 * hides its budget, as Sure's `show_budget_meta`. The whole card opens the
 * category's sheet. No hover fill: the « Dépassé » badge keeps its contrast
 * only on the card's own surfaces.
 */
function BudgetCard({
	envelope,
	name,
	currency,
	section,
	indented,
	onOpen,
}: {
	envelope: Envelope;
	name: string;
	currency: string;
	section: CardSection;
	indented: boolean;
	onOpen: () => void;
}) {
	const { t } = useTranslation();
	const { line } = envelope;
	const shared = envelope.kind === "category" && envelope.line.shared;
	const rolledOver = envelope.kind === "category" ? envelope.line.rolledOver : toMinorUnits(0);
	const showBudget = section === "onTrack" || line.budgeted;
	const money = (amount: MinorUnits) => <Money amount={amount} currency={currency} />;

	return (
		<li className="flex items-start">
			{indented && (
				<CornerDownRightIcon
					aria-hidden="true"
					className="mt-6 ml-8 size-4 shrink-0 text-muted-foreground"
				/>
			)}
			<button
				type="button"
				data-slot="budget-card"
				className="group flex min-w-0 flex-1 flex-col gap-3 px-4 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
				onClick={onOpen}
			>
				<span className="flex w-full items-center gap-2">
					<TintedIcon
						size="lg"
						subject={
							envelope.kind === "category"
								? { kind: "category", color: envelope.line.color, icon: envelope.line.icon }
								: { kind: "uncategorised" }
						}
					/>
					<span className="min-w-0 flex-1 truncate font-medium group-hover:underline">{name}</span>
					<StatusBadge status={BADGE_OF[line.status]} />
				</span>
				<span
					aria-hidden="true"
					className="block h-1.5 w-full overflow-hidden rounded-full bg-inset"
				>
					<span
						className={cn(
							"block h-full rounded-full",
							line.status === "over"
								? "bg-destructive"
								: line.status === "near"
									? "bg-warning"
									: "bg-foreground",
						)}
						style={{ width: `${Math.min(line.percentSpent, 100)}%` }}
					/>
				</span>
				<span className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-sm">
					<span className="whitespace-nowrap">
						<span className="text-muted-foreground">{t("budgets.categories.spentLabel")}</span>
						{money(line.spent)}
					</span>
					{showBudget && (
						<span className="whitespace-nowrap">
							<span className="text-muted-foreground">{t("budgets.categories.budgetedLabel")}</span>
							{shared ? (
								<span className="font-medium">{t("budgets.categories.shared")}</span>
							) : (
								money(line.budgetedSpending)
							)}
						</span>
					)}
					{showBudget && rolledOver > 0 && (
						<span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
							{t("budgets.rollover.card", {
								amount: formatMoney({ amount: rolledOver, currency }),
							})}
						</span>
					)}
					<span className="whitespace-nowrap lg:ml-auto">
						{line.available >= 0 ? (
							<>
								<span className="text-muted-foreground">{t("budgets.categories.leftLabel")}</span>
								<Money
									amount={line.available}
									currency={currency}
									className={cn(line.status === "near" && "text-warning")}
								/>
							</>
						) : (
							<>
								<span className="text-muted-foreground">{t("budgets.categories.overByLabel")}</span>
								<Money
									amount={toMinorUnits(Math.abs(line.available))}
									currency={currency}
									className="text-destructive"
								/>
							</>
						)}
					</span>
				</span>
			</button>
		</li>
	);
}

/**
 * Sure's « Catégories » card of a month set up: « Dépassées » first when a
 * card is over, then « Dans les clous », parents by name with their children
 * indented under them, « Sans catégorie » last. A category neither budgeted
 * nor spending is hidden. The filter shows only when a card is over; its
 * choice lives in `?filter=`.
 */
export function BudgetCategories({
	budget,
	filter,
	onFilterChange,
}: {
	budget: BudgetData;
	filter: BudgetFilter | undefined;
	onFilterChange: (filter: BudgetFilter | undefined) => void;
}) {
	const { t } = useTranslation();
	// The sheet keeps the last card it opened while it slides out.
	const [opened, setOpened] = useState<string | null>(null);
	const [sheetOpen, setSheetOpen] = useState(false);
	const uncategorisedName = t("dashboard.cashFlow.uncategorised");
	const envelopes: Envelope[] = [
		...budget.categories.map((line): Envelope => ({ kind: "category", line })),
		{ kind: "uncategorised", line: budget.uncategorised },
	];
	const nameOf = (envelope: Envelope) =>
		envelope.kind === "category" ? envelope.line.name : uncategorisedName;
	const anyOver = envelopes.some((envelope) => envelope.line.section === "over");
	const shownSection = anyOver && filter !== undefined ? SECTION_OF_FILTER[filter] : null;
	const openedEnvelope = envelopes.find((envelope) => keyOf(envelope) === opened) ?? null;

	const group = (section: CardSection) => {
		const members = envelopes.filter((envelope) => envelope.line.section === section);
		const shown = new Set(members.map(keyOf));

		if (members.length === 0 || (shownSection !== null && shownSection !== section)) {
			return null;
		}

		const title = t(section === "over" ? "budgets.categories.over" : "budgets.categories.onTrack");

		return (
			<InsetGroup
				level={3}
				title={title}
				count={members.length}
				countLabel={t("budgets.categories.count", { count: members.length })}
			>
				<ul aria-label={title} className="flex flex-col divide-y divide-line">
					{members.map((envelope) => (
						<BudgetCard
							key={keyOf(envelope)}
							envelope={envelope}
							name={nameOf(envelope)}
							currency={budget.currency}
							section={section}
							// Indented under its parent only when the parent shows here too.
							indented={
								envelope.kind === "category" &&
								envelope.line.parentId !== null &&
								shown.has(envelope.line.parentId)
							}
							onOpen={() => {
								setOpened(keyOf(envelope));
								setSheetOpen(true);
							}}
						/>
					))}
				</ul>
			</InsetGroup>
		);
	};

	const over = group("over");
	const onTrack = group("onTrack");

	return (
		<Section
			title={t("budgets.categories.title")}
			action={
				<div className="flex flex-wrap items-center gap-2">
					{anyOver && (
						<ToggleGroup
							type="single"
							variant="outline"
							size="sm"
							spacing={0}
							aria-label={t("budgets.categories.filter.label")}
							value={filter ?? "all"}
							// Radix reports an empty value when the pressed item is pressed again.
							onValueChange={(value) => {
								if (value === "all") {
									onFilterChange(undefined);
								} else if (value === "over-budget" || value === "on-track") {
									onFilterChange(value);
								}
							}}
						>
							<ToggleGroupItem value="all">{t("budgets.categories.filter.all")}</ToggleGroupItem>
							<ToggleGroupItem value="over-budget">
								{t("budgets.categories.filter.over")}
							</ToggleGroupItem>
							<ToggleGroupItem value="on-track">
								{t("budgets.categories.filter.onTrack")}
							</ToggleGroupItem>
						</ToggleGroup>
					)}
					<Button variant="outline" size="sm" asChild>
						<Link
							to="/budgets/$month/categories"
							params={{ month: budget.month }}
							aria-label={t("budgets.categories.editLabel")}
						>
							<Settings2Icon aria-hidden="true" />
							{t("budgets.categories.edit")}
						</Link>
					</Button>
				</div>
			}
		>
			<div className="flex flex-col gap-4 p-4">
				{over}
				{onTrack}
				{!envelopes.some((envelope) => envelope.line.section !== null) && (
					<p className="text-sm text-muted-foreground">{t("budgets.categories.empty")}</p>
				)}
			</div>
			{openedEnvelope !== null && (
				<BudgetCategorySheet
					budget={budget}
					envelope={openedEnvelope}
					name={nameOf(openedEnvelope)}
					open={sheetOpen}
					onOpenChange={setSheetOpen}
				/>
			)}
		</Section>
	);
}
