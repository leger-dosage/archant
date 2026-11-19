import type { ServiceDeps } from "./deps.ts";

import { and, eq, isNull, ne } from "drizzle-orm";

import { users } from "@archant/data/schema/auth";
import { budgets } from "@archant/data/schema/budgets";
import { settings } from "@archant/data/schema/settings";
import { budgetShares } from "@archant/data/schema/sharing";

import { AppError } from "../lib/errors.ts";
import { forbidden } from "./account-access.ts";

export function budgetScope(ownerId?: string | null) {
	return typeof ownerId !== "string" ? isNull(budgets.ownerId) : eq(budgets.ownerId, ownerId);
}

export async function personalBudgetsEnabled(db: Pick<ServiceDeps["db"], "select">) {
	const row = await db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, "personal_budgets"))
		.get();
	return row?.value === "true";
}

export async function budgetAccess(deps: ServiceDeps, requested?: string) {
	const actor = deps.actor;
	const personal = await personalBudgetsEnabled(deps.db);
	const ownerId = personal && requested !== "shared" ? (requested ?? actor?.id ?? null) : null;
	if (!personal && requested !== undefined && requested !== "shared") {
		throw new AppError("NOT_FOUND", "No budget is shared by this person.");
	}
	if (ownerId === null || ownerId === actor?.id) {
		return { ownerId, canWrite: actor?.role !== "guest" };
	}
	const share = await deps.db
		.select({ permission: budgetShares.permission })
		.from(budgetShares)
		.where(and(eq(budgetShares.ownerId, ownerId), eq(budgetShares.viewerId, actor?.id ?? "")))
		.get();
	if (share === undefined) {
		throw new AppError("NOT_FOUND", "No budget is shared by this person.");
	}
	return { ownerId, canWrite: share.permission === "read_write" && actor?.role !== "guest" };
}

export async function budgetDeps(
	deps: ServiceDeps,
	requested?: string,
	write = false,
): Promise<ServiceDeps> {
	const { ownerId, canWrite } = await budgetAccess(deps, requested);
	if (write && !canWrite) {
		throw forbidden();
	}
	return { ...deps, budgetOwnerId: ownerId };
}

export async function assertBudgetWrite(deps: ServiceDeps, db: ServiceDeps["db"]) {
	if (deps.actor !== undefined && deps.budgetOwnerId !== undefined) {
		await budgetDeps({ ...deps, db }, deps.budgetOwnerId ?? "shared", true);
	}
}

export async function budgetChoices(deps: ServiceDeps, userId: string) {
	const enabled = await personalBudgetsEnabled(deps.db);
	if (!enabled) {
		return { enabled, received: [], members: [] };
	}
	const [received, members] = await Promise.all([
		deps.db
			.select({ id: users.id, name: users.name, permission: budgetShares.permission })
			.from(budgetShares)
			.innerJoin(users, eq(users.id, budgetShares.ownerId))
			.where(eq(budgetShares.viewerId, userId))
			.orderBy(users.name, users.id),
		deps.db
			.select({ id: users.id, name: users.name, permission: budgetShares.permission })
			.from(users)
			.leftJoin(
				budgetShares,
				and(eq(budgetShares.viewerId, users.id), eq(budgetShares.ownerId, userId)),
			)
			.where(ne(users.id, userId))
			.orderBy(users.name, users.id),
	]);
	return { enabled, received, members };
}

export async function saveBudgetShare(
	deps: ServiceDeps,
	userId: string,
	viewerId: string,
	permission: (typeof budgetShares.$inferInsert)["permission"] | null,
) {
	await deps.db.transaction(
		async (tx) => {
			if (!(await personalBudgetsEnabled(tx))) {
				throw forbidden();
			}
			const member = await tx
				.select({ id: users.id })
				.from(users)
				.where(eq(users.id, viewerId))
				.get();
			if (member === undefined || viewerId === userId) {
				throw new AppError("NOT_FOUND", "No eligible member has this id.");
			}
			if (permission === null) {
				await tx
					.delete(budgetShares)
					.where(and(eq(budgetShares.ownerId, userId), eq(budgetShares.viewerId, viewerId)));
			} else {
				await tx
					.insert(budgetShares)
					.values({ ownerId: userId, viewerId, permission })
					.onConflictDoUpdate({
						target: [budgetShares.ownerId, budgetShares.viewerId],
						set: { permission },
					});
			}
		},
		{ behavior: "immediate" },
	);
	return budgetChoices(deps, userId);
}
