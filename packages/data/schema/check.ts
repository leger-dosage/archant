import type { SQL } from "drizzle-orm";

import { sql } from "drizzle-orm";

/**
 * Renders a `const` array as an SQL `IN` list for a check constraint, so the
 * database and the TypeScript union are built from the same values. Only ever
 * called with literals from this package, never with user input.
 */
export function inList(values: readonly string[]): SQL {
	return sql.raw(`(${values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ")})`);
}
