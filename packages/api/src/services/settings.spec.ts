import type { TempDatabase } from "../testing/temp-database.ts";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempDatabase } from "../testing/temp-database.ts";
import { saveHouseholdLocale } from "./household-locale.ts";
import {
	backfillHouseholdPreferences,
	getHouseholdPreferences,
	saveHouseholdPreferences,
} from "./settings.ts";

let temp: TempDatabase;

beforeEach(async () => {
	temp = await createTempDatabase();
});

afterEach(async () => {
	await temp.dispose();
});

describe("backfillHouseholdPreferences", () => {
	it("fills missing rows from the legacy zone and currency once", async () => {
		const db = temp.db;
		const deps = { db, timeZone: "America/Toronto" };
		await saveHouseholdLocale(db, "en");
		await saveHouseholdPreferences(db, { country: "CH", monthStartDay: 15 });

		await backfillHouseholdPreferences(deps);
		await backfillHouseholdPreferences({ db, timeZone: "UTC" });

		await expect(getHouseholdPreferences(deps)).resolves.toEqual({
			country: "CH",
			baseCurrency: "EUR",
			dateFormat: "MM/DD/YYYY",
			timeZone: "America/Toronto",
			monthStartDay: 15,
		});
	});

	it("keeps a previously saved currency, date format and zone", async () => {
		const db = temp.db;
		const deps = { db, timeZone: "Europe/Paris" };
		await saveHouseholdPreferences(db, {
			timeZone: "UTC",
			baseCurrency: "USD",
			dateFormat: "YYYY-MM-DD",
		});

		await backfillHouseholdPreferences(deps);

		await expect(getHouseholdPreferences(deps)).resolves.toMatchObject({
			baseCurrency: "USD",
			dateFormat: "YYYY-MM-DD",
			timeZone: "UTC",
		});
	});
});
