import type { Database } from "@archant/data/client";

/**
 * What a service needs from the outside world. Passed in rather than imported
 * so a spec can hand each file its own temporary database.
 */
export type ServiceDeps = {
	/**
	 * The query methods only, which a transaction offers too: a service can
	 * then run another's work inside its own transaction, where the other's
	 * `transaction` call becomes a savepoint.
	 */
	db: Pick<Database, "select" | "selectDistinct" | "insert" | "update" | "delete" | "transaction">;
	/** IANA zone that decides which calendar day "today" is (`APP_TIMEZONE`). */
	timeZone: string;
};
