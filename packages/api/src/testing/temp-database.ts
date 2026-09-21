import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Database } from "@archant/data/client";
import { createDb } from "@archant/data/client";
import { runMigrations } from "@archant/data/migrate";

export type TempDatabase = { db: Database; dispose: () => Promise<void> };

/**
 * A migrated SQLite file in a temporary directory, one per spec file. Not
 * `:memory:`: a libSQL transaction borrows its own pooled connection, and every
 * connection to `:memory:` is a different, empty database.
 */
export async function createTempDatabase(): Promise<TempDatabase> {
	const directory = await mkdtemp(join(tmpdir(), "archant-api-"));
	const url = `file:${join(directory, "test.db")}`;

	await runMigrations(url);
	const db = await createDb(url);

	return {
		db,
		dispose: async () => {
			db.$client.close();
			await rm(directory, { recursive: true, force: true });
		},
	};
}
