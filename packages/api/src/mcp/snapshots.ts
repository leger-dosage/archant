import type { SnapshotRecord, ValuationRecord } from "../services/ledger/snapshots.ts";

import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { toDecimalString } from "@archant/data/money";

import { recordValuationInput, valuationsInput } from "../schemas/assistants.ts";
import { DEFAULT_PAGE_SIZE } from "../schemas/transactions.ts";
import { createSnapshot, listValuations } from "../services/snapshots.ts";
import { BANK_TEXT, READ_ONLY, REPLACES, decimal, defineTool } from "./tool.ts";

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

// The ledger's kinds, spelt here: only the ledger imports the entries table (AD-2).
const VALUATION_KINDS = [
	"opening_anchor",
	"reconciliation",
	"current_anchor",
] as const satisfies readonly ValuationRecord["kind"][];

const valuation = z.object({
	id: z.string(),
	accountId: z.string(),
	accountName: z.string(),
	date: z.string(),
	kind: z
		.enum(VALUATION_KINDS)
		.describe(
			'"opening_anchor": the opening balance; "reconciliation": a snapshot, as the « Soldes » tab lists it; "current_anchor": the balance a bank last gave.',
		),
	balance: decimal("The recorded stored balance"),
	computed: decimal("A snapshot's balance its transactions alone give for that day")
		.nullable()
		.describe("null for an anchor, which sets the balance itself."),
	gap: decimal("balance minus computed").nullable().describe("null for an anchor."),
	currency: z.string(),
});

function valuationOf(record: ValuationRecord): z.input<typeof valuation> {
	const { currency } = record;
	const amount = (value: MinorUnits | null) =>
		value === null ? null : toDecimalString({ amount: value, currency });

	return {
		id: record.id,
		accountId: record.accountId,
		accountName: record.accountName,
		date: record.date,
		kind: record.kind,
		balance: toDecimalString({ amount: record.balance, currency }),
		computed: amount(record.computed),
		gap: amount(record.gap),
		currency,
	};
}

export const getValuations = defineTool({
	name: "get_valuations",
	title: "Valuations",
	description: `Recorded valuations, as Sure's get_valuations, most recent first, ${DEFAULT_PAGE_SIZE} a page: every active account's opening balance, its snapshots, the « Soldes » tab's, and the balance a bank last gave, unless accountId names one account, between two optional dates. Each snapshot comes with the balance its transactions alone give for that day and the gap between them. Use it to find the dates that already carry a value before record_valuation. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: valuationsInput,
	output: z.object({
		items: z.array(valuation),
		page: z.number().int(),
		pageSize: z.number().int(),
		total: z.number().int(),
		totalPages: z.number().int(),
	}),
	run: async (deps, { accountId, startDate, endDate, page }) => {
		const found = await listValuations(
			deps,
			{ accountId, from: startDate, to: endDate },
			{ page, pageSize: DEFAULT_PAGE_SIZE },
		);

		return {
			result: {
				items: found.items.map(valuationOf),
				page: found.page,
				pageSize: found.pageSize,
				total: found.total,
				totalPages: Math.ceil(found.total / found.pageSize),
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
