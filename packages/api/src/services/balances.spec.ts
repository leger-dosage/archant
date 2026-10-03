import type { TempDatabase } from "../testing/temp-database.ts";
import type { NewAccountInput } from "./ledger/accounts.ts";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { createTempDatabase } from "../testing/temp-database.ts";
import { listAccounts } from "./accounts.ts";
import { getBalanceHistory, listAccountsWithHistory } from "./balances.ts";
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

describe("listAccountsWithHistory", () => {
	it("gives listAccounts with each account's points as its page charts them", async () => {
		const checking = await account();
		const card = await account({
			name: "Carte",
			type: "credit_card",
			subtype: null,
			openingBalance: toMinorUnits(30_000),
			openingDate: "2026-09-10",
		});

		const list = await listAccountsWithHistory(deps(), "3M");
		const accounts = list.groups.flatMap((group) => group.accounts);

		expect({
			...list,
			groups: list.groups.map((group) => ({
				...group,
				accounts: group.accounts.map(({ balanceSeries: _, ...summary }) => summary),
			})),
		}).toEqual(await listAccounts(deps()));
		expect(accounts.find((row) => row.id === checking)?.balanceSeries).toEqual({
			interval: "day",
			points: (await getBalanceHistory(deps(), checking, "3M")).points,
		});
		expect(accounts.find((row) => row.id === card)?.balanceSeries.points.at(0)).toEqual({
			date: "2026-09-10",
			balance: 30_000,
		});
	});

	it("gives an account opening after today an empty series", async () => {
		const later = await account({ openingDate: "2026-10-01" });

		const list = await listAccountsWithHistory(deps(), "1Y");

		expect(list.groups.flatMap((group) => group.accounts)).toEqual([
			expect.objectContaining({ id: later, balanceSeries: { interval: "day", points: [] } }),
		]);
	});

	it("samples a long history by week", async () => {
		const old = await account({ openingDate: "2023-09-21" });

		const [row] = (await listAccountsWithHistory(deps(), "all")).groups.flatMap(
			(group) => group.accounts,
		);

		expect(row?.id).toBe(old);
		expect(row?.balanceSeries.interval).toBe("week");
		expect(row?.balanceSeries.points.at(-1)).toEqual({ date: "2026-09-21", balance: 100_000 });
	});
});
