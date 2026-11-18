import type { Logger } from "../lib/logger.ts";
import type { BetterAuthOptions, BetterAuthPlugin, Verification, Where } from "better-auth";

import { getCurrentAdapter } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { createHash } from "node:crypto";
import { z } from "zod";

const RESET_PREFIX = "reset-password:";
// Better Auth also tries the unhashed identifier for older rows.
const HASHED_RESET_PREFIX = "archant-email-reset:";

export type SendPasswordReset = (email: string, link: URL) => Promise<void>;

type VerificationHooks = NonNullable<
	NonNullable<BetterAuthOptions["databaseHooks"]>["verification"]
>;
type BeforeDelete = NonNullable<NonNullable<VerificationHooks["delete"]>["before"]>;
type AuthContext = NonNullable<Parameters<BeforeDelete>[1]>;

export function emailPasswordResetAvailable({ emailAndPassword }: BetterAuthOptions): boolean {
	return (
		emailAndPassword !== undefined &&
		emailAndPassword.enabled &&
		emailAndPassword.sendResetPassword !== undefined
	);
}

async function hasLocalPassword(context: AuthContext["context"], userId: string) {
	if (!emailPasswordResetAvailable(context.options)) {
		return false;
	}
	const account = await context.internalAdapter.findCredentialAccount(userId);

	return Boolean(account?.password);
}

export function emailPasswordReset(baseURL: string, send: SendPasswordReset, logger: Logger) {
	return {
		id: "email-password-reset",
		init: (context) => ({
			options: {
				emailAndPassword: {
					enabled: true,
					resetPasswordTokenExpiresIn: 15 * 60,
					revokeSessionsOnPasswordReset: true,
					sendResetPassword: async ({ user, token }) => {
						if (!(await hasLocalPassword(context, user.id))) {
							return;
						}

						// Fragments stay in the browser. Access logs and referrers
						// never see the token, and the request cannot choose the origin.
						const link = new URL("/reset-password", new URL(baseURL).origin);
						link.hash = new URLSearchParams({ token }).toString();
						void Promise.resolve()
							.then(() => send(user.email, link))
							.catch(() => logger.warn("Password reset email delivery failed"));
					},
				},
				verification: {
					storeIdentifier: {
						default: "plain",
						overrides: {
							[RESET_PREFIX]: {
								hash: async (identifier) =>
									`${HASHED_RESET_PREFIX}${createHash("sha256").update(identifier).digest("hex")}`,
							},
						},
					},
				},
				databaseHooks: {
					verification: { delete: { before: beforeResetTokenConsumption } },
				},
			},
		}),
		endpoints: {
			checkPasswordReset: createAuthEndpoint(
				"/check-password-reset",
				{ method: "POST", body: z.object({ token: z.string().min(1).max(128) }) },
				async ({ body, context, json }) => {
					const verification = await context.internalAdapter.findVerificationValue(
						`${RESET_PREFIX}${body.token}`,
					);

					if (
						!verification ||
						verification.expiresAt < new Date() ||
						!(await hasLocalPassword(context, verification.value))
					) {
						throw APIError.from("BAD_REQUEST", { code: "INVALID_TOKEN", message: "Invalid token" });
					}

					return json({ status: true });
				},
			),
		},
	} satisfies BetterAuthPlugin;
}

async function beforeResetTokenConsumption(verification: Verification, ctx: AuthContext | null) {
	// Better Auth also calls this hook while cleaning up expired verifications.
	if (
		ctx?.path !== "/reset-password" ||
		!verification.identifier.startsWith(HASHED_RESET_PREFIX) ||
		verification.expiresAt < new Date()
	) {
		return true;
	}

	const { context } = ctx;
	if (!(await hasLocalPassword(context, verification.value))) {
		return false;
	}

	// This runs inside Better Auth's password reset transaction. Sibling links,
	// trusted devices and in-progress second factor challenges must expire with
	// the password, even when two reset links are submitted at the same time.
	const adapter = await getCurrentAdapter(context.adapter);
	const related = [HASHED_RESET_PREFIX, "trust-device-", "2fa-"].map((prefix): Where => ({
		field: "identifier",
		operator: "starts_with",
		value: prefix,
		connector: "OR",
	}));
	await adapter.deleteMany({
		model: "verification",
		where: [
			{ field: "value", value: verification.value },
			{ field: "id", operator: "ne", value: verification.id },
			...related,
		],
	});

	return true;
}
