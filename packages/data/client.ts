import type { Client } from "@libsql/client";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { closeSync, openSync } from "node:fs";
import { resolve } from "node:path";

export type Database = LibSQLDatabase & { $client: Client };

// Long enough to outwait another `behavior: "immediate"` ledger transaction,
// short enough that a stuck writer surfaces as an error rather than a hang.
const BUSY_TIMEOUT_MS = 5000;

/**
 * The file a `file:` URL names, parsed as `@libsql/core`'s `parseUri` parses
 * it: an optional `//host`, a percent-decoded path, no query or fragment. A
 * relative path resolves against the working directory, as SQLite opens it.
 */
export function databasePath(url: string): string {
	const path = /^file:(?:\/\/[^/?#]*)?(?<path>[^?#]*)/u.exec(url)?.groups?.["path"] ?? "";

	return resolve(decodeURIComponent(path));
}

/**
 * Creates a missing database file empty, readable by its owner only. SQLite
 * gives its `-wal` and `-shm` files the database's own mode, and would
 * otherwise create all three readable by every local user. `wx` leaves a file
 * that exists, and its mode, alone.
 */
function createPrivately(path: string): void {
	try {
		closeSync(openSync(path, "wx", 0o600));
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
			throw error;
		}
	}
}

/**
 * The only place in the codebase that picks a driver and tunes the connection.
 * Every target -- a local file, a Docker volume, Turso -- is the same libSQL
 * client behind the same SQLite dialect, so nothing above this function knows
 * where the data lives.
 */
export async function createDb(url: string, authToken?: string): Promise<Database> {
	const isFile = url.startsWith("file:");

	if (isFile && !url.includes(":memory:")) {
		createPrivately(databasePath(url));
	}

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

/**
 * Gives SQLite's planner the statistics it otherwise never has. Without them,
 * at 100,000 transactions it picked an index over the primary key for every
 * transfer candidate. `analysis_limit` bounds the work to a sample per index,
 * so a decade of history analyses in milliseconds. One `executeMultiple`
 * because the PRAGMA lasts one connection, and the pool would otherwise be
 * free to run `ANALYZE` on another.
 */
export async function refreshStatistics(db: Pick<Database, "$client">): Promise<void> {
	await db.$client.executeMultiple("PRAGMA analysis_limit=1000; ANALYZE;");
}
