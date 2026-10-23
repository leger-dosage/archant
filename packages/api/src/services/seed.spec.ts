import type { TempDatabase } from "../testing/temp-database.ts";

import { eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { categories } from "@archant/data/schema/categories";
import { settings } from "@archant/data/schema/settings";

import { createTempDatabase } from "../testing/temp-database.ts";
import { DEFAULT_CATEGORIES } from "./default-categories.ts";
import { seedDefaults } from "./seed.ts";

const execute = promisify(execFile);

const seedModule = new URL("./seed.ts", import.meta.url).href;
const clientModule = import.meta.resolve("@archant/data/client");

/** Runs `seedDefaults` in a Node process of its own, returning what it inserted. */
async function seedInProcess(url: string): Promise<number> {
	const script = [
		`const { createDb } = await import(${JSON.stringify(clientModule)});`,
		`const { seedDefaults } = await import(${JSON.stringify(seedModule)});`,
		`const db = await createDb(${JSON.stringify(url)});`,
		"process.stdout.write(String(await seedDefaults({ db })));",
		"db.$client.close();",
	].join("\n");
	const { stdout } = await execute(process.execPath, ["--input-type=module", "--eval", script]);

	return Number(stdout);
}

let temp: TempDatabase | undefined;

async function fresh() {
	temp = await createTempDatabase();

	return temp.db;
}

afterEach(async () => {
	await temp?.dispose();
	temp = undefined;
});

describe("seedDefaults", () => {
	it("inserts Sure's 22 top-level defaults with the settings row on first start", async () => {
		const db = await fresh();

		await expect(seedDefaults({ db })).resolves.toBe(22);

		const rows = await db
			.select({
				name: categories.name,
				color: categories.color,
				icon: categories.icon,
				parentId: categories.parentId,
			})
			.from(categories);
		expect(rows).toHaveLength(22);
		expect(rows).toEqual(
			expect.arrayContaining(
				DEFAULT_CATEGORIES.map((category) => ({ ...category, parentId: null })),
			),
		);
		expect(rows).toContainEqual({
			name: "Revenus",
			color: "#22c55e",
			icon: "circle-dollar-sign",
			parentId: null,
		});
		// One of the seven Sure added, under its `fr.yml` name.
		expect(rows).toContainEqual({
			name: "Contributions aux investissements",
			color: "#0d9488",
			icon: "trending-up",
			parentId: null,
		});
		await expect(
			db.select().from(settings).where(eq(settings.key, "defaults_seeded_at")).all(),
		).resolves.toHaveLength(1);
	});

	it("inserts nothing on a later start, even once the defaults are deleted", async () => {
		const db = await fresh();
		await seedDefaults({ db });
		await db.delete(categories);

		await expect(seedDefaults({ db })).resolves.toBe(0);

		await expect(db.select().from(categories).all()).resolves.toEqual([]);
	});

	it("seeds once when two servers start at the same time", async () => {
		const db = await fresh();
		const url = `file:${temp?.file ?? ""}`;

		// Two processes, as two servers would be. In one process the second
		// `BEGIN IMMEDIATE` blocks the thread on the busy timeout, and the first
		// transaction could never finish to release the lock.
		const results = await Promise.all([seedInProcess(url), seedInProcess(url)]);

		expect(results.toSorted((a, b) => a - b)).toEqual([0, 22]);
		await expect(db.select().from(categories).all()).resolves.toHaveLength(22);
	});
});
