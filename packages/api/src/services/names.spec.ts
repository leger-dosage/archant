import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { accounts } from "@archant/data/schema/accounts";

import { deps, openAccount, temp, useRecurringDatabase } from "../testing/recurring.ts";
import { accountsNamed } from "./names.ts";

useRecurringDatabase("2026-09-21T10:00:00Z");

describe("accountsNamed", () => {
	it("finds an account by its exact name, case included, and two at most of a shared name", async () => {
		const euros = await openAccount("EUR");
		const [first, second] = [await openAccount("USD"), await openAccount("USD")];

		await expect(accountsNamed(deps(), "Compte EUR")).resolves.toEqual([euros]);
		await expect(accountsNamed(deps(), "compte eur")).resolves.toEqual([]);
		await expect(accountsNamed(deps(), "Compte")).resolves.toEqual([]);
		await expect(
			accountsNamed(deps(), "Compte USD").then((ids) => ids.toSorted()),
		).resolves.toEqual([first, second].toSorted());

		await openAccount("USD");

		await expect(accountsNamed(deps(), "Compte USD")).resolves.toHaveLength(2);
	});

	it("leaves a deactivated account out, so its namesake is the one account of that name", async () => {
		const [hidden, shown] = [await openAccount("EUR"), await openAccount("EUR")];
		await temp.db.update(accounts).set({ active: false }).where(eq(accounts.id, hidden));

		await expect(accountsNamed(deps(), "Compte EUR")).resolves.toEqual([shown]);

		await temp.db.update(accounts).set({ active: false }).where(eq(accounts.id, shown));

		await expect(accountsNamed(deps(), "Compte EUR")).resolves.toEqual([]);
	});
});
