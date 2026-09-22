import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Database } from "@archant/data/client";
import { createDb } from "@archant/data/client";
import { runMigrations } from "@archant/data/migrate";

export type TempDatabase = {
	db: Database;
	/** The SQLite file, which `createTempDatabase` can copy once `db` is closed. */
	file: string;
	dispose: () => Promise<void>;
};

/**
 * A migrated SQLite file in a temporary directory, one per spec file. Not
 * `:memory:`: a libSQL transaction borrows its own pooled connection, and every
 * connection to `:memory:` is a different, empty database.
 *
 * With `copyOf`, the new database starts as a copy of that file instead, such
 * as one already holding a signed-in administrator.
 */
export async function createTempDatabase(copyOf?: string): Promise<TempDatabase> {
	const directory = await mkdtemp(join(tmpdir(), "archant-api-"));
	const file = join(directory, "test.db");
	const url = `file:${file}`;

	if (copyOf === undefined) {
		await runMigrations(url);
	} else {
		await copyFile(copyOf, file);
	}

	const db = await createDb(url);

	return {
		db,
		file,
		dispose: async () => {
			db.$client.close();
			await rm(directory, { recursive: true, force: true });
		},
	};
}
