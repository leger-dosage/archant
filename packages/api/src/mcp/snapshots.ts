import type { SnapshotRecord } from "../services/ledger/snapshots.ts";

import { z } from "zod";

import { toDecimalString } from "@archant/data/money";

import { recordValuationInput, valuationsInput } from "../schemas/assistants.ts";
import { DEFAULT_PAGE_SIZE } from "../schemas/transactions.ts";
import { createSnapshot, listAccountSnapshots } from "../services/snapshots.ts";
import { READ_ONLY, REPLACES, decimal, defineTool } from "./tool.ts";

const snapshotFields = {
	id: z.string(),
	date: z.string(),
	balance: decimal("The recorded stored balance"),
	computed: decimal("The balance the transactions alone give for that day"),
	gap: decimal("balance minus computed"),
	currency: z.string(),
};

function snapshotOf(record: SnapshotRecord) {
	const { currency } = record;

	return {
		id: record.id,
		date: record.date,
		balance: toDecimalString({ amount: record.balance, currency }),
		computed: toDecimalString({ amount: record.computed, currency }),
		gap: toDecimalString({ amount: record.gap, currency }),
		currency,
	};
}

export const getValuations = defineTool({
	name: "get_valuations",
	title: "Balance snapshots",
	description: `One account's balance snapshots, as its « Soldes » tab lists them in Archant, most recent first, ${DEFAULT_PAGE_SIZE} a page: each recorded balance beside the one its transactions alone give for that day, and the gap between them. The opening balance and a bank's current balance are in get_accounts, not here.`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: valuationsInput,
	output: z.object({
		items: z.array(z.object(snapshotFields)),
		page: z.number().int(),
		pageSize: z.number().int(),
		total: z.number().int(),
	}),
	run: async (deps, { accountId, page }) => {
		const found = await listAccountSnapshots(deps, accountId, {
			page,
			pageSize: DEFAULT_PAGE_SIZE,
		});

		return {
			result: {
				items: found.items.map(snapshotOf),
				page: found.page,
				pageSize: found.pageSize,
				total: found.total,
			},
			changedRows: 0,
		};
	},
});

export const recordValuationTool = defineTool({
	name: "record_valuation",
	title: "Record a balance",
	description:
		"Records an account's end-of-day balance on a date, as the « Soldes » dialog does in Archant, replacing a snapshot already on that date. The balance is the stored one: what an asset holds or is worth, what a liability such as a loan or a card still owes, both positive; an overdraft is negative. From that date the balance follows the snapshot, then the transactions after it; on an account a bank syncs, today's balance stays the bank's, and the snapshot sets its day and the days before it. A date on or before the opening date, or after today, answers VALIDATION_ERROR on date; a balance the account's currency cannot hold, VALIDATION_ERROR on balance; an unknown accountId, NOT_FOUND.",
	scope: "archant:write",
	annotations: REPLACES,
	input: recordValuationInput,
	output: z.object({
		...snapshotFields,
		accountId: z.string(),
		replacedExisting: z
			.boolean()
			.describe("Whether a snapshot already held the date: it keeps its id, with this balance."),
	}),
	run: async (deps, { accountId, ...input }) => {
		const recorded = await createSnapshot(deps, accountId, input);

		return {
			result: {
				...snapshotOf(recorded),
				accountId: recorded.accountId,
				replacedExisting: recorded.replacedExisting,
			},
			changedRows: 1,
		};
	},
});
