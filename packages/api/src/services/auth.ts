import type { Logger } from "../lib/logger.ts";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";

import type { Database } from "@archant/data/client";
import { authAccounts, sessions, users, verifications } from "@archant/data/schema/auth";

export type AuthOptions = {
	db: Database;
	/** `BETTER_AUTH_SECRET`. */
	secret: string;
	/** `BETTER_AUTH_URL`: the browser's origin, and the one origin Better Auth trusts. */
	baseURL: string;
	/** `TRUSTED_PROXIES`: the proxies Better Auth walks past in `x-forwarded-for`. */
	trustedProxies: string[];
	logger: Logger;
};

/**
 * The admin plugin supplies the `role` field and the server-side `createUser`
 * setup uses; its HTTP endpoints would let the signed-in admin create a
 * second user, set a role the database refuses or ban themselves. Better Auth
 * matches these paths exactly, with no wildcard.
 */
const ADMIN_PATHS = [
	"/admin/set-role",
	"/admin/get-user",
	"/admin/create-user",
	"/admin/update-user",
	"/admin/list-users",
	"/admin/list-user-sessions",
	"/admin/unban-user",
	"/admin/ban-user",
	"/admin/impersonate-user",
	"/admin/stop-impersonating",
	"/admin/revoke-user-session",
	"/admin/revoke-user-sessions",
	"/admin/remove-user",
	"/admin/set-user-password",
	"/admin/has-permission",
];

/**
 * Users and sessions belong to Better Auth (AD-13); nothing here hand-rolls a
 * session or a password. Session length, cookie attributes and password
 * length stay at its defaults (NFR6).
 */
export function createAuth({ db, secret, baseURL, trustedProxies, logger }: AuthOptions) {
	return betterAuth({
		baseURL,
		secret,
		database: drizzleAdapter(db, {
			provider: "sqlite",
			usePlural: true,
			// The adapter looks tables up by key, and with `usePlural` it appends
			// an `s` to the renamed model too: `auth_accounts` becomes this key.
			// The SQL table stays `auth_accounts`.
			schema: { users, sessions, auth_accountss: authAccounts, verifications },
		}),
		account: { modelName: "auth_accounts" },
		// No public sign-up: the only user is the administrator setup creates.
		emailAndPassword: { enabled: true, disableSignUp: true },
		plugins: [admin({ defaultRole: "admin" })],
		disabledPaths: ADMIN_PATHS,
		// `x-forwarded-for` is rebuilt from the TCP peer before Better Auth sees
		// it (lib/client-address.ts); this list is where its walk stops.
		advanced: { ipAddress: { trustedProxies } },
		// Better Auth enables it only when NODE_ENV is production. On explicitly,
		// so a server started any other way still slows down password guessing,
		// and tests see the behaviour that ships.
		rateLimit: { enabled: true },
		telemetry: { enabled: false },
		logger: {
			// The message only: Better Auth's arguments can carry an email or a
			// raw database error, which must not reach the logs (AD-14).
			log: (level, message) => {
				logger[level]({ source: "better-auth" }, message);
			},
		},
	});
}

export type Auth = ReturnType<typeof createAuth>;
