import type { TempDatabase } from "../testing/temp-database.ts";
import type { NewAccountInput } from "./ledger/accounts.ts";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";

import { createTempDatabase } from "../testing/temp-database.ts";
import { listAssistantAccounts } from "./balances.ts";
import { createAccount } from "./ledger/accounts.ts";

let temp: TempDatabase;
const deps = () => ({ db: temp.db, timeZone: "Europe/Paris" });

beforeEach(async () => {
	temp = await createTempDatabase();
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
});

afterEach(async () => {
	vi.useRealTimers();
	await temp.dispose();
});

async function account(overrides: Partial<NewAccountInput> = {}) {
	const created = await createAccount(
		deps(),
		{
			name: "Courant",
			type: "depository",
			subtype: "checking",
			currency: "EUR",
			openingBalance: toMinorUnits(100_000),
			openingDate: "2026-06-01",
			...overrides,
		},
		{ origin: "user" },
	);

	return created.id;
}

describe("listAssistantAccounts", () => {
	it("lists the active accounts with their start date, a deactivated one left out", async () => {
		const checking = await account();
		const closed = await account({ name: "Ancien" });
		await temp.db.update(accounts).set({ active: false }).where(eq(accounts.id, closed));

		const listed = await listAssistantAccounts(deps());

		expect(listed).toEqual([
			expect.objectContaining({
				id: checking,
				classification: "asset",
				startDate: "2026-06-01",
				linked: false,
				balance: 100_000,
				series: undefined,
			}),
		]);
	});

	it("reads the period from the account's start date, a day at a time up to a year", async () => {
		const checking = await account({ openingDate: "2026-09-10" });

		const [row] = await listAssistantAccounts(deps(), "last_90_days");

		expect(row?.id).toBe(checking);
		expect(row?.series?.range).toEqual({ from: "2026-09-10", to: "2026-09-21" });
		expect(row?.series?.interval).toBe("1 day");
		expect(row?.series?.values).toHaveLength(12);
		expect(row?.series?.values.at(-1)).toBe(100_000);
	});

	it("gives no series to an account starting after the period", async () => {
		await account({ openingDate: "2026-10-01" });

		const [row] = await listAssistantAccounts(deps(), "last_7_days");

		expect(row?.series).toBeNull();
	});

	it("steps by week beyond a year and by month beyond five", async () => {
		await account({ openingDate: "2020-09-01" });

		const [weekly] = await listAssistantAccounts(deps(), "last_5_years");
		const [monthly] = await listAssistantAccounts(deps(), "last_10_years");

		expect(weekly?.series?.interval).toBe("1 week");
		expect(weekly?.series?.range.from).toBe("2021-09-21");
		expect(monthly?.series?.interval).toBe("1 month");
		expect(monthly?.series?.range.from).toBe("2020-09-01");
		expect(monthly?.series?.values.at(-1)).toBe(100_000);
	});
});
