import type { TempDatabase } from "../testing/temp-database.ts";

import { afterEach, describe, expect, it } from "vitest";

import { createTempDatabase } from "../testing/temp-database.ts";
import { householdLocale, saveHouseholdLocale } from "./household-locale.ts";

let temp: TempDatabase | undefined;

afterEach(async () => {
	await temp?.dispose();
	temp = undefined;
});

describe("householdLocale", () => {
	it("is French for a household with no row, as every one before Story 37.2", async () => {
		temp = await createTempDatabase();

		await expect(householdLocale(temp.db)).resolves.toBe("fr");
	});

	it("keeps the language saved, then the one saved over it", async () => {
		temp = await createTempDatabase();

		await saveHouseholdLocale(temp.db, "en");
		await expect(householdLocale(temp.db)).resolves.toBe("en");

		await saveHouseholdLocale(temp.db, "fr");
		await expect(householdLocale(temp.db)).resolves.toBe("fr");
	});
});
