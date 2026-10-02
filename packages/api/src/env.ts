import type { KeyObject } from "node:crypto";

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

/** Whether `url` is HTTPS, or plain HTTP to this machine's own loopback. */
function isHttpsOrLoopback(url: string): boolean {
	if (!URL.canParse(url)) {
		return false;
	}

	const { protocol, hostname } = new URL(url);

	return (
		protocol === "https:" ||
		hostname === "localhost" ||
		hostname === "[::1]" ||
		// The URL parser writes every IPv4 form, `127.1` included, as four numbers.
		/^127\.\d+\.\d+\.\d+$/u.test(hostname)
	);
}

/** AES-256 wants exactly this many bytes of key. */
const ENCRYPTION_KEY_BYTES = 32;

/**
 * The RSA private key a PEM holds, PKCS#1 (`BEGIN RSA PRIVATE KEY`) or
 * PKCS#8 (`BEGIN PRIVATE KEY`) alike, and a key bundled after its
 * certificate, as some control panels hand them out; `null` for anything else.
 */
export function rsaPrivateKey(pem: string): KeyObject | null {
	try {
		const key = createPrivateKey(pem);

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
			// Also read by packages/app/vite.config.ts as its proxy target: one
			// variable names the API's port in both processes, so they cannot drift.
			PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
			// Loopback by default: bound to every interface, a laptop's sign-in
			// and `/setup` answered anyone on the same Wi-Fi. The image sets
			// `0.0.0.0`, because a published port reaches the container through its
			// network interface, never its loopback. An address, never a name:
			// Node binds only the first address a name resolves to, `::1` for
			// `localhost` on macOS, and a typo would pass for a bind failure.
			HOST: z.union([z.ipv4(), z.ipv6()]).default("127.0.0.1"),
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
			// Enable Banking (Story 10.1). Optional: without them the credentials
			// saved from « Réglages › Banques » apply (Story 11.14); with them, they
			// win, so a secret pinned in a vault is never overridden by a click.
			// Both or neither, and a value present but unreadable fails startup,
			// as a bad secret does: a typo would otherwise look like an
			// unconfigured feature.
			ENABLE_BANKING_APPLICATION_ID: z.string().trim().min(1).optional(),
			ENABLE_BANKING_PRIVATE_KEY: z
				.string()
				.optional()
				.transform((value, context) => {
					if (value === undefined) {
						return undefined;
					}

					// Base64, because a multi-line PEM does not survive every `.env`
					// parser or control panel.
					const key = rsaPrivateKey(Buffer.from(value, "base64").toString("utf8"));

					if (key === null) {
						context.addIssue({ code: "custom", message: "invalid_private_key" });

						return z.NEVER;
					}

					return key;
				}),
			// Encrypts bank session ids and the private key saved from the
			// interface at rest. Losing it means setting Enable Banking up again
			// and reconnecting every bank; changing it without a migration has
			// the same effect.
			ENCRYPTION_KEY: z
				.base64()
				.transform((value) => Buffer.from(value, "base64"))
				.refine((key) => key.length === ENCRYPTION_KEY_BYTES)
				.optional(),
			// The bearer token `POST /api/sync` accepts. Unset, the route refuses
			// every call and only the interface's button syncs.
			SYNC_SECRET: z.string().min(32).optional(),
			// The release the image was built from, set by the Dockerfile from the
			// tag. Digits only, without the tag's `v`: the interface puts the `v`
			// back to link the release. Unset, this is a development build.
			APP_VERSION: z
				.string()
				.regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u)
				.optional()
				.transform((value) => value ?? null),
			// Overridden only by the end-to-end suite, which points it at a fake.
			// Plain HTTP only on loopback: each request carries a token signed with
			// the application's key, and the answers hold the household's accounts.
			ENABLE_BANKING_API_URL: z
				.url({ protocol: /^https?$/u })
				.refine(isHttpsOrLoopback)
				.default("https://api.enablebanking.com"),
		},
		// One variable of the pair alone is a half-finished setup: the stored
		// credentials would silently apply instead, so startup names the other.
		createFinalSchema: (shape) =>
			z.object(shape).superRefine((env, context) => {
				const pair = ["ENABLE_BANKING_APPLICATION_ID", "ENABLE_BANKING_PRIVATE_KEY"] as const;
				const [first, second] = pair.map((name) => env[name] !== undefined);

				if (first !== second) {
					context.addIssue({
						code: "custom",
						path: [first === true ? pair[1] : pair[0]],
						message: "missing_pair",
					});
				}
			}),
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
