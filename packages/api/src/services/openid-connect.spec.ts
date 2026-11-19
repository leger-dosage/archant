import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { http, HttpResponse } from "msw";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";

import { users, authAccounts, ssoAuditLogs } from "@archant/data/schema/auth";

import { server } from "../../vitest.setup.ts";
import { createLogger } from "../lib/logger.ts";
import {
	ADMIN,
	TEST_ORIGIN,
	TEST_SECRET,
	buildTestApp,
	cookieOf,
	setUpAndSignIn,
	signIn,
} from "../testing/auth.ts";
import { createTempDatabase, type TempDatabase } from "../testing/temp-database.ts";
import { createAuth, type AuthOptions } from "./auth.ts";
import { resetPassword } from "./password.ts";

const issuer = "https://identity.example.test/household";
const clientId = "archant-test";
const clientSecret = "fictional-client-secret";
const provider = "openid-connect";
const callbackPath = `/api/auth/callback/${provider}`;
const openIdConnect = {
	issuer,
	clientId,
	clientSecret,
	redirectUri: TEST_ORIGIN + callbackPath,
	domains: [],
	jitMode: "create_and_link" as const,
};
const keys = await generateKeyPair("RS256");
let temp: TempDatabase | undefined;

afterEach(async () => {
	await temp?.dispose();
	temp = undefined;
});

async function setup(policy: Partial<AuthOptions> = {}) {
	temp = await createTempDatabase();
	const db = temp.db;
	const logger = createLogger("silent");
	let discoveryIssuer = issuer;
	let exchanged = 0;
	let token = "";
	server.use(
		http.get(`${issuer}/.well-known/openid-configuration`, () =>
			HttpResponse.json({
				issuer: discoveryIssuer,
				authorization_endpoint: `${issuer}/authorize`,
				token_endpoint: `${issuer}/token`,
				jwks_uri: `${issuer}/keys`,
				id_token_signing_alg_values_supported: ["RS256"],
			}),
		),
		http.get(`${issuer}/keys`, async () =>
			HttpResponse.json({ keys: [await exportJWK(keys.publicKey)] }),
		),
		http.post(`${issuer}/token`, async ({ request }) => {
			exchanged++;
			const form = new URLSearchParams(await request.text());
			expect(form.get("redirect_uri")).toBe(TEST_ORIGIN + callbackPath);
			expect(form.get("code_verifier")).toBeTruthy();

			return HttpResponse.json({
				access_token: "fixture-access-token",
				refresh_token: "fixture-refresh-token",
				id_token: token,
				token_type: "Bearer",
			});
		}),
	);
	const options = { db, secret: TEST_SECRET, baseURL: TEST_ORIGIN, trustedProxies: [], logger };
	const localApp = buildTestApp(db, logger, createAuth(options), { peer: "203.0.113.12" });
	const cookie = await setUpAndSignIn(localApp);
	const configuredAuth = () =>
		createAuth({
			...options,
			openIdConnect,
			...policy,
		});
	const auth = configuredAuth();
	const app = buildTestApp(db, logger, auth, { peer: "203.0.113.14" });
	const restart = () => buildTestApp(db, logger, configuredAuth(), { peer: "203.0.113.15" });
	const post = (path: string, body: unknown, session?: string, target = app) =>
		target.request(`/api/${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: TEST_ORIGIN,
				...(session ? { cookie: session } : {}),
			},
			body: JSON.stringify(body),
		});

	async function start(extra = {}, linkPassword?: string) {
		return post(
			linkPassword === undefined ? "auth/sign-in/social" : "auth/link-social",
			{
				provider,
				callbackURL: "/",
				disableRedirect: true,
				additionalData: linkPassword === undefined ? extra : { password: linkPassword },
			},
			linkPassword === undefined ? undefined : cookie,
			app,
		);
	}

	async function finish(
		started: Response,
		claims: Record<string, unknown> = {},
		callbackIssuer = issuer,
	) {
		expect(started.status, await started.clone().text()).toBe(200);
		const { url } = z.object({ url: z.url() }).parse(await started.json());
		const authorization = new URL(url);
		expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
		expect(authorization.searchParams.get("nonce")).toBeTruthy();
		token = await new SignJWT({
			iss: issuer,
			aud: clientId,
			sub: "member-subject",
			email: ADMIN.email,
			email_verified: true,
			nonce: authorization.searchParams.get("nonce"),
			...claims,
		})
			.setProtectedHeader({ alg: "RS256" })
			.setIssuedAt()
			.setExpirationTime("5m")
			.sign(keys.privateKey);
		const query = new URLSearchParams({
			code: "fictional-code",
			state: authorization.searchParams.get("state") ?? "",
			iss: callbackIssuer,
		});
		return app.request(`${callbackPath}?${query.toString()}`, {
			headers: { cookie: cookieOf(started) },
		});
	}

	return {
		app,
		auth,
		cookie,
		db,
		post,
		start,
		finish,
		restart,
		getExchanges: () => exchanged,
		changeIssuer: () => {
			discoveryIssuer += "/other";
		},
	};
}

it("requires a password to link, refuses matching an existing email implicitly and signs in by issuer and subject", async () => {
	const { app, db, start, finish, post } = await setup();
	expect((await start({}, "wrong")).status).toBe(400);
	expect((await finish(await start())).headers.get("location")).toContain("oidc=failed");
	expect((await finish(await start({}, ADMIN.password))).headers.get("location")).toContain(
		"/settings/security",
	);
	const signedIn = await finish(await start(), { email: "changed@example.test" });
	expect(signedIn.headers.get("location")).toBe("/");
	const response = await app.request("/api/auth/get-session", {
		headers: { cookie: cookieOf(signedIn) },
	});
	expect(await response.json()).toMatchObject({ user: { email: ADMIN.email, role: "admin" } });
	expect(await db.select().from(authAccounts)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				providerId: provider,
				idToken: null,
				accessToken: null,
				refreshToken: null,
			}),
		]),
	);
	expect((await post("auth/unlink-openid-connect", {}, cookieOf(signedIn), app)).status).toBe(200);
	expect((await db.select().from(ssoAuditLogs)).map((row) => row.eventType)).toEqual([
		"login_failed",
		"link",
		"login",
		"unlink",
	]);
});

it("creates a passwordless user only with the matching invitation and its role", async () => {
	const { app, auth, cookie, db, post, start, finish } = await setup();
	const email = "invitee@example.test";
	const invited = await post("invitations", { email, role: "member" }, cookie, app);
	expect(invited.status).toBe(201);
	const { data } = z.object({ data: z.object({ url: z.url() }) }).parse(await invited.json());
	const invitationToken = data.url.split("/").at(-1);
	const denied = async (extra: object, claims: Record<string, unknown>) => {
		expect((await finish(await start(extra), claims)).headers.get("location")).toContain(
			"oidc=failed",
		);
	};
	await denied({}, { email });
	await denied({ invitationToken }, { email: "other@example.test" });
	await denied({ invitationToken }, { email, email_verified: "true" });
	expect((await finish(await start({ invitationToken }), { email })).headers.get("location")).toBe(
		"/",
	);
	expect(await db.select({ email: users.email, role: users.role }).from(users)).toContainEqual({
		email,
		role: "member",
	});
	expect(
		(await post("invitations/preview", { token: invitationToken }, undefined, app)).status,
	).toBe(404);
	await expect(resetPassword({ auth }, email, "fictional new password")).rejects.toMatchObject({
		problem: "no_local_password",
	});
	expect((await db.select().from(ssoAuditLogs)).map((row) => row.eventType)).toEqual([
		"login_failed",
		"login_failed",
		"login_failed",
		"jit_account_created",
		"login",
	]);
});

it("refuses mismatched issuer, audience and nonce before establishing a session", async () => {
	const { start, finish, getExchanges } = await setup();
	expect((await finish(await start(), {}, issuer + "/other")).headers.get("location")).toContain(
		"oidc=failed",
	);
	expect(getExchanges()).toBe(0);
	expect(
		(await finish(await start(), { iss: `${issuer}/different` })).headers.get("location"),
	).toContain("oidc=failed");
	expect(
		(await finish(await start(), { aud: "another-client" })).headers.get("location"),
	).toContain("oidc=failed");
	expect(
		(await finish(await start(), { nonce: "another-session" })).headers.get("location"),
	).toContain("oidc=failed");
});

it("refuses password login and mail recovery except for the administrator sign-in override", async () => {
	const resetLinks: URL[] = [];
	const { app, auth, post } = await setup({
		localLoginEnabled: false,
		localAdminOverrideEnabled: true,
		sendPasswordReset: async (_email, url) => void resetLinks.push(url),
	});
	const member = { email: "local-member@example.test", password: "fictional password" };
	await auth.api.createUser({ body: { ...member, name: "Member", data: { role: "member" } } });
	expect((await signIn(app, ADMIN)).status).toBe(200);
	expect((await signIn(app, member)).status).toBe(401);
	expect(
		(await post("auth/request-password-reset", { email: ADMIN.email }, undefined, app)).status,
	).toBe(404);
	expect(resetLinks).toHaveLength(0);
});

it.each([
	{ ...openIdConnect, jitMode: "link_only" as const },
	{ ...openIdConnect, domains: ["other.example"] },
])("leaves an invitation pending when the creation policy refuses it", async (configuration) => {
	const { app, cookie, db, post, start, finish } = await setup({ openIdConnect: configuration });
	const email = "restricted@example.test";
	const invited = await post("invitations", { email, role: "guest" }, cookie);
	const { data } = z.object({ data: z.object({ url: z.url() }) }).parse(await invited.json());
	const invitationToken = data.url.split("/").at(-1);
	expect(
		(await finish(await start({ invitationToken }), { email })).headers.get("location"),
	).toContain("oidc=failed");
	expect(await db.select({ email: users.email }).from(users)).toEqual([{ email: ADMIN.email }]);
	expect(
		(await post("invitations/preview", { token: invitationToken }, undefined, app)).status,
	).toBe(200);
});

it("does not trust a discovery document with a different issuer", async () => {
	const { changeIssuer, restart, post, getExchanges } = await setup();
	changeIssuer();
	expect((await post("auth/sign-in/social", { provider }, undefined, restart())).status).toBe(404);
	expect(getExchanges()).toBe(0);
});

it("does not accept direct ID tokens or user-supplied linking authorization", async () => {
	const { post, cookie } = await setup();
	expect(
		(await post("auth/sign-in/social", { provider, idToken: { token: "ignored" } })).status,
	).toBe(403);
	expect(
		(
			await post(
				"auth/link-social",
				{
					provider,
					additionalData: { passwordVerified: true, linkSessionId: "a client value" },
				},
				cookie,
			)
		).status,
	).toBe(400);
});

it("refuses a revoked invitation and leaves it unused when local password sign-in is disabled", async () => {
	const { app, cookie, db, post, start, finish } = await setup({ localLoginEnabled: false });
	expect((await signIn(app, ADMIN)).status).toBe(401);
	const email = "revoked@example.test";
	const invited = await post("invitations", { email, role: "guest" }, cookie);
	const { data } = z
		.object({
			data: z.object({ id: z.string(), url: z.url() }),
		})
		.parse(await invited.json());
	const invitationToken = data.url.split("/").at(-1);

	expect(
		(
			await post("invitations/accept", {
				token: invitationToken,
				password: "fictional password",
			})
		).status,
	).toBe(403);
	expect((await post("invitations/preview", { token: invitationToken })).status).toBe(200);
	const started = await start({ invitationToken });
	const revoked = await app.request(`/api/invitations/${data.id}`, {
		method: "DELETE",
		headers: { origin: TEST_ORIGIN, cookie },
	});
	expect(revoked.status).toBe(200);
	expect((await finish(started, { email })).headers.get("location")).toContain("oidc=failed");
	expect(await db.select({ email: users.email }).from(users)).toEqual([{ email: ADMIN.email }]);
});

it("invalidates an in-flight association when the local password changes", async () => {
	const { cookie, db, post, start, finish } = await setup();
	const started = await start({}, ADMIN.password);
	const changed = await post(
		"auth/change-password",
		{
			currentPassword: ADMIN.password,
			newPassword: "a new fictional password",
		},
		cookie,
	);
	expect(changed.status).toBe(200);
	expect((await finish(started)).headers.get("location")).toBe(
		TEST_ORIGIN + "/settings/security?oidc=failed",
	);
	expect(await db.select().from(authAccounts)).toHaveLength(1);
});
