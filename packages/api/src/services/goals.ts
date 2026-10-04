import type { IsoDate } from "../domain/dates.ts";
import type { GoalLink, GoalProgress, SavedPoint } from "../domain/goals.ts";
import type { FieldError } from "../lib/errors.ts";
import type { GoalInput, GoalRequest, GoalTarget } from "../schemas/goals.ts";
import type { ServiceDeps } from "./deps.ts";

import { and, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";

import type { AccountType } from "@archant/data/account-types";
import type { CategoryColor, CategoryIcon } from "@archant/data/category-presets";
import type { GoalEvent, GoalKind, GoalState, GoalTargetMode } from "@archant/data/goals";
import { RELEASED_GOAL_STATES, canBackGoal, goalTransition } from "@archant/data/goals";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode, toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { goalAccounts, goals } from "@archant/data/schema/goals";

import { suggestions } from "../domain/budgets/actuals.ts";
import { minDate, today } from "../domain/dates.ts";
import {
	backingShares,
	compareGoals,
	goalProgress,
	goalSeries,
	goalsSummary,
	monthsOfExpenses,
	paceStart,
	targetAsRead,
} from "../domain/goals.ts";
import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import { goalSchema } from "../schemas/goals.ts";
import { balanceOn, balancesBetween, openingDateOf } from "./ledger/balances.ts";
import { getCashFlowHistory } from "./reports.ts";
import { getReportingCurrency } from "./settings.ts";

/** One linked account as a goal shows it. */
type GoalAccountShare = {
	accountId: string;
	name: string;
	type: AccountType;
	currency: string;
	/** The account's balance at the end of today. */
	balance: MinorUnits;
	/**
	 * `false` once deactivated: it then backs nothing, left out of the goal as
	 * it is out of its group's total, and the dialog no longer offers it.
	 */
	active: boolean;
	/** The fixed amount asked for, `null` for the whole balance. */
	allocatedAmount: MinorUnits | null;
	/** What the account backs for this goal, once the other goals on it have theirs. */
	share: MinorUnits;
};

export type GoalSummary = GoalProgress & {
	id: string;
	name: string;
	/** The target as read: for a reserve in months, the months times `monthlyExpenses`. */
	targetAmount: MinorUnits;
	targetMode: GoalTargetMode;
	/** How many months of expenses a reserve holds; `null` for a fixed target. */
	targetMonths: number | null;
	/**
	 * The median monthly expenses the target multiplies, in the reporting
	 * currency; `null` for a fixed target, and when the target last computed
	 * stands because there is no median to multiply.
	 */
	monthlyExpenses: MinorUnits | null;
	/** The currency of every amount here, its accounts'. */
	currency: string;
	targetDate: IsoDate | null;
	color: CategoryColor;
	icon: CategoryIcon;
	notes: string | null;
	state: GoalState;
	kind: GoalKind;
	/** When it was completed, in epoch milliseconds; kept once archived, `null` otherwise. */
	completedAt: number | null;
	/** By account name. */
	accounts: GoalAccountShare[];
};

type Db = ServiceDeps["db"];

const notFound = () => new AppError("NOT_FOUND", "No goal has this id.");

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

const RELEASED: readonly GoalState[] = RELEASED_GOAL_STATES;

/** An account's balance today, and on the day its 90-day pace starts from (AD-8). */
async function accountFigures(deps: ServiceDeps, accountId: string, date: IsoDate) {
	const [now, openingDate] = await Promise.all([
		balanceOn(deps, accountId, date),
		openingDateOf(deps, accountId),
	]);
	const before = await balanceOn(deps, accountId, paceStart(date, openingDate));

	return { now: now?.amount ?? toMinorUnits(0), before: before?.amount ?? toMinorUnits(0) };
}

/**
 * Every goal, every link with its account, and, by account, the links of the
 * goals that hold their money, which share its balance. Reads only.
 */
async function loadGoals(deps: ServiceDeps) {
	const [goalRows, linkRows] = await Promise.all([
		deps.db.select().from(goals),
		deps.db
			.select({
				goalId: goalAccounts.goalId,
				accountId: goalAccounts.accountId,
				allocatedAmount: goalAccounts.allocatedAmount,
				name: accounts.name,
				type: accounts.type,
				currency: accounts.currency,
				active: accounts.active,
			})
			.from(goalAccounts)
			.innerJoin(accounts, eq(accounts.id, goalAccounts.accountId)),
	]);
	const holding = new Set(
		goalRows.filter((goal) => !RELEASED.includes(goal.state)).map((goal) => goal.id),
	);
	const pool = new Map<string, GoalLink[]>();

	for (const row of linkRows) {
		if (holding.has(row.goalId)) {
			pool.set(row.accountId, [...(pool.get(row.accountId) ?? []), linkOf(row)]);
		}
	}

	/**
	 * The links `row`'s account balance is split among for its goal: a goal
	 * that released its money still reads what it would back beside the
	 * goals holding theirs.
	 */
	const competing = (row: LinkRow): GoalLink[] => {
		const shared = pool.get(row.accountId) ?? [];

		return holding.has(row.goalId) ? shared : [...shared, linkOf(row)];
	};

	return { goalRows, linkRows, competing };
}

type LinkRow = { goalId: string; accountId: string; allocatedAmount: number | null };

function linkOf(row: LinkRow): GoalLink {
	return {
		goalId: row.goalId,
		allocatedAmount: row.allocatedAmount === null ? null : toMinorUnits(row.allocatedAmount),
	};
}

/**
 * The household's median monthly expenses, as the budget suggests spending
 * (Story 17.1): every complete month before the current one in
 * `APP_TIMEZONE` that has an expense line, in the reporting currency (AD-9).
 * Reads only.
 */
async function monthlyExpenses(deps: ServiceDeps): Promise<MinorUnits | null> {
	const current = today(deps.timeZone).slice(0, 7);

	return suggestions(await getCashFlowHistory(deps, current), current, current).spending;
}

/**
 * Every goal with its figures, as Sure's `Goal.prepared_for`, sorted as its
 * list: active goals behind first, then paused, completed and archived ones.
 * Each goal reads its share of every account it links; a goal with a frozen
 * amount reads that instead, as Sure's `current_balance`. A reserve in
 * months of expenses reads its target from the median monthly expenses,
 * read only when such a reserve exists. Reads only.
 */
export async function listGoals(deps: ServiceDeps): Promise<GoalSummary[]> {
	const date = today(deps.timeZone);
	const { goalRows, linkRows, competing } = await loadGoals(deps);
	const expenses = {
		currency: getReportingCurrency(),
		median: goalRows.some((goal) => goal.targetMode === "months_of_expenses")
			? await monthlyExpenses(deps)
			: null,
	};
	const accountIds = [...new Set(linkRows.map((row) => row.accountId))];
	const figures = new Map(
		await Promise.all(
			accountIds.map(async (id) => [id, await accountFigures(deps, id, date)] as const),
		),
	);

	return goalRows
		.map((goal): GoalSummary => {
			const links = linkRows.filter((row) => row.goalId === goal.id);
			const shares = links.map((row): GoalAccountShare => {
				const { now } = figures.get(row.accountId) ?? { now: toMinorUnits(0) };

				return {
					accountId: row.accountId,
					name: row.name,
					type: row.type,
					currency: row.currency,
					balance: now,
					active: row.active,
					allocatedAmount: linkOf(row).allocatedAmount,
					// A deactivated account backs nothing, as it counts in no total.
					share: row.active
						? (backingShares(now, competing(row)).get(goal.id) ?? toMinorUnits(0))
						: toMinorUnits(0),
				};
			});
			const { targetAmount, monthlyExpenses: median } = targetAsRead(
				{ ...goal, targetAmount: toMinorUnits(goal.targetAmount) },
				expenses,
			);
			const progress = goalProgress({
				kind: goal.kind,
				target: targetAmount,
				saved: toMinorUnits(
					goal.completedAmount ?? shares.reduce((sum, account) => sum + account.share, 0),
				),
				targetDate: goal.targetDate,
				today: date,
				accounts: links.flatMap((row) => (row.active ? (figures.get(row.accountId) ?? []) : [])),
				completed: goal.state === "completed",
			});

			return {
				id: goal.id,
				name: goal.name,
				targetAmount,
				targetMode: goal.targetMode,
				targetMonths: goal.targetMonths,
				monthlyExpenses: median,
				currency: goal.currency,
				targetDate: goal.targetDate,
				color: goal.color,
				icon: goal.icon,
				notes: goal.notes,
				state: goal.state,
				kind: goal.kind,
				completedAt: goal.completedAt,
				...progress,
				accounts: shares.toSorted((a, b) => byName.compare(a.name, b.name)),
			};
		})
		.toSorted(compareGoals);
}

export async function getGoal(deps: ServiceDeps, id: string): Promise<GoalSummary> {
	const goal = (await listGoals(deps)).find((candidate) => candidate.id === id);

	if (goal === undefined) {
		throw notFound();
	}

	return goal;
}

/**
 * The dashboard's card: the goals that hold their money, summed in the
 * reporting currency, as Sure's Plan card. Reads only.
 */
export async function getGoalsSummary(deps: ServiceDeps) {
	return goalsSummary(await listGoals(deps), getReportingCurrency());
}

export type GoalHistory = { currency: string; from: IsoDate; to: IsoDate; points: SavedPoint[] };

/**
 * What a goal had saved each day of its chart, as Sure's projection panel's
 * `balance_series_values`: from 90 days ago, or from the earliest opening of
 * its active accounts if later, to today, each day its share of each active
 * account's balance under today's links (AD-8). Reads only.
 */
export async function getGoalHistory(deps: ServiceDeps, id: string): Promise<GoalHistory> {
	const date = today(deps.timeZone);
	const { goalRows, linkRows, competing } = await loadGoals(deps);
	const goal = goalRows.find((candidate) => candidate.id === id);

	if (goal === undefined) {
		throw notFound();
	}

	const links = linkRows.filter((row) => row.goalId === id && row.active);
	const openings = await Promise.all(links.map(async (row) => openingDateOf(deps, row.accountId)));
	const opened = openings.filter((opening) => opening !== null);
	const from = paceStart(date, opened.length === 0 ? null : opened.reduce(minDate));
	const accountsSeries = await Promise.all(
		links.map(async (row) => ({
			balances: await balancesBetween(deps, row.accountId, from, date),
			links: competing(row),
		})),
	);

	return {
		currency: goal.currency,
		from,
		to: date,
		points: goalSeries({ goalId: id, from, to: date, accounts: accountsSeries }),
	};
}

/** A stored currency as the schema reads amounts in; the reporting one if it is no longer known. */
function currencyCode(currency: string | undefined): CurrencyCode {
	if (currency !== undefined && isCurrencyCode(currency)) {
		return currency;
	}

	return getReportingCurrency();
}

function parse(input: GoalInput, currency: CurrencyCode): GoalRequest {
	const parsed = goalSchema(currency).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	return parsed.data;
}

/**
 * Which of `accountIds` a goal other than `goalId` that holds its money
 * takes whole: two whole-balance links on one account would count it twice.
 */
async function wholeTakenElsewhere(
	db: Db,
	goalId: string | null,
	accountIds: readonly string[],
): Promise<Set<string>> {
	const taken = await db
		.select({ accountId: goalAccounts.accountId })
		.from(goalAccounts)
		.innerJoin(goals, eq(goals.id, goalAccounts.goalId))
		.where(
			and(
				inArray(goalAccounts.accountId, [...accountIds]),
				isNull(goalAccounts.allocatedAmount),
				notInArray(goals.state, [...RELEASED_GOAL_STATES]),
				goalId === null ? undefined : ne(goals.id, goalId),
			),
		);

	return new Set(taken.map((row) => row.accountId));
}

/**
 * Refuses a link to an account that cannot back the goal, as Sure's
 * validations: unknown, inactive or neither a depository nor an investment
 * account, held in another currency, or taken whole by another goal that
 * holds its money, which two whole-balance links on one account would count
 * twice. A whole-balance link the goal already had is not checked again, as
 * Sure's `whole_account_link_must_be_exclusive` checks new or changed links
 * only: a released goal is renamed even after another goal took its account
 * whole. Under the caller's write lock, so two saves never both take one
 * account whole.
 */
async function assertFundable(
	db: Db,
	goalId: string | null,
	currency: string,
	links: GoalRequest["accounts"],
): Promise<void> {
	const ids = links.map((link) => link.accountId);
	const [rows, takenWhole, ownWhole] = await Promise.all([
		db
			.select({
				id: accounts.id,
				type: accounts.type,
				currency: accounts.currency,
				active: accounts.active,
			})
			.from(accounts)
			.where(inArray(accounts.id, ids)),
		wholeTakenElsewhere(db, goalId, ids),
		goalId === null
			? []
			: db
					.select({ accountId: goalAccounts.accountId })
					.from(goalAccounts)
					.where(and(eq(goalAccounts.goalId, goalId), isNull(goalAccounts.allocatedAmount))),
	]);
	const found = new Map(rows.map((row) => [row.id, row]));
	const kept = new Set(ownWhole.map((row) => row.accountId));
	const fields = links.flatMap((link, index): FieldError[] => {
		const account = found.get(link.accountId);

		if (account === undefined || !canBackGoal(account)) {
			return [{ path: `accounts.${index}.accountId`, code: "not_fundable" }];
		}

		if (account.currency !== currency) {
			return [{ path: `accounts.${index}.accountId`, code: "currency_mismatch" }];
		}

		if (
			link.allocatedAmount === null &&
			takenWhole.has(link.accountId) &&
			!kept.has(link.accountId)
		) {
			return [{ path: `accounts.${index}.allocatedAmount`, code: "whole_balance_taken" }];
		}

		return [];
	});

	if (fields.length > 0) {
		throw new AppError("VALIDATION_ERROR", "The request is invalid.", fields);
	}
}

/**
 * What a goal stores as its target: the amount typed, or, for a reserve in
 * months of expenses, the months times the median monthly expenses now, the
 * figure its read falls back on, as Sure's `apply_months_of_expenses_target`
 * stores it on save. Without a median, or for a goal in a currency other
 * than the reporting one, in which the median is counted (AD-6), `kept` stands
 * when given: the target of a reserve saved with the same months, so a rename
 * never fails on a median gone since. Refused otherwise. Reads through the
 * caller's transaction.
 */
async function storedTarget(
	deps: ServiceDeps,
	currency: string,
	target: GoalTarget,
	kept: MinorUnits | null,
): Promise<MinorUnits> {
	if (target.mode === "fixed") {
		return target.amount;
	}

	const reported = currency === getReportingCurrency();
	const amount = reported ? monthsOfExpenses(target.months, await monthlyExpenses(deps)) : null;

	if (amount !== null) {
		return amount;
	}

	if (kept !== null) {
		return kept;
	}

	throw fieldError("targetMonths", reported ? "no_expenses" : "not_reporting_currency");
}

/** One refused field, as the schema reports one. */
function fieldError(path: string, code: string): AppError {
	return new AppError("VALIDATION_ERROR", "The request is invalid.", [{ path, code }]);
}

/** A goal's target and kind as the `goals` row holds them. */
function targetColumns(goal: GoalRequest, targetAmount: MinorUnits) {
	return {
		kind: goal.kind,
		targetMode: goal.target.mode,
		targetMonths: goal.target.mode === "months_of_expenses" ? goal.target.months : null,
		targetAmount,
		targetDate: goal.targetDate,
	};
}

async function insertLinks(db: Db, goalId: string, links: GoalRequest["accounts"]) {
	await db.insert(goalAccounts).values(
		links.map((link) => ({
			goalId,
			accountId: link.accountId,
			allocatedAmount: link.allocatedAmount,
		})),
	);
}

/**
 * The currency of the first listed account that may back a goal, which a new
 * goal takes, as Sure's controller: an unknown or unfit account before it is
 * refused on its own, and does not turn valid ones into currency mismatches.
 */
async function firstFundableCurrency(
	db: Db,
	links: GoalInput["accounts"],
): Promise<string | undefined> {
	const ids = links.map((link) => link.accountId);

	if (ids.length === 0) {
		return undefined;
	}

	const rows = await db
		.select({
			id: accounts.id,
			type: accounts.type,
			currency: accounts.currency,
			active: accounts.active,
		})
		.from(accounts)
		.where(inArray(accounts.id, ids));
	const fit = new Map(rows.filter(canBackGoal).map((row) => [row.id, row.currency]));

	return ids.map((id) => fit.get(id)).find((currency) => currency !== undefined);
}

/**
 * Creates an active goal in its first account's currency, as Sure's
 * controller, then returns it with its figures. Nothing is written when an
 * account cannot back it.
 */
export async function createGoal(deps: ServiceDeps, input: GoalInput): Promise<GoalSummary> {
	const id = crypto.randomUUID();

	await deps.db.transaction(
		async (tx) => {
			const currency = currencyCode(await firstFundableCurrency(tx, input.accounts));
			const goal = parse(input, currency);
			const now = Date.now();

			await assertFundable(tx, null, currency, goal.accounts);
			const targetAmount = await storedTarget({ ...deps, db: tx }, currency, goal.target, null);
			await tx.insert(goals).values({
				id,
				name: goal.name,
				...targetColumns(goal, targetAmount),
				currency,
				color: goal.color,
				icon: goal.icon,
				notes: goal.notes,
				createdAt: now,
				updatedAt: now,
			});
			await insertLinks(tx, id, goal.accounts);
		},
		{ behavior: "immediate" },
	);

	return getGoal(deps, id);
}

/**
 * Replaces a goal's fields and links, in its own currency, which never
 * changes: an account in another one is refused. A completed or archived
 * goal keeps its kind, as Sure's `kind_locked_while_released`: it becomes a
 * reserve, or stops being one, once active again.
 */
export async function updateGoal(
	deps: ServiceDeps,
	id: string,
	input: GoalInput,
): Promise<GoalSummary> {
	await deps.db.transaction(
		async (tx) => {
			const existing = await tx.select().from(goals).where(eq(goals.id, id)).get();

			if (existing === undefined) {
				throw notFound();
			}

			const goal = parse(input, currencyCode(existing.currency));

			if (goal.kind !== existing.kind && RELEASED.includes(existing.state)) {
				throw fieldError("kind", "kind_locked");
			}

			await assertFundable(tx, id, existing.currency, goal.accounts);
			const unchanged =
				existing.targetMode === "months_of_expenses" &&
				goal.target.mode === "months_of_expenses" &&
				existing.targetMonths === goal.target.months;
			const targetAmount = await storedTarget(
				{ ...deps, db: tx },
				existing.currency,
				goal.target,
				unchanged ? toMinorUnits(existing.targetAmount) : null,
			);
			await tx
				.update(goals)
				.set({
					name: goal.name,
					...targetColumns(goal, targetAmount),
					color: goal.color,
					icon: goal.icon,
					notes: goal.notes,
					updatedAt: Date.now(),
				})
				.where(eq(goals.id, id));
			await tx.delete(goalAccounts).where(eq(goalAccounts.goalId, id));
			await insertLinks(tx, id, goal.accounts);
		},
		{ behavior: "immediate" },
	);

	return getGoal(deps, id);
}

/** Deletes a goal and its links; its accounts and their history stay as they are. */
export async function deleteGoal(deps: ServiceDeps, id: string): Promise<{ id: string }> {
	const deleted = await deps.db.delete(goals).where(eq(goals.id, id)).returning({ id: goals.id });

	if (deleted.length === 0) {
		throw notFound();
	}

	return { id };
}

/**
 * Refuses to bring a released goal back while another goal holding its money
 * now takes whole an account this one takes whole, as Sure's
 * `restore_must_not_recreate_whole_account_conflict`: the account would back
 * both twice. Names the first such account by id only (AD-14). Under the
 * caller's write lock.
 */
async function assertWholeAccountsFree(db: Db, goalId: string): Promise<void> {
	const own = await db
		.select({ accountId: goalAccounts.accountId })
		.from(goalAccounts)
		.where(and(eq(goalAccounts.goalId, goalId), isNull(goalAccounts.allocatedAmount)))
		.orderBy(goalAccounts.accountId);
	const ids = own.map((row) => row.accountId);
	const taken = ids.length === 0 ? new Set<string>() : await wholeTakenElsewhere(db, goalId, ids);
	const accountId = ids.find((id) => taken.has(id));

	if (accountId !== undefined) {
		throw new AppError(
			"GOAL_ACCOUNT_TAKEN",
			"Another goal now takes whole an account this goal takes whole.",
			undefined,
			{ accountId },
		);
	}
}

/**
 * Moves a goal through one of Sure's events, then returns it with its
 * figures. Completing freezes what it saved and when; becoming active again
 * from a released state clears both, and archiving a completed goal keeps
 * them. An event that does not apply from the goal's state is refused.
 */
export async function transitionGoal(
	deps: ServiceDeps,
	id: string,
	event: GoalEvent,
): Promise<GoalSummary> {
	// Read before the write lock, which the balance reads do not run under:
	// the transaction rechecks the state, and one household's single writer
	// leaves a balance moving in between harmless.
	const frozen = event === "complete" ? (await getGoal(deps, id)).saved : null;

	await deps.db.transaction(
		async (tx) => {
			const existing = await tx
				.select({ state: goals.state, kind: goals.kind })
				.from(goals)
				.where(eq(goals.id, id))
				.get();

			if (existing === undefined) {
				throw notFound();
			}

			const next = goalTransition(existing.state, existing.kind, event);

			if (next === null) {
				throw new AppError(
					"GOAL_STATE_INVALID",
					`This goal is ${existing.state}: ${event} does not apply.`,
				);
			}

			const thawed = RELEASED.includes(existing.state) && !RELEASED.includes(next);

			if (thawed) {
				await assertWholeAccountsFree(tx, id);
			}

			const now = Date.now();

			await tx
				.update(goals)
				.set({
					state: next,
					updatedAt: now,
					...(next === "completed" ? { completedAmount: frozen, completedAt: now } : {}),
					...(thawed ? { completedAmount: null, completedAt: null } : {}),
				})
				.where(eq(goals.id, id));
		},
		{ behavior: "immediate" },
	);

	return getGoal(deps, id);
}
