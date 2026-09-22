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
			// Also read by packages/web/vite.config.ts as its proxy target: one
			// variable names the API's port in both processes, so they cannot drift.
			PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
			// Signs session cookies. Rotating it signs every user out.
			BETTER_AUTH_SECRET: z.string().min(32),
			// The origin the browser uses, not the API's own port: Better Auth
			// refuses a sign-in whose `Origin` it does not trust, and in
			// development the browser sends Vite's origin through the proxy.
			BETTER_AUTH_URL: z
				.url({ protocol: /^https?$/u })
				// An origin only: Better Auth mounts under `/api/auth` of this URL,
				// so a path would move every auth route away from where it is served.
				.refine((value) => {
					const url = new URL(value);

					return url.pathname === "/" && url.search === "" && url.hash === "";
				}),
			// The reverse proxies whose `x-forwarded-for` is believed. Empty, the
			// client address is the TCP peer and no header can forge it.
			TRUSTED_PROXIES: z
				.string()
				.optional()
				.transform((value) =>
					(value ?? "")
						.split(",")
						.map((entry) => entry.trim())
						.filter((entry) => entry !== ""),
				)
				.pipe(z.array(z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]))),
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
