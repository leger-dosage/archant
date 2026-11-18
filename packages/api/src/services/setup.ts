import type { Logger } from "../lib/logger.ts";
import type { SetupInput } from "../schemas/setup.ts";
import type { Auth } from "./auth.ts";
import type { ServiceDeps } from "./deps.ts";

import { eq } from "drizzle-orm";

import {
	DEFAULT_HOUSEHOLD_COUNTRY,
	DEFAULT_TIME_ZONE,
	currencyForCountry,
	defaultDateFormat,
} from "@archant/data/household-preferences";
import { users } from "@archant/data/schema/auth";
import { settings } from "@archant/data/schema/settings";

import { AppError } from "../lib/errors.ts";
import { sameSecret } from "../lib/secret.ts";
import { saveHouseholdLocale } from "./household-locale.ts";
import { seedDefaults } from "./seed.ts";
import { saveHouseholdPreferences } from "./settings.ts";

export type SetupDeps = Pick<ServiceDeps, "db"> & {
	auth: Pick<Auth, "api">;
	timeZone?: string;
	logger: Logger;
	/**
	 * The token `index.ts` generated and logged at start because no user
	 * existed; `null` once one did, which refuses every token.
	 */
	setupToken: string | null;
	/**
	 * Seeds the default categories once the administrator exists, in the
	 * household's language. The server turns it on; a spec that wants no
	 * categories it did not make leaves it off.
	 */
	seedAtSetup?: boolean | undefined;
};

const SETUP_KEY = "setup_completed_at";

const closed = () => new AppError("FORBIDDEN", "Setup is already complete.");

export async function hasUser(deps: Pick<ServiceDeps, "db">): Promise<boolean> {
	const rows = await deps.db.select({ id: users.id }).from(users).limit(1);

	return rows.length > 0;
}

/** Answers `403 FORBIDDEN` once a user exists, so the page knows to send the visitor to sign-in. */
export async function getSetupStatus(deps: Pick<ServiceDeps, "db">): Promise<{ open: true }> {
	await assertSetupOpen(deps);

	return { open: true };
}

/** Throws `403 FORBIDDEN` once a user exists. */
export async function assertSetupOpen(deps: Pick<ServiceDeps, "db">): Promise<void> {
	if (await hasUser(deps)) {
		throw closed();
	}
}

/**
 * Creates the single administrator for whoever holds the setup token, which
 * only someone reading the server's logs has: a new instance's address is
 * public within minutes of its certificate. The `setup_completed_at` row is
 * then claimed first, through its primary key: Better Auth writes on its own
 * connection, so neither a user count nor a transaction around it could stop
 * two concurrent requests from both creating one.
 */
export async function completeSetup(deps: SetupDeps, input: SetupInput): Promise<{ id: string }> {
	if (deps.setupToken === null || !sameSecret(input.token, deps.setupToken)) {
		// Never the submitted value: it may be a near miss of the real token.
		deps.logger.warn("setup refused: invalid setup token");
		throw new AppError("SETUP_TOKEN_INVALID", "The setup token is invalid.");
	}

	await assertSetupOpen(deps);

	const now = Date.now();
	const claimed = await deps.db
		.insert(settings)
		.values({ key: SETUP_KEY, value: String(now), updatedAt: now })
		.onConflictDoNothing()
		.returning({ key: settings.key });

	if (claimed.length === 0) {
		throw closed();
	}

	let administrator: { id: string };

	try {
		const locale = input.locale ?? "fr";
		const country = input.country ?? DEFAULT_HOUSEHOLD_COUNTRY;

		// Better Auth creates the user on another connection. Write the preferences
		// first so an existing user always has the choices made at setup. A retry
		// overwrites these choices if creating the user fails.
		await saveHouseholdLocale(deps.db, locale);
		await saveHouseholdPreferences(deps.db, {
			country,
			baseCurrency: input.baseCurrency ?? currencyForCountry(country),
			dateFormat: input.dateFormat ?? defaultDateFormat(locale),
			timeZone: deps.timeZone ?? DEFAULT_TIME_ZONE,
			monthStartDay: 1,
		});

		// No headers: a server call, which the admin plugin allows without a
		// session. The claim above is what stands between it and a stranger.
		const { user } = await deps.auth.api.createUser({
			body: {
				email: input.email,
				password: input.password,
				// Better Auth requires a name; blank means no greeting by name.
				name: input.name ?? "",
				role: "admin",
			},
		});

		administrator = user;
	} catch (error) {
		// Otherwise setup would stay closed with no user, and only editing the
		// database could reopen it.
		await deps.db.delete(settings).where(eq(settings.key, SETUP_KEY));
		throw error;
	}

	deps.logger.info({ userId: administrator.id }, "administrator created");
	if (deps.seedAtSetup === true) {
		await seedDefaults(deps);
	}

	return { id: administrator.id };
}
