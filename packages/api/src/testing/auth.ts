import type { Logger } from "../lib/logger.ts";
import type { Auth } from "../services/auth.ts";
import type { TempDatabase } from "./temp-database.ts";

import type { Database } from "@archant/data/client";

import { createApp } from "../app.ts";
import { createLogger } from "../lib/logger.ts";
import { createAuth } from "../services/auth.ts";
import { createTempDatabase } from "./temp-database.ts";

/** The interface's origin in tests, as `BETTER_AUTH_URL` is in development. */
export const TEST_ORIGIN = "http://localhost:5173";

const TEST_SECRET = "archant-test-secret-of-at-least-32-characters";

export const ADMIN = { email: "admin@example.test", password: "correct horse battery" } as const;

export type TestApp = ReturnType<typeof createApp>;

export function createTestAuth(
	db: Database,
	logger: Logger = createLogger("silent"),
	trustedProxies: string[] = [],
): Auth {
	return createAuth({ db, secret: TEST_SECRET, baseURL: TEST_ORIGIN, trustedProxies, logger });
}

/** A TCP peer and the proxies trusted, for specs about the client address. */
export type TestNetwork = { peer?: string; trustedProxies?: string[] };

export function buildTestApp(
	db: Database,
	logger: Logger = createLogger("silent"),
	auth?: Auth,
	network: TestNetwork & { webDist?: string } = {},
): TestApp {
	const trustedProxies = network.trustedProxies ?? [];

	return createApp({
		db,
		timeZone: "Europe/Paris",
		logger,
		auth: auth ?? createTestAuth(db, logger, trustedProxies),
		trustedOrigin: TEST_ORIGIN,
		trustedProxies,
		// In process there is no socket unless a spec names a peer.
		clientAddress: () => network.peer,
		webDist: network.webDist,
	});
}

/**
 * Makes every request of `app`, including the ones `testClient` sends, carry
 * the session cookie and the interface's `Origin`, as the browser does.
 */
export function withSession(app: TestApp, cookie: string): TestApp {
	const request = app.request;

	app.request = async (input, init, ...rest) => {
		const headers = new Headers(init?.headers);
		headers.set("cookie", cookie);

		if (!headers.has("origin")) {
			headers.set("origin", TEST_ORIGIN);
		}

		return request(
			input,
			{ ...init, ...(await encodeForm(init?.body, headers)), headers },
			...rest,
		);
	};

	return app;
}

/**
 * Encodes a `FormData` body up front, with its `content-type` set explicitly.
 * msw's header recording, active in every spec, loses every header but
 * `content-type` when a `Request` adds that one itself, as it does for a
 * form: Better Auth then copies the headers and finds no cookie.
 */
async function encodeForm(
	body: RequestInit["body"],
	headers: Headers,
): Promise<{ body?: ArrayBuffer }> {
	if (!(body instanceof FormData)) {
		return {};
	}

	const encoded = new Request("http://localhost", { method: "POST", body });
	headers.set("content-type", encoded.headers.get("content-type") ?? "");

	return { body: await encoded.arrayBuffer() };
}

/** The `name=value` pairs a response sets, as a `Cookie` header. */
export function cookieOf(response: Response): string {
	return response.headers
		.getSetCookie()
		.map((line) => line.split(";")[0])
		.join("; ");
}

const jsonPost = (body: unknown) => ({
	method: "POST",
	headers: { "content-type": "application/json", origin: TEST_ORIGIN },
	body: JSON.stringify(body),
});

export async function signIn(app: TestApp, credentials: { email: string; password: string }) {
	return app.request("/api/auth/sign-in/email", jsonPost(credentials));
}

/** Runs first-launch setup, then signs in, and returns the session cookie. */
export async function setUpAndSignIn(app: TestApp): Promise<string> {
	const setup = await app.request("/api/setup", jsonPost(ADMIN));

	if (setup.status !== 201) {
		throw new Error(`Setup failed with ${setup.status}: ${await setup.text()}`);
	}

	const response = await signIn(app, ADMIN);

	if (response.status !== 200) {
		throw new Error(`Sign-in failed with ${response.status}: ${await response.text()}`);
	}

	return cookieOf(response);
}

export type SignedInTemplate = { file: string; cookie: string; dispose: () => Promise<void> };

/**
 * A closed database file holding the administrator and one session. Every
 * copy accepts the same cookie, so a spec signs in once however many
 * databases it opens: the sign-in rate limit allows three attempts per ten
 * seconds, and a spec's fake clock never lets ten seconds pass.
 */
export async function createSignedInTemplate(): Promise<SignedInTemplate> {
	const template: TempDatabase = await createTempDatabase();
	const cookie = await setUpAndSignIn(buildTestApp(template.db));

	// The database runs in WAL mode, where recent writes, migrations included,
	// sit in a side file until a checkpoint: without one, a copy of the main
	// file alone has no tables at all.
	await template.db.$client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
	template.db.$client.close();

	return { file: template.file, cookie, dispose: template.dispose };
}
