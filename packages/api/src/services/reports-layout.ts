import type { ReportsLayoutInput } from "../schemas/reports.ts";
import type { ServiceDeps } from "./deps.ts";

import { eq } from "drizzle-orm";

import type { ReportsLayout } from "@archant/data/reports-layout";
import { mergeReportsLayout, resolveReportsLayout } from "@archant/data/reports-layout";
import { users } from "@archant/data/schema/auth";

/** The signed-in user's reports page; Sure's default for a user removed since the session was checked. */
export async function getReportsLayout(deps: ServiceDeps, userId: string): Promise<ReportsLayout> {
	const user = await deps.db
		.select({ reportsLayout: users.reportsLayout })
		.from(users)
		.where(eq(users.id, userId))
		.get();

	return resolveReportsLayout(user?.reportsLayout ?? null);
}

/**
 * Saves one change to the user's reports page, as Sure's
 * `update_reports_preferences`: read, merge and write in one immediate
 * transaction, Sure's `lock!`, so a collapse and a move never lose one
 * another. Another user's layout is untouched.
 */
export async function updateReportsLayout(
	deps: ServiceDeps,
	userId: string,
	input: ReportsLayoutInput,
): Promise<ReportsLayout> {
	return deps.db.transaction(
		async (tx) => {
			const user = await tx
				.select({ reportsLayout: users.reportsLayout })
				.from(users)
				.where(eq(users.id, userId))
				.get();
			const next = mergeReportsLayout(user?.reportsLayout ?? null, input);

			await tx.update(users).set({ reportsLayout: next }).where(eq(users.id, userId));

			return resolveReportsLayout(next);
		},
		{ behavior: "immediate" },
	);
}
