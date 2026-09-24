import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { bankConnections } from "./bank-connections.ts";

/**
 * Sure's `EnableBankingAccount`: one account the bank returned with a
 * session, kept from the callback on because the provider lists a session's
 * accounts only then. What the household does with it lives on the other
 * side, in `accounts.bank_account_id`.
 */
export const bankAccounts = sqliteTable(
	"bank_accounts",
	{
		id: text("id").primaryKey(),
		bankConnectionId: text("bank_connection_id")
			.notNull()
			.references(() => bankConnections.id, { onDelete: "cascade" }),
		// Stable across consent renewals, where `provider_uid` is not: the
		// identity a renewed session's accounts are matched on (Story 10.5).
		identificationHash: text("identification_hash").notNull(),
		// Scoped to one session: the reference every data call uses.
		providerUid: text("provider_uid").notNull(),
		name: text("name").notNull(),
		// Never the full IBAN: only what the interface shows.
		ibanLast4: text("iban_last4"),
		currency: text("currency").notNull(),
		// ISO 20022 cash account type as the bank reports it, such as `CACC`.
		cashAccountType: text("cash_account_type"),
		// Epoch milliseconds of this account's last committed sync. The window
		// lives here, not on the connection: an account that keeps failing
		// would otherwise come back with a gap once the others moved on.
		lastSyncedAt: integer("last_synced_at"),
		// Whether the connection's current session shares it. A renewal whose
		// consent leaves it out keeps the row and its link, as Sure does, but a
		// sync must not ask the new session for a uid it does not know: that
		// account would fail every run and hold the connection's last sync back.
		listed: integer("listed", { mode: "boolean" }).notNull().default(true),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		uniqueIndex("bank_accounts_connection_hash_unique").on(
			table.bankConnectionId,
			table.identificationHash,
		),
	],
);
