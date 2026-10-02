import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { sessions, users } from "./auth.ts";

/**
 * The tables of Better Auth's `jwt` plugin and of `@better-auth/oauth-provider`,
 * which `@better-auth/mcp` configures (AD-19). Declared by hand from the
 * models the plugins list, as `auth.ts` is, with snake_case columns: a Better
 * Auth upgrade that adds a field needs a migration here, and
 * `services/auth.spec.ts` in `@archant/api` fails until it has one.
 *
 * On SQLite the adapter stores a `string[]` or a `json` field as JSON text,
 * encoding and decoding it itself, so those columns are plain `text`: a
 * Drizzle `json` mode would encode it a second time. Dates are epoch
 * milliseconds, as everywhere else.
 */

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

/** The key pairs access tokens are signed with; the private key is encrypted with `BETTER_AUTH_SECRET`. */
export const jwks = sqliteTable("jwks", {
	id: text("id").primaryKey(),
	publicKey: text("public_key").notNull(),
	privateKey: text("private_key").notNull(),
	createdAt: timestamp("created_at").notNull(),
	expiresAt: timestamp("expires_at"),
	alg: text("alg"),
	crv: text("crv"),
});

/**
 * An assistant, registered dynamically or from its Client ID Metadata
 * Document. A row stays once its consent is gone: Better Auth refuses deleting
 * a client nobody owns, and a self-registered one has no owner.
 */
export const oauthClients = sqliteTable(
	"oauth_clients",
	{
		id: text("id").primaryKey(),
		clientId: text("client_id").notNull().unique(),
		clientSecret: text("client_secret"),
		clientDiscoveryId: text("client_discovery_id"),
		disabled: integer("disabled", { mode: "boolean" }).default(false),
		skipConsent: integer("skip_consent", { mode: "boolean" }),
		enableEndSession: integer("enable_end_session", { mode: "boolean" }),
		subjectType: text("subject_type"),
		scopes: text("scopes"),
		clientCredentialsScopes: text("client_credentials_scopes").default("[]"),
		userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at"),
		updatedAt: timestamp("updated_at"),
		name: text("name"),
		uri: text("uri"),
		icon: text("icon"),
		contacts: text("contacts"),
		tos: text("tos"),
		policy: text("policy"),
		softwareId: text("software_id"),
		softwareVersion: text("software_version"),
		softwareStatement: text("software_statement"),
		redirectUris: text("redirect_uris").notNull(),
		postLogoutRedirectUris: text("post_logout_redirect_uris"),
		backchannelLogoutUri: text("backchannel_logout_uri"),
		backchannelLogoutSessionRequired: integer("backchannel_logout_session_required", {
			mode: "boolean",
		}),
		tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
		applicationType: text("application_type"),
		jwks: text("jwks"),
		jwksUri: text("jwks_uri"),
		grantTypes: text("grant_types"),
		responseTypes: text("response_types"),
		requirePKCE: integer("require_pkce", { mode: "boolean" }),
		dpopBoundAccessTokens: integer("dpop_bound_access_tokens", { mode: "boolean" }).default(false),
		referenceId: text("reference_id"),
		metadata: text("metadata"),
	},
	(table) => [index("oauth_clients_user_id").on(table.userId)],
);

/** The protected resources tokens are issued for: `/api/mcp` alone, seeded at start. */
export const oauthResources = sqliteTable("oauth_resources", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull().unique(),
	name: text("name").notNull(),
	accessTokenTtl: integer("access_token_ttl"),
	refreshTokenTtl: integer("refresh_token_ttl"),
	signingAlgorithm: text("signing_algorithm"),
	signingKeyId: text("signing_key_id"),
	allowedScopes: text("allowed_scopes"),
	customClaims: text("custom_claims"),
	dpopBoundAccessTokensRequired: integer("dpop_bound_access_tokens_required", {
		mode: "boolean",
	}).default(false),
	disabled: integer("disabled", { mode: "boolean" }).default(false),
	createdAt: timestamp("created_at"),
	updatedAt: timestamp("updated_at"),
	policyVersion: integer("policy_version").default(1),
	metadata: text("metadata"),
});

/** Which resource each client may ask a token for. */
export const oauthClientResources = sqliteTable(
	"oauth_client_resources",
	{
		id: text("id").primaryKey(),
		clientId: text("client_id")
			.notNull()
			.references(() => oauthClients.clientId, { onDelete: "cascade" }),
		resourceId: text("resource_id")
			.notNull()
			.references(() => oauthResources.identifier, { onDelete: "cascade" }),
		metadata: text("metadata"),
		createdAt: timestamp("created_at"),
	},
	(table) => [
		index("oauth_client_resources_client_id").on(table.clientId),
		index("oauth_client_resources_resource_id").on(table.resourceId),
	],
);

/** Refresh tokens, stored hashed. Rotated at each use; `revoked` set by a disconnection or a replay. */
export const oauthRefreshTokens = sqliteTable(
	"oauth_refresh_tokens",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull().unique(),
		clientId: text("client_id")
			.notNull()
			.references(() => oauthClients.clientId, { onDelete: "cascade" }),
		sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		referenceId: text("reference_id"),
		authorizationCodeId: text("authorization_code_id"),
		resources: text("resources"),
		requestedUserInfoClaims: text("requested_user_info_claims"),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").notNull(),
		revoked: timestamp("revoked"),
		rotatedAt: timestamp("rotated_at"),
		rotationReplayResponse: text("rotation_replay_response"),
		rotationReplayExpiresAt: timestamp("rotation_replay_expires_at"),
		authTime: timestamp("auth_time"),
		confirmation: text("confirmation"),
		scopes: text("scopes").notNull(),
	},
	(table) => [
		index("oauth_refresh_tokens_client_id").on(table.clientId),
		index("oauth_refresh_tokens_session_id").on(table.sessionId),
		index("oauth_refresh_tokens_user_id").on(table.userId),
		index("oauth_refresh_tokens_authorization_code_id").on(table.authorizationCodeId),
	],
);

/**
 * Opaque access tokens only. Archant's are JWTs bound to `/api/mcp`, which
 * Better Auth never stores; the table exists because the plugin declares it.
 */
export const oauthAccessTokens = sqliteTable(
	"oauth_access_tokens",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull().unique(),
		clientId: text("client_id")
			.notNull()
			.references(() => oauthClients.clientId, { onDelete: "cascade" }),
		sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
		userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
		referenceId: text("reference_id"),
		authorizationCodeId: text("authorization_code_id"),
		resources: text("resources"),
		requestedUserInfoClaims: text("requested_user_info_claims"),
		refreshId: text("refresh_id").references(() => oauthRefreshTokens.id, {
			onDelete: "cascade",
		}),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").notNull(),
		revoked: timestamp("revoked"),
		confirmation: text("confirmation"),
		scopes: text("scopes").notNull(),
	},
	(table) => [
		index("oauth_access_tokens_client_id").on(table.clientId),
		index("oauth_access_tokens_session_id").on(table.sessionId),
		index("oauth_access_tokens_user_id").on(table.userId),
		index("oauth_access_tokens_authorization_code_id").on(table.authorizationCodeId),
		index("oauth_access_tokens_refresh_id").on(table.refreshId),
	],
);

/**
 * What the owner granted an assistant on the consent page. Archant has one
 * user, so an assistant is « connected » exactly while it holds a row here.
 */
export const oauthConsents = sqliteTable(
	"oauth_consents",
	{
		id: text("id").primaryKey(),
		clientId: text("client_id")
			.notNull()
			.references(() => oauthClients.clientId, { onDelete: "cascade" }),
		userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
		referenceId: text("reference_id"),
		resources: text("resources"),
		requestedUserInfoClaims: text("requested_user_info_claims"),
		scopes: text("scopes").notNull(),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(table) => [
		index("oauth_consents_client_id").on(table.clientId),
		index("oauth_consents_user_id").on(table.userId),
	],
);

/** The `jti` of each `private_key_jwt` client assertion seen, so none is replayed. */
export const oauthClientAssertions = sqliteTable("oauth_client_assertions", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at").notNull(),
});
