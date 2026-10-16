// Apart from the `users` table, so the interface reads the orders without
// bundling Drizzle.

/**
 * Sure's `AccountOrder::ORDERS`, in Sure's order: how each user's account
 * lists are sorted within their classification, saved per user. A new value
 * is a check rebuilt, no data migration.
 */
export const ACCOUNT_ORDERS = ["name_asc", "name_desc", "balance_asc", "balance_desc"] as const;

export type AccountOrder = (typeof ACCOUNT_ORDERS)[number];

/** Sure's `AccountOrder.default`, the name order every list had before the preference. */
export const DEFAULT_ACCOUNT_ORDER: AccountOrder = "name_asc";
