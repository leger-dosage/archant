import type { OAuthProvider } from "@better-auth/core/oauth2";
import type { BetterAuthPlugin } from "better-auth";

import { verifyProviderIdToken } from "@better-auth/core/oauth2";
import { genericOAuth } from "better-auth/plugins";
import { createRemoteJWKSet, decodeJwt } from "jose";
import { createHash } from "node:crypto";
import { z } from "zod";

import { firstNameSchema } from "../schemas/setup.ts";

export const OPENID_PROVIDER = "openid-connect";
export const OPENID_CALLBACK = `/api/auth/callback/${OPENID_PROVIDER}`;

export type OpenIdConnectConfig = {
	issuer: string;
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	jitMode: "create_and_link" | "link_only";
	domains: string[];
};

export function openIdAccountId(issuer: string, subject: string): string {
	return createHash("sha256")
		.update(JSON.stringify([issuer, subject]))
		.digest("hex");
}

export function secureOpenIdUrl(value: string): boolean {
	if (!URL.canParse(value)) {
		return false;
	}

	const url = new URL(value);
	return (
		!url.username &&
		!url.password &&
		!value.includes("#") &&
		(url.protocol === "https:" ||
			(url.protocol === "http:" && /^(localhost|\[::1\]|127\.\d+\.\d+\.\d+)$/u.test(url.hostname)))
	);
}

const endpoint = z.string().refine(secureOpenIdUrl);
const discoverySchema = z.object({
	issuer: endpoint,
	authorization_endpoint: endpoint,
	token_endpoint: endpoint,
	jwks_uri: endpoint,
	userinfo_endpoint: endpoint.optional(),
	token_endpoint_auth_methods_supported: z.array(z.string()).default(["client_secret_basic"]),
	id_token_signing_alg_values_supported: z.array(z.string()),
});

const identityClaims = z.object({
	sub: z.string().regex(/^[\x20-\x7e]{1,255}$/u),
	email: z.email().max(254),
	email_verified: z.literal(true),
	given_name: firstNameSchema.catch(""),
});

async function getJson(url: string, headers?: Headers): Promise<unknown> {
	const response = await fetch(url, {
		...(headers ? { headers } : {}),
		redirect: "error",
		signal: AbortSignal.timeout(5000),
	});
	return response.ok ? response.json() : null;
}

/**
 * Use Generic OAuth's code exchange and the core callback, with metadata
 * validated against the configured issuer before any client secret is sent.
 */
export function openIdProvider(config: OpenIdConnectConfig): BetterAuthPlugin {
	return {
		id: "generic-oauth",
		async init(ctx) {
			const issuer = new URL(config.issuer);
			const discovery = new URL(issuer);
			discovery.pathname = `${issuer.pathname.replace(/\/$/u, "")}/.well-known/openid-configuration`;
			const metadata = discoverySchema.safeParse(await getJson(discovery.href).catch(() => null));
			if (!metadata.success || metadata.data.issuer !== config.issuer) {
				ctx.logger.warn("OpenID Connect discovery failed or returned an unexpected issuer");
				return {};
			}

			const document = metadata.data;
			const endpoints = [
				document.authorization_endpoint,
				document.token_endpoint,
				document.jwks_uri,
				document.userinfo_endpoint,
			];
			if (
				issuer.protocol === "https:" &&
				endpoints.some((url) => url !== undefined && new URL(url).protocol === "http:")
			) {
				ctx.logger.warn("OpenID Connect discovery returned an insecure endpoint");
				return {};
			}

			// Only asymmetric signing is supported. The provider never gets to
			// choose how its client secret or public keys are interpreted.
			const algorithms = document.id_token_signing_alg_values_supported.filter((value) =>
				/^(RS|PS|ES)(256|384|512)$|^EdDSA$/u.test(value),
			);
			const methods = document.token_endpoint_auth_methods_supported;
			const authentication = methods.includes("client_secret_basic") ? "basic" : "post";
			if (
				algorithms.length === 0 ||
				(authentication === "post" && !methods.includes("client_secret_post"))
			) {
				ctx.logger.warn(
					"OpenID Connect discovery returned unsupported signing or client authentication",
				);
				return {};
			}

			const plugin = genericOAuth({
				config: [
					{
						providerId: OPENID_PROVIDER,
						clientId: config.clientId,
						clientSecret: config.clientSecret,
						redirectURI: config.redirectUri,
						authorizationUrl: document.authorization_endpoint,
						tokenUrl: document.token_endpoint,
						authentication,
						scopes: ["openid", "email", "profile"],
						pkce: true,
						disableImplicitSignUp: true,
						disableSignUp: config.jitMode === "link_only",
						accountSubject: ({ profile }) => {
							const identity = identityClaims.parse(profile);
							return openIdAccountId(config.issuer, identity.sub);
						},
					},
				],
			});
			const { context } = await plugin.init(ctx);
			const [generic] = context.socialProviders;
			if (!generic) {
				return {};
			}

			const provider: OAuthProvider = {
				...generic,
				issuer: config.issuer,
				requiresIdTokenNonce: true,
				idToken: {
					issuer: config.issuer,
					audience: config.clientId,
					algorithms,
					maxTokenAge: "10m",
					jwks: createRemoteJWKSet(new URL(document.jwks_uri), { timeoutDuration: 5000 }),
					verifyClaims: ({ aud, azp }) =>
						(typeof aud === "string" || (Array.isArray(aud) && aud.length === 1)) &&
						(azp === undefined || azp === config.clientId),
				},
				async getUserInfo({ idToken, expectedIdTokenNonce, accessToken }) {
					if (
						!idToken ||
						!expectedIdTokenNonce ||
						!(await verifyProviderIdToken(provider, idToken, expectedIdTokenNonce))
					) {
						return null;
					}

					const claims = decodeJwt(idToken);
					let identity = identityClaims.safeParse(claims);
					if (!identity.success && document.userinfo_endpoint && accessToken) {
						const headers = new Headers({ authorization: `Bearer ${accessToken}` });
						const profile = await getJson(document.userinfo_endpoint, headers).catch(() => null);
						identity = identityClaims.safeParse(profile);
					}
					if (!identity.success || identity.data.sub !== claims.sub) {
						return null;
					}

					return {
						user: {
							email: identity.data.email.toLowerCase(),
							emailVerified: true,
							name: identity.data.given_name,
						},
						data: identity.data,
					};
				},
			};

			return { context: { socialProviders: [provider, ...ctx.socialProviders] } };
		},
	};
}
