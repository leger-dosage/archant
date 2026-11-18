export const RECONCILIATION_STATUSES = ["unreconciled", "cleared", "reconciled"] as const;

export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];
