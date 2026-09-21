import type { Database } from "@archant/data/client";

/**
 * What a service needs from the outside world. Passed in rather than imported
 * so a spec can hand each file its own temporary database.
 */
export type ServiceDeps = {
	db: Database;
	/** IANA zone that decides which calendar day "today" is (`APP_TIMEZONE`). */
	timeZone: string;
};
