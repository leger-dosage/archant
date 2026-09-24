import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { inList } from "./check.ts";

/** Bank connector ids. The same string will be `entry_keys.source` for synced lines. */
export const BANK_CONNECTOR_IDS = ["enable-banking"] as const;

export type BankConnectorId = (typeof BANK_CONNECTOR_IDS)[number];

/**
 * `pending` from the redirect to the bank until the callback, `active` once
 * the session is open. Renewal and revocation (Story 10.5) add their own.
 */
export const BANK_CONNECTION_STATUSES = ["pending", "active"] as const;

export type BankConnectionStatus = (typeof BANK_CONNECTION_STATUSES)[number];

/**
 * Sure's `EnableBankingItem`: one consent given at one bank. The row exists
 * from the redirect on, so the callback can find it by `authorization_state`
 * alone and nothing about the attempt lives in the browser.
 */
export const bankConnections = sqliteTable(
	"bank_connections",
	{
		id: text("id").primaryKey(),
		connector: text("connector").$type<BankConnectorId>().notNull(),
		institutionName: text("institution_name").notNull(),
		/** ISO 3166-1 alpha-2, as the provider lists the bank under. */
		country: text("country").notNull(),
		status: text("status").$type<BankConnectionStatus>().notNull(),
		// The OAuth `state` of a pending attempt, cleared once used so a replay
		// finds nothing. Unique: two attempts never share a callback.
		authorizationState: text("authorization_state"),
		// Encrypted by the API's crypto service (`v1:<iv>:<tag>:<ciphertext>`),
		// never stored in clear: it is a bearer credential for the account data.
		sessionId: text("session_id"),
		// Epoch milliseconds, in clear: the expiry banner queries it.
		consentExpiresAt: integer("consent_expires_at"),
		// Epoch milliseconds of the last run where every account synced.
		lastSyncedAt: integer("last_synced_at"),
		// The `AppError` code of the latest failed run, cleared by a clean one.
		lastError: text("last_error"),
		// The sync lease: set while a run holds the connection, and treated as
		// free after ten minutes so a crashed run never locks it for good.
		syncStartedAt: integer("sync_started_at"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		check(
			"bank_connections_connector_check",
			sql`${table.connector} in ${inList(BANK_CONNECTOR_IDS)}`,
		),
		check(
			"bank_connections_status_check",
			sql`${table.status} in ${inList(BANK_CONNECTION_STATUSES)}`,
		),
		uniqueIndex("bank_connections_authorization_state_unique").on(table.authorizationState),
	],
);
