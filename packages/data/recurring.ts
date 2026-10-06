// Apart from the `recurring_transactions` and `recurrence_rules` tables, so
// the interface reads the values without bundling Drizzle.

/**
 * Sure's `RecurrenceRule` frequencies. Sure's `weekday_ordinal`, `end_on` and
 * `weekend_adjust` have no column: no Sure screen sets them.
 */
export const RECURRENCE_FREQUENCIES = ["weekly", "monthly", "yearly"] as const;

export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/**
 * Sure's `bill_type` without `transfer`: Archant has no recurring transfer
 * between the household's own accounts.
 */
export const BILL_TYPES = ["bill", "subscription", "installment", "income", "other"] as const;

export type BillType = (typeof BILL_TYPES)[number];

/** Sure's `RecurrenceRule::LAST`: a `day_of_month` meaning the month's last day. */
export const LAST_DAY_OF_MONTH = -1;

/** Sure's `MAX_END_AFTER_COUNT`: a 50-year monthly plan, or a 10-year weekly one. */
export const MAX_END_AFTER_COUNT = 600;
