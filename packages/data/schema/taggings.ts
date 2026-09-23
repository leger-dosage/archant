import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { tags } from "./tags.ts";
import { transactions } from "./transactions.ts";

/**
 * Which tags a transaction carries. Only the ledger writes it, and it deletes a
 * row's taggings before the row, as it does for entry keys.
 */
export const taggings = sqliteTable(
	"taggings",
	{
		// Restrict, not cascade, on both ends: a delete path that forgets the
		// taggings fails in its tests instead of silently dropping links.
		transactionId: text("transaction_id")
			.notNull()
			.references(() => transactions.entryId, { onDelete: "restrict" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "restrict" }),
	},
	(table) => [
		primaryKey({ columns: [table.transactionId, table.tagId] }),
		// Deleting a tag, counting its rows and the list's filter look taggings up by tag.
		index("taggings_tag").on(table.tagId),
	],
);
