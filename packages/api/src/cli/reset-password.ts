import { createDb } from "@archant/data/client";

import { validateEnv } from "../env.ts";
import { createLogger } from "../lib/logger.ts";
import { checkNewPassword, closePrompts, promptSecret } from "../lib/prompt.ts";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../schemas/setup.ts";
import { createAuth } from "../services/auth.ts";
import { PasswordResetError, resetPassword } from "../services/password.ts";

/**
 * `pnpm api reset-password <email>`: the way back in when the password is
 * lost, with no email service and no reset token (AD-13). The password is
 * typed twice, never echoed and never accepted as an argument, where the
 * shell history would keep it.
 *
 * Prompt-and-call wiring only: the checks live in `lib/prompt.ts` and the
 * write in `services/password.ts` (AD-1).
 */

const MESSAGES = {
	password_mismatch: "Les mots de passe ne correspondent pas.",
	password_too_short: `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`,
	password_too_long: `Le mot de passe ne peut pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`,
	unknown_user: "Aucun utilisateur avec cette adresse.",
} as const;

function fail(message: string): never {
	process.stderr.write(`${message}\n`);
	process.exit(1);
}

const email = process.argv[2]?.trim();

if (email === undefined || email === "") {
	fail("Usage : pnpm api reset-password <adresse e-mail>");
}

// The prompts need a terminal; `docker exec` without one reads nothing, which
// would look like a hang.
if (!process.stdin.isTTY) {
	fail("Aucun terminal : lancez la commande avec un terminal, par exemple « docker exec -it ».");
}

// Checked before anything is typed, so a missing variable does not waste the
// two prompts.
const env = validateEnv(process.env);
// Nothing but a failure is worth a line here: the confirmation below is the
// whole output of this command.
const logger = createLogger("error");
const db = await createDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);
const auth = createAuth({
	db,
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
	trustedProxies: env.TRUSTED_PROXIES,
	logger,
});

const password = await promptSecret("Nouveau mot de passe : ");
const confirmation = await promptSecret("Confirmer le nouveau mot de passe : ");
// Nothing more is asked; holding stdin open would keep the process alive.
closePrompts();
const problem = checkNewPassword(password, confirmation);

if (problem !== null) {
	fail(MESSAGES[problem]);
}

try {
	await resetPassword({ auth }, email, password);
} catch (error) {
	if (error instanceof PasswordResetError) {
		fail(MESSAGES[error.problem]);
	}

	throw error;
}

db.$client.close();
process.stdout.write(`Mot de passe modifié pour ${email}. Toutes les sessions ont été fermées.\n`);
