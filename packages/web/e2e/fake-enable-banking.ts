import type { KeyObject } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { randomUUID, verify } from "node:crypto";
import { createServer } from "node:http";
import { z } from "zod";

/**
 * A stand-in for Enable Banking on loopback, so the suite never reaches the
 * network (AD-16). It serves what the API calls, `/aspsps`, `/auth` and
 * `/sessions`, plus the bank's consent page, which approves at once and
 * sends the browser back to `redirect_url` with a `code` and the `state`.
 * It checks each request's RS256 token against the public key, as the real
 * service would refuse an unsigned one.
 */

/** The French banks the fake lists. `Banque Démo` is the one the tests connect. */
export const FAKE_BANKS = ["Banque Démo", "Caisse Régionale Exemple", "Néobanque Test"] as const;

/** 180 days, above the 90-day cap, so the API must ask for 90. */
const MAXIMUM_CONSENT_SECONDS = 180 * 86_400;

type Pending = { state: string; redirectUrl: string; validUntil: string };

function base64url(text: string): Buffer {
	return Buffer.from(text, "base64url");
}

function tokenIsValid(header: string | undefined, publicKey: KeyObject, applicationId: string) {
	const token = header?.replace(/^Bearer /u, "") ?? "";
	const [head = "", payload = "", signature = ""] = token.split(".");

	try {
		const parsedHead: unknown = JSON.parse(base64url(head).toString("utf8"));
		const claims: unknown = JSON.parse(base64url(payload).toString("utf8"));

		return (
			typeof parsedHead === "object" &&
			parsedHead !== null &&
			"kid" in parsedHead &&
			parsedHead.kid === applicationId &&
			typeof claims === "object" &&
			claims !== null &&
			"aud" in claims &&
			claims.aud === "api.enablebanking.com" &&
			verify("RSA-SHA256", Buffer.from(`${head}.${payload}`), publicKey, base64url(signature))
		);
	} catch {
		return false;
	}
}

const bodySchema = z.record(z.string(), z.unknown());

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];

	for await (const chunk of request) {
		if (chunk instanceof Buffer) {
			chunks.push(chunk);
		}
	}

	return bodySchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
}

function json(response: ServerResponse, status: number, body: unknown) {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
}

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="6" fill="#2563eb"/></svg>`;

/** Starts the fake on a free loopback port and returns its origin. */
export async function startFakeEnableBanking(options: {
	publicKey: KeyObject;
	applicationId: string;
}): Promise<{ url: string; close: () => void }> {
	const pending = new Map<string, Pending>();
	const codes = new Map<string, Pending>();
	let origin = "";

	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", origin);

		void (async () => {
			if (request.method === "GET" && url.pathname === "/logo.svg") {
				response.writeHead(200, { "content-type": "image/svg+xml" });
				response.end(LOGO);
				return;
			}

			// The bank's consent page: the user approves, the bank redirects.
			if (request.method === "GET" && url.pathname.startsWith("/consent/")) {
				const attempt = pending.get(url.pathname.slice("/consent/".length));

				if (attempt === undefined) {
					json(response, 404, { error: "NOT_FOUND" });
					return;
				}

				const code = randomUUID();
				codes.set(code, attempt);
				const back = new URL(attempt.redirectUrl);
				back.searchParams.set("code", code);
				back.searchParams.set("state", attempt.state);
				response.writeHead(302, { location: back.toString() });
				response.end();
				return;
			}

			if (!tokenIsValid(request.headers.authorization, options.publicKey, options.applicationId)) {
				json(response, 401, { code: 401, message: "Invalid token", error: "UNAUTHORIZED" });
				return;
			}

			if (request.method === "GET" && url.pathname === "/aspsps") {
				const country = url.searchParams.get("country") ?? "";
				const names = country === "FR" ? FAKE_BANKS : [`Banque ${country}`];

				json(response, 200, {
					aspsps: names.map((name, index) => ({
						name,
						country,
						logo: index === 0 ? `${origin}/logo.svg` : null,
						bic: index === 0 ? "DEMOFRPP" : undefined,
						maximum_consent_validity: MAXIMUM_CONSENT_SECONDS,
						psu_types: ["personal"],
					})),
				});
				return;
			}

			if (request.method === "POST" && url.pathname === "/auth") {
				const body = await readJson(request);
				const access = body["access"];
				const authorizationId = randomUUID();
				pending.set(authorizationId, {
					state: String(body["state"]),
					redirectUrl: String(body["redirect_url"]),
					validUntil:
						typeof access === "object" && access !== null && "valid_until" in access
							? String(access.valid_until)
							: "",
				});

				json(response, 200, {
					url: `${origin}/consent/${authorizationId}`,
					authorization_id: authorizationId,
				});
				return;
			}

			if (request.method === "POST" && url.pathname === "/sessions") {
				const body = await readJson(request);
				const attempt = codes.get(String(body["code"]));

				if (attempt === undefined) {
					json(response, 400, { code: 400, message: "Unknown code", error: "WRONG_AUTH_CODE" });
					return;
				}

				codes.delete(String(body["code"]));
				json(response, 200, {
					session_id: randomUUID(),
					accounts: [],
					access: { valid_until: attempt.validUntil },
				});
				return;
			}

			json(response, 404, { error: "NOT_FOUND" });
		})().catch(() => json(response, 500, { error: "FAKE_FAILED" }));
	});

	await new Promise<void>((resolve) => {
		// No host, as the API's own server: `localhost` resolves to ::1 or to
		// 127.0.0.1 depending on the client, and both must answer.
		server.listen(0, resolve);
	});
	// `localhost`, not an IP: the suite's guard lets the browser reach
	// localhost only, and the browser loads the consent page and the logo.
	const address = server.address();

	if (address === null || typeof address === "string") {
		throw new Error("The fake Enable Banking server has no port.");
	}

	origin = `http://localhost:${address.port}`;

	return { url: origin, close: () => server.close() };
}
