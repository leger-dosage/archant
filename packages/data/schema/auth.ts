import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "./accounts.ts";

export { users } from "./accounts.ts";

/**
 * Better Auth's tables (AD-13). Generated once with `pnpm dlx auth@1.7.5
 * generate` for email and password with the `admin` plugin, then maintained by
 * hand: a Better Auth upgrade that adds a column needs a migration here.
 * Better Auth writes `Date` objects, which `timestamp_ms` stores as epoch
 * milliseconds like every other timestamp in the schema.
 */

const createdAt = () =>
	integer("created_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull();

const updatedAt = () =>
	integer("updated_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.$onUpdate(() => new Date())
		.notNull();

export const sessions = sqliteTable(
	"sessions",
	{
		id: text("id").primaryKey(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: createdAt(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => new Date())
			.notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		impersonatedBy: text("impersonated_by"),
	},
	(table) => [index("sessions_user_id").on(table.userId)],
);

/**
 * Better Auth's `account` model: credentials, here a password hash. Renamed so
 * it never collides with the domain's bank `accounts`.
 */
export const authAccounts = sqliteTable(
	"auth_accounts",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
		refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
		scope: text("scope"),
		password: text("password"),
		createdAt: createdAt(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("auth_accounts_user_id").on(table.userId)],
);

export const verifications = sqliteTable(
	"verifications",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [index("verifications_identifier").on(table.identifier)],
);

/**
 * The `twoFactor` plugin's TOTP secret and backup codes, both encrypted with
 * `BETTER_AUTH_SECRET`. A row with `verified` false is an activation the
 * user started and never confirmed with a code: it signs nobody in.
 * `failed_verification_count` and `locked_until` are the plugin's account
 * lockout, which caps wrong codes across challenges. `last_used_step` is the
 * last 30-second step a TOTP code signed in with, declared by
 * `services/one-time-totp.ts`: a code read over a shoulder or relayed by a
 * phishing page would otherwise sign in again within its window, as Sure's
 * `otp_last_used_at` prevents.
 */
export const twoFactors = sqliteTable(
	"two_factors",
	{
		id: text("id").primaryKey(),
		secret: text("secret").notNull(),
		backupCodes: text("backup_codes").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		verified: integer("verified", { mode: "boolean" }).default(true),
		failedVerificationCount: integer("failed_verification_count").default(0),
		lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
		lastUsedStep: integer("last_used_step"),
	},
	(table) => [index("two_factors_user_id").on(table.userId)],
);

export const passkeys = sqliteTable(
	"passkeys",
	{
		id: text("id").primaryKey(),
		name: text("name"),
		publicKey: text("public_key").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		// Both ways to disable two-factor already delete the enrolment.
		factorId: text("factor_id")
			.notNull()
			.references(() => twoFactors.id, { onDelete: "cascade" }),
		userHandle: text("user_handle").notNull(),
		credentialID: text("credential_id").notNull().unique(),
		counter: integer("counter").notNull(),
		deviceType: text("device_type").notNull(),
		backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
		transports: text("transports"),
		createdAt: createdAt(),
		lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
		aaguid: text("aaguid"),
	},
	(table) => [
		index("passkeys_user_id").on(table.userId),
		index("passkeys_factor_id").on(table.factorId),
	],
);

/**
 * Better Auth's per-address rate limit, in the database so a restart does not
 * hand a guesser a fresh allowance. `key` is the address and the path;
 * `last_request` is epoch milliseconds, written by Better Auth as a number.
 */
export const rateLimits = sqliteTable("rate_limits", {
	id: text("id").primaryKey(),
	key: text("key").notNull().unique(),
	count: integer("count").notNull(),
	lastRequest: integer("last_request").notNull(),
});

/**
 * Failed sign-ins across every address, one fixed window at a time: the
 * ceiling that stops many addresses guessing in parallel. Not Better Auth's
 * table: it prunes rows older than its longest window, a minute, which would
 * reset a ten-minute count. One row, `all`.
 */
export const signInFailures = sqliteTable("sign_in_failures", {
	id: text("id").primaryKey(),
	count: integer("count").notNull(),
	windowStartedAt: integer("window_started_at").notNull(),
});
