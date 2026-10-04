import type { IsoDate } from "../domain/dates.ts";
import type { GoalLink, GoalProgress } from "../domain/goals.ts";
import type { FieldError } from "../lib/errors.ts";
import type { GoalInput, GoalRequest } from "../schemas/goals.ts";
import type { ServiceDeps } from "./deps.ts";

import { and, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";

import type { AccountType } from "@archant/data/account-types";
import type { CategoryColor, CategoryIcon } from "@archant/data/category-presets";
import type { GoalKind, GoalState } from "@archant/data/goals";
import { RELEASED_GOAL_STATES, canBackGoal } from "@archant/data/goals";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode, toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { goalAccounts, goals } from "@archant/data/schema/goals";

import { today } from "../domain/dates.ts";
import { backingShares, compareGoals, goalProgress, paceStart } from "../domain/goals.ts";
import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import { goalSchema } from "../schemas/goals.ts";
import { balanceOn, openingDateOf } from "./ledger/balances.ts";
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
	targetAmount: MinorUnits;
	/** The currency of every amount here, its accounts'. */
	currency: string;
	targetDate: IsoDate | null;
	color: CategoryColor;
	icon: CategoryIcon;
	notes: string | null;
	state: GoalState;
	kind: GoalKind;
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
 * Every goal with its figures, as Sure's `Goal.prepared_for`, behind ones
 * first, as its `active_display_sort`: the links of goals that hold their
 * money share each account's balance, and each goal reads its share of
 * every account it links. Reads only.
 */
export async function listGoals(deps: ServiceDeps): Promise<GoalSummary[]> {
	const date = today(deps.timeZone);
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
	const accountIds = [...new Set(linkRows.map((row) => row.accountId))];
	const figures = new Map(
		await Promise.all(
			accountIds.map(async (id) => [id, await accountFigures(deps, id, date)] as const),
		),
	);
	const holding = new Set(
		goalRows.filter((goal) => !RELEASED.includes(goal.state)).map((goal) => goal.id),
	);
	const linkOf = (row: (typeof linkRows)[number]): GoalLink => ({
		goalId: row.goalId,
		allocatedAmount: row.allocatedAmount === null ? null : toMinorUnits(row.allocatedAmount),
	});
	const pool = new Map<string, GoalLink[]>();

	for (const row of linkRows) {
		if (holding.has(row.goalId)) {
			pool.set(row.accountId, [...(pool.get(row.accountId) ?? []), linkOf(row)]);
		}
	}

	return goalRows
		.map((goal): GoalSummary => {
			const links = linkRows.filter((row) => row.goalId === goal.id);
			const shares = links.map((row): GoalAccountShare => {
				const { now } = figures.get(row.accountId) ?? { now: toMinorUnits(0) };
				const shared = pool.get(row.accountId) ?? [];
				// A goal that released its money still reads what it would back.
				const competing = holding.has(goal.id) ? shared : [...shared, linkOf(row)];

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
						? (backingShares(now, competing).get(goal.id) ?? toMinorUnits(0))
						: toMinorUnits(0),
				};
			});
			const progress = goalProgress({
				target: toMinorUnits(goal.targetAmount),
				saved: toMinorUnits(shares.reduce((sum, account) => sum + account.share, 0)),
				targetDate: goal.targetDate,
				today: date,
				accounts: links.flatMap((row) => (row.active ? (figures.get(row.accountId) ?? []) : [])),
			});

			return {
				id: goal.id,
				name: goal.name,
				targetAmount: toMinorUnits(goal.targetAmount),
				currency: goal.currency,
				targetDate: goal.targetDate,
				color: goal.color,
				icon: goal.icon,
				notes: goal.notes,
				state: goal.state,
				kind: goal.kind,
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
 * Refuses a link to an account that cannot back the goal, as Sure's
 * validations: unknown, inactive or neither a depository nor an investment
 * account, held in another currency, or taken whole by another goal that
 * holds its money, which two whole-balance links on one account would count
 * twice. Under the caller's write lock, so two saves never both take one
 * account whole.
 */
async function assertFundable(
	db: Db,
	goalId: string | null,
	currency: string,
	links: GoalRequest["accounts"],
): Promise<void> {
	const ids = links.map((link) => link.accountId);
	const [rows, taken] = await Promise.all([
		db
			.select({
				id: accounts.id,
				type: accounts.type,
				currency: accounts.currency,
				active: accounts.active,
			})
			.from(accounts)
			.where(inArray(accounts.id, ids)),
		db
			.select({ accountId: goalAccounts.accountId })
			.from(goalAccounts)
			.innerJoin(goals, eq(goals.id, goalAccounts.goalId))
			.where(
				and(
					inArray(goalAccounts.accountId, ids),
					isNull(goalAccounts.allocatedAmount),
					notInArray(goals.state, [...RELEASED_GOAL_STATES]),
					goalId === null ? undefined : ne(goals.id, goalId),
				),
			),
	]);
	const found = new Map(rows.map((row) => [row.id, row]));
	const takenWhole = new Set(taken.map((row) => row.accountId));
	const fields = links.flatMap((link, index): FieldError[] => {
		const account = found.get(link.accountId);

		if (account === undefined || !canBackGoal(account)) {
			return [{ path: `accounts.${index}.accountId`, code: "not_fundable" }];
		}

		if (account.currency !== currency) {
			return [{ path: `accounts.${index}.accountId`, code: "currency_mismatch" }];
		}

		if (link.allocatedAmount === null && takenWhole.has(link.accountId)) {
			return [{ path: `accounts.${index}.allocatedAmount`, code: "whole_balance_taken" }];
		}

		return [];
	});

	if (fields.length > 0) {
		throw new AppError("VALIDATION_ERROR", "The request is invalid.", fields);
	}
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
			await tx.insert(goals).values({
				id,
				name: goal.name,
				targetAmount: goal.targetAmount,
				currency,
				targetDate: goal.targetDate,
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
 * changes: an account in another one is refused.
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

			await assertFundable(tx, id, existing.currency, goal.accounts);
			await tx
				.update(goals)
				.set({
					name: goal.name,
					targetAmount: goal.targetAmount,
					targetDate: goal.targetDate,
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
