// Apart from the `users` table, so the interface reads the roles without
// bundling Drizzle.

/**
 * Every role a user can hold (AD-21): an `admin` reads and writes everything,
 * a `viewer` reads what an administrator reads, bank credentials, assistants
 * and the export apart, and writes nothing. One global role rather than
 * Sure's per-account sharing, since one instance is one household. A new
 * value is a check rebuilt, no data migration.
 */
export const USER_ROLES = ["admin", "viewer"] as const;

export type UserRole = (typeof USER_ROLES)[number];
