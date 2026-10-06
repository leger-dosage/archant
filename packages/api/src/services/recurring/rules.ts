import type { IsoDate } from "../../domain/dates.ts";
import type { MatchSeries } from "../../domain/recurring/matcher.ts";
import type { RecurrenceRule } from "../../domain/recurring/schedule.ts";
import type { Transaction } from "../ledger/shared.ts";

import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { toMinorUnits } from "@archant/data/money";
import { recurrenceRules } from "@archant/data/schema/recurrence-rules";
import type { RecurringStatus } from "@archant/data/schema/recurring-transactions";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { monthlyOn } from "../../domain/recurring/schedule.ts";
import { scheduleOf } from "../../domain/recurring/series.ts";
import { KEYS_PER_LOOKUP, inSequence } from "../ledger/shared.ts";
import { parseAliases } from "./hints.ts";

// Two hundred rules of eight columns bind 1 600 parameters, far below
// SQLite's cap of 32 766.
const RULES_PER_INSERT = 200;

type Reader = Pick<Transaction, "select">;

/**
 * A stored rule, parsed rather than trusted: the database checks the same
 * shapes, so a row this refuses means a migration went wrong.
 */
const ruleRowSchema = z.discriminatedUnion("frequency", [
	z
		.object({
			frequency: z.literal("weekly"),
			interval: z.number().int(),
			weekday: z.number().int(),
		})
		.transform(({ frequency, interval, weekday }): RecurrenceRule => ({
			frequency,
			interval,
			weekday,
		})),
	z
		.object({
			frequency: z.literal("monthly"),
			interval: z.number().int(),
			dayOfMonth: z.number().int(),
		})
		.transform(({ frequency, interval, dayOfMonth }): RecurrenceRule => ({
			frequency,
			interval,
			dayOfMonth,
		})),
	z
		.object({
			frequency: z.literal("yearly"),
			interval: z.number().int(),
			dayOfMonth: z.number().int(),
			monthOfYear: z.number().int(),
		})
		.transform(({ frequency, interval, dayOfMonth, monthOfYear }): RecurrenceRule => ({
			frequency,
			interval,
			dayOfMonth,
			monthOfYear,
		})),
]);

/** The rules of each series of `ids`, by position; every series when `ids` is `undefined`. */
export async function rulesBySeries(
	db: Reader,
	ids?: readonly string[],
): Promise<Map<string, RecurrenceRule[]>> {
	const columns = {
		seriesId: recurrenceRules.recurringTransactionId,
		frequency: recurrenceRules.frequency,
		interval: recurrenceRules.interval,
		dayOfMonth: recurrenceRules.dayOfMonth,
		weekday: recurrenceRules.weekday,
		monthOfYear: recurrenceRules.monthOfYear,
	};
	const order = [asc(recurrenceRules.recurringTransactionId), asc(recurrenceRules.position)];
	const readAll = () =>
		db
			.select(columns)
			.from(recurrenceRules)
			.orderBy(...order);
	const rows: Awaited<ReturnType<typeof readAll>> = [];

	if (ids === undefined) {
		rows.push(...(await readAll()));
	} else {
		await inSequence(ids, KEYS_PER_LOOKUP, async (chunk) => {
			rows.push(
				...(await db
					.select(columns)
					.from(recurrenceRules)
					.where(inArray(recurrenceRules.recurringTransactionId, chunk))
					.orderBy(...order)),
			);
		});
	}

	const found = new Map<string, RecurrenceRule[]>();

	for (const { seriesId, ...row } of rows) {
		const rule = ruleRowSchema.parse(row);
		const rules = found.get(seriesId);

		if (rules === undefined) {
			found.set(seriesId, [rule]);
		} else {
			rules.push(rule);
		}
	}

	return found;
}

/** A rule as its row stores it, at `position` in its series. */
function rowOf(seriesId: string, rule: RecurrenceRule, position: number) {
	return {
		id: crypto.randomUUID(),
		recurringTransactionId: seriesId,
		frequency: rule.frequency,
		interval: rule.interval,
		dayOfMonth: rule.frequency === "weekly" ? null : rule.dayOfMonth,
		weekday: rule.frequency === "weekly" ? rule.weekday : null,
		monthOfYear: rule.frequency === "yearly" ? rule.monthOfYear : null,
		position,
	};
}

/** Writes the rules of new series, inside the caller's transaction. */
export async function insertRules(
	tx: Pick<Transaction, "insert">,
	series: readonly { id: string; rules: readonly RecurrenceRule[] }[],
): Promise<void> {
	const rows = series.flatMap(({ id, rules }) =>
		rules.map((rule, position) => rowOf(id, rule, position)),
	);

	await inSequence(rows, RULES_PER_INSERT, (chunk) => tx.insert(recurrenceRules).values(chunk));
}

/** Replaces a series' rules as a set, as Sure's `FrequencyPreset#write`. */
export async function replaceRules(
	tx: Pick<Transaction, "insert" | "delete">,
	seriesId: string,
	rules: readonly RecurrenceRule[],
): Promise<void> {
	await tx.delete(recurrenceRules).where(eq(recurrenceRules.recurringTransactionId, seriesId));
	await insertRules(tx, [{ id: seriesId, rules }]);
}

/** A series as generation and matching read it. */
export type LoadedSeries = MatchSeries & {
	status: RecurringStatus;
	manual: boolean;
	anchorDate: IsoDate | null;
	endAfterCount: number | null;
};

/** Every series, or those of `ids`, with their schedules, as generation and matching read them. */
export async function seriesWithSchedules(
	tx: Pick<Transaction, "select">,
	ids?: readonly string[],
): Promise<Map<string, LoadedSeries>> {
	const rows = await tx
		.select({
			id: recurringTransactions.id,
			accountId: recurringTransactions.accountId,
			currency: recurringTransactions.currency,
			amount: recurringTransactions.amount,
			merchantId: recurringTransactions.merchantId,
			labelKey: recurringTransactions.labelKey,
			name: recurringTransactions.name,
			nameAliases: recurringTransactions.nameAliases,
			learnedTolerance: recurringTransactions.learnedTolerance,
			billType: recurringTransactions.billType,
			status: recurringTransactions.status,
			manual: recurringTransactions.manual,
			anchorDate: recurringTransactions.anchorDate,
			lastOccurrenceDate: recurringTransactions.lastOccurrenceDate,
			endAfterCount: recurringTransactions.endAfterCount,
			expectedDayOfMonth: recurringTransactions.expectedDayOfMonth,
		})
		.from(recurringTransactions)
		.where(ids === undefined ? undefined : inArray(recurringTransactions.id, [...ids]));
	const rules = await rulesBySeries(tx, ids);

	return new Map(
		rows.map(({ lastOccurrenceDate, expectedDayOfMonth, nameAliases, ...row }) => [
			row.id,
			{
				...row,
				amount: toMinorUnits(row.amount),
				nameAliases: parseAliases(nameAliases),
				schedule: scheduleOf({
					rules: rules.get(row.id) ?? [monthlyOn(expectedDayOfMonth)],
					anchorDate: row.anchorDate,
					lastOccurrenceDate,
					endAfterCount: row.endAfterCount,
					expectedDayOfMonth,
				}),
			},
		]),
	);
}
