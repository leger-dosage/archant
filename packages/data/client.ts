import type { Client } from "@libsql/client";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

export type Database = LibSQLDatabase & { $client: Client };

// Long enough to outwait another `behavior: "immediate"` ledger transaction,
// short enough that a stuck writer surfaces as an error rather than a hang.
const BUSY_TIMEOUT_MS = 5000;

/**
 * The only place in the codebase that picks a driver and tunes the connection.
 * Every target -- a local file, a Docker volume, Turso -- is the same libSQL
 * client behind the same SQLite dialect, so nothing above this function knows
 * where the data lives.
 */
export async function createDb(url: string, authToken?: string): Promise<Database> {
	const isFile = url.startsWith("file:");
	// `exactOptionalPropertyTypes` rejects an explicit `undefined`, which is
	// exactly the local-file case, so absent keys are omitted rather than set.
	const client = createClient({
		url,
		...(authToken === undefined ? {} : { authToken }),
		// libSQL applies `timeout` as `busy_timeout` on every pooled connection,
		// which a one-off PRAGMA could not do: the pool opens connections lazily.
		...(isFile ? { timeout: BUSY_TIMEOUT_MS } : {}),
	});

	// libSQL already turns foreign keys on for each connection it opens. Stating
	// it here keeps the guarantee visible, and fails loudly if a driver upgrade
	// ever drops that default on the connection the pool hands out first.
	await client.execute("PRAGMA foreign_keys = ON");

	if (isFile && !url.includes(":memory:")) {
		// Persisted in the file itself, so setting it once covers every
		// connection. Readers then no longer block the ledger's writes.
		await client.execute("PRAGMA journal_mode = WAL");
	}

	return drizzle(client);
}
