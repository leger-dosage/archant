import type { ServiceDeps } from "./deps.ts";

import { and, eq, notExists, notInArray } from "drizzle-orm";

import { goalAccounts, goals } from "@archant/data/schema/goals";

import { scopedAccounts } from "./account-access.ts";

export function goalScope(deps: ServiceDeps, access: "read" | "edit" = "read") {
	if (deps.actor === undefined) {
		return undefined;
	}
	return notExists(
		deps.db
			.select({ id: goalAccounts.accountId })
			.from(goalAccounts)
			.where(
				and(
					eq(goalAccounts.goalId, goals.id),
					notInArray(goalAccounts.accountId, scopedAccounts(deps, access)),
				),
			),
	);
}
