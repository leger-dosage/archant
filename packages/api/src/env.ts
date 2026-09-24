import { createEnv } from "@t3-oss/env-core";
import { createPrivateKey } from "node:crypto";
import { isAbsolute } from "node:path";
import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

function isTimeZone(value: string): boolean {
	try {
		return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone !== "";
	} catch {
		return false;
	}
}

/** AES-256 wants exactly this many bytes of key. */
export const ENCRYPTION_KEY_BYTES = 32;

/**
 * The PEM behind a base64 value, when Node reads it as an RSA private key,
 * PKCS#1 (`BEGIN RSA PRIVATE KEY`) or PKCS#8 (`BEGIN PRIVATE KEY`) alike.
 * Base64, because a multi-line PEM does not survive every `.env` parser or
 * control panel.
 */
function rsaPrivateKey(value: string) {
	try {
		const key = createPrivateKey(Buffer.from(value, "base64").toString("utf8"));

		return key.asymmetricKeyType === "rsa" ? key : null;
	} catch {
		return null;
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
			// The built interface, which the API then serves under `/`. Absolute,
			// because a relative path would depend on the directory the server
			// happens to be started from.
			WEB_DIST: z
				.string()
				.refine((value) => isAbsolute(value))
				.optional(),
			// Enable Banking (Story 10.1). All optional: without the three below the
			// bank routes answer 503 and the rest of the app is untouched. A value
			// present but unreadable still fails startup, as a bad secret does:
			// a typo would otherwise look like an unconfigured feature.
			ENABLE_BANKING_APPLICATION_ID: z.string().trim().min(1).optional(),
			ENABLE_BANKING_PRIVATE_KEY: z
				.string()
				.optional()
				.transform((value, context) => {
					if (value === undefined) {
						return undefined;
					}

					const key = rsaPrivateKey(value);

					if (key === null) {
						context.addIssue({ code: "custom", message: "invalid_private_key" });

						return z.NEVER;
					}

					return key;
				}),
			// Encrypts bank session ids at rest. Losing it means reconnecting
			// every bank; changing it without a migration has the same effect.
			ENCRYPTION_KEY: z
				.base64()
				.transform((value) => Buffer.from(value, "base64"))
				.refine((key) => key.length === ENCRYPTION_KEY_BYTES)
				.optional(),
			// Overridden only by the end-to-end suite, which points it at a fake.
			ENABLE_BANKING_API_URL: z
				.url({ protocol: /^https?$/u })
				.default("https://api.enablebanking.com"),
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
