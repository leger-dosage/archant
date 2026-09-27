import { migrate } from "drizzle-orm/libsql/migrator";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb } from "../client.ts";
import { migrationsFolder } from "../migrate.ts";

// No vitest import: the CI `image` job runs this file with the production
// dependencies only, to leave a pending migration on the container's volume.

function isJournal(value: unknown): value is { entries: { tag: string }[] } {
	return (
		typeof value === "object" &&
		value !== null &&
		"entries" in value &&
		Array.isArray(value.entries) &&
		value.entries.every(
			(entry: unknown) =>
				typeof entry === "object" &&
				entry !== null &&
				"tag" in entry &&
				typeof entry.tag === "string",
		)
	);
}

/**
 * Migrates `url` through the journal entries `keep` selects, from a copy of the
 * folder whose journal lists only those. The copy lives under the system's
 * temporary directory, the one place a read-only container lets it be written.
 */
async function migrateThrough(
	url: string,
	keep: (entries: { tag: string }[]) => { tag: string }[],
): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), "archant-journal-"));

	try {
		const folder = join(directory, "drizzle");
		await cp(migrationsFolder, folder, { recursive: true });
		const journalPath = join(folder, "meta", "_journal.json");
		const journal: unknown = JSON.parse(await readFile(journalPath, "utf8"));

		if (!isJournal(journal)) {
			throw new Error("drizzle-kit changed the shape of its journal.");
		}

		await writeFile(journalPath, JSON.stringify({ ...journal, entries: keep(journal.entries) }));
		const db = await createDb(url);

		try {
			await migrate(db, { migrationsFolder: folder });
		} finally {
			db.$client.close();
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

/** Migrates `url` up to, not including, the migration whose tag starts with `tag`. */
export async function migrateBefore(url: string, tag: string): Promise<void> {
	await migrateThrough(url, (entries) => entries.filter((entry) => entry.tag < tag));
}

/** Migrates `url` up to the next-to-last migration, as an upgrade finds it. */
export async function migrateAllButLast(url: string): Promise<void> {
	await migrateThrough(url, (entries) => entries.slice(0, -1));
}
