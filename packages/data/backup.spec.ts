import { sql } from "drizzle-orm";
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BackupError, copyBeforeMigrating } from "./backup.ts";
import { createDb } from "./client.ts";
import { pendingMigrations, runMigrations } from "./migrate.ts";
import { migrateAllButLast } from "./testing/migrations.ts";

let directory: string;
let url: string;
let backups: string;
let template: string;

const NOW = new Date("2026-09-27T08:30:05.123Z");

// Migrated once and copied into each test. Migrating per test cost a second
// or more on a CI runner sharing its cores with migrate.spec.ts, and the
// first test, paying cold module loads on top, ran past the 5 s timeout on
// 2026-10-07 while measuring nothing about the copy.
beforeAll(async () => {
	template = await mkdtemp(join(tmpdir(), "archant-backup-template-"));
	const templateUrl = `file:${join(template, "archant.db")}`;
	await migrateAllButLast(templateUrl);
	const db = await createDb(templateUrl);
	await db.run(
		sql`insert into accounts (id, name, type, subtype, currency, created_at, updated_at) values ('a1', 'A', 'depository', 'checking', 'EUR', 0, 0)`,
	);
	// The copy takes the main file alone: what still sits in the WAL would be lost.
	await db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
	db.$client.close();
}, 30_000);

afterAll(async () => {
	await rm(template, { recursive: true, force: true });
});

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "archant-backup-"));
	url = `file:${join(directory, "archant.db")}`;
	backups = join(directory, "backups");
});

afterEach(async () => {
	await chmod(backups, 0o700).catch(() => undefined);
	await rm(directory, { recursive: true, force: true });
});

/** A database one migration behind, holding one account, at `path`. */
async function upgradable(path = join(directory, "archant.db")): Promise<void> {
	await copyFile(join(template, "archant.db"), path);
}

const listBackups = async () => (await readdir(backups)).toSorted();

describe("copyBeforeMigrating", () => {
	it("copies a database with a pending migration, named after the time and the version", async () => {
		await upgradable();

		const outcome = await copyBeforeMigrating({ url, version: "1.2.0", now: NOW });

		expect(outcome).toEqual({ copied: "archant-20260927T083005Z-1.2.0.db", kept: 1 });
		await expect(listBackups()).resolves.toEqual(["archant-20260927T083005Z-1.2.0.db"]);
		const copy = await createDb(`file:${join(backups, "archant-20260927T083005Z-1.2.0.db")}`);
		try {
			await expect(copy.all(sql`select id from accounts`)).resolves.toEqual([{ id: "a1" }]);
		} finally {
			copy.$client.close();
		}
		// The copy is taken before migrating, so migrating still has work to do.
		await runMigrations(url);
	});

	// Windows has no POSIX modes to assert.
	it.skipIf(process.platform === "win32")(
		"keeps backups/ and each copy to their owner: 0700 and 0600",
		async () => {
			await upgradable();

			const outcome = await copyBeforeMigrating({ url, version: "1.2.0", now: NOW });

			const copied = "copied" in outcome ? outcome.copied : "";
			expect((await stat(backups)).mode & 0o777).toBe(0o700);
			expect((await stat(join(backups, copied))).mode & 0o777).toBe(0o600);
		},
	);

	it.skipIf(process.platform === "win32")(
		"takes group and other access off a backups/ made before",
		async () => {
			await upgradable();
			await mkdir(backups);
			await chmod(backups, 0o755);

			await copyBeforeMigrating({ url, version: "1.2.0", now: NOW });

			expect((await stat(backups)).mode & 0o777).toBe(0o700);
		},
	);

	it("names a development build's copy dev", async () => {
		await upgradable();

		const outcome = await copyBeforeMigrating({ url, version: null, now: NOW });

		expect(outcome).toMatchObject({ copied: "archant-20260927T083005Z-dev.db" });
	});

	it("resolves a relative file URL against the working directory", async () => {
		await upgradable();
		const target = `file:${relative(process.cwd(), join(directory, "archant.db"))}`;

		const outcome = await copyBeforeMigrating({ url: target, version: null, now: NOW });

		expect(outcome).toMatchObject({ copied: "archant-20260927T083005Z-dev.db" });
		await expect(listBackups()).resolves.toEqual(["archant-20260927T083005Z-dev.db"]);
	});

	it("reads an absolute file:/// URL", async () => {
		await upgradable();

		const outcome = await copyBeforeMigrating({
			url: `file://${join(directory, "archant.db")}`,
			version: null,
			now: NOW,
		});

		expect(outcome).toMatchObject({ copied: "archant-20260927T083005Z-dev.db" });
		await expect(listBackups()).resolves.toEqual(["archant-20260927T083005Z-dev.db"]);
	});

	it("percent-decodes the path, as libSQL does", async () => {
		const spaced = join(directory, "my db");
		await mkdir(spaced);
		const encoded = `file:${join(directory, "my%20db", "archant.db")}`;
		await upgradable(join(spaced, "archant.db"));

		const outcome = await copyBeforeMigrating({ url: encoded, version: null, now: NOW });

		expect(outcome).toMatchObject({ copied: "archant-20260927T083005Z-dev.db" });
		await expect(readdir(join(spaced, "backups"))).resolves.toEqual([
			"archant-20260927T083005Z-dev.db",
		]);
	});

	it("copies nothing when every migration is applied", async () => {
		await upgradable();
		await runMigrations(url);

		const outcome = await copyBeforeMigrating({ url, version: "1.2.0", now: NOW });

		expect(outcome).toEqual({ skipped: "up-to-date" });
		await expect(readdir(directory)).resolves.not.toContain("backups");
	});

	it("copies nothing, and creates no file, when the database does not exist", async () => {
		const outcome = await copyBeforeMigrating({ url, version: "1.2.0", now: NOW });

		expect(outcome).toEqual({ skipped: "new" });
		await expect(readdir(directory)).resolves.toEqual([]);
	});

	it("copies nothing from a file that was never migrated", async () => {
		const db = await createDb(url);
		db.$client.close();

		const outcome = await copyBeforeMigrating({ url, version: "1.2.0", now: NOW });

		expect(outcome).toEqual({ skipped: "new" });
		await expect(readdir(directory)).resolves.not.toContain("backups");
	});

	it("copies nothing from memory", async () => {
		await expect(
			copyBeforeMigrating({ url: "file::memory:", version: null, now: NOW }),
		).resolves.toEqual({
			skipped: "new",
		});
	});

	it("copies nothing from a remote database, without connecting to it", async () => {
		await expect(
			copyBeforeMigrating({
				url: "libsql://archant.example.test",
				authToken: "token",
				version: null,
				now: NOW,
			}),
		).resolves.toEqual({ skipped: "remote" });
	});

	it("keeps the five most recent copies and no other file of this database", async () => {
		await upgradable();
		await mkdir(backups);
		const older = [
			"archant-20260901T000000Z-1.0.0.db",
			"archant-20260902T000000Z-1.0.1.db",
			"archant-20260903T000000Z-1.1.0.db",
			"archant-20260904T000000Z-1.1.1.db",
			"archant-20260905T000000Z-1.1.2.db",
		];
		const others = ["archant-manual.db", "notes.txt", "other-20260901T000000Z-1.0.0.db"];
		await Promise.all([...older, ...others].map((name) => writeFile(join(backups, name), "")));

		const outcome = await copyBeforeMigrating({ url, version: "1.2.0", now: NOW });

		expect(outcome).toEqual({ copied: "archant-20260927T083005Z-1.2.0.db", kept: 5 });
		await expect(listBackups()).resolves.toEqual(
			[...older.slice(1), "archant-20260927T083005Z-1.2.0.db", ...others].toSorted(),
		);
	});

	it("never deletes the copy just written, even with a clock behind the older ones", async () => {
		await upgradable();
		await mkdir(backups);
		const later = [
			"archant-20261001T000000Z-1.0.0.db",
			"archant-20261002T000000Z-1.0.1.db",
			"archant-20261003T000000Z-1.1.0.db",
			"archant-20261004T000000Z-1.1.1.db",
			"archant-20261005T000000Z-1.1.2.db",
		];
		await Promise.all(later.map((name) => writeFile(join(backups, name), "")));

		const outcome = await copyBeforeMigrating({ url, version: "1.2.0", now: NOW });

		expect(outcome).toEqual({ copied: "archant-20260927T083005Z-1.2.0.db", kept: 5 });
		await expect(listBackups()).resolves.toEqual(
			["archant-20260927T083005Z-1.2.0.db", ...later.slice(1)].toSorted(),
		);
	});

	it("deletes this database's partial files a killed copy left", async () => {
		await upgradable();
		await mkdir(backups);
		await writeFile(join(backups, "archant-20260901T000000Z-1.0.0.db.partial"), "");
		await writeFile(join(backups, "other-20260901T000000Z-1.0.0.db.partial"), "");

		const outcome = await copyBeforeMigrating({ url, version: "1.2.0", now: NOW });

		expect(outcome).toEqual({ copied: "archant-20260927T083005Z-1.2.0.db", kept: 1 });
		await expect(listBackups()).resolves.toEqual([
			"archant-20260927T083005Z-1.2.0.db",
			"other-20260901T000000Z-1.0.0.db.partial",
		]);
	});

	it("reports a failed pruning without failing the copy", async () => {
		await upgradable();
		await mkdir(backups);
		// A directory under a copy's name: removing it as a file fails.
		await Promise.all(
			["01", "02", "03", "04", "05"].map((day) =>
				mkdir(join(backups, `archant-202609${day}T000000Z-1.0.0.db`)),
			),
		);

		const outcome = await copyBeforeMigrating({ url, version: "1.2.0", now: NOW });

		expect(outcome).toMatchObject({ copied: "archant-20260927T083005Z-1.2.0.db", kept: 6 });
		expect(outcome).toHaveProperty("pruneFailed");
		await expect(listBackups()).resolves.toContain("archant-20260927T083005Z-1.2.0.db");
	});

	it("throws when backups is a regular file, leaving nothing behind", async () => {
		await upgradable();
		await writeFile(backups, "");

		const copying = copyBeforeMigrating({ url, version: "1.2.0", now: NOW });

		await expect(copying).rejects.toBeInstanceOf(BackupError);
		await expect(copying).rejects.toMatchObject({ directory: backups });
		await expect(copying.catch((error: BackupError) => error.code)).resolves.toMatch(/^E[A-Z]+$/u);
		const beside = await readdir(directory);
		expect(beside.filter((name) => name !== "backups" && !name.startsWith("archant.db"))).toEqual(
			[],
		);
		const db = await createDb(url);
		try {
			await expect(pendingMigrations(db)).resolves.toBe(1);
		} finally {
			db.$client.close();
		}
	});

	// Root writes through any permission, so the refusal cannot be staged there.
	it.skipIf(process.getuid?.() === 0)(
		"throws when the copy cannot be written to backups/, leaving it empty",
		async () => {
			await upgradable();
			await mkdir(backups);
			await chmod(backups, 0o500);

			const copying = copyBeforeMigrating({ url, version: "1.2.0", now: NOW });

			await expect(copying).rejects.toBeInstanceOf(BackupError);
			// Refused when the empty copy is created, before `VACUUM INTO` runs.
			await expect(copying.catch((error: BackupError) => error.code)).resolves.toBe("EACCES");
			await expect(listBackups()).resolves.toEqual([]);
		},
	);
});
