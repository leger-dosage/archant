import { eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";

import { toMinorUnits } from "@archant/data/money";
import { goalDeposits } from "@archant/data/schema/goals";

import { createLogger } from "../../lib/logger.ts";
import { quantity, tradePrice } from "../../testing/decimals.ts";
import {
	add,
	addStandard,
	deps,
	labelLike,
	line,
	linkedAccount,
	openChecking,
	openPea,
	setToday,
	snapshot,
	temp,
	transferRows,
	useLedgerDatabase,
} from "../../testing/ledger.ts";
import { createGoalPledge, extendGoalPledge } from "../goal-pledges.ts";
import { createGoal, getGoal } from "../goals.ts";
import { applyRules, createRule } from "../rules.ts";
import { mergeDuplicate } from "./duplicates.ts";
import { updateTransaction } from "./edits.ts";
import { queueGoalInflows, reconcileGoalDeposits } from "./goal-deposits.ts";
import { ingest } from "./ingest.ts";
import { updateSnapshot } from "./snapshots.ts";
import { recordTrade } from "./trades.ts";
import { createTransferBetween, matchTransfer } from "./transfers.ts";

useLedgerDatabase();

const origin = { origin: "user" } as const;

function transferInput(
	fromAccountId: string,
	toAccountId: string,
	date = "2026-09-21",
	amount = 10_000,
) {
	return {
		fromAccountId,
		toAccountId,
		date,
		amount: toMinorUnits(amount),
		sourceFee: toMinorUnits(0),
		destinationFee: toMinorUnits(0),
		tagIds: [],
		idempotencyKey: crypto.randomUUID(),
	};
}

async function goalFor(accountId: string) {
	return createGoal(deps(), {
		name: "Garden shed",
		targetAmount: "5000",
		targetDate: "2027-01-01",
		color: "#27a644",
		icon: null,
		notes: null,
		accounts: [{ accountId, allocatedAmount: "" }],
	});
}

it("assigns a booked transfer to the oldest eligible pledge only, even on retry", async () => {
	const from = await openChecking();
	const to = await openChecking();
	const goal = await goalFor(to.id);
	const first = await createGoalPledge(deps(), goal.id, { accountId: to.id, amount: "100" });
	setToday("2026-09-22T10:00:00Z");
	const second = await createGoalPledge(deps(), goal.id, { accountId: to.id, amount: "101" });

	const input = transferInput(from.id, to.id, "2026-09-17", 10_050);
	const booked = await createTransferBetween(deps(), input, origin);
	expect(await createTransferBetween(deps(), input, origin)).toEqual({
		transfer: booked.transfer,
		created: false,
	});

	const current = await getGoal(deps(), goal.id);
	expect(current.latestMatchedDepositDate).toBe(input.date);
	expect(current.pledges).toMatchObject([{ id: second.id, status: "open" }]);
	expect(current.pledges.map(({ id }) => id)).not.toContain(first.id);
});

it("refuses an identical open pledge and uses the extended expiry", async () => {
	const account = await openChecking();
	const goal = await goalFor(account.id);
	const input = { accountId: account.id, amount: "75" };
	const first = await createGoalPledge(deps(), goal.id, input);
	await expect(createGoalPledge(deps(), goal.id, input)).rejects.toMatchObject({
		code: "VALIDATION_ERROR",
		fields: [{ path: "amount", code: "duplicate_open_pledge" }],
	});
	await extendGoalPledge(deps(), goal.id, first.id);
	setToday("2026-09-29T10:00:00Z");
	expect((await getGoal(deps(), goal.id)).pledges).toMatchObject([{ status: "open", daysLeft: 6 }]);
	setToday("2026-10-06T10:00:00Z");
	expect((await getGoal(deps(), goal.id)).pledges).toMatchObject([{ status: "expired" }]);
	await expect(extendGoalPledge(deps(), goal.id, first.id)).rejects.toMatchObject({
		code: "VALIDATION_ERROR",
	});
	await expect(createGoalPledge(deps(), goal.id, input)).resolves.toMatchObject({ status: "open" });
});

it.each([
	["absolute tolerance", "20", 2_050, "2026-09-16", true],
	["relative tolerance", "200", 20_200, "2026-09-28", true],
	["outside both tolerances", "200", 20_201, "2026-09-21", false],
	["before the date window", "100", 10_000, "2026-09-15", false],
	["after the date window", "100", 10_000, "2026-09-29", false],
])("checks %s against the pledge", async (_name, amount, received, date, matches) => {
	const from = await openChecking();
	const to = await openChecking();
	const goal = await goalFor(to.id);
	await createGoalPledge(deps(), goal.id, { accountId: to.id, amount });

	await createTransferBetween(deps(), transferInput(from.id, to.id, date, received), origin);

	expect((await getGoal(deps(), goal.id)).latestMatchedDepositDate).toBe(matches ? date : null);
});

it("does not claim a pending bank entry and claims its booked identity once", async () => {
	const { account, bank } = await linkedAccount();
	const goal = await goalFor(account.id);
	await createGoalPledge(deps(), goal.id, { accountId: account.id, amount: "100" });
	setToday("2026-09-21T10:00:01Z");
	const second = await createGoalPledge(deps(), goal.id, {
		accountId: account.id,
		amount: "100,50",
	});
	const bankLine = line({
		externalId: "demo-deposit",
		date: "2026-09-21",
		amount: toMinorUnits(10_000),
	});
	const sync = (pending: boolean) =>
		ingest(
			deps(),
			account.id,
			{ transactions: [{ ...bankLine, pending }], balance: null, rejected: [] },
			{ connectionId: bank.connectionId },
			{ origin: "sync" },
		);

	const {
		created: [id],
	} = await sync(true);
	expect(id).toBeDefined();
	expect((await getGoal(deps(), goal.id)).pledges).toHaveLength(2);

	await sync(false);
	await sync(false);

	expect((await getGoal(deps(), goal.id)).pledges).toMatchObject([
		{ id: second.id, status: "open" },
	]);
	expect(
		await temp.db
			.select()
			.from(goalDeposits)
			.where(eq(goalDeposits.entryId, id ?? "")),
	).toMatchObject([{ claimed: true }]);
});

it("bookmarks a manual cash increase and ignores a replay or a decrease", async () => {
	const account = await openChecking({ openingBalance: toMinorUnits(90_000) });
	const goal = await goalFor(account.id);
	await createGoalPledge(deps(), goal.id, { accountId: account.id, amount: "100" });
	await snapshot(account.id, "2026-09-20", 80_000);
	expect((await getGoal(deps(), goal.id)).latestMatchedDepositDate).toBeNull();
	const source = await snapshot(account.id, "2026-09-21", 90_000);

	const next = await createGoalPledge(deps(), goal.id, { accountId: account.id, amount: "100" });
	expect(await snapshot(account.id, "2026-09-21", 90_000)).toBe(source);

	const result = await getGoal(deps(), goal.id);
	expect(result.latestMatchedDepositDate).toBeNull();
	await expect(
		temp.db.select().from(goalDeposits).where(eq(goalDeposits.entryId, source)),
	).resolves.toMatchObject([{ claimed: true }]);
	expect(result.pledges).toMatchObject([{ id: next.id, status: "open" }]);
});

it("leaves investment snapshots, trades and outflows unclaimed and accepts a cash deposit", async () => {
	const account = await openPea({ openingBalance: toMinorUnits(90_000) });
	const goal = await goalFor(account.id);
	const pledge = await createGoalPledge(deps(), goal.id, { accountId: account.id, amount: "100" });

	await snapshot(account.id, "2026-09-19", 100_000);
	await recordTrade(
		deps(),
		account.id,
		{
			side: "buy",
			security: { source: "manual", isin: null, name: "Fictional fund" },
			date: "2026-09-20",
			quantity: quantity("1"),
			price: tradePrice("100"),
			fee: toMinorUnits(0),
		},
		origin,
	);
	await add(account.id, { amount: toMinorUnits(-10_000), date: "2026-09-21" });
	expect((await getGoal(deps(), goal.id)).pledges).toMatchObject([
		{ id: pledge.id, status: "open" },
	]);
	await add(account.id, { amount: toMinorUnits(10_000), date: "2026-09-21" });
	expect((await getGoal(deps(), goal.id)).latestMatchedDepositDate).toBe("2026-09-21");
});

it("leaves the pledge open when matching existing ledger entries by hand", async () => {
	const from = await openChecking();
	const to = await openChecking();
	const goal = await goalFor(to.id);
	const outflow = await add(from.id, { amount: toMinorUnits(-10_000), date: "2026-09-16" });
	const inflow = await add(to.id, { amount: toMinorUnits(10_000), date: "2026-09-21" });
	await createGoalPledge(deps(), goal.id, { accountId: to.id, amount: "100" });

	await matchTransfer(deps(), outflow, inflow, origin);

	expect((await getGoal(deps(), goal.id)).latestMatchedDepositDate).toBeNull();
});

it("leaves the pledge open when a rule pairs existing entries", async () => {
	const from = await openChecking();
	const to = await openChecking();
	const goal = await goalFor(to.id);
	const outflow = await add(from.id, {
		amount: toMinorUnits(-14_723),
		date: "2026-09-20",
		label: "Pledge rule outflow",
	});
	await addStandard(to.id, { amount: toMinorUnits(14_723), date: "2026-09-21" });
	await createGoalPledge(deps(), goal.id, { accountId: to.id, amount: "147,23" });
	const rule = await createRule(deps(), {
		conditions: [labelLike("Pledge rule outflow")],
		actions: [{ actionType: "set_as_transfer_or_payment", value: to.id }],
	});
	expect(await transferRows(outflow)).toHaveLength(0);

	expect((await applyRules(deps(), rule.id)).changed).toBe(1);

	expect(await transferRows(outflow)).toHaveLength(1);
	expect((await getGoal(deps(), goal.id)).latestMatchedDepositDate).toBeNull();
});

it("rolls back the queued deposit when the booking fails, then reconciles only after commit", async () => {
	const from = await openChecking();
	const to = await openChecking();
	const goal = await goalFor(to.id);
	await createGoalPledge(deps(), goal.id, { accountId: to.id, amount: "100" });
	const input = transferInput(from.id, to.id);
	const transact = temp.db.transaction.bind(temp.db);
	const fail = new Error("Booking rolled back");
	vi.spyOn(temp.db, "transaction").mockImplementationOnce((run, config) =>
		transact(async (tx) => {
			await run(tx);
			throw fail;
		}, config),
	);

	await expect(createTransferBetween(deps(), input, origin)).rejects.toBe(fail);
	expect((await getGoal(deps(), goal.id)).latestMatchedDepositDate).toBeNull();
	await expect(
		temp.db.select().from(goalDeposits).where(eq(goalDeposits.claimed, false)),
	).resolves.toEqual([]);
	expect((await createTransferBetween(deps(), input, origin)).created).toBe(true);
	expect((await getGoal(deps(), goal.id)).latestMatchedDepositDate).toBe(input.date);
});

it("keeps the booked transfer and retries without partial claims after a stamp failure", async () => {
	const from = await openChecking();
	const to = await openChecking();
	const goal = await goalFor(to.id);
	await createGoalPledge(deps(), goal.id, { accountId: to.id, amount: "100" });
	const input = transferInput(from.id, to.id);
	const logger = createLogger("silent");
	const logged = vi.spyOn(logger, "error");
	await temp.db.run(sql`create trigger reject_test_stamp before update on goal_deposits
		begin select raise(abort, 'test stamp failure'); end`);

	try {
		expect((await createTransferBetween({ ...deps(), logger }, input, origin)).created).toBe(true);
		expect((await getGoal(deps(), goal.id)).latestMatchedDepositDate).toBeNull();
		expect(logged).toHaveBeenCalledWith(
			{ code: "INTERNAL_ERROR" },
			"Goal deposit reconciliation failed",
		);
	} finally {
		await temp.db.run(sql`drop trigger reject_test_stamp`);
	}

	expect((await createTransferBetween(deps(), input, origin)).created).toBe(false);
	expect((await getGoal(deps(), goal.id)).latestMatchedDepositDate).toBe(input.date);
});

it("ignores an expired pledge even if the deposit's date is in its old window", async () => {
	const from = await openChecking();
	const to = await openChecking();
	const goal = await goalFor(to.id);
	const pledge = await createGoalPledge(deps(), goal.id, { accountId: to.id, amount: "100" });
	setToday("2026-09-29T10:00:00Z");

	await createTransferBetween(deps(), transferInput(from.id, to.id, "2026-09-28"), origin);

	const current = await getGoal(deps(), goal.id);
	expect(current.latestMatchedDepositDate).toBeNull();
	expect(current.pledges).toMatchObject([{ id: pledge.id, status: "expired" }]);
});

it("reconciles an edit that increases a manual cash snapshot", async () => {
	const account = await openChecking({ openingBalance: toMinorUnits(90_000) });
	const id = await snapshot(account.id, "2026-09-20", 90_000);
	const goal = await goalFor(account.id);
	await createGoalPledge(deps(), goal.id, { accountId: account.id, amount: "100" });

	await updateSnapshot(deps(), id, { balance: toMinorUnits(100_000) }, origin);

	expect((await getGoal(deps(), goal.id)).pledges).toHaveLength(0);
	await expect(
		temp.db.select().from(goalDeposits).where(eq(goalDeposits.entryId, id)),
	).resolves.toMatchObject([{ claimed: true }]);
});

it("reconciles a transfer whose incoming leg is booked during ingestion", async () => {
	const from = await openChecking();
	const to = await openChecking();
	const goal = await goalFor(to.id);
	await createGoalPledge(deps(), goal.id, { accountId: to.id, amount: "187,12" });

	await add(from.id, { amount: toMinorUnits(-18_712), date: "2026-09-21" });
	const inflow = await add(to.id, { amount: toMinorUnits(18_712), date: "2026-09-21" });

	expect(await transferRows(inflow)).toHaveLength(1);
	expect((await getGoal(deps(), goal.id)).latestMatchedDepositDate).toBe("2026-09-21");
});

it("keeps a bank claim with its bank key through a merge and later sync", async () => {
	const { account, bank } = await linkedAccount();
	const amount = toMinorUnits(11_900);
	const survivor = await add(account.id, { amount, date: "2026-09-18" });
	await add(account.id, { amount, date: "2026-09-20" });
	const goal = await goalFor(account.id);
	await createGoalPledge(deps(), goal.id, { accountId: account.id, amount: "119" });
	const sync = () =>
		ingest(
			deps(),
			account.id,
			{
				transactions: [line({ amount, date: "2026-09-19", externalId: "fixture-deposit" })],
				balance: null,
				rejected: [],
			},
			{ connectionId: bank.connectionId },
			{ origin: "sync" },
		);

	const {
		created: [absorbed = ""],
	} = await sync();
	expect((await getGoal(deps(), goal.id)).pledges).toHaveLength(0);
	await mergeDuplicate(deps(), absorbed, survivor);
	const next = await createGoalPledge(deps(), goal.id, { accountId: account.id, amount: "119" });
	await sync();

	expect((await getGoal(deps(), goal.id)).pledges).toMatchObject([{ id: next.id, status: "open" }]);
	await expect(
		temp.db.select().from(goalDeposits).where(eq(goalDeposits.entryId, survivor)),
	).resolves.toMatchObject([{ claimed: true }]);
});

it("rechecks an exclusion applied after the source was queued", async () => {
	const account = await openChecking();
	const goal = await goalFor(account.id);
	const pledge = await createGoalPledge(deps(), goal.id, { accountId: account.id, amount: "173" });
	const entryId = await add(account.id, { amount: toMinorUnits(17_300), date: "2026-09-21" });
	await temp.db.transaction((tx) => queueGoalInflows(tx, deps().timeZone, [entryId]));
	await updateTransaction(deps(), entryId, { excluded: true }, origin);

	await reconcileGoalDeposits(deps());

	expect((await getGoal(deps(), goal.id)).pledges).toMatchObject([
		{ id: pledge.id, status: "open" },
	]);
	await expect(
		temp.db.select().from(goalDeposits).where(eq(goalDeposits.entryId, entryId)),
	).resolves.toEqual([]);
});
