import type { BankConnector, Institution } from "../bank-connector.ts";
import type { KeyObject } from "node:crypto";
import type { z } from "zod";

import { BankProviderError } from "../bank-connector.ts";
import { signJwt } from "./jwt.ts";
import {
	aspspsResponseSchema,
	authResponseSchema,
	errorResponseSchema,
	sessionResponseSchema,
} from "./schemas.ts";

export type EnableBankingConfig = {
	applicationId: string;
	privateKey: KeyObject;
	/** `ENABLE_BANKING_API_URL`. */
	apiUrl: string;
};

/** Sure asks for 90 days at most, even from a bank that allows 180. */
const MAX_CONSENT_SECONDS = 90 * 86_400;

// A bank's listing can be slow; a request stuck longer is not coming back.
const TIMEOUT_MS = 30_000;

/**
 * When the consent asked for ends: the bank's own maximum, capped at 90
 * days, as Sure does.
 */
export function consentValidUntil(now: number, maximumConsentValidity: number | null): Date {
	const seconds = Math.min(maximumConsentValidity ?? MAX_CONSENT_SECONDS, MAX_CONSENT_SECONDS);

	return new Date(now + seconds * 1000);
}

const failed = (status: number | null, providerCode: string | null = null) =>
	new BankProviderError("BANK_PROVIDER_ERROR", "The bank provider request failed.", {
		status,
		providerCode,
	});

type Call = { method: "GET" | "POST"; path: string; body?: unknown };

async function call<Schema extends z.ZodType>(
	config: EnableBankingConfig,
	{ method, path, body }: Call,
	schema: Schema,
): Promise<z.output<Schema>> {
	const headers: Record<string, string> = {
		authorization: `Bearer ${await signJwt(config.applicationId, config.privateKey)}`,
		accept: "application/json",
	};
	let response: Response;

	try {
		response = await fetch(`${config.apiUrl.replace(/\/+$/u, "")}${path}`, {
			method,
			headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch {
		throw failed(null);
	}

	const payload: unknown = await response.json().catch(() => null);

	if (!response.ok) {
		const error = errorResponseSchema.safeParse(payload);

		throw failed(response.status, error.success ? error.data.error : null);
	}

	const parsed = schema.safeParse(payload);

	if (!parsed.success) {
		throw failed(response.status);
	}

	return parsed.data;
}

/** Enable Banking behind the bank connector port, after Sure's `Provider::EnableBanking`. */
export function createEnableBankingConnector(config: EnableBankingConfig): BankConnector {
	return {
		id: "enable-banking",

		async listInstitutions(country) {
			const { aspsps } = await call(
				config,
				{ method: "GET", path: `/aspsps?${new URLSearchParams({ country }).toString()}` },
				aspspsResponseSchema,
			);

			return aspsps.map((aspsp): Institution => ({
				name: aspsp.name,
				country: aspsp.country,
				logo: aspsp.logo ?? null,
				bic: aspsp.bic ?? null,
				maximumConsentValidity: aspsp.maximum_consent_validity ?? null,
			}));
		},

		async startAuthorization({ institution, state, redirectUrl }) {
			const body = {
				access: {
					valid_until: consentValidUntil(
						Date.now(),
						institution.maximumConsentValidity,
					).toISOString(),
				},
				aspsp: { name: institution.name, country: institution.country },
				state,
				redirect_url: redirectUrl,
				psu_type: "personal",
				language: "fr",
			};

			try {
				return await call(config, { method: "POST", path: "/auth", body }, authResponseSchema);
			} catch (error) {
				// Sure names the URL to register rather than a bare failure.
				if (
					error instanceof BankProviderError &&
					error.failure.providerCode === "REDIRECT_URI_NOT_ALLOWED"
				) {
					throw new BankProviderError(
						"BANK_REDIRECT_NOT_ALLOWED",
						"Register the redirect URL in the Enable Banking control panel.",
						error.failure,
						{ url: redirectUrl },
					);
				}

				throw error;
			}
		},

		async completeAuthorization(code) {
			const session = await call(
				config,
				{ method: "POST", path: "/sessions", body: { code } },
				sessionResponseSchema,
			);

			return { sessionId: session.session_id, consentExpiresAt: session.access.valid_until };
		},
	};
}
