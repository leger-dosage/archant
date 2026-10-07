import type { SnapshotRecord, ValuationRecord } from "../services/ledger/snapshots.ts";

import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { toDecimalString } from "@archant/data/money";

import { CITATION_GRADES, ESTIMATED_PREFIX } from "../domain/balances/citation.ts";
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
	notes: z
		.string()
		.nullable()
		.describe(
			"What the owner wrote on a snapshot, and the source each record_valuation cited, one paragraph each.",
		),
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
		notes: record.notes,
	};
}

export const getValuations = defineTool({
	name: "get_valuations",
	title: "Valuations",
	description: `Recorded valuations, as Sure's get_valuations, most recent first, ${DEFAULT_PAGE_SIZE} a page: every active account's opening balance, its snapshots, the « Soldes » tab's, and the balance a bank last gave, unless accountId names one account, between two optional dates. Each snapshot comes with the balance its transactions alone give for that day, the gap between them, and its notes, where record_valuation stores the source it cites. Use it to audit what record_valuation wrote, to find the dates that already carry a value, or to trace where a balance came from. ${BANK_TEXT}`,
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
	description: [
		"Records an account's end-of-day balance on a date, with a citation for where the figure came from, as the « Soldes » dialog does in Archant, replacing a snapshot already on that date. The balance is the stored one: what an asset holds or is worth, what a liability such as a loan or a card still owes, both positive; an overdraft is negative. From that date the balance follows the snapshot, then the transactions after it; on an account a bank syncs, today's balance stays the bank's, and the snapshot sets its day and the days before it.",
		`The source citation is required, as in Sure, and checked against this grammar: ["${ESTIMATED_PREFIX}"] citation [" (grade: A|B|C)"]. The "${ESTIMATED_PREFIX}" prefix says the value was interpolated or proxied, not read off a document; an estimate must carry a grade. Grade A is an official document for that exact date, such as a statement or a loan table; B is derived with a document; C is a proxy or an assumption, to derive again from the real source. For example "Relevé Boursorama 2026-03-31, solde de fin de mois (grade: A)" or "estimated: linear interpolation over 2026-02 / 2026-04 statements (grade: C)".`,
		"If you have no document to cite, do not invent one and do not call this tool: ask the owner for the source. A value with no provenance is worse than a missing one, because it looks authoritative.",
		"The citation is stored in the snapshot's notes; what the owner wrote there is kept and the new citation appended below it, and a citation already there is not added again.",
		"A date on or before the opening date, or after today, answers VALIDATION_ERROR on date; a balance the account's currency cannot hold, VALIDATION_ERROR on balance; a source outside the grammar, VALIDATION_ERROR on source with the reason as its code: source_required, source_too_long, source_invalid, estimated_prefix, unknown_grade, no_document_named or estimate_without_grade; an unknown accountId, NOT_FOUND.",
	].join("\n\n"),
	scope: "archant:write",
	annotations: REPLACES,
	input: recordValuationInput,
	output: z.object({
		...snapshotFields,
		accountId: z.string(),
		replacedExisting: z
			.boolean()
			.describe("Whether a snapshot already held the date: it keeps its id, with this balance."),
		provenance: z
			.object({
				source: z.string(),
				citation: z.string().describe("The source without its estimate prefix and grade."),
				estimated: z.boolean(),
				grade: z.enum(CITATION_GRADES).nullable(),
			})
			.describe("The source as parsed, Sure's provenance."),
	}),
	run: async (deps, { accountId, source, ...input }) => {
		const recorded = await createSnapshot(deps, accountId, input, { source: source.source });

		return {
			result: {
				...snapshotOf(recorded),
				accountId: recorded.accountId,
				replacedExisting: recorded.replacedExisting,
				provenance: source,
			},
			changedRows: 1,
		};
	},
});
