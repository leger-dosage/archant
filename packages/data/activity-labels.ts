/**
 * What an investment or crypto account's transaction did, Sure's
 * `Transaction::ACTIVITY_LABELS` in its order. Stored in English, as Sure
 * stores them, so an export reads the same in both. Kept out of the schema
 * module so the pure domain and the interface can read it without reaching
 * for the table.
 */
export const ACTIVITY_LABELS = [
	"Buy",
	"Sell",
	"Sweep In",
	"Sweep Out",
	"Dividend",
	"Reinvestment",
	"Interest",
	"Fee",
	"Transfer",
	"Contribution",
	"Withdrawal",
	"Exchange",
	"Other",
] as const;

export type ActivityLabel = (typeof ACTIVITY_LABELS)[number];

/**
 * Money moving within the account, not in or out of the household: Sure's
 * `INTERNAL_MOVEMENT_LABELS`, left out of cash flow (AD-9).
 */
export const INTERNAL_MOVEMENT_LABELS = [
	"Transfer",
	"Sweep In",
	"Sweep Out",
	"Exchange",
] as const satisfies readonly ActivityLabel[];
