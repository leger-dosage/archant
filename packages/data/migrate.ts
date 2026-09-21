import { migrate } from "drizzle-orm/libsql/migrator";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDb } from "./client.ts";

// Resolved from this file rather than the working directory, so the command
// behaves the same from the package, from the repository root and in the image.
const migrationsFolder = fileURLToPath(new URL("./drizzle", import.meta.url));

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
