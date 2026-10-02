import type { BankConnectionDeps } from "../services/bank-connections.ts";

import { Hono } from "hono";

import { AppError } from "../lib/errors.ts";
import { sameSecret } from "../lib/secret.ts";
import { syncAll } from "../services/sync.ts";

export type SyncRouteDeps = BankConnectionDeps & {
	/** `SYNC_SECRET`; unset, every call is refused. */
	syncSecret?: string | undefined;
};

/** Whether the header carries the secret, compared in constant time. */
function carriesSecret(header: string | undefined, secret: string | undefined): boolean {
	// The scheme is case-insensitive (RFC 7235): `bearer` is as good as `Bearer`.
	const match = /^bearer (.+)$/iu.exec(header ?? "");

	if (secret === undefined || match?.[1] === undefined) {
		return false;
	}

	return sameSecret(match[1], secret);
}

/**
 * The scheduled sync, outside the session guard: a system cron or a
 * scheduled GitHub Action calls it with `Authorization: Bearer <SYNC_SECRET>`.
 * Anything else is refused before a single row is read.
 */
export function syncRoutes(deps: SyncRouteDeps) {
	return new Hono().post("/", async (c) => {
		if (!carriesSecret(c.req.header("authorization"), deps.syncSecret)) {
			throw new AppError("UNAUTHORIZED", "A valid sync secret is required.");
		}

		return c.json({ data: { connections: await syncAll(deps) } }, 200);
	});
}
