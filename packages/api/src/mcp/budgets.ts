import type { BudgetCategoryLine, UncategorisedLine } from "../domain/budgets/categories.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { BudgetMonth } from "../services/budgets.ts";

import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { toDecimalString, toMinorUnits } from "@archant/data/money";
import { shiftMonth } from "@archant/data/months";

import { isBudgetMonth } from "../domain/budgets/months.ts";
import { daysBetween, today } from "../domain/dates.ts";
import { budgetInput, updateBudgetInput } from "../schemas/assistants.ts";
import { getBudget, updateBudget } from "../services/budgets.ts";
import { categoryIdsOf } from "../services/names.ts";
import { READ_ONLY, REPLACES, decimal, defineTool, leftOutFields, leftOutOf } from "./tool.ts";

/** Sure's `category_status`, which `GetBudget` gives each category. */
const BUDGET_STATUSES = [
	"over_budget",
	"near_limit",
	"on_track",
	"unbudgeted",
	"no_activity",
] as const;

const status = z
	.enum(BUDGET_STATUSES)
	.describe(
		'"over_budget": spent past what it received; "near_limit": 90 % spent or more; "on_track": below; "unbudgeted": spent without an amount; "no_activity": neither an amount nor spending.',
	);

const envelopeFields = {
	actual: decimal("What it spent this month, net of refunds, never below zero"),
	available: decimal("What it has left, negative once over"),
	percent_spent: z.number().describe("actual over what it received, in percent, one decimal."),
	status,
};

/** Sure's category payload, with the id update_budget takes and Archant's carry and switch. */
const categoryFields = {
	category_id: z.string(),
	name: z.string(),
	budgeted: decimal(
		"The amount set for the month; a parent's includes what its own-amount subcategories hold",
	),
	carried: decimal("What the month before left it, counted in available but not in budgeted"),
	...envelopeFields,
	suggested_daily_spending: decimal("What it may spend each day left in the month")
		.optional()
		.describe("The current month only, while it has money left."),
	rollover_enabled: z
		.boolean()
		.describe("What it leaves at the month's end carries into the next month set up."),
};

const categoryOutput = z.object({
	...categoryFields,
	color: z.string(),
	subcategories: z.array(
		z.object({
			...categoryFields,
			inherits_parent_budget: z
				.boolean()
				.describe("Without an amount of its own, it spends from its parent's."),
		}),
	),
});

const totalOf = (what: string) => decimal(what).nullable().describe("null until set up.");

const monthOutput = z.object({
	month: z.string(),
	period: z.object({ start_date: z.string(), end_date: z.string() }),
	is_current: z.boolean(),
	initialized: z
		.boolean()
		.describe("false until the month has its planned spending and expected income."),
	totals: z.object({
		budgeted_spending: totalOf("The month's planned spending"),
		allocated_spending: decimal("The top-level categories' amounts, summed"),
		available_to_allocate: totalOf("budgeted_spending less allocated_spending"),
		actual_spending: decimal("What the month spent, as get_income_statement counts it, positive"),
		available_to_spend: totalOf("budgeted_spending less actual_spending, negative once over"),
		percent_of_budget_spent: z
			.number()
			.describe("actual_spending over budgeted_spending, in percent, one decimal; 0 until set up."),
		overage_percent: z
			.number()
			.describe("How far past budgeted_spending, in percent; 0 within it."),
	}),
	income: z.object({
		expected_income: totalOf("The month's expected income"),
		actual_income: decimal("What the month earned, as get_income_statement counts it"),
		remaining_expected_income: totalOf("expected_income less actual_income"),
	}),
	categories: z
		.array(categoryOutput)
		.describe("Every top-level expense category, by name, with its subcategories."),
	uncategorised: z
		.object({
			budgeted: decimal("What budgeted_spending leaves unallocated, never stored"),
			actual: envelopeFields.actual,
			available: envelopeFields.available,
			status,
		})
		.describe(
			"« Sans catégorie »: the unallocated money against the spending without a category. It has no id: set it through budgeted_spending or the category amounts.",
		),
});

type Envelope = Pick<UncategorisedLine, "budgeted" | "spent" | "status">;

type BudgetStatus = (typeof BUDGET_STATUSES)[number];

const BUDGETED_STATUS: Record<Envelope["status"], BudgetStatus> = {
	over: "over_budget",
	near: "near_limit",
	onTrack: "on_track",
};

/** Sure's `category_status`, read from the envelope the page shows. */
function statusOf(envelope: Envelope): BudgetStatus {
	if (!envelope.budgeted) {
		return envelope.spent > 0 ? "unbudgeted" : "no_activity";
	}

	return BUDGETED_STATUS[envelope.status];
}

const oneDecimal = (value: number) => Math.round(value * 10) / 10;

function monthOf(budget: BudgetMonth, day: IsoDate): z.input<typeof monthOutput> {
	const money = (amount: MinorUnits) => toDecimalString({ amount, currency: budget.currency });
	const orNull = (amount: number | null) => (amount === null ? null : money(toMinorUnits(amount)));
	const isCurrent = day.slice(0, 7) === budget.month;
	// Today included, as Sure's `suggested_daily_spending` divides by the days left.
	const daysLeft = daysBetween(day, budget.to) + 1;
	const { budgetedSpending: total, expectedIncome: income } = budget;
	const spent = budget.actual.spending;
	const percent = total === null || total <= 0 ? 0 : (spent / total) * 100;
	const lineOf = (line: BudgetCategoryLine) => ({
		category_id: line.categoryId,
		name: line.name,
		budgeted: money(line.budgetedSpending),
		carried: money(line.rolledOver),
		actual: money(line.spent),
		available: money(line.available),
		percent_spent: oneDecimal(line.percentSpent),
		status: statusOf(line),
		...(isCurrent && line.available > 0
			? { suggested_daily_spending: money(toMinorUnits(Math.round(line.available / daysLeft))) }
			: {}),
		rollover_enabled: line.rolloverEnabled,
	});

	return {
		month: budget.month,
		period: { start_date: budget.from, end_date: budget.to },
		is_current: isCurrent,
		initialized: budget.setUp,
		totals: {
			budgeted_spending: orNull(total),
			allocated_spending: money(budget.allocated),
			available_to_allocate: orNull(total === null ? null : total - budget.allocated),
			actual_spending: money(spent),
			available_to_spend: orNull(total === null ? null : total - spent),
			percent_of_budget_spent: oneDecimal(percent),
			overage_percent: oneDecimal(Math.max(0, percent - 100)),
		},
		income: {
			expected_income: orNull(income),
			actual_income: money(budget.actual.income),
			remaining_expected_income: orNull(income === null ? null : income - budget.actual.income),
		},
		categories: budget.categories
			.filter((line) => line.parentId === null)
			.map((parent) => ({
				...lineOf(parent),
				color: parent.color,
				subcategories: budget.categories
					.filter((line) => line.parentId === parent.categoryId)
					.map((child) => ({ ...lineOf(child), inherits_parent_budget: child.shared })),
			})),
		uncategorised: {
			budgeted: money(budget.uncategorised.budgetedSpending),
			actual: money(budget.uncategorised.spent),
			available: money(budget.uncategorised.available),
			status: statusOf(budget.uncategorised),
		},
	};
}

export const getBudgetTool = defineTool({
	name: "get_budget",
	title: "Budget",
	description:
		"A calendar month's budget as the budget page shows it, and up to eleven months before it, in Sure's get_budget shape: the totals planned, allocated, spent and left, the income expected and earned, and each expense category with its subcategories, its amount, spending, carried amount and status. Amounts are in the reporting currency and count the accounts the income statement counts. A month not set up has null totals; months before the first one a budget can cover are left out and counted in months_unavailable.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: budgetInput,
	output: z.object({
		currency: z.string().describe("The reporting currency every amount is in."),
		months: z.array(monthOutput).describe("Oldest first, month last."),
		months_unavailable: z
			.number()
			.int()
			.optional()
			.describe("Earlier months asked for that no budget can cover; absent when none."),
		...leftOutFields,
	}),
	run: async (deps, input) => {
		const day = today(deps.timeZone);
		const month = input.month ?? day.slice(0, 7);
		const target = await getBudget(deps, month);
		const asked = Array.from({ length: input.prior_months }, (_, index) =>
			shiftMonth(month, index - input.prior_months),
		);
		const earlier = asked.filter((item) => isBudgetMonth(item, target.bounds));
		const prior = await Promise.all(earlier.map(async (item) => getBudget(deps, item)));
		const unavailable = asked.length - earlier.length;

		return {
			result: {
				currency: target.currency,
				months: [...prior, target].map((budget) => monthOf(budget, day)),
				...(unavailable > 0 ? { months_unavailable: unavailable } : {}),
				...leftOutOf(target.leftOut),
			},
			changedRows: 0,
		};
	},
});

export const updateBudgetTool = defineTool({
	name: "update_budget",
	title: "Set a budget",
	description:
		"Sets a month's planned spending, expected income and expense category amounts, as the budget page does, in one write: a refusal anywhere changes nothing. Call get_budget first for the current amounts and the category names. A category is named by its name, case aside, or its id, as Sure's update_budget takes it. A field absent keeps its value; a month not set up needs both budgeted_spending and expected_income, and its categories need the month set up. It answers the month's totals and each category it set, as Sure's update_budget does.",
	scope: "archant:write",
	annotations: REPLACES,
	fieldPaths: { budgeted: "amount", categoryId: "category" },
	input: updateBudgetInput,
	output: z.object({
		month: z.string(),
		currency: z.string(),
		totals: z.object({
			budgeted_spending: totalOf("The month's planned spending"),
			expected_income: totalOf("The month's expected income"),
			allocated_spending: decimal("The top-level categories' amounts, summed"),
			available_to_allocate: totalOf("budgeted_spending less allocated_spending"),
		}),
		updated_categories: z.array(
			z.object({
				category_id: z.string(),
				category: z.string().describe("Its name."),
				budgeted_spending: decimal(
					"Its amount now; a parent's includes its own-amount subcategories",
				),
			}),
		),
		...leftOutFields,
	}),
	run: async (deps, input) => {
		const month = input.month ?? today(deps.timeZone).slice(0, 7);
		const refs = await categoryIdsOf(
			deps,
			(input.categories ?? []).map((line) => line.category),
			{ caseInsensitive: true },
		);
		const budget = await updateBudget(deps, month, {
			budgetedSpending: input.budgeted_spending,
			expectedIncome: input.expected_income,
			categories: input.categories?.map((line) => ({
				// « Sans catégorie » reads as null, which the service refuses with its own code.
				categoryId: refs.has(line.category) ? (refs.get(line.category) ?? null) : line.category,
				budgeted: line.amount,
			})),
		});
		const money = (amount: MinorUnits) => toDecimalString({ amount, currency: budget.currency });
		const orNull = (amount: number | null) =>
			amount === null ? null : money(toMinorUnits(amount));
		const set = new Set(input.categories?.map((line) => refs.get(line.category)));
		const totals = input.budgeted_spending !== undefined || input.expected_income !== undefined;

		return {
			result: {
				month: budget.month,
				currency: budget.currency,
				totals: {
					budgeted_spending: orNull(budget.budgetedSpending),
					expected_income: orNull(budget.expectedIncome),
					allocated_spending: money(budget.allocated),
					available_to_allocate: orNull(
						budget.budgetedSpending === null ? null : budget.budgetedSpending - budget.allocated,
					),
				},
				updated_categories: budget.categories
					.filter((line) => set.has(line.categoryId))
					.map((line) => ({
						category_id: line.categoryId,
						category: line.name,
						budgeted_spending: money(line.budgetedSpending),
					})),
				...leftOutOf(budget.leftOut),
			},
			changedRows: (totals ? 1 : 0) + (input.categories?.length ?? 0),
		};
	},
});
