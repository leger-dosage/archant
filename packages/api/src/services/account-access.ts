import type { ServiceDeps } from "./deps.ts";
import type { SQLWrapper } from "drizzle-orm";

import { and, asc, eq, exists, inArray, isNotNull, ne, not, notExists, or, sql } from "drizzle-orm";

import type { AccountPermission, AccountSharingDefault } from "@archant/data/account-sharing";
import { accounts } from "@archant/data/schema/accounts";
import { users } from "@archant/data/schema/auth";
import { securities } from "@archant/data/schema/securities";
import { settings } from "@archant/data/schema/settings";
import { accountShares } from "@archant/data/schema/sharing";
import type { UserRole } from "@archant/data/user-roles";

import { AppError } from "../lib/errors.ts";
import {
	entryAccount,
	entryAccountColumn,
	scopedEntryIds,
	securityTrades,
	transferEntries,
} from "./ledger/access-queries.ts";

export type AccountActor = { id: string; role: UserRole };
export type AccountAccess = "read" | "annotate" | "edit" | "finance" | "owned";

type Reader = Pick<ServiceDeps["db"], "select">;
type AccessDeps = Pick<ServiceDeps, "actor" | "budgetOwnerId"> & { db: Reader };

export function accountScope(deps: AccessDeps, access: AccountAccess = "read") {
	if (access === "finance" && typeof deps.budgetOwnerId === "string") {
		return eq(accounts.ownerId, deps.budgetOwnerId);
	}

	const { actor, db } = deps;
	if (actor === undefined) {
		return undefined;
	}

	const owns = and(isNotNull(accounts.ownerId), eq(accounts.ownerId, actor.id));
	if (
		(access === "edit" || access === "annotate" || access === "owned") &&
		actor.role === "guest"
	) {
		return sql`0`;
	}
	if (access === "owned") {
		return owns;
	}

	const shares = db
		.select({ id: accountShares.accountId })
		.from(accountShares)
		.where(
			and(
				eq(accountShares.accountId, accounts.id),
				eq(accountShares.userId, actor.id),
				access === "finance" ? eq(accountShares.includeInFinances, true) : undefined,
				access === "edit" ? eq(accountShares.permission, "full_control") : undefined,
				access === "annotate" ? ne(accountShares.permission, "read_only") : undefined,
			),
		);
	return or(owns, exists(shares));
}

export function scopedAccounts(deps: AccessDeps, access?: AccountAccess) {
	return deps.db.select({ id: accounts.id }).from(accounts).where(accountScope(deps, access));
}

export async function accountIds(
	deps: AccessDeps,
	access?: AccountAccess,
): Promise<string[] | undefined> {
	if (deps.actor === undefined && typeof deps.budgetOwnerId !== "string") {
		return undefined;
	}
	return (await scopedAccounts(deps, access)).map(({ id }) => id);
}

export async function accountPermission(
	deps: AccessDeps,
	id: string,
): Promise<"owner" | AccountPermission | null> {
	const { actor, db } = deps;
	const row = await db
		.select({ ownerId: accounts.ownerId, permission: accountShares.permission })
		.from(accounts)
		.leftJoin(
			accountShares,
			and(eq(accountShares.accountId, accounts.id), eq(accountShares.userId, actor?.id ?? "")),
		)
		.where(eq(accounts.id, id))
		.get();
	if (row === undefined) {
		return null;
	}
	if (actor === undefined || row.ownerId === actor.id) {
		return "owner";
	}
	return row.permission;
}

export function forbidden() {
	return new AppError("FORBIDDEN", "You do not have permission to change this resource.");
}

export async function requireAccount(deps: AccessDeps, id: string, access: AccountAccess = "read") {
	if (deps.actor === undefined) {
		return;
	}
	const permission = await accountPermission(deps, id);
	if (permission === null) {
		throw new AppError("NOT_FOUND", "No account has this id.");
	}
	if (access === "read") {
		return;
	}
	if (
		deps.actor.role === "guest" ||
		(permission !== "owner" &&
			(access === "owned" ||
				permission === "read_only" ||
				(access === "edit" && permission !== "full_control")))
	) {
		throw forbidden();
	}
}

export async function requireEntry(deps: AccessDeps, id: string, access: AccountAccess = "read") {
	if (deps.actor === undefined) {
		return;
	}
	const row = await entryAccount(deps.db, id);
	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No entry has this id.");
	}
	await requireAccount(deps, row.accountId, access);
}

export async function requireTransfer(
	deps: AccessDeps,
	id: string,
	access: AccountAccess = "read",
) {
	if (deps.actor === undefined) {
		return;
	}
	const row = await transferEntries(deps.db, id);
	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No transfer has this id.");
	}
	await requireEntry(deps, row.outgoing, access);
	await requireEntry(deps, row.incoming, access);
}

export async function firstAdmin(db: Reader, except?: string) {
	const row = await db
		.select({ id: users.id })
		.from(users)
		.where(and(eq(users.role, "admin"), except === undefined ? undefined : ne(users.id, except)))
		.orderBy(asc(users.createdAt), asc(users.id))
		.limit(1)
		.get();
	return row?.id ?? null;
}

export async function accountOwner(deps: Pick<ServiceDeps, "actor">, db: Reader) {
	return deps.actor?.id ?? firstAdmin(db);
}

export async function sharingDefault(db: Reader): Promise<AccountSharingDefault> {
	const row = await db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, "default_account_sharing"))
		.get();
	return row?.value === "private" ? "private" : "shared";
}

const automaticPermission = sql<AccountPermission>`case when ${users.role} = 'guest' then 'read_only' else 'read_write' end`;

export async function shareNewAccounts(
	db: ServiceDeps["db"],
	ownerId: string | null,
	ids: readonly string[],
) {
	if (ownerId === null || ids.length === 0 || (await sharingDefault(db)) === "private") {
		return;
	}
	await ids.reduce<Promise<unknown>>(async (previous, id) => {
		await previous;
		const members = db
			.select({
				accountId: sql<string>`${id}`.as("account_id"),
				userId: users.id,
				permission: automaticPermission.as("permission"),
				includeInFinances: sql<boolean>`true`.as("include_in_finances"),
			})
			.from(users)
			.where(ne(users.id, ownerId));
		return db.insert(accountShares).select(members).onConflictDoNothing();
	}, Promise.resolve());
}

export async function shareExistingAccounts(db: ServiceDeps["db"], actor: AccountActor) {
	if ((await sharingDefault(db)) === "private") {
		return;
	}
	const permission = actor.role === "guest" ? "read_only" : "read_write";
	const shared = db
		.select({
			accountId: accounts.id,
			userId: sql<string>`${actor.id}`.as("user_id"),
			permission: sql<AccountPermission>`${permission}`.as("permission"),
			includeInFinances: sql<boolean>`true`.as("include_in_finances"),
		})
		.from(accounts)
		.where(ne(accounts.ownerId, actor.id));
	await db.insert(accountShares).select(shared).onConflictDoNothing();
}

export async function accountSharing(deps: ServiceDeps, accountId: string) {
	await requireAccount(deps, accountId);
	const actor = deps.actor;
	if (actor === undefined) {
		throw forbidden();
	}

	if ((await accountPermission(deps, accountId)) !== "owner") {
		const share = await deps.db
			.select({ includeInFinances: accountShares.includeInFinances })
			.from(accountShares)
			.where(and(eq(accountShares.userId, actor.id), eq(accountShares.accountId, accountId)))
			.get();
		if (share === undefined) {
			throw new AppError("NOT_FOUND", "No account has this id.");
		}
		return { members: null, includeInFinances: share.includeInFinances };
	}

	const members = await deps.db
		.select({
			id: users.id,
			name: users.name,
			role: users.role,
			permission: accountShares.permission,
		})
		.from(users)
		.leftJoin(
			accountShares,
			and(eq(accountShares.userId, users.id), eq(accountShares.accountId, accountId)),
		)
		.where(ne(users.id, actor.id))
		.orderBy(users.name, users.id);
	return { members, includeInFinances: null };
}

export async function saveAccountShare(
	deps: ServiceDeps,
	accountId: string,
	userId: string,
	permission: AccountPermission | null,
) {
	await deps.db.transaction(
		async (tx) => {
			await requireAccount({ ...deps, db: tx }, accountId, "owned");
			const member = await tx
				.select({ id: users.id })
				.from(users)
				.where(eq(users.id, userId))
				.get();
			if (member === undefined || userId === deps.actor?.id) {
				throw new AppError("NOT_FOUND", "No eligible member has this id.");
			}

			if (permission === null) {
				await tx
					.delete(accountShares)
					.where(and(eq(accountShares.accountId, accountId), eq(accountShares.userId, userId)));
			} else {
				await tx
					.insert(accountShares)
					.values({ accountId, userId, permission })
					.onConflictDoUpdate({
						target: [accountShares.accountId, accountShares.userId],
						set: { permission },
					});
			}
		},
		{ behavior: "immediate" },
	);

	return accountSharing(deps, accountId);
}

export async function saveFinanceInclusion(
	deps: ServiceDeps,
	accountId: string,
	includeInFinances: boolean,
) {
	const updated = await deps.db
		.update(accountShares)
		.set({ includeInFinances })
		.where(
			and(eq(accountShares.accountId, accountId), eq(accountShares.userId, deps.actor?.id ?? "")),
		)
		.returning({ includeInFinances: accountShares.includeInFinances })
		.get();
	if (updated === undefined) {
		throw new AppError("NOT_FOUND", "No account share has this id.");
	}
	return updated;
}

export function entryScope(
	deps: AccessDeps,
	access?: AccountAccess,
	column: SQLWrapper = entryAccountColumn,
) {
	return accountScope(deps, access) === undefined
		? undefined
		: inArray(column, scopedAccounts(deps, access));
}

export function transactionScope(deps: AccessDeps, column: SQLWrapper, access?: AccountAccess) {
	return accountScope(deps, access) === undefined
		? undefined
		: inArray(column, scopedEntryIds(deps.db, entryScope(deps, access)));
}

export function accountIdFilter(column: SQLWrapper, ids: readonly string[] | undefined) {
	return ids === undefined ? undefined : inArray(column, [...ids]);
}

export function securityScope(deps: AccessDeps) {
	const scope = entryScope(deps);
	if (scope === undefined) {
		return undefined;
	}
	return or(
		notExists(securityTrades(deps.db, securities.id)),
		exists(securityTrades(deps.db, securities.id, scope)),
	);
}

export async function assertSecurityWritable(deps: AccessDeps, securityId: string) {
	const scope = entryScope(deps, "edit");
	if (scope === undefined) {
		return;
	}
	const blocked = await securityTrades(deps.db, securityId, not(scope)).limit(1).get();
	if (blocked !== undefined) {
		throw forbidden();
	}
}

export async function limitedEditableAccounts(deps: AccessDeps) {
	const editable = accountScope(deps, "edit");
	if (editable === undefined) {
		return undefined;
	}
	const blocked = await deps.db
		.select({ id: accounts.id })
		.from(accounts)
		.where(not(editable))
		.limit(1)
		.get();
	return blocked === undefined ? undefined : accountIds(deps, "edit");
}
