import type { UserRole } from "../user-roles.ts";

import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { USER_ROLES } from "../user-roles.ts";
import { users } from "./auth.ts";
import { inList } from "./check.ts";

/**
 * A link the administrator hands someone of the household, as self-hosted
 * Sure's `Invitation` (AD-21). Only the SHA-256 of its token is stored: a
 * copy of the database cannot be turned into a working link. Pending while
 * `accepted_at` is null and `expires_at` is ahead; a revoked one is deleted.
 */
export const invitations = sqliteTable(
	"invitations",
	{
		id: text("id").primaryKey(),
		// Trimmed and lowercased, as Better Auth stores a user's email, so the
		// two compare as they are.
		email: text("email").notNull(),
		role: text("role").$type<UserRole>().notNull(),
		// Hex SHA-256 of the 32 random bytes the link carries.
		tokenHash: text("token_hash").notNull().unique(),
		// A removed inviter takes their invitations with them: a link should not
		// outlive the person who vouched for it.
		inviterId: text("inviter_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		expiresAt: integer("expires_at").notNull(),
		acceptedAt: integer("accepted_at"),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [
		check("invitations_role_check", sql`${table.role} in ${inList(USER_ROLES)}`),
		// One pending invitation per email, as Sure's `invitation.rb`; an
		// expired one is deleted before the next is created, and accepted ones
		// stay as a record.
		uniqueIndex("invitations_pending_email_unique")
			.on(table.email)
			.where(sql`${table.acceptedAt} is null`),
		index("invitations_inviter_id").on(table.inviterId),
	],
);
