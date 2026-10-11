import type { ValuationRecord } from "../services/ledger/snapshots.ts";

import { z } from "zod";

import {
	CITATION_GRADES,
	CITATION_MAX_LENGTH,
	ESTIMATED_PREFIX,
	parseCitation,
} from "../domain/balances/citation.ts";
import { AppError } from "../lib/errors.ts";
import { recordValuationInput, valuationsInput } from "../schemas/assistants.ts";
import { DEFAULT_PAGE_SIZE } from "../schemas/transactions.ts";
import { namesOf } from "../services/names.ts";
import { createSnapshot, listValuations } from "../services/snapshots.ts";
import {
	BANK_TEXT,
	READ_ONLY,
	REPLACES,
	decimalOf,
	defineTool,
	formatMoney,
	pageFieldsOf,
	pageOutput,
	refuse,
	refuseWithoutSuccess,
	sureDecimalText,
} from "./tool.ts";

/** Sure's `{ id, name, currency }` of the account a valuation is on: every amount is in it. */
const accountRef = z.object({ id: z.string(), name: z.string(), currency: z.string() });

const amountFields = {
	amount: z
		.string()
		.describe('The recorded stored balance as Sure\'s decimal text, such as "1990.0".'),
	amount_formatted: z.string().describe('Such as "1 990,00 €".'),
};

// The ledger's kinds, spelt here: only the ledger imports the entries table (AD-2).
const VALUATION_KINDS = [
	"opening_anchor",
	"reconciliation",
	"current_anchor",
] as const satisfies readonly ValuationRecord["kind"][];

const valuation = z.object({
	entry_id: z.string(),
	account: accountRef,
	date: z.string(),
	...amountFields,
	kind: z
		.enum(VALUATION_KINDS)
		.describe(
			'"opening_anchor": the opening balance; "reconciliation": a snapshot, as the « Soldes » tab lists it; "current_anchor": the balance a bank last gave.',
		),
	notes: z
		.string()
		.nullable()
		.describe(
			"What the owner wrote on a snapshot, and the source each record_valuation cited, one paragraph each.",
		),
});

function valuationOf(record: ValuationRecord): z.input<typeof valuation> {
	const money = { amount: record.balance, currency: record.currency };

	return {
		entry_id: record.id,
		account: { id: record.accountId, name: record.accountName, currency: record.currency },
		date: record.date,
		amount: decimalOf(money),
		amount_formatted: formatMoney(money),
		kind: record.kind,
		notes: record.notes,
	};
}

/** Sure's `Date.iso8601` of an optional date: `undefined` when blank, `null` when unreadable. */
function optionalDate(value: string | undefined): string | null | undefined {
	if (value === undefined || value.trim() === "") {
		return undefined;
	}

	return z.iso.date().safeParse(value).success ? value : null;
}

export const getValuations = defineTool({
	name: "get_valuations",
	title: "Valuations",
	description: `Lists recorded account valuations, as Sure's get_valuations, newest first, ${DEFAULT_PAGE_SIZE} a page: every active account's opening balance, its snapshots, the « Soldes » tab's, and the balance a bank last gave, unless account_id names one account, between two optional dates. Each entry includes its notes, where record_valuation stores the source it cites. Use it to audit what record_valuation wrote, to find the dates that already carry a value, or to trace where a balance came from. A malformed date, or a start_date after end_date, answers { error: "invalid_date", message }. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: valuationsInput,
	output: z.object({ valuations: z.array(valuation), ...pageOutput }),
	run: async (deps, { account_id: accountId, start_date: start, end_date: end, page }) => {
		const from = optionalDate(start);
		const to = optionalDate(end);

		// A malformed date fails loudly, as Sure's: dropping the filter would
		// present every valuation as though the range was honoured.
		if (from === null || to === null) {
			refuseWithoutSuccess("invalid_date", "Dates must be valid and in YYYY-MM-DD format.");
		}

		if (from !== undefined && to !== undefined && from > to) {
			refuseWithoutSuccess("invalid_date", "start_date must be on or before end_date.");
		}

		const found = await listValuations(
			deps,
			{ accountId, from, to },
			{ page, pageSize: DEFAULT_PAGE_SIZE },
		);

		return {
			result: {
				valuations: found.items.map(valuationOf),
				...pageFieldsOf(found.total, found.page, found.pageSize),
			},
			changedRows: 0,
		};
	},
});

/** Sure's `Provenance::Citation.grammar`. */
const GRAMMAR = `["${ESTIMATED_PREFIX}"] citation [" (grade: ${CITATION_GRADES.join("|")})"]`;

/** Sure's `InvalidError` message for each reason `parseCitation` refuses a source but a grade. */
const CITATION_REASONS = {
	source_required: "source citation is required",
	source_too_long: `source citation must be ${CITATION_MAX_LENGTH} characters or fewer`,
	estimated_prefix: `estimated values must start with the exact prefix ${JSON.stringify(ESTIMATED_PREFIX)}`,
	source_invalid: `source citation does not match ${GRAMMAR}`,
	no_document_named: "source citation must name the document it came from",
	estimate_without_grade: `estimated values must carry a reliability grade, e.g. "${ESTIMATED_PREFIX}... (grade: C)"`,
} as const;

/** Sure's `InvalidError` message for a source `parseCitation` refused. */
function citationReason(refused: Exclude<ReturnType<typeof parseCitation>, { ok: true }>): string {
	return refused.code === "unknown_grade"
		? `reliability grade must be one of ${CITATION_GRADES.join(", ")} (got ${JSON.stringify(refused.grade)})`
		: CITATION_REASONS[refused.code];
}

export const recordValuationTool = defineTool({
	name: "record_valuation",
	title: "Record a balance",
	description: [
		"Records an account's end-of-day balance on a date, with a citation for where the figure came from, as Sure's record_valuation and the « Soldes » dialog in Archant, replacing a snapshot already on that date. The balance is the stored one: what an asset holds or is worth, what a liability such as a loan or a card still owes, both positive; an overdraft is negative. From that date the balance follows the snapshot, then the transactions after it; on an account a bank syncs, today's balance stays the bank's, and the snapshot sets its day and the days before it.",
		`The source citation is required, as in Sure, and checked against this grammar: ${GRAMMAR}. The "${ESTIMATED_PREFIX}" prefix says the value was interpolated or proxied, not read off a document; an estimate must carry a grade. Grade A is an official document for that exact date, such as a statement or a loan table; B is derived with a document; C is a proxy or an assumption, to derive again from the real source. For example "Relevé Boursorama 2026-03-31, solde de fin de mois (grade: A)" or "estimated: linear interpolation over 2026-02 / 2026-04 statements (grade: C)".`,
		"If you have no document to cite, do not invent one and do not call this tool: ask the owner for the source. A value with no provenance is worse than a missing one, because it looks authoritative.",
		"The citation is stored in the snapshot's notes; what the owner wrote there is kept and the new citation appended below it, and a citation already there is not added again.",
		"Refusals answer Sure's keys, in Sure's order: invalid_source_citation, its message saying why; invalid_date; invalid_amount; account_not_found. A date on or before the opening date, or after today, answers validation_error naming date; an amount with more decimals than the account's currency holds, validation_error naming amount.",
	].join("\n\n"),
	scope: "archant:write",
	annotations: REPLACES,
	fieldPaths: { balance: "amount" },
	input: recordValuationInput,
	output: z.object({
		success: z.literal(true),
		entry_id: z.string(),
		account: accountRef,
		date: z.string(),
		...amountFields,
		replaced_existing: z
			.boolean()
			.describe(
				"Whether a snapshot already held the date: it keeps its entry_id, with this amount.",
			),
		provenance: z
			.object({
				source: z.string(),
				citation: z.string().describe("The source without its estimate prefix and grade."),
				estimated: z.boolean(),
				grade: z.enum(CITATION_GRADES).nullable(),
			})
			.describe("The source as parsed, Sure's provenance."),
		message: z.string(),
	}),
	run: async (deps, { account_id: accountId, date, amount, source }) => {
		const cited = parseCitation(source);

		if (!cited.ok) {
			refuse(
				"invalid_source_citation",
				`${citationReason(cited)}. Every recorded value must cite its source, in the grammar: ${GRAMMAR}.`,
			);
		}

		if (!z.iso.date().safeParse(date).success) {
			refuse("invalid_date", "date must be an ISO 8601 date (YYYY-MM-DD).");
		}

		const balance = sureDecimalText(amount);

		if (balance === null) {
			refuse("invalid_amount", "amount must be a number.");
		}

		let recorded;

		try {
			recorded = await createSnapshot(
				deps,
				accountId,
				{ date, balance },
				{ source: cited.citation.source },
			);
		} catch (error) {
			if (error instanceof AppError && error.code === "NOT_FOUND") {
				refuse("account_not_found", "No account found with that ID that this user can write to.");
			}

			throw error;
		}

		const { accounts } = await namesOf(deps, { accounts: [recorded.accountId] });
		const name = accounts.get(recorded.accountId) ?? recorded.accountId;
		const money = { amount: recorded.balance, currency: recorded.currency };
		const formatted = formatMoney(money);

		return {
			result: {
				success: true as const,
				entry_id: recorded.id,
				account: { id: recorded.accountId, name, currency: recorded.currency },
				date: recorded.date,
				amount: decimalOf(money),
				amount_formatted: formatted,
				replaced_existing: recorded.replacedExisting,
				provenance: cited.citation,
				message: `Recorded ${formatted} for ${name} on ${recorded.date}, cited as: ${cited.citation.source}.`,
			},
			changedRows: 1,
		};
	},
});
