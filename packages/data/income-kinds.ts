/**
 * What a trade of quantity zero records, as Sure's `Trade::CreateForm`: the
 * cash a held security paid, or the interest the broker paid on a security
 * or on the account's cash. Reports count it as income (AD-9). Kept out of
 * the schema module so the pure domain and the interface can read it without
 * reaching for the table.
 */
export const INCOME_KINDS = ["dividend", "interest"] as const;

export type IncomeKind = (typeof INCOME_KINDS)[number];
