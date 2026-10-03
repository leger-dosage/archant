import type { Logger } from "../lib/logger.ts";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";

import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { admin, jwt, twoFactor } from "better-auth/plugins";

import type { Database } from "@archant/data/client";
import {
	authAccounts,
	rateLimits,
	sessions,
	twoFactors,
	users,
	verifications,
} from "@archant/data/schema/auth";
import {
	jwks,
	oauthAccessTokens,
	oauthClientAssertions,
	oauthClientResources,
	oauthClients,
	oauthConsents,
	oauthRefreshTokens,
	oauthResources,
} from "@archant/data/schema/oauth";

import { firstNameSchema } from "../schemas/setup.ts";

export type AuthOptions = {
	db: Database;
	/** `BETTER_AUTH_SECRET`. */
	secret: string;
	/** `BETTER_AUTH_URL`: the browser's origin, and the one origin Better Auth trusts. */
	baseURL: string;
	/** `TRUSTED_PROXIES`: the proxies Better Auth walks past in `x-forwarded-for`. */
	trustedProxies: string[];
	logger: Logger;
	/**
	 * How a Client ID Metadata Document is fetched: `@better-auth/cimd/node`'s,
	 * which resolves the name once, refuses every non-public address and
	 * follows no redirect. A spec hands in its own, since no test reaches the
	 * network.
	 */
	fetchClientMetadataResource?: ClientMetadataResourceFetch;
};

/** What an assistant may be granted. `offline_access` is how it gets a refresh token. */
const ASSISTANT_SCOPES = ["archant:read", "archant:write", "offline_access"];

/** An access token lives ten minutes: a stolen one is worth little, and a refresh is silent. */
const ACCESS_TOKEN_SECONDS = 600;

/** Thirty days without a call and the assistant signs in again. */
const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;

/** The address an assistant is given, and the audience of every token it holds (RFC 8707). */
export function mcpResource(baseURL: string): string {
	return `${new URL(baseURL).origin}/api/mcp`;
}

/** Who issues the tokens: Better Auth, mounted under `/api/auth`. */
export function mcpIssuer(baseURL: string): string {
	return `${new URL(baseURL).origin}/api/auth`;
}

function isLoopbackHost(hostname: string): boolean {
	const octets = hostname.split(".");

	return (
		hostname === "localhost" ||
		hostname === "[::1]" ||
		(octets.length === 4 &&
			octets[0] === "127" &&
			octets.every((octet) => /^\d+$/u.test(octet) && Number(octet) <= 255))
	);
}

/**
 * Whether assistants can connect: `mcp()` throws at start on any resource but
 * HTTPS or loopback HTTP, and a server that refused to start over a feature
 * the owner may never use would be the worse failure. The same rule as
 * `@better-auth/mcp`'s own, which it does not export.
 */
export function assistantsAvailable(baseURL: string): boolean {
	const url = new URL(baseURL);

	return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
}

/**
 * `@better-auth/oauth-provider` declares its OpenAPI parameters with
 * `items?: undefined`, which `exactOptionalPropertyTypes` refuses against
 * Better Auth's plugin type, and typed as it is, its endpoints would turn
 * every other one on `auth.api` into a maybe. Nothing here calls them through
 * `auth.api`: clients reach them over HTTP, and `services/assistants.ts` reads
 * their tables. So the plugin is typed by its id alone; at run time it is
 * whole.
 */
function untyped(plugin: { id: "oauth-provider" }): { id: "oauth-provider" } {
	return plugin;
}

/**
 * The authorisation server assistants sign in through (AD-19). `twoFactor`
 * comes before `mcp` in the plugin list: its hook expires the session cookie
 * of a password-only sign-in before `mcp`'s hook would continue the OAuth
 * flow on it.
 */
function assistantPlugins(baseURL: string, fetchMetadata: ClientMetadataResourceFetch) {
	return [
		// The key set signs the access tokens. No `set-auth-jwt` header on every
		// session read: the interface never uses one, and each would cost a
		// signature on every request `requireSession` checks.
		jwt({ disableSettingJwtHeader: true }),
		untyped(
			mcp({
				resource: mcpResource(baseURL),
				loginPage: "/sign-in",
				consentPage: "/oauth/consent",
				scopes: ASSISTANT_SCOPES,
				accessTokenExpiresIn: ACCESS_TOKEN_SECONDS,
				refreshTokenExpiresIn: REFRESH_TOKEN_SECONDS,
				// No `client_credentials`: every token acts for the owner, who signed in.
				grantTypes: ["authorization_code", "refresh_token"],
				// Claude Code, VS Code and Cursor register themselves when they do
				// not publish a metadata document; nobody is signed in yet then.
				allowDynamicClientRegistration: true,
				allowUnauthenticatedClientRegistration: true,
			}),
		),
		cimd({ fetchClientMetadataResource: fetchMetadata }),
	];
}

/**
 * Endpoints of `@better-auth/oauth-provider` that let a signed-in user create
 * or rewrite a client by hand. Assistants register themselves; nothing else
 * should.
 */
const OAUTH_CLIENT_PATHS = ["/oauth2/create-client", "/oauth2/update-client"];

/**
 * The admin plugin supplies the `role` field and the server-side `createUser`
 * setup uses; its HTTP endpoints would let the signed-in admin create a
 * second user, set a role the database refuses or ban themselves. Better Auth
 * matches these paths exactly, with no wildcard.
 */
const ADMIN_PATHS = [
	"/admin/set-role",
	"/admin/get-user",
	"/admin/create-user",
	"/admin/update-user",
	"/admin/list-users",
	"/admin/list-user-sessions",
	"/admin/unban-user",
	"/admin/ban-user",
	"/admin/impersonate-user",
	"/admin/stop-impersonating",
	"/admin/revoke-user-session",
	"/admin/revoke-user-sessions",
	"/admin/remove-user",
	"/admin/set-user-password",
	"/admin/has-permission",
];

/**
 * Every table Better Auth writes, keyed as its Drizzle adapter looks them up:
 * with `usePlural` it appends an `s` to each model name, the renamed
 * `auth_accounts` and `jwks` included. The SQL names stay snake_case.
 */
export const AUTH_SCHEMA = {
	users,
	sessions,
	auth_accountss: authAccounts,
	verifications,
	rateLimits,
	twoFactors,
	jwkss: jwks,
	oauthClients,
	oauthResources,
	oauthClientResources,
	oauthRefreshTokens,
	oauthAccessTokens,
	oauthConsents,
	oauthClientAssertions,
};

/**
 * Users and sessions belong to Better Auth (AD-13); nothing here hand-rolls a
 * session or a password. Session length, cookie attributes and password
 * length stay at its defaults (NFR6).
 */
export function createAuth({
	db,
	secret,
	baseURL,
	trustedProxies,
	logger,
	fetchClientMetadataResource: fetchMetadata = fetchClientMetadataResource,
}: AuthOptions) {
	const auth = betterAuth({
		baseURL,
		secret,
		database: drizzleAdapter(db, {
			provider: "sqlite",
			usePlural: true,
			schema: AUTH_SCHEMA,
		}),
		account: { modelName: "auth_accounts" },
		// No public sign-up: setup creates the administrator.
		emailAndPassword: { enabled: true, disableSignUp: true },
		plugins: [
			// A user created without a role reads and writes nothing more than a
			// viewer: every creation names its role, and a forgotten one fails
			// closed (AD-21).
			admin({ defaultRole: "viewer" }),
			// Every other option at its default: 6-digit, 30-second TOTP, ten
			// backup codes stored encrypted, 5 attempts per challenge, a
			// 15-minute lockout after 10 failures and 3 requests per 10 seconds
			// per address on `/two-factor/*`. The issuer is what the
			// authenticator app shows; without it, Better Auth names itself.
			twoFactor({ issuer: "Archant" }),
			...(assistantsAvailable(baseURL) ? assistantPlugins(baseURL, fetchMetadata) : []),
		],
		databaseHooks: {
			user: {
				update: {
					// `/update-user` takes any string as a name; the security form's
					// rule is enforced here too, so a hand-made request stores
					// nothing the form would refuse. Every other update, such as a
					// password change touching `updatedAt`, carries no name.
					before: async (user) => {
						if (user.name === undefined) {
							return { data: user };
						}

						const parsed = firstNameSchema.safeParse(user.name);

						if (!parsed.success) {
							// Returning `false` would not do: `/update-user` then answers
							// success with the refused name, having stored nothing.
							throw APIError.fromStatus("BAD_REQUEST", { message: "The first name is invalid." });
						}

						return { data: { ...user, name: parsed.data } };
					},
				},
			},
		},
		disabledPaths: [...ADMIN_PATHS, ...OAUTH_CLIENT_PATHS],
		// `x-forwarded-for` is rebuilt from the TCP peer before Better Auth sees
		// it (lib/client-address.ts); this list is where its walk stops.
		advanced: { ipAddress: { trustedProxies } },
		// Better Auth enables it only when NODE_ENV is production. On explicitly,
		// so a server started any other way still slows down password guessing,
		// and tests see the behaviour that ships. In the database, not in
		// memory: a restart would otherwise hand every address a fresh allowance.
		rateLimit: { enabled: true, storage: "database" },
		telemetry: { enabled: false },
		logger: {
			// The message only: Better Auth's arguments can carry an email or a
			// raw database error, which must not reach the logs (AD-14).
			log: (level, message) => {
				logger[level]({ source: "better-auth" }, message);
			},
		},
	});

	// Better Auth starts at once, and `mcp()`'s start seeds `/api/mcp` as a
	// resource in the database. `index.ts` awaits it, so a failure stops the
	// server; observed here too, so an instance a spec builds and drops
	// before its database closes is no unhandled rejection. Every later
	// `await auth.$context` still sees the failure.
	auth.$context.catch(() => undefined);

	return auth;
}

export type Auth = ReturnType<typeof createAuth>;
