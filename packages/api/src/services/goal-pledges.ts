import type { ServiceDeps } from "./deps.ts";

import { and, desc, eq, gte, or } from "drizzle-orm";
import { z } from "zod";

import { isCurrencyCode, toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { goalAccounts, goalPledges, goals } from "@archant/data/schema/goals";

import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import { amountIn } from "../schemas/budgets.ts";
import { accountScope, requireAccount } from "./account-access.ts";
import { goalScope } from "./goal-access.ts";
import { invalidField } from "./ledger/shared.ts";

const DAY = 86_400_000;
const PLEDGE_WINDOW = 7 * DAY;

type PledgeRow = typeof goalPledges.$inferSelect;

function pledgeIsOpen(pledge: PledgeRow, now: number): boolean {
	return pledge.status === "open" && pledge.expiresAt >= now;
}

function publicPledge(pledge: PledgeRow, now: number, accountName: string) {
	return {
		id: pledge.id,
		accountId: pledge.accountId,
		accountName,
		amount: toMinorUnits(pledge.amount),
		status: pledge.expiresAt < now ? ("expired" as const) : ("open" as const),
		daysLeft: Math.max(0, Math.ceil((pledge.expiresAt - now) / DAY)),
	};
}

export type GoalPledge = ReturnType<typeof publicPledge>;

export async function readGoalPledges(deps: ServiceDeps, now: number) {
	const rows = await deps.db
		.select({ pledge: goalPledges, accountName: accounts.name })
		.from(goalPledges)
		.innerJoin(accounts, eq(accounts.id, goalPledges.accountId))
		.leftJoin(
			goalAccounts,
			and(
				eq(goalAccounts.goalId, goalPledges.goalId),
				eq(goalAccounts.accountId, goalPledges.accountId),
			),
		)
		.where(
			and(
				accountScope(deps),
				or(
					eq(goalPledges.status, "matched"),
					and(eq(goalPledges.status, "open"), eq(goalAccounts.accountId, goalPledges.accountId)),
				),
			),
		)
		.orderBy(desc(goalPledges.createdAt), desc(goalPledges.id));

	const byGoal = new Map<
		string,
		{
			pledges: GoalPledge[];
			latestMatchedDepositDate: string | null;
		}
	>();

	for (const { pledge, accountName } of rows) {
		const data = byGoal.get(pledge.goalId) ?? { pledges: [], latestMatchedDepositDate: null };
		const date = pledge.matchedDate;

		if (pledge.status === "matched") {
			if (
				date !== null &&
				(data.latestMatchedDepositDate === null || date > data.latestMatchedDepositDate)
			) {
				data.latestMatchedDepositDate = date;
			}
		} else {
			data.pledges.push(publicPledge(pledge, now, accountName));
		}

		byGoal.set(pledge.goalId, data);
	}

	return byGoal;
}

export async function createGoalPledge(
	deps: ServiceDeps,
	goalId: string,
	input: { accountId: string; amount: string },
) {
	return deps.db.transaction(
		async (tx) => {
			const goal = await tx
				.select()
				.from(goals)
				.where(and(eq(goals.id, goalId), goalScope({ ...deps, db: tx }, "edit")))
				.get();

			if (goal === undefined) {
				throw new AppError("NOT_FOUND", "No goal has this id.");
			}
			if (goal.state !== "active" || !isCurrencyCode(goal.currency)) {
				throw invalidField("amount", "pledge_goal_inactive");
			}

			await requireAccount({ ...deps, db: tx }, input.accountId, "edit");
			const account = await tx
				.select({ name: accounts.name })
				.from(goalAccounts)
				.innerJoin(accounts, eq(accounts.id, goalAccounts.accountId))
				.where(
					and(
						eq(goalAccounts.goalId, goalId),
						eq(goalAccounts.accountId, input.accountId),
						eq(accounts.active, true),
						eq(accounts.currency, goal.currency),
					),
				)
				.get();

			if (account === undefined) {
				throw invalidField("accountId");
			}

			const parsed = z
				.object({ amount: z.string().transform(amountIn(goal.currency, true)) })
				.safeParse(input);

			if (!parsed.success) {
				throw validationError(parsed.error);
			}

			const now = Date.now();
			const duplicate = await tx
				.select({ id: goalPledges.id })
				.from(goalPledges)
				.where(
					and(
						eq(goalPledges.goalId, goalId),
						eq(goalPledges.accountId, input.accountId),
						eq(goalPledges.amount, parsed.data.amount),
						eq(goalPledges.status, "open"),
						gte(goalPledges.expiresAt, now),
					),
				)
				.get();

			if (duplicate !== undefined) {
				throw invalidField("amount", "duplicate_open_pledge");
			}

			const pledge = {
				id: crypto.randomUUID(),
				goalId,
				accountId: input.accountId,
				amount: parsed.data.amount,
				currency: goal.currency,
				status: "open" as const,
				createdAt: now,
				expiresAt: now + PLEDGE_WINDOW,
				matchedDate: null,
			};

			await tx.insert(goalPledges).values(pledge);

			return publicPledge(pledge, now, account.name);
		},
		{ behavior: "immediate" },
	);
}

async function changePledge(
	deps: ServiceDeps,
	goalId: string,
	id: string,
	action: "extend" | "cancel",
) {
	return deps.db.transaction(
		async (tx) => {
			const where = and(eq(goalPledges.id, id), eq(goalPledges.goalId, goalId));
			const pledge = await tx.select().from(goalPledges).where(where).get();

			if (pledge === undefined) {
				throw new AppError("NOT_FOUND", "No pledge has this id on the goal.");
			}

			await requireAccount({ ...deps, db: tx }, pledge.accountId, "edit");
			const now = Date.now();

			if (!pledgeIsOpen(pledge, now)) {
				throw invalidField("pledge", "pledge_not_open");
			}

			await tx
				.update(goalPledges)
				.set(
					action === "extend"
						? { expiresAt: pledge.expiresAt + PLEDGE_WINDOW }
						: { status: "cancelled" },
				)
				.where(where);

			return { id };
		},
		{ behavior: "immediate" },
	);
}

export const extendGoalPledge = (deps: ServiceDeps, goalId: string, id: string) =>
	changePledge(deps, goalId, id, "extend");

export const cancelGoalPledge = (deps: ServiceDeps, goalId: string, id: string) =>
	changePledge(deps, goalId, id, "cancel");
