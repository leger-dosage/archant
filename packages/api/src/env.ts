import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

function isTimeZone(value: string): boolean {
	try {
		return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone !== "";
	} catch {
		return false;
	}
}

/**
 * Exported as a function rather than a module-level object: some runtimes have
 * no ambient `process.env` and hand their bindings over per request.
 */
export function validateEnv(runtimeEnv: Record<string, string | undefined>) {
	return createEnv({
		server: {
			DATABASE_URL: z.string().min(1),
			// A local file needs no token; a `libsql://` URL does.
			DATABASE_AUTH_TOKEN: z.string().optional(),
			// Decides which calendar day "today" is, so a balance written at 00:30
			// in Paris lands on the right date whatever the server's clock zone.
			APP_TIMEZONE: z.string().refine(isTimeZone).default("Europe/Paris"),
			LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
		},
		runtimeEnv,
		emptyStringAsUndefined: true,
		onValidationError: (issues) => {
			const names = issues
				.map((issue) => issue.path?.map(String).join("."))
				.filter((name) => name !== undefined && name !== "");

			throw new Error(`Invalid environment variables: ${names.join(", ")}`);
		},
	});
}

export type Env = ReturnType<typeof validateEnv>;
