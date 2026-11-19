import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { text } from "node:stream/consumers";

import { DATABASE_FILE } from "./settings.ts";

export const OPENID_CLIENT_ID = "archant-e2e";
export const OPENID_CLIENT_SECRET = "fictional-openid-client-secret";
export const OPENID_ORIGIN_FILE = join(dirname(DATABASE_FILE), "openid-origin");
export const OPENID_INVITEE = "openid-invitee@archant.test";
const name = "Dominique";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export async function startFakeOpenIdConnect(redirectUri: string) {
	const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const jwk = { ...publicKey.export({ format: "jwk" }), kid: "e2e", alg: "RS256" };
	const codes = new Map<string, { nonce: string; challenge: string }>();
	let issuer = "";

	const handle = async (req: IncomingMessage, res: ServerResponse) => {
		const url = new URL(req.url ?? "/", issuer);
		const json = (status: number, body: unknown) => {
			res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
		};

		if (url.pathname === "/.well-known/openid-configuration") {
			return json(200, {
				issuer,
				authorization_endpoint: `${issuer}/authorize`,
				token_endpoint: `${issuer}/token`,
				jwks_uri: `${issuer}/keys`,
				id_token_signing_alg_values_supported: ["RS256"],
			});
		}
		if (url.pathname === "/keys") {
			return json(200, { keys: [jwk] });
		}

		if (url.pathname === "/authorize") {
			const q = url.searchParams;
			const state = q.get("state");
			const nonce = q.get("nonce");
			const challenge = q.get("code_challenge");
			if (
				!state ||
				!nonce ||
				!challenge ||
				q.get("code_challenge_method") !== "S256" ||
				q.get("redirect_uri") !== redirectUri ||
				q.get("client_id") !== OPENID_CLIENT_ID
			) {
				return json(400, { error: "invalid_request" });
			}

			const code = randomUUID();
			codes.set(code, { nonce, challenge });
			const callback = new URL(redirectUri);
			callback.search = new URLSearchParams({ code, state, iss: issuer }).toString();
			return res.writeHead(302, { location: callback.href }).end();
		}

		if (url.pathname === "/token" && req.method === "POST") {
			const authorization = Buffer.from(`${OPENID_CLIENT_ID}:${OPENID_CLIENT_SECRET}`).toString(
				"base64",
			);
			if (req.headers.authorization !== `Basic ${authorization}`) {
				return json(401, { error: "invalid_client" });
			}
			const body = new URLSearchParams(await text(req));
			const code = body.get("code") ?? "";
			const pending = codes.get(code);
			codes.delete(code);
			const actual = createHash("sha256")
				.update(body.get("code_verifier") ?? "")
				.digest("base64url");
			if (!pending || pending.challenge !== actual || body.get("redirect_uri") !== redirectUri) {
				return json(400, { error: "invalid_grant" });
			}

			const now = Math.floor(Date.now() / 1000);
			const input = `${encode({ alg: jwk.alg, kid: jwk.kid })}.${encode({
				iss: issuer,
				aud: OPENID_CLIENT_ID,
				sub: "e2e-invited-subject",
				nonce: pending.nonce,
				iat: now,
				exp: now + 60,
				email: OPENID_INVITEE,
				email_verified: true,
				given_name: name,
			})}`;
			const signature = sign("sha256", Buffer.from(input), privateKey).toString("base64url");
			return json(200, {
				id_token: `${input}.${signature}`,
				access_token: "fictional-access-token",
				token_type: "Bearer",
			});
		}

		return json(404, { error: "not_found" });
	};
	const server = createServer((req, res) => {
		void handle(req, res).catch(() => res.writeHead(500).end());
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("The OpenID test provider has no port.");
	}
	issuer = `http://127.0.0.1:${address.port}`;
	return { issuer, close: () => server.close() };
}
