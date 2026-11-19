import type { Auth } from "./auth.ts";

import { getCurrentAdapter, runWithTransaction } from "@better-auth/core/context";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../schemas/setup.ts";

/** Why a reset was refused, as a code the caller turns into its own words. */
export type PasswordResetProblem =
	| "unknown_user"
	| "no_local_password"
	| "password_too_short"
	| "password_too_long";

export class PasswordResetError extends Error {
	readonly problem: PasswordResetProblem;

	constructor(problem: PasswordResetProblem) {
		super(problem);
		this.name = "PasswordResetError";
		this.problem = problem;
	}
}

export type PasswordDeps = { auth: Pick<Auth, "$context"> };

/**
 * Resets a password from a shell, with no email service and no reset token
 * (AD-13). `auth.$context` is Better Auth's own door to its adapter and its
 * hasher, so nothing here hashes a password itself: `auth.api.setUserPassword`
 * sits behind an admin session a shell does not have, and `setPassword`
 * refuses an account that already has one.
 *
 * Every session of the user is deleted, since whoever needs this has lost
 * control of the old password. Two-factor sign-in is turned off too: the
 * server shell is its recovery path, for a lost phone and for a lost
 * `BETTER_AUTH_SECRET` alike, which leaves the stored secret unreadable.
 */
export async function resetPassword(
	deps: PasswordDeps,
	email: string,
	newPassword: string,
): Promise<{ userId: string; twoFactorDisabled: boolean }> {
	if (newPassword.length < PASSWORD_MIN_LENGTH) {
		throw new PasswordResetError("password_too_short");
	}

	if (newPassword.length > PASSWORD_MAX_LENGTH) {
		throw new PasswordResetError("password_too_long");
	}

	const context = await deps.auth.$context;
	const found = await context.internalAdapter.findUserByEmail(email);

	if (found === null) {
		throw new PasswordResetError("unknown_user");
	}

	const hash = await context.password.hash(newPassword);
	return runWithTransaction(context.adapter, async () => {
		const userId = found.user.id;
		const credential = await context.internalAdapter.findCredentialAccount(userId);
		if (!credential?.password) {
			throw new PasswordResetError("no_local_password");
		}

		await context.internalAdapter.updatePassword(userId, hash);
		const user = await context.internalAdapter.findUserById(userId);
		const wasEnabled =
			user !== null && "twoFactorEnabled" in user && user.twoFactorEnabled === true;
		if (wasEnabled) {
			await context.internalAdapter.updateUser(userId, { twoFactorEnabled: false });
		}

		const adapter = await getCurrentAdapter(context.adapter);
		// The same write transaction revokes sessions and the enrolment's
		// credentials, so a concurrent passkey sign-in cannot survive recovery.
		await adapter.deleteMany({ model: "twoFactor", where: [{ field: "userId", value: userId }] });
		await context.internalAdapter.deleteUserSessions(userId);

		return { userId, twoFactorDisabled: wasEnabled };
	});
}
