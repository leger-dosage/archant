import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One row per MCP tool call (AD-19): which assistant, which tool, when, how it
 * ended and how many rows it changed. Never its arguments or its result, which
 * hold amounts and labels (AD-14). Kept 90 days.
 */
export const assistantCalls = sqliteTable(
	"assistant_calls",
	{
		id: text("id").primaryKey(),
		/** `oauth_clients.client_id`; no foreign key, so the record outlives nothing it describes. */
		clientId: text("client_id").notNull(),
		tool: text("tool").notNull(),
		/** `OK`, or the `AppError` code the tool answered with. */
		outcome: text("outcome").notNull(),
		changedRows: integer("changed_rows").notNull(),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [
		index("assistant_calls_created_at").on(table.createdAt),
		index("assistant_calls_client_id").on(table.clientId),
	],
);
