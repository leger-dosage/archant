import type { RecurrenceRule } from "../../domain/recurring/schedule.ts";
import type { Transaction } from "../ledger/shared.ts";

import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { recurrenceRules } from "@archant/data/schema/recurrence-rules";

import { KEYS_PER_LOOKUP, inSequence } from "../ledger/shared.ts";

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
