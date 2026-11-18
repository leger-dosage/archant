import { expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { add, deps, openPea, snapshot, useLedgerDatabase } from "../../testing/ledger.ts";
import { goalMarketGains } from "./goal-market.ts";

useLedgerDatabase();

it("counts no market movement before the first balance or for an account without balances", async () => {
	const account = await openPea({ openingDate: "2026-09-01" });

	await expect(goalMarketGains(deps(), [account.id, "missing"], "2026-08-31")).resolves.toEqual(
		new Map([
			[account.id, { total: 0, since: 0 }],
			["missing", { total: 0, since: 0 }],
		]),
	);
});

it("counts opening capital and backdated deposits separately from valuation changes", async () => {
	const account = await openPea({
		openingDate: "2026-09-01",
		openingBalance: toMinorUnits(100_000),
	});
	await add(account.id, { date: "2026-08-30", amount: toMinorUnits(20_000) });
	await snapshot(account.id, "2026-09-19", 150_000);

	const gains = await goalMarketGains(deps(), [account.id], "2026-09-21", "2026-08-29");

	expect(gains.get(account.id)).toEqual({ total: 50_000, since: 50_000 });
});
