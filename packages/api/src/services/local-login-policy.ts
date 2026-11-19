import type { BetterAuthPlugin } from "better-auth";

import { APIError, createAuthMiddleware } from "better-auth/api";
import { z } from "zod";

export type LocalLoginPolicy = {
	localLoginEnabled: boolean;
	localAdminOverrideEnabled: boolean;
};

export function allowsPassword(policy: LocalLoginPolicy, role?: string | null): boolean {
	return policy.localLoginEnabled || (policy.localAdminOverrideEnabled && role === "admin");
}

export function localLoginPolicy(policy: LocalLoginPolicy): BetterAuthPlugin {
	return {
		id: "local-login-policy",
		init: () => ({
			options: {
				databaseHooks: {
					session: {
						create: {
							before: async (session, ctx) => {
								if (policy.localLoginEnabled || !ctx) {
									return;
								}
								const passwordStep =
									ctx.path === "/sign-in/email" ||
									ctx.path === "/two-factor/verify-totp" ||
									ctx.path === "/two-factor/verify-backup-code" ||
									(ctx.path === "/passkey/sign-in" && ctx.body?.mode === "second-factor");
								if (!passwordStep) {
									return;
								}
								const user = await ctx.context.internalAdapter.findUserById(session.userId);
								const role = z.object({ role: z.string() }).safeParse(user).data?.role;
								if (!allowsPassword(policy, role)) {
									throw APIError.fromStatus("UNAUTHORIZED");
								}
							},
						},
					},
				},
			},
		}),
		hooks: {
			before: [
				{
					matcher: (ctx) => ctx.path === "/sign-in/email" && !policy.localLoginEnabled,
					handler: createAuthMiddleware(async (ctx) => {
						const parsed = z.object({ email: z.email() }).safeParse(ctx.body);
						const user =
							policy.localAdminOverrideEnabled && parsed.success
								? await ctx.context.internalAdapter.findUserByEmail(parsed.data.email)
								: null;
						if (
							!allowsPassword(
								policy,
								z.object({ role: z.string() }).safeParse(user?.user).data?.role,
							)
						) {
							throw APIError.from("UNAUTHORIZED", {
								code: "INVALID_EMAIL_OR_PASSWORD",
								message: "Invalid email or password",
							});
						}
					}),
				},
			],
		},
	};
}
