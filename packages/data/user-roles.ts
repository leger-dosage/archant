// Apart from the `users` table, so the interface reads the roles without
// bundling Drizzle.

/** Household roles (AD-21). A member can write to the ledger, a guest can read it. */
export const USER_ROLES = ["admin", "member", "guest"] as const;

export type UserRole = (typeof USER_ROLES)[number];
