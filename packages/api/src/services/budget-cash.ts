import type { GoalLink } from "../domain/goals.ts";
import type { ServiceDeps } from "./deps.ts";

import { and, eq, inArray, notInArray } from "drizzle-orm";

import { RELEASED_GOAL_STATES } from "@archant/data/goals";
import { toMinorUnits } from "@archant/data/money";
import { goalAccounts, goals } from "@archant/data/schema/goals";

import { today } from "../domain/dates.ts";
import { backingShares } from "../domain/goals.ts";
import { balanceOn } from "./ledger/balances.ts";
import { reportedAccounts } from "./reports.ts";

/** Cash at today's close, separate from the selected period's budget. */
export async function getBudgetCash(deps: ServiceDeps) {
	const { currency, counted } = await reportedAccounts(deps, (row) => row.type === "depository");
	const date = today(deps.timeZone);
	const ids = counted.map((row) => row.id);
	const [balances, links] = await Promise.all([
		Promise.all(ids.map(async (id) => [id, await balanceOn(deps, id, date)] as const)),
		ids.length === 0
			? []
			: deps.db
					.select({
						accountId: goalAccounts.accountId,
						goalId: goalAccounts.goalId,
						allocatedAmount: goalAccounts.allocatedAmount,
					})
					.from(goalAccounts)
					.innerJoin(goals, eq(goals.id, goalAccounts.goalId))
					.where(
						and(
							inArray(goalAccounts.accountId, ids),
							notInArray(goals.state, [...RELEASED_GOAL_STATES]),
						),
					),
	]);
	const linksByAccount = new Map<string, GoalLink[]>();

	for (const { accountId, goalId, allocatedAmount } of links) {
		const held = linksByAccount.get(accountId) ?? [];

		held.push({
			goalId,
			allocatedAmount: allocatedAmount === null ? null : toMinorUnits(allocatedAmount),
		});
		linksByAccount.set(accountId, held);
	}

	let available = 0;
	let earmarked = 0;

	for (const [id, balanceOnDate] of balances) {
		const balance = balanceOnDate?.amount ?? toMinorUnits(0);
		available += balance;

		for (const share of backingShares(balance, linksByAccount.get(id) ?? []).values()) {
			earmarked += share;
		}
	}

	return {
		currency,
		available: toMinorUnits(available),
		earmarked: toMinorUnits(earmarked),
		free: toMinorUnits(Math.max(available - earmarked, 0)),
	};
}
