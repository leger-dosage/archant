import type { Logger } from "../lib/logger.ts";
import type { Auth } from "../services/auth.ts";
import type { BankConnectionDeps } from "../services/bank-connections.ts";
import type { TempDatabase } from "./temp-database.ts";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";

import type { Database } from "@archant/data/client";

import { createApp } from "../app.ts";
import { createLogger } from "../lib/logger.ts";
import { createAuth } from "../services/auth.ts";
import { createTempDatabase } from "./temp-database.ts";

/** The interface's origin in tests, as `BETTER_AUTH_URL` is in development. */
export const TEST_ORIGIN = "http://localhost:5173";

export const TEST_SECRET = "archant-test-secret-of-at-least-32-characters";

export const ADMIN = { email: "admin@example.test", password: "correct horse battery" } as const;

export const VIEWER = { email: "viewer@example.test", password: "staple battery horse" } as const;

/** The setup token every test app is given, as `index.ts` would log it. */
export const TEST_SETUP_TOKEN = "archant-test-setup-token";

export type TestApp = ReturnType<typeof createApp>;

/**
 * Where a Client ID Metadata Document comes from in tests: nowhere, unless a
 * spec hands in its own. No test reaches the network.
 */
const NO_METADATA: ClientMetadataResourceFetch = () => {
	throw new Error("A spec fetched a client metadata document without providing one.");
};

export function createTestAuth(
	db: Database,
	logger: Logger = createLogger("silent"),
	trustedProxies: string[] = [],
	{
		baseURL = TEST_ORIGIN,
		fetchClientMetadataResource = NO_METADATA,
	}: { baseURL?: string; fetchClientMetadataResource?: ClientMetadataResourceFetch } = {},
): Auth {
	return createAuth({
		db,
		secret: TEST_SECRET,
		baseURL,
		trustedProxies,
		logger,
		fetchClientMetadataResource,
	});
}

/**
 * A TCP peer and the proxies trusted, for specs about the client address, and
 * `BETTER_AUTH_URL` when a spec needs another than the interface's.
 */
export type TestNetwork = { peer?: string; trustedProxies?: string[]; origin?: string };

export type TestBank = Partial<
	Pick<BankConnectionDeps, "bankCredentials" | "encryptionKey" | "bankApiUrl">
> & { syncSecret?: string };

/**
 * No bank variable set, as on a fresh install: every bank route but `setup`
 * and `credentials` answers 503. The provider URL is msw's, as in
 * `testing/bank.ts`, which is not imported here: it generates a key pair.
 */
const NO_BANK = {
	bankCredentials: null,
	encryptionKey: null,
	bankApiUrl: "https://api.enablebanking.com",
} as const;

export function buildTestApp(
	db: Database,
	logger: Logger = createLogger("silent"),
	auth?: Auth,
	network: TestNetwork & { webDist?: string; version?: string | null } = {},
	bank: TestBank = {},
): TestApp {
	const trustedProxies = network.trustedProxies ?? [];
	const origin = network.origin ?? TEST_ORIGIN;

	return createApp({
		db,
		timeZone: "Europe/Paris",
		logger,
		auth: auth ?? createTestAuth(db, logger, trustedProxies, { baseURL: origin }),
		trustedOrigin: origin,
		authSecret: TEST_SECRET,
		trustedProxies,
		// In process there is no socket unless a spec names a peer.
		clientAddress: () => network.peer,
		webDist: network.webDist,
		setupToken: TEST_SETUP_TOKEN,
		// A development build unless a spec names a release.
		version: network.version ?? null,
		...NO_BANK,
		...bank,
		redirectUrl: `${TEST_ORIGIN}/settings/banks/callback`,
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
function cookieOf(response: Response): string {
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
	const setup = await app.request("/api/setup", jsonPost({ ...ADMIN, token: TEST_SETUP_TOKEN }));

	if (setup.status !== 201) {
		throw new Error(`Setup failed with ${setup.status}: ${await setup.text()}`);
	}

	const response = await signIn(app, ADMIN);

	if (response.status !== 200) {
		throw new Error(`Sign-in failed with ${response.status}: ${await response.text()}`);
	}

	return cookieOf(response);
}

/**
 * Creates a viewer through `auth.api.createUser`, as invitations will, then
 * signs them in on `app`, whose Better Auth `auth` must be, and returns their
 * session cookie. One sign-in more for the spec's rate limit.
 */
export async function addViewer(app: TestApp, auth: Auth): Promise<string> {
	// Through `data`: without access-control roles, Better Auth types `role`
	// as its own `admin` or `user`, while it stores any string it is given.
	await auth.api.createUser({ body: { ...VIEWER, name: "", data: { role: "viewer" } } });
	const response = await signIn(app, VIEWER);

	if (response.status !== 200) {
		throw new Error(`Viewer sign-in failed with ${response.status}: ${await response.text()}`);
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
