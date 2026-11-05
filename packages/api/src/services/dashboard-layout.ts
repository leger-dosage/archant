import type { DashboardLayoutInput } from "../schemas/dashboard-layout.ts";
import type { ServiceDeps } from "./deps.ts";

import { eq } from "drizzle-orm";

import type { DashboardLayout } from "@archant/data/dashboard-layout";
import { mergeLayout, resolveLayout } from "@archant/data/dashboard-layout";
import { users } from "@archant/data/schema/auth";

/** The signed-in user's dashboard; Sure's default for a user removed since the session was checked. */
export async function getDashboardLayout(
	deps: ServiceDeps,
	userId: string,
): Promise<DashboardLayout> {
	const user = await deps.db
		.select({ dashboardLayout: users.dashboardLayout })
		.from(users)
		.where(eq(users.id, userId))
		.get();

	return resolveLayout(user?.dashboardLayout ?? null);
}

/**
 * Saves one change to the user's dashboard, as Sure's
 * `update_dashboard_preferences`: read, merge and write in one immediate
 * transaction, Sure's `lock!`, so two quick clicks never lose one another's
 * key. Another user's layout is untouched.
 */
export async function updateDashboardLayout(
	deps: ServiceDeps,
	userId: string,
	input: DashboardLayoutInput,
): Promise<DashboardLayout> {
	return deps.db.transaction(
		async (tx) => {
			const user = await tx
				.select({ dashboardLayout: users.dashboardLayout })
				.from(users)
				.where(eq(users.id, userId))
				.get();
			const next = mergeLayout(user?.dashboardLayout ?? null, input);

			await tx.update(users).set({ dashboardLayout: next }).where(eq(users.id, userId));

			return resolveLayout(next);
		},
		{ behavior: "immediate" },
	);
}
