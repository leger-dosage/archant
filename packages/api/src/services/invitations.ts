import type { Logger } from "../lib/logger.ts";
import type { AcceptInvitationInput, CreateInvitationInput } from "../schemas/invitations.ts";
import type { Auth } from "./auth.ts";
import type { ServiceDeps } from "./deps.ts";

import { and, asc, eq, gt, isNull, lte } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";

import { users } from "@archant/data/schema/auth";
import { invitations } from "@archant/data/schema/invitations";
import type { UserRole } from "@archant/data/user-roles";

import { AppError } from "../lib/errors.ts";

export type InvitationDeps = Pick<ServiceDeps, "db"> & {
	auth: Pick<Auth, "api">;
	logger: Logger;
	/** `BETTER_AUTH_URL`: the address the household reaches, so the one a link names. */
	trustedOrigin: string;
};

/** Sure's `Invitation` expires after three days. */
const LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;

export type PendingInvitation = { id: string; email: string; role: UserRole; expiresAt: number };

export type CreatedInvitation = PendingInvitation & {
	/** The link, holding the token: answered once, never stored or logged. */
	url: string;
};

export type InvitationPreview = { email: string; role: UserRole; inviterName: string };

const fieldError = (code: "user_exists" | "invitation_pending") =>
	new AppError("VALIDATION_ERROR", "The request is invalid.", [{ path: "email", code }]);

const invalid = () => new AppError("INVITATION_INVALID", "This invitation is no longer valid.");

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Not accepted, and not expired at `now`: a revoked one no longer exists. */
const pendingAt = (now: number) =>
	and(isNull(invitations.acceptedAt), gt(invitations.expiresAt, now));

/**
 * Invites `email` as `role`, and answers the link once. An email that has a
 * user, or a pending invitation, is refused. Every expired invitation never
 * accepted is deleted first, this email's as Sure's
 * `remove_expired_duplicates_in_family`, and every other's too: it holds the
 * email of someone who never joined, and nothing reads it. One immediate
 * transaction, so two concurrent invitations of one email cannot both pass
 * the checks; the unique index on pending emails stands behind it.
 */
export async function createInvitation(
	deps: InvitationDeps,
	inviterId: string,
	input: CreateInvitationInput,
): Promise<CreatedInvitation> {
	const email = input.email.toLowerCase();
	const token = randomBytes(32).toString("base64url");
	const id = crypto.randomUUID();
	const now = Date.now();
	const expiresAt = now + LIFETIME_MS;

	await deps.db.transaction(
		async (tx) => {
			const user = await tx
				.select({ id: users.id })
				.from(users)
				.where(eq(users.email, email))
				.get();

			if (user !== undefined) {
				throw fieldError("user_exists");
			}

			await tx
				.delete(invitations)
				.where(and(isNull(invitations.acceptedAt), lte(invitations.expiresAt, now)));

			const pending = await tx
				.select({ id: invitations.id })
				.from(invitations)
				.where(and(eq(invitations.email, email), isNull(invitations.acceptedAt)))
				.get();

			if (pending !== undefined) {
				throw fieldError("invitation_pending");
			}

			await tx.insert(invitations).values({
				id,
				email,
				role: input.role,
				tokenHash: hashToken(token),
				inviterId,
				expiresAt,
				createdAt: now,
			});
		},
		{ behavior: "immediate" },
	);

	// Ids only: the email names a person, and the token opens an account.
	deps.logger.info({ invitationId: id, inviterId }, "invitation created");

	return {
		id,
		email,
		role: input.role,
		expiresAt,
		url: new URL(`/invitations/${token}`, deps.trustedOrigin).href,
	};
}

/** The invitations still pending, the soonest to expire first. */
export async function listInvitations(deps: InvitationDeps): Promise<PendingInvitation[]> {
	return deps.db
		.select({
			id: invitations.id,
			email: invitations.email,
			role: invitations.role,
			expiresAt: invitations.expiresAt,
		})
		.from(invitations)
		.where(pendingAt(Date.now()))
		.orderBy(asc(invitations.expiresAt), asc(invitations.id));
}

/** Deletes a pending invitation, so its link stops working; anything else is `NOT_FOUND`. */
export async function revokeInvitation(deps: InvitationDeps, id: string): Promise<void> {
	const deleted = await deps.db
		.delete(invitations)
		.where(and(eq(invitations.id, id), pendingAt(Date.now())))
		.returning({ id: invitations.id });

	if (deleted.length === 0) {
		throw new AppError("NOT_FOUND", "No pending invitation has this id.");
	}

	deps.logger.info({ invitationId: id }, "invitation revoked");
}

/**
 * What the link's page shows: the email the account will have, the role, and
 * who invites, by name, else by email. An unknown, expired, accepted or
 * revoked token answers `INVITATION_INVALID`, all four alike.
 */
export async function previewInvitation(
	deps: InvitationDeps,
	token: string,
): Promise<InvitationPreview> {
	const row = await deps.db
		.select({
			email: invitations.email,
			role: invitations.role,
			inviterName: users.name,
			inviterEmail: users.email,
		})
		.from(invitations)
		.innerJoin(users, eq(users.id, invitations.inviterId))
		.where(and(eq(invitations.tokenHash, hashToken(token)), pendingAt(Date.now())))
		.get();

	if (row === undefined) {
		throw invalid();
	}

	return {
		email: row.email,
		role: row.role,
		inviterName: row.inviterName.trim() === "" ? row.inviterEmail : row.inviterName,
	};
}

/**
 * Creates the invited user with the invitation's email and role, then signs
 * them in, answering the session's cookies: none when the sign-in failed, and
 * the person signs in on the page.
 *
 * The invitation is claimed first, in one conditional update: Better Auth
 * writes on its own connection, so no transaction can hold both writes, and
 * the claim is what stops two concurrent acceptances from both creating a
 * user. A failed creation releases it, so the link still works, as
 * `completeSetup` does with its claim.
 */
export async function acceptInvitation(
	deps: InvitationDeps,
	input: AcceptInvitationInput,
	headers: Headers,
): Promise<{ cookies: string[] }> {
	const now = Date.now();
	const [claimed] = await deps.db
		.update(invitations)
		.set({ acceptedAt: now })
		.where(and(eq(invitations.tokenHash, hashToken(input.token)), pendingAt(now)))
		.returning({ id: invitations.id, email: invitations.email, role: invitations.role });

	if (claimed === undefined) {
		throw invalid();
	}

	let userId: string;

	try {
		// No headers: a server call, which the admin plugin allows without a
		// session. The claim above is what stands between it and a stranger.
		const { user } = await deps.auth.api.createUser({
			body: {
				email: claimed.email,
				password: input.password,
				// Better Auth requires a name; blank means no greeting by name.
				name: input.name ?? "",
				// Through `data`: without access-control roles, Better Auth types
				// `role` as its own `admin` or `user`, while it stores any string.
				data: { role: claimed.role },
			},
		});

		userId = user.id;
	} catch (error) {
		try {
			await deps.db
				.update(invitations)
				.set({ acceptedAt: null })
				.where(eq(invitations.id, claimed.id));
		} catch {
			// The link stays spent with no user behind it; the original failure says why.
			deps.logger.warn({ invitationId: claimed.id }, "releasing an invitation failed");
		}

		throw error;
	}

	deps.logger.info({ invitationId: claimed.id, userId }, "invitation accepted");

	try {
		const signedIn = await deps.auth.api.signInEmail({
			body: { email: claimed.email, password: input.password },
			headers,
			returnHeaders: true,
		});

		return { cookies: signedIn.headers.getSetCookie() };
	} catch (error) {
		// The account exists: the page sends the person to sign in.
		deps.logger.warn(
			{ invitationId: claimed.id, error: error instanceof Error ? error.name : "unknown" },
			"sign-in after an invitation failed",
		);

		return { cookies: [] };
	}
}
