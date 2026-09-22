import type { Logger } from "../lib/logger.ts";
import type { ServiceDeps } from "./deps.ts";

import { settings } from "@archant/data/schema/settings";

import { AppError } from "../lib/errors.ts";

export type HealthDeps = Pick<ServiceDeps, "db"> & { logger: Logger };

/**
 * Reads one row of a migrated table: a container that answers here has a
 * database it can query, not merely a process that listens.
 */
export async function checkHealth(deps: HealthDeps): Promise<{ status: "ok" }> {
	try {
		await deps.db.select({ key: settings.key }).from(settings).limit(1);
	} catch (error) {
		// The name only: a driver message can carry the file path or a query.
		deps.logger.error(
			{ error: error instanceof Error ? error.name : "unknown" },
			"health check failed",
		);

		throw new AppError("SERVICE_UNAVAILABLE", "The database does not answer.");
	}

	return { status: "ok" };
}
