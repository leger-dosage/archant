import type { ServiceDeps } from "./deps.ts";

import { and, eq, notInArray } from "drizzle-orm";

import { RELEASED_GOAL_STATES } from "@archant/data/goals";
import type { MinorUnits } from "@archant/data/money";
import { goals } from "@archant/data/schema/goals";
import { settings } from "@archant/data/schema/settings";

import { today } from "../domain/dates.ts";
import { monthsOfExpenses } from "../domain/goals.ts";
import { getCashFlowStatistics } from "./reports.ts";
import { getReportingCurrency } from "./settings.ts";

type Db = ServiceDeps["db"];

/**
 * The household's median monthly expenses, as Sure's `median_expense` and
 * the budget's suggested spending: `FamilyStats`' expense side over the
 * whole history, the current month included, in the reporting currency
 * (AD-9). Reads only.
 */
export async function monthlyExpenses(deps: ServiceDeps): Promise<MinorUnits | null> {
	return (await getCashFlowStatistics(deps)).family.expense.median;
}

const REFRESHED_MONTH = "goal_targets_refreshed_month";

async function refreshedMonth(db: Db): Promise<string> {
	const row = await db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, REFRESHED_MONTH))
		.get();

	return row?.value ?? "";
}

const reserveRefreshes = new WeakMap<Db, { month: string; run: Promise<void> }>();

/**
 * Sure's monthly `RefreshMaintainedGoalTargetsJob`, caught up on the first
 * signed-in visit. The month and the targets commit together, so a failed
 * attempt can retry and a concurrent process cannot refresh a second time.
 */
export function refreshReserveTargets(deps: ServiceDeps): Promise<void> {
	const month = today(deps.timeZone).slice(0, 7);
	const pending = reserveRefreshes.get(deps.db);

	if (pending !== undefined) {
		return pending.month === month
			? pending.run
			: pending.run.catch(() => undefined).then(() => refreshReserveTargets(deps));
	}

	// Local libSQL takes the write lock synchronously. Parallel visits in the
	// same process share the attempt so a second lock cannot delay the first.
	const run = refreshDueReserveTargets(deps, month).finally(() => {
		reserveRefreshes.delete(deps.db);
	});
	reserveRefreshes.set(deps.db, { month, run });

	return run;
}

async function refreshDueReserveTargets(deps: ServiceDeps, month: string): Promise<void> {
	if ((await refreshedMonth(deps.db)) >= month) {
		return;
	}

	await deps.db.transaction(
		async (tx) => {
			if ((await refreshedMonth(tx)) >= month) {
				return;
			}

			const reserves = await tx
				.select({
					id: goals.id,
					targetMonths: goals.targetMonths,
					targetAmount: goals.targetAmount,
				})
				.from(goals)
				.where(
					and(
						eq(goals.targetMode, "months_of_expenses"),
						eq(goals.currency, getReportingCurrency()),
						notInArray(goals.state, [...RELEASED_GOAL_STATES]),
					),
				);

			const median = reserves.length === 0 ? null : await monthlyExpenses({ ...deps, db: tx });
			const now = Date.now();

			await Promise.all(
				reserves.map(async (reserve) => {
					const amount = monthsOfExpenses(reserve.targetMonths ?? 0, median);

					if (amount !== null && amount !== reserve.targetAmount) {
						await tx
							.update(goals)
							.set({ targetAmount: amount, updatedAt: now })
							.where(eq(goals.id, reserve.id));
					}
				}),
			);

			const stamp = { value: month, updatedAt: now };
			await tx
				.insert(settings)
				.values({ key: REFRESHED_MONTH, ...stamp })
				.onConflictDoUpdate({ target: settings.key, set: stamp });
		},
		{ behavior: "immediate" },
	);
}
