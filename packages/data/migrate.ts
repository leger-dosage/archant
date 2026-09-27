import type { Database } from "./client.ts";

import { and, desc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { numeric, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDb } from "./client.ts";

// Resolved from this file rather than the working directory, so the command
// behaves the same from the package, from the repository root and in the image.
export const migrationsFolder = fileURLToPath(new URL("./drizzle", import.meta.url));

// Declared here, outside `schema/`, so drizzle-kit never generates a migration
// for tables SQLite and the migrator own.
const sqliteMaster = sqliteTable("sqlite_master", { type: text("type"), name: text("name") });
const drizzleMigrations = sqliteTable("__drizzle_migrations", {
	createdAt: numeric("created_at"),
});

/**
 * How many migrations `runMigrations` would apply: `"new"` when the database
 * has never been migrated, `"none"` when it is up to date. Decided as
 * drizzle-orm's libSQL migrator decides it, so the two never disagree: every
 * journal entry newer than the last recorded `created_at` is pending.
 */
export async function pendingMigrations(db: Database): Promise<"new" | "none" | number> {
	const table = await db
		.select({ name: sqliteMaster.name })
		.from(sqliteMaster)
		.where(and(eq(sqliteMaster.type, "table"), eq(sqliteMaster.name, "__drizzle_migrations")));

	if (table.length === 0) {
		return "new";
	}

	const last = await db
		.select({ createdAt: drizzleMigrations.createdAt })
		.from(drizzleMigrations)
		.orderBy(desc(drizzleMigrations.createdAt))
		.limit(1);
	const lastMillis = last[0] === undefined ? undefined : Number(last[0].createdAt);
	const pending = readMigrationFiles({ migrationsFolder }).filter(
		(migration) => lastMillis === undefined || lastMillis < migration.folderMillis,
	).length;

	return pending === 0 ? "none" : pending;
}

/**
 * Applies every migration the journal lists that the database has not seen yet.
 */
export async function runMigrations(url: string, authToken?: string): Promise<void> {
	const db = authToken === undefined ? await createDb(url) : await createDb(url, authToken);

	try {
		await migrate(db, { migrationsFolder });
	} finally {
		db.$client.close();
	}
}

export async function migrateFromEnv(env: Record<string, string | undefined>): Promise<void> {
	const url = env["DATABASE_URL"];

	if (url === undefined || url === "") {
		throw new Error("DATABASE_URL is required to run migrations.");
	}

	const authToken = env["DATABASE_AUTH_TOKEN"];

	await runMigrations(url, authToken === undefined || authToken === "" ? undefined : authToken);
}

// Only when run as a command. Importing this file from a test must not touch a
// database.
const invokedAsCommand =
	process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCommand) {
	await migrateFromEnv(process.env);
}
