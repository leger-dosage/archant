import type { Logger } from "../lib/logger.ts";
import type { ServiceDeps } from "./deps.ts";

import { and, asc, count, eq, gt, isNull, ne, or } from "drizzle-orm";

import { users } from "@archant/data/schema/auth";
import { invitations } from "@archant/data/schema/invitations";
import { oauthAccessTokens, oauthConsents, oauthRefreshTokens } from "@archant/data/schema/oauth";
import type { UserRole } from "@archant/data/user-roles";

import { AppError } from "../lib/errors.ts";

export type MemberDeps = Pick<ServiceDeps, "db"> & { logger: Logger };

export type Member = { id: string; name: string; email: string; role: UserRole; createdAt: number };

type Transaction = Parameters<Parameters<MemberDeps["db"]["transaction"]>[0]>[0];

const columns = {
	id: users.id,
	name: users.name,
	email: users.email,
	role: users.role,
	createdAt: users.createdAt,
};

const member = (row: Omit<Member, "createdAt"> & { createdAt: Date }): Member => ({
	...row,
	createdAt: row.createdAt.getTime(),
});

/** Every member of the household, the oldest first: the administrator who set Archant up leads. */
export async function listMembers(deps: MemberDeps): Promise<Member[]> {
	const rows = await deps.db
		.select(columns)
		.from(users)
		.orderBy(asc(users.createdAt), asc(users.id));

	return rows.map(member);
}

/**
 * Sure's `cannot_remove_self`: a member never changes or removes themselves
 * here, so the last administrator cannot lock the household out by mistake,
 * and a second one does it for them.
 */
function refuseSelf(actorId: string, memberId: string): void {
	if (actorId === memberId) {
		throw new AppError("CANNOT_CHANGE_SELF", "You cannot change your own role or remove yourself.");
	}
}

async function memberOrNotFound(tx: Transaction, memberId: string) {
	const row = await tx.select(columns).from(users).where(eq(users.id, memberId)).get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No member has this id.");
	}

	return row;
}

/**
 * The row may change only while it is not an administrator, or while another
 * administrator remains. In the `update` or `delete` statement itself rather
 * than in a read before it, so two administrators demoting each other at once
 * leave one: the second statement counts after the first one wrote.
 */
function keepsAnAdmin(tx: Transaction, memberId: string) {
	const admins = tx.select({ count: count() }).from(users).where(eq(users.role, "admin"));

	return and(eq(users.id, memberId), or(ne(users.role, "admin"), gt(admins, 1)));
}

const lastAdmin = () =>
	new AppError("LAST_ADMIN", "The household must keep at least one administrator.");

/**
 * Gives `memberId` the role `role`, applied at their next request, since
 * `requireSession` reads the role on each one; their sessions stay. A
 * demotion to `viewer` also deletes, in the same transaction, the
 * invitations they sent that are still pending and every assistant they
 * connected, consents and tokens: a later promotion must not revive a link
 * or an assistant granted under the role they lost, as Sure revokes tokens
 * on deactivation. The same role changes nothing.
 */
export async function setMemberRole(
	deps: MemberDeps,
	actorId: string,
	memberId: string,
	role: UserRole,
): Promise<Member> {
	refuseSelf(actorId, memberId);

	const outcome = await deps.db.transaction(
		async (tx) => {
			const current = await memberOrNotFound(tx, memberId);

			if (current.role === role) {
				return { row: current, changed: false };
			}

			const [row] = await tx
				.update(users)
				.set({ role })
				.where(keepsAnAdmin(tx, memberId))
				.returning(columns);

			if (row === undefined) {
				throw lastAdmin();
			}

			if (role === "viewer") {
				await tx
					.delete(invitations)
					.where(and(eq(invitations.inviterId, memberId), isNull(invitations.acceptedAt)));
				await tx.delete(oauthConsents).where(eq(oauthConsents.userId, memberId));
				await tx.delete(oauthAccessTokens).where(eq(oauthAccessTokens.userId, memberId));
				await tx.delete(oauthRefreshTokens).where(eq(oauthRefreshTokens.userId, memberId));
			}

			return { row, changed: true };
		},
		{ behavior: "immediate" },
	);

	if (outcome.changed) {
		// Ids and the role only: a name or an email names a person.
		deps.logger.info({ memberId, actorId, role }, "member role changed");
	}

	return member(outcome.row);
}

/**
 * Removes `memberId`: deleting the user cascades to their sessions, so they
 * are signed out everywhere at once, to their credentials, two-factor
 * secret, invitations sent, assistant consents and tokens. The invitations
 * addressed to their email go too, accepted ones included, as Sure's
 * `profiles_controller#destroy`. Nothing in the household's data names a
 * user, so the accounts and transactions stay.
 */
export async function removeMember(
	deps: MemberDeps,
	actorId: string,
	memberId: string,
): Promise<void> {
	refuseSelf(actorId, memberId);

	await deps.db.transaction(
		async (tx) => {
			const current = await memberOrNotFound(tx, memberId);

			await tx.delete(invitations).where(eq(invitations.email, current.email));

			const removed = await tx
				.delete(users)
				.where(keepsAnAdmin(tx, memberId))
				.returning({ id: users.id });

			if (removed.length === 0) {
				throw lastAdmin();
			}
		},
		{ behavior: "immediate" },
	);

	deps.logger.info({ memberId, actorId }, "member removed");
}
