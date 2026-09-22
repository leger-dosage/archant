import type { Logger } from "../lib/logger.ts";
import type { SetupInput } from "../schemas/setup.ts";
import type { Auth } from "./auth.ts";
import type { ServiceDeps } from "./deps.ts";

import { eq } from "drizzle-orm";

import { users } from "@archant/data/schema/auth";
import { settings } from "@archant/data/schema/settings";

import { AppError } from "../lib/errors.ts";

export type SetupDeps = Pick<ServiceDeps, "db"> & { auth: Pick<Auth, "api">; logger: Logger };

const SETUP_KEY = "setup_completed_at";

const closed = () => new AppError("FORBIDDEN", "Setup is already complete.");

async function hasUser(deps: SetupDeps): Promise<boolean> {
	const rows = await deps.db.select({ id: users.id }).from(users).limit(1);

	return rows.length > 0;
}

/** Answers `403 FORBIDDEN` once a user exists, so the page knows to send the visitor to sign-in. */
export async function getSetupStatus(deps: SetupDeps): Promise<{ open: true }> {
	if (await hasUser(deps)) {
		throw closed();
	}

	return { open: true };
}

/**
 * Creates the single administrator. The `setup_completed_at` row is claimed
 * first, through its primary key: Better Auth writes on its own connection,
 * so neither a user count nor a transaction around it could stop two
 * concurrent requests from both creating one.
 */
export async function completeSetup(deps: SetupDeps, input: SetupInput): Promise<{ id: string }> {
	if (await hasUser(deps)) {
		throw closed();
	}

	const claimed = await deps.db
		.insert(settings)
		.values({ key: SETUP_KEY, value: String(Date.now()), updatedAt: Date.now() })
		.onConflictDoNothing()
		.returning({ key: settings.key });

	if (claimed.length === 0) {
		throw closed();
	}

	try {
		// No headers: a server call, which the admin plugin allows without a
		// session. The claim above is what stands between it and a stranger.
		const { user } = await deps.auth.api.createUser({
			body: {
				email: input.email,
				password: input.password,
				name: input.email.split("@")[0] ?? input.email,
				role: "admin",
			},
		});

		deps.logger.info({ userId: user.id }, "administrator created");

		return { id: user.id };
	} catch (error) {
		// Otherwise setup would stay closed with no user, and only editing the
		// database could reopen it.
		await deps.db.delete(settings).where(eq(settings.key, SETUP_KEY));
		throw error;
	}
}
