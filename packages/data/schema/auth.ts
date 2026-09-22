import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { inList } from "./check.ts";

/**
 * Better Auth's tables (AD-13). Generated once with `pnpm dlx auth@1.7.5
 * generate` for email and password with the `admin` plugin, then maintained by
 * hand: a Better Auth upgrade that adds a column needs a migration here.
 * Better Auth writes `Date` objects, which `timestamp_ms` stores as epoch
 * milliseconds like every other timestamp in the schema.
 */

/**
 * Every role a user can hold. Only `admin` exists: one household, one owner.
 * A `viewer` later is a new value here and a check rebuilt, no data migration.
 */
export const USER_ROLES = ["admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];

const createdAt = () =>
	integer("created_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull();

const updatedAt = () =>
	integer("updated_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.$onUpdate(() => new Date())
		.notNull();

export const users = sqliteTable(
	"users",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull().unique(),
		emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
		image: text("image"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		// The admin plugin declares it `input: false`, so Better Auth's own
		// update endpoint refuses it: nobody promotes themselves through it.
		role: text("role").$type<UserRole>().notNull(),
		banned: integer("banned", { mode: "boolean" }).default(false),
		banReason: text("ban_reason"),
		banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
	},
	(table) => [check("users_role_check", sql`${table.role} in ${inList(USER_ROLES)}`)],
);

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
