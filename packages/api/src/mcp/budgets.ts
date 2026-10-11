import type { BudgetCategoryLine, UncategorisedLine } from "../domain/budgets/categories.ts";
import type { IsoDate, IsoMonth } from "../domain/dates.ts";
import type { BudgetMonth } from "../services/budgets.ts";

import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { shiftMonth } from "@archant/data/months";

import { isBudgetMonth } from "../domain/budgets/months.ts";
import { daysBetween, today } from "../domain/dates.ts";
import { AppError } from "../lib/errors.ts";
import { budgetInput, monthParam, sureMonthOf, updateBudgetInput } from "../schemas/assistants.ts";
import { getBudget, isBudgetableMonth, updateBudget } from "../services/budgets.ts";
import { categoriesByRef, isUncategorisedName } from "../services/names.ts";
import {
	READ_ONLY,
	REPLACES,
	defineTool,
	formatMoney,
	formatted,
	percent,
	percentage,
	refuse,
	sureDecimalText,
} from "./tool.ts";

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

/** Sure's category payload, in its order. */
const categoryFields = {
	name: z.string(),
	budgeted: formatted(
		"The amount set for the month; a parent's includes what its own-amount subcategories hold, a shared subcategory shows its parent's",
	),
	actual: formatted("What it spent this month, net of refunds, never below zero"),
	available: formatted("What it has left, what came in from the month before included"),
	percent_spent: percent("actual over what it received, one decimal"),
	status,
	suggested_daily_spending: formatted("What it may spend each day left in the month")
		.optional()
		.describe("The current month only, while it has money left."),
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

const monthOutput = z.object({
	month: z.string().describe('Sure\'s slug, such as "aug-2026", which update_budget takes back.'),
	period: z.object({ start_date: z.string(), end_date: z.string() }),
	is_current: z.boolean(),
	initialized: z
		.boolean()
		.describe("false until the month has its planned spending and expected income."),
	totals: z.object({
		budgeted_spending: formatted("The month's planned spending, 0 until set up"),
		allocated_spending: formatted("The top-level categories' amounts, summed"),
		available_to_allocate: formatted("budgeted_spending less allocated_spending"),
		actual_spending: formatted("What the month spent, as get_income_statement counts it"),
		available_to_spend: formatted("budgeted_spending less actual_spending, negative once over"),
		percent_of_budget_spent: percent("actual_spending over budgeted_spending; 0 until set up"),
		overage_percent: percent("What went past budgeted_spending, over actual_spending; 0 within it"),
	}),
	income: z.object({
		expected_income: formatted("The month's expected income, 0 until set up"),
		actual_income: formatted("What the month earned, as get_income_statement counts it"),
		remaining_expected_income: formatted("expected_income less actual_income"),
	}),
	categories: z
		.array(categoryOutput)
		.describe("Every top-level expense category, by name, with its subcategories."),
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

function monthOf(budget: BudgetMonth, day: IsoDate): z.input<typeof monthOutput> {
	const money = (amount: MinorUnits) => formatMoney({ amount, currency: budget.currency });
	const isCurrent = day.slice(0, 7) === budget.month;
	// Today included, as Sure's `suggested_daily_spending` divides by the days left.
	const daysLeft = daysBetween(day, budget.to) + 1;
	// A missing amount counts 0, as Sure's `format_money(value || 0)`.
	const total = budget.budgetedSpending ?? toMinorUnits(0);
	const income = budget.expectedIncome ?? toMinorUnits(0);
	const spent = budget.actual.spending;
	const left = toMinorUnits(total - spent);
	const parentAmount = new Map(
		budget.categories.map((line) => [line.categoryId, line.budgetedSpending]),
	);
	const lineOf = (line: BudgetCategoryLine) => ({
		name: line.name,
		// Sure's `display_budgeted_spending`: a shared child shows its parent's amount.
		budgeted: money(
			line.shared && line.parentId !== null
				? (parentAmount.get(line.parentId) ?? toMinorUnits(0))
				: line.budgetedSpending,
		),
		actual: money(line.spent),
		available: money(line.available),
		percent_spent: percentage(line.percentSpent, 1),
		status: statusOf(line),
		...(isCurrent && line.available > 0
			? { suggested_daily_spending: money(toMinorUnits(Math.round(line.available / daysLeft))) }
			: {}),
	});

	return {
		month: monthParam(budget.month),
		period: { start_date: budget.from, end_date: budget.to },
		is_current: isCurrent,
		initialized: budget.setUp,
		totals: {
			budgeted_spending: money(total),
			allocated_spending: money(budget.allocated),
			available_to_allocate: money(toMinorUnits(total - budget.allocated)),
			actual_spending: money(spent),
			available_to_spend: money(left),
			percent_of_budget_spent: percentage(budget.setUp && total > 0 ? (spent / total) * 100 : 0, 1),
			overage_percent: percentage(left < 0 ? (Math.abs(left) / spent) * 100 : 0, 1),
		},
		income: {
			expected_income: money(income),
			actual_income: money(budget.actual.income),
			remaining_expected_income: money(toMinorUnits(income - budget.actual.income)),
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
	};
}

export const getBudgetTool = defineTool({
	name: "get_budget",
	title: "Budget",
	description:
		"Sure's get_budget: a calendar month's budget as the budget page shows it, and up to eleven months before it: the totals planned, allocated, spent and left, the income expected and earned, and each expense category with its subcategories, its amount, spending, what it has left and its status. Amounts are in the reporting currency and count the accounts the income statement counts; an account in another currency is left out until exchange rates exist. A month not set up shows 0 for what it plans; months before the first one a budget can cover are left out and counted in months_unavailable.",
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
			},
			changedRows: 0,
		};
	},
});

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/**
 * Sure's `MonthResolvable`: "YYYY-MM" or "MMM-YYYY", the current month when
 * blank; anything else refused with Sure's `invalid_params`.
 */
function monthOfParam(raw: string | undefined, day: IsoDate): IsoMonth {
	if (raw === undefined || raw.trim() === "") {
		return day.slice(0, 7);
	}

	const month = sureMonthOf(raw);

	if (month === null) {
		refuse("invalid_params", `Invalid month: ${raw}. Use YYYY-MM or MMM-YYYY.`);
	}

	return month;
}

/** Sure's `parse_amount!`: a non-negative number, as decimal text for `updateBudget`. */
function amountText(value: string | number, label: string): string {
	const text = sureDecimalText(value);

	if (text === null || text.startsWith("-")) {
		refuse("invalid_params", `${label} must be a non-negative number.`);
	}

	return text;
}

/** `updateBudget`'s field names as the tool's. */
const FIELD_NAMES: Readonly<Record<string, string>> = {
	budgetedSpending: "budgeted_spending",
	expectedIncome: "expected_income",
	categoryId: "category",
	budgeted: "amount",
};

/**
 * What `updateBudget` refuses beyond Sure, a month not set up, a category
 * twice or more decimals than the currency holds, as Sure's
 * `validation_failed`, each field under the tool's name for it.
 */
async function asValidationFailed<Answer>(write: Promise<Answer>): Promise<Answer> {
	try {
		return await write;
	} catch (error) {
		if (
			error instanceof AppError &&
			(error.code === "VALIDATION_ERROR" || error.code === "BUDGET_NOT_SET_UP")
		) {
			const fields = (error.fields ?? []).map(({ path, code }) => {
				const named = path
					.split(".")
					.map((segment) => FIELD_NAMES[segment] ?? segment)
					.join(".");

				return named === "" ? code : `${named} ${code}`;
			});

			refuse(
				"validation_failed",
				fields.length === 0
					? error.message
					: [error.message.replace(/\.$/u, ""), ...fields].join("; "),
			);
		}

		throw error;
	}
}

export const updateBudgetTool = defineTool({
	name: "update_budget",
	title: "Set a budget",
	description:
		"Sure's update_budget: sets a month's planned spending, expected income and expense category amounts, as the budget page does, in one write: a refusal anywhere changes nothing. Call get_budget first for the current amounts and the category names. Amounts are non-negative numbers in the reporting currency. A category is named by its name, case aside, or its id; « Non catégorisé » is what budgeted_spending leaves unallocated and cannot be set. A field absent keeps its value; a month not set up needs both budgeted_spending and expected_income, and its categories need the month set up. Refusals answer Sure's keys in Sure's order: no_changes, invalid_params for the month, invalid_month, invalid_params for an amount or a category; what Archant refuses beyond Sure, validation_failed.",
	scope: "archant:write",
	annotations: REPLACES,
	fieldPaths: FIELD_NAMES,
	input: updateBudgetInput,
	output: z.object({
		success: z.literal(true),
		month: z.string().describe('Sure\'s slug, such as "aug-2026".'),
		totals: z.object({
			budgeted_spending: formatted("The month's planned spending"),
			expected_income: formatted("The month's expected income"),
			allocated_spending: formatted("The top-level categories' amounts, summed"),
			available_to_allocate: formatted("budgeted_spending less allocated_spending"),
		}),
		updated_categories: z
			.array(
				z.object({
					category: z.string().describe("Its name."),
					budgeted_spending: formatted(
						"Its amount now; a parent's includes its own-amount subcategories",
					),
				}),
			)
			.describe("Subcategories first, then parents, as Sure writes them."),
		message: z.string(),
	}),
	run: async (deps, input) => {
		const entries = input.categories ?? [];

		if (
			input.budgeted_spending === undefined &&
			input.expected_income === undefined &&
			entries.length === 0
		) {
			refuse(
				"no_changes",
				"Provide at least one of budgeted_spending, expected_income, or categories.",
			);
		}

		const month = monthOfParam(input.month, today(deps.timeZone));

		if (!(await isBudgetableMonth(deps, month))) {
			refuse(
				"invalid_month",
				"No budget exists (or can be created) for that month — it is outside the valid budget range.",
			);
		}

		const budgetedSpending =
			input.budgeted_spending === undefined
				? undefined
				: amountText(input.budgeted_spending, "budgeted_spending");
		const expectedIncome =
			input.expected_income === undefined
				? undefined
				: amountText(input.expected_income, "expected_income");
		const found = await categoriesByRef(
			deps,
			entries.map((entry) => entry.category ?? ""),
		);
		const changes = entries.map((entry) => {
			const ref = (entry.category ?? "").trim();

			if (ref === "") {
				refuse("invalid_params", "Each categories entry needs a category name or id.");
			}

			const category = found.get(entry.category ?? "");

			if (category === undefined) {
				refuse(
					"invalid_params",
					isUncategorisedName(ref)
						? `'${ref}' is the unallocated remainder of budgeted_spending and cannot be set directly. Adjust budgeted_spending or category amounts instead.`
						: `Category '${ref}' not found. Use get_categories to list categories.`,
				);
			}

			// Budgets hold expense categories only: an income category has no row.
			if (category.kind !== "expense") {
				refuse(
					"invalid_params",
					`No budget row exists for category '${category.name}' in ${monthParam(month)}.`,
				);
			}

			return { category, amount: amountText(entry.amount, `amount for '${category.name}'`) };
		});
		const budget = await asValidationFailed(
			updateBudget(deps, month, {
				budgetedSpending,
				expectedIncome,
				categories:
					entries.length === 0
						? undefined
						: changes.map(({ category, amount }) => ({
								categoryId: category.id,
								budgeted: amount,
							})),
			}),
		);
		const money = (amount: MinorUnits) => formatMoney({ amount, currency: budget.currency });
		const total = budget.budgetedSpending ?? toMinorUnits(0);
		const written = [
			...changes.filter(({ category }) => category.parentId !== null),
			...changes.filter(({ category }) => category.parentId === null),
		];
		const [year = "", number = ""] = month.split("-");

		return {
			result: {
				success: true as const,
				month: monthParam(budget.month),
				totals: {
					budgeted_spending: money(total),
					expected_income: money(budget.expectedIncome ?? toMinorUnits(0)),
					allocated_spending: money(budget.allocated),
					available_to_allocate: money(toMinorUnits(total - budget.allocated)),
				},
				updated_categories: written.map(({ category }) => ({
					category: category.name,
					budgeted_spending: money(
						budget.categories.find((line) => line.categoryId === category.id)?.budgetedSpending ??
							toMinorUnits(0),
					),
				})),
				message: `Budget for ${MONTH_NAMES[Number(number) - 1]} ${year} updated.`,
			},
			changedRows:
				(budgetedSpending !== undefined || expectedIncome !== undefined ? 1 : 0) + entries.length,
		};
	},
});
