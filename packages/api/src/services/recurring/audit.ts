import type { ServiceDeps } from "../deps.ts";
import type { BillView } from "./bill-reads.ts";
import type { BillCandidate, PriceChange } from "./bills.ts";

import { and, eq, exists, gte } from "drizzle-orm";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import {
	recurringOccurrences,
	recurringPriceChanges,
} from "@archant/data/schema/recurring-occurrences";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { addMonths, today } from "../../domain/dates.ts";
import { cyclesOverdue } from "../../domain/recurring/bills.ts";
import { loadBillViews } from "./bill-reads.ts";
import { candidatePatterns, priceChangesWhere } from "./bills.ts";

// Sure's `SECTION_LIMIT`.
const SECTION_LIMIT = 20;

/** One finding of the audit: its first twenty items, how many there are and whether some were cut. */
type AuditSection<Item> = { items: Item[]; count: number; truncated: boolean };

function section<Item>(items: readonly Item[]): AuditSection<Item> {
	return {
		items: items.slice(0, SECTION_LIMIT),
		count: items.length,
		truncated: items.length > SECTION_LIMIT,
	};
}

/** Active bills Sure's `duplicate_key` groups: one name, one signed amount, one expected day. */
type DuplicateGroup = {
	name: string;
	/** A positive magnitude in `currency`. */
	amount: MinorUnits;
	currency: string;
	expectedDayOfMonth: number;
	bills: BillView[];
};

export type BillAudit = {
	possibleDuplicates: AuditSection<DuplicateGroup>;
	priceChanges: AuditSection<PriceChange>;
	longOverdue: AuditSection<{ bill: BillView; cyclesOverdue: number }>;
	dormant: AuditSection<BillView>;
	awaitingConfirmation: AuditSection<BillView>;
	undeclaredCandidates: AuditSection<BillCandidate>;
};

/** Sure's `duplicate_key`'s name: lower case, its spaces collapsed. */
const normalisedName = (name: string) =>
	name.toLocaleLowerCase("fr").replaceAll(/\s+/gu, " ").trim();

/**
 * Sure's `GetBillAudit` without its trial and renewal sections, which wait
 * for subscription dates: active bills sharing a name, an amount and a day;
 * price changes of any series since `lookbackMonths`; active bills but
 * incomes a whole cycle or more past due, the most cycles first; paused bills
 * still holding an open occurrence; suggestions, which are not bills yet;
 * and the patterns the declare dialog offers, without its cap of eight.
 * Twenty items a section, with the count.
 */
export async function billAudit(deps: ServiceDeps, lookbackMonths: number): Promise<BillAudit> {
	const day = today(deps.timeZone);
	const active = await loadBillViews(deps.db, day, eq(recurringTransactions.status, "active"));
	const groups = new Map<string, BillView[]>();

	for (const bill of active) {
		const key = JSON.stringify([
			normalisedName(bill.displayName),
			bill.amount,
			bill.expectedDayOfMonth,
		]);
		groups.set(key, [...(groups.get(key) ?? []), bill]);
	}

	const duplicates = [...groups.values()]
		.filter((group) => group.length > 1)
		.map((bills): DuplicateGroup => {
			const first = bills[0]!;

			return {
				name: first.displayName,
				amount: toMinorUnits(Math.abs(first.amount)),
				currency: first.currency,
				expectedDayOfMonth: first.expectedDayOfMonth,
				bills,
			};
		});
	const overdue = active
		.filter((bill) => bill.billType !== "income")
		.map((bill) => ({ bill, cyclesOverdue: cyclesOverdue(bill, bill.nextDueDate, day) }))
		.filter((row) => row.cyclesOverdue >= 1)
		.toSorted((a, b) => b.cyclesOverdue - a.cyclesOverdue);
	const dormant = await loadBillViews(
		deps.db,
		day,
		and(
			eq(recurringTransactions.status, "inactive"),
			exists(
				deps.db
					.select({ id: recurringOccurrences.id })
					.from(recurringOccurrences)
					.where(
						and(
							eq(recurringOccurrences.recurringTransactionId, recurringTransactions.id),
							eq(recurringOccurrences.status, "scheduled"),
						),
					),
			),
		),
	);
	const suggested = await loadBillViews(
		deps.db,
		day,
		eq(recurringTransactions.status, "suggested"),
	);

	return {
		possibleDuplicates: section(duplicates),
		priceChanges: section(
			await priceChangesWhere(
				deps.db,
				gte(recurringPriceChanges.effectiveOn, addMonths(day, -lookbackMonths)),
			),
		),
		longOverdue: section(overdue),
		dormant: section(dormant),
		awaitingConfirmation: section(suggested),
		undeclaredCandidates: section(await candidatePatterns(deps, "bill")),
	};
}
