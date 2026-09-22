// The choices of a QIF import, apart from the table that stores them so the
// interface can list them without bundling Drizzle.

export const QIF_DATE_ORDERS = ["day-first", "month-first"] as const;

/** Whether a QIF date such as `03/04/2026` reads the day or the month first. */
export type QifDateOrder = (typeof QIF_DATE_ORDERS)[number];
