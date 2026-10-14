import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { merchants } from "@archant/data/schema/merchants";
import { tags } from "@archant/data/schema/tags";

import { deps, openAccount, temp, useRecurringDatabase } from "../testing/recurring.ts";
import { createAccount } from "./ledger/accounts.ts";
import { accountsNamed, assertNameFree, fundableAccountsNamed } from "./names.ts";

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

describe("fundableAccountsNamed", () => {
	it("finds every active account a goal may take by its exact name, a shared name giving both", async () => {
		const euros = await openAccount("EUR");
		const [first, second] = [await openAccount("USD"), await openAccount("USD")];
		const hidden = await openAccount("EUR");
		await temp.db.update(accounts).set({ active: false }).where(eq(accounts.id, hidden));
		await createAccount(
			deps(),
			{
				name: "Compte EUR",
				type: "credit_card",
				subtype: null,
				currency: "EUR",
				openingBalance: toMinorUnits(0),
				openingDate: "2026-01-01",
			},
			{ origin: "user" },
		);

		await expect(fundableAccountsNamed(deps(), ["Compte EUR"])).resolves.toEqual([
			{ id: euros, name: "Compte EUR", currency: "EUR" },
		]);
		await expect(fundableAccountsNamed(deps(), ["compte eur"])).resolves.toEqual([]);
		await expect(
			fundableAccountsNamed(deps(), ["Compte USD", "Compte USD"]).then((rows) =>
				rows.map((row) => row.id).toSorted(),
			),
		).resolves.toEqual([first, second].toSorted());
		await expect(fundableAccountsNamed(deps(), [])).resolves.toEqual([]);
	});
});

describe("assertNameFree", () => {
	it("refuses a name another row of the same table holds, case aside, and lets a row keep its own", async () => {
		await temp.db.insert(tags).values({ id: "tag-1", name: "Été", createdAt: 0, updatedAt: 0 });
		const taken = {
			code: "VALIDATION_ERROR",
			fields: [{ path: "name", code: "name_taken" }],
		};

		await expect(assertNameFree(temp.db, tags, "ÉTÉ", null)).rejects.toMatchObject(taken);
		await expect(assertNameFree(temp.db, tags, "été", "tag-1")).resolves.toBeUndefined();
		await expect(assertNameFree(temp.db, tags, "Ete", null)).resolves.toBeUndefined();
		await expect(assertNameFree(temp.db, merchants, "Été", null)).resolves.toBeUndefined();
	});
});
