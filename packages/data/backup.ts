import { sql } from "drizzle-orm";
import { closeSync, existsSync, openSync } from "node:fs";
import { chmod, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { createDb, databasePath } from "./client.ts";
import { pendingMigrations } from "./migrate.ts";

/** Copies kept in `backups/`: a crash loop or a string of upgrades never fills the disk. */
export const KEPT_COPIES = 5;

export type BackupOutcome =
	| {
			copied: string;
			kept: number;
			/** The error code of a failed pruning, which leaves older copies behind. */
			pruneFailed?: string;
	  }
	| { skipped: "remote" | "new" | "up-to-date" };

/** A copy that could not be written: the caller must not migrate. */
export class BackupError extends Error {
	readonly code: string;
	readonly directory: string;

	constructor(code: string, directory: string, cause: unknown) {
		super(`The database could not be copied to ${directory} (${code}).`, { cause });
		this.name = "BackupError";
		this.code = code;
		this.directory = directory;
	}
}

/** The `code` of a Node or SQLite error, looked for through Drizzle's wrapper. */
export function errorCode(error: unknown): string {
	let current: unknown = error;

	while (typeof current === "object" && current !== null) {
		if ("code" in current && typeof current.code === "string") {
			return current.code;
		}

		current = "cause" in current ? current.cause : undefined;
	}

	return "UNKNOWN";
}

/** `20260927T083000Z`: sorting names by text sorts them by time. */
function timestamp(now: Date): string {
	return now
		.toISOString()
		.replace(/\.\d{3}Z$/u, "Z")
		.replace(/[-:]/gu, "");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Deletes this database's copies beyond the most recent `KEPT_COPIES`, and no
 * other file: `backups/` may hold the owner's own copies.
 */
async function prune(
	directory: string,
	stem: string,
	written: string,
): Promise<{ kept: number; pruneFailed?: string }> {
	const pattern = new RegExp(`^${escapeRegExp(stem)}-\\d{8}T\\d{6}Z-.+\\.db$`, "u");
	const partialPattern = new RegExp(
		`^${escapeRegExp(stem)}-\\d{8}T\\d{6}Z-.+\\.db\\.partial$`,
		"u",
	);
	let copies: string[];
	let partials: string[];

	try {
		const names = await readdir(directory);
		// The copy just written stays whatever its name sorts as: a clock set
		// behind older copies would otherwise make it the first to go.
		copies = names
			.filter((name) => pattern.test(name) && name !== written)
			.toSorted()
			.toReversed();
		// Left by a copy killed mid-write, under a time no later copy repeats.
		partials = names.filter((name) => partialPattern.test(name));
	} catch (error) {
		// Unreadable right after the copy was written: only that copy is certain.
		return { kept: 1, pruneFailed: errorCode(error) };
	}

	const stale = copies.slice(KEPT_COPIES - 1);
	const removals = await Promise.allSettled(
		[...stale, ...partials].map((name) => rm(join(directory, name))),
	);
	const failed = removals.find((removal) => removal.status === "rejected");
	const removedCopies = removals
		.slice(0, stale.length)
		.filter((removal) => removal.status === "fulfilled").length;
	const kept = 1 + copies.length - removedCopies;

	return failed === undefined ? { kept } : { kept, pruneFailed: errorCode(failed.reason) };
}

/**
 * Copies a local database to `backups/` beside it when a migration is pending,
 * so a failed upgrade can go back: migrations only go forward, and a migrated
 * file no longer opens in the previous image. Throws a `BackupError` when the
 * copy fails, and the caller must then not migrate.
 */
export async function copyBeforeMigrating({
	url,
	authToken,
	version,
	now,
}: {
	url: string;
	authToken?: string | undefined;
	version: string | null;
	now: Date;
}): Promise<BackupOutcome> {
	if (!url.startsWith("file:")) {
		return { skipped: "remote" };
	}

	// Nothing to lose in memory, nor in a file that does not exist yet; opening
	// the latter would create it.
	const path = url.includes(":memory:") ? null : databasePath(url);
	if (path === null || !existsSync(path)) {
		return { skipped: "new" };
	}

	const db = authToken === undefined ? await createDb(url) : await createDb(url, authToken);
	const directory = join(dirname(path), "backups");
	const stem = basename(path, extname(path));
	const name = `${stem}-${timestamp(now)}-${version ?? "dev"}.db`;
	const partial = join(directory, `${name}.partial`);

	try {
		const pending = await pendingMigrations(db);

		// A database with no migration table holds nothing yet, and copying it
		// would leave an empty file at every fresh install.
		if (pending === "new") {
			return { skipped: "new" };
		}

		if (pending === "none") {
			return { skipped: "up-to-date" };
		}

		try {
			// Each copy holds every transaction: the directory and the copies are
			// the owner's alone, whatever the umask. A directory made before this
			// rule loses its group and other bits; the owner's are left as set.
			await mkdir(directory, { recursive: true, mode: 0o700 });
			// Best effort: a directory another user owns, such as a bind mount or
			// one an earlier run as root made, refuses `chmod` while still
			// accepting the copy, and a refused copy would refuse the upgrade.
			await chmod(directory, (await stat(directory)).mode & 0o700).catch(() => undefined);
			// `VACUUM INTO` refuses a file that is not empty, which only a killed
			// copy started within the same second leaves under this name; older
			// ones go with pruning.
			await rm(partial, { force: true });
			// Created empty, the owner's alone, before `VACUUM INTO` fills it:
			// created by SQLite, it would be readable by everyone while written.
			closeSync(openSync(partial, "wx", 0o600));
			// No Drizzle builder writes `VACUUM INTO`; the path is bound, never
			// interpolated into the statement.
			await db.run(sql`VACUUM INTO ${partial}`);
			// Only a complete copy carries the name pruning and a restore look for.
			await rename(partial, join(directory, name));
		} catch (error) {
			await rm(partial, { force: true }).catch(() => undefined);
			throw new BackupError(errorCode(error), directory, error);
		}
	} finally {
		db.$client.close();
	}

	return { copied: name, ...(await prune(directory, stem, name)) };
}
