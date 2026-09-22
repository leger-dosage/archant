import type { Auth } from "./auth.ts";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../schemas/setup.ts";

/** Why a reset was refused, as a code the caller turns into its own words. */
export type PasswordResetProblem = "unknown_user" | "password_too_short" | "password_too_long";

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
 * control of the old password.
 */
export async function resetPassword(
	deps: PasswordDeps,
	email: string,
	newPassword: string,
): Promise<{ userId: string }> {
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
	await context.internalAdapter.updatePassword(found.user.id, hash);
	await context.internalAdapter.deleteUserSessions(found.user.id);

	return { userId: found.user.id };
}
