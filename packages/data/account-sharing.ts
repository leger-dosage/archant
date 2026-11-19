export const ACCOUNT_PERMISSIONS = ["full_control", "read_write", "read_only"] as const;
export type AccountPermission = (typeof ACCOUNT_PERMISSIONS)[number];

export const BUDGET_PERMISSIONS = ["read_write", "read_only"] as const;
export type BudgetPermission = (typeof BUDGET_PERMISSIONS)[number];

export const ACCOUNT_SHARING_DEFAULTS = ["shared", "private"] as const;
export type AccountSharingDefault = (typeof ACCOUNT_SHARING_DEFAULTS)[number];
