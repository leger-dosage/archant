import type { BudgetCategoryLine, UncategorisedLine } from "../domain/budgets/categories.ts";
import type { BudgetMonth } from "../services/budgets.ts";

import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { toDecimalString } from "@archant/data/money";
import { shiftMonth } from "@archant/data/months";

import { isBudgetMonth } from "../domain/budgets/months.ts";
import { today } from "../domain/dates.ts";
import { budgetInput, updateBudgetInput } from "../schemas/assistants.ts";
import { getBudget, updateBudget } from "../services/budgets.ts";
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
	status,
};

const categoryOutput = z.object({
	category_id: z.string(),
	parent_id: z.string().nullable().describe("The parent category's id; null for a top-level one."),
	name: z.string(),
	budgeted: decimal(
		"The amount set for the month; a parent's includes what its own-amount subcategories hold",
	),
	shared: z
		.boolean()
		.describe("A subcategory without an amount of its own, spending from its parent's."),
	carried: decimal("What the month before left it, counted in available but not in budgeted"),
	...envelopeFields,
	percent_spent: z.number().describe("actual over what it received, in percent, one decimal."),
	rollover_enabled: z
		.boolean()
		.describe("What it leaves at the month's end carries into the next month set up."),
});

const monthOutput = z.object({
	month: z.string(),
	from: z.string(),
	to: z.string(),
	currency: z.string(),
	initialized: z
		.boolean()
		.describe("false until the month has its planned spending and expected income."),
	budgeted_spending: decimal("The month's planned spending")
		.nullable()
		.describe("null until set up."),
	expected_income: decimal("The month's expected income").nullable().describe("null until set up."),
	allocated: decimal("The top-level categories' amounts, summed"),
	actual_spending: decimal("What the month spent, as get_income_statement counts it, positive"),
	actual_income: decimal("What the month earned, as get_income_statement counts it"),
	categories: z
		.array(categoryOutput)
		.describe("Every expense category, each parent followed by its subcategories."),
	uncategorised: z
		.object({
			budgeted: decimal("What budgeted_spending leaves unallocated, never stored"),
			...envelopeFields,
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

function monthOf(budget: BudgetMonth): z.input<typeof monthOutput> {
	const money = (amount: MinorUnits) => toDecimalString({ amount, currency: budget.currency });
	const categoryOf = (line: BudgetCategoryLine): z.input<typeof categoryOutput> => ({
		category_id: line.categoryId,
		parent_id: line.parentId,
		name: line.name,
		budgeted: money(line.budgetedSpending),
		shared: line.shared,
		carried: money(line.rolledOver),
		actual: money(line.spent),
		available: money(line.available),
		status: statusOf(line),
		percent_spent: Math.round(line.percentSpent * 10) / 10,
		rollover_enabled: line.rolloverEnabled,
	});

	return {
		month: budget.month,
		from: budget.from,
		to: budget.to,
		currency: budget.currency,
		initialized: budget.setUp,
		budgeted_spending: budget.budgetedSpending === null ? null : money(budget.budgetedSpending),
		expected_income: budget.expectedIncome === null ? null : money(budget.expectedIncome),
		allocated: money(budget.allocated),
		actual_spending: money(budget.actual.spending),
		actual_income: money(budget.actual.income),
		categories: budget.categories.map(categoryOf),
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
		"A calendar month's budget as the budget page shows it, and up to eleven months before it: the planned spending and expected income, what the month spent and earned, and each expense category's amount, spending, carried amount and status. Amounts are in the reporting currency and count the accounts the income statement counts. A month not set up has null amounts; months before the first one a budget can cover are left out.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: budgetInput,
	output: z.object({
		months: z.array(monthOutput).describe("Oldest first, month last."),
		...leftOutFields,
	}),
	run: async (deps, input) => {
		const month = input.month ?? today(deps.timeZone).slice(0, 7);
		const target = await getBudget(deps, month);
		const earlier = Array.from({ length: input.prior_months }, (_, index) =>
			shiftMonth(month, index - input.prior_months),
		).filter((item) => isBudgetMonth(item, target.bounds));
		const prior = await Promise.all(earlier.map(async (item) => getBudget(deps, item)));

		return {
			result: {
				months: [...prior, target].map(monthOf),
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
		"Sets a month's planned spending, expected income and expense category amounts, as the budget page does, in one write: a refusal anywhere changes nothing. A field absent keeps its value; a month not set up needs both budgeted_spending and expected_income, and its categories need the month set up. It answers the month as get_budget gives it.",
	scope: "archant:write",
	annotations: REPLACES,
	fieldPaths: { budgeted: "amount" },
	input: updateBudgetInput,
	output: monthOutput.extend(leftOutFields),
	run: async (deps, input) => {
		const budget = await updateBudget(deps, input.month, {
			budgetedSpending: input.budgeted_spending,
			expectedIncome: input.expected_income,
			categories: input.categories?.map((line) => ({
				categoryId: line.category_id,
				budgeted: line.amount,
			})),
		});
		const totals = input.budgeted_spending !== undefined || input.expected_income !== undefined;

		return {
			result: { ...monthOf(budget), ...leftOutOf(budget.leftOut) },
			changedRows: (totals ? 1 : 0) + (input.categories?.length ?? 0),
		};
	},
});
