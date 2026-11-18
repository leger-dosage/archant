import type { BetterAuthPlugin } from "better-auth";
import type { createAuthMiddleware } from "better-auth/api";

import { getCurrentAdapter, runWithTransaction } from "@better-auth/core/context";
import { passkey } from "@better-auth/passkey";
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { APIError, createAuthEndpoint, getAuthoritativeSessionFromCtx } from "better-auth/api";
import { expireCookie, setSessionCookie } from "better-auth/cookies";
import { symmetricDecrypt } from "better-auth/crypto";
import { parseUserOutput } from "better-auth/db";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { matchingStep, pendingTwoFactor } from "./one-time-totp.ts";

const CHALLENGE_SECONDS = 300;
const SECOND_FACTOR_COOKIE = "two_factor";
const mode = z.enum(["standalone", "second-factor"]);
const code = z.string().regex(/^\d{6}$/u);
const credentialName = z.string().trim().min(1).max(100);
const base64url = z
	.string()
	.min(1)
	.regex(/^[\w-]+$/u);
const registrationInput = z.object({ name: credentialName, code });

const credential = z.object({
	id: base64url,
	rawId: base64url,
	type: z.literal("public-key"),
	clientExtensionResults: z.object({}),
});
const registrationResponse = credential.extend({
	response: z.object({
		clientDataJSON: base64url,
		attestationObject: base64url,
		transports: z
			.array(z.enum(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]))
			.default([]),
	}),
});
const authenticationResponse = credential.extend({
	response: z.object({
		clientDataJSON: base64url,
		authenticatorData: base64url,
		signature: base64url,
		userHandle: base64url.optional(),
	}),
});
const challengePayload = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("register"),
		challenge: base64url,
		sessionId: z.string(),
		factorId: z.string(),
		userHandle: base64url,
		name: credentialName,
	}),
	z.object({ kind: z.literal("standalone"), challenge: base64url }),
	z.object({
		kind: z.literal("second-factor"),
		challenge: base64url,
		identifier: z.string(),
		userId: z.string(),
		factorId: z.string(),
	}),
]);
type Challenge = z.infer<typeof challengePayload>;

type Context = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];
type Factor = {
	id: string;
	secret: string;
	lastUsedStep: number | null;
	lockedUntil: Date | null;
	verified: boolean | null;
};
type StoredKey = {
	id: string;
	userId: string;
	factorId: string;
	userHandle: string;
	credentialID: string;
	publicKey: string;
	counter: number;
};

type PasskeyConfiguration = { rpID: string; origins: string[]; standalone: boolean };

export function passkeyConfiguration(
	baseURL: string,
	standalone: boolean,
	rpID?: string,
	origins?: string[],
): PasskeyConfiguration | null {
	const url = new URL(baseURL);
	const relyingParty = rpID ?? url.hostname;
	const allowed = origins ?? [url.origin];
	const secure = url.protocol === "https:" || url.hostname === "localhost";

	return secure &&
		allowed.includes(url.origin) &&
		(url.hostname === relyingParty || url.hostname.endsWith(`.${relyingParty}`))
		? { rpID: relyingParty, origins: allowed, standalone }
		: null;
}

// Keep only the library endpoints whose proofs match Archant's contract.
export function passkeyManagement() {
	const plugin = passkey();
	const { listPasskeys, deletePasskey } = plugin.endpoints;

	return { ...plugin, endpoints: { listPasskeys, deletePasskey } };
}

function unavailable(): never {
	throw APIError.from("FORBIDDEN", {
		code: "PASSKEY_UNAVAILABLE",
		message: "Passkeys are unavailable.",
	});
}

function invalid(): never {
	throw APIError.from("UNAUTHORIZED", {
		code: "INVALID_PASSKEY",
		message: "Passkey verification failed.",
	});
}

function missingPasswordStep(): never {
	throw APIError.from("UNAUTHORIZED", {
		code: "INVALID_TWO_FACTOR_COOKIE",
		message: "The password step is required.",
	});
}

function authConfig(config: PasskeyConfiguration | null, standalone = false) {
	if (config === null || (standalone && !config.standalone)) {
		unavailable();
	}

	return config;
}

async function activeEnrollment(ctx: Context, userId: string) {
	const user = await ctx.context.internalAdapter.findUserById(userId);
	if (
		user === null ||
		!("twoFactorEnabled" in user) ||
		user.twoFactorEnabled !== true ||
		("banned" in user && user.banned === true)
	) {
		invalid();
	}

	const adapter = await getCurrentAdapter(ctx.context.adapter);
	const factor = await adapter.findOne<Factor>({
		model: "twoFactor",
		where: [{ field: "userId", value: userId }],
	});
	if (factor === null || factor.verified === false) {
		invalid();
	}

	return { user, factor };
}

// A stolen session must not get a new code-guessing budget at each address.
async function limitRegistration(ctx: Context, userId: string, phase: "options" | "verify") {
	await runWithTransaction(ctx.context.adapter, async () => {
		const adapter = await getCurrentAdapter(ctx.context.adapter);
		const key = `passkey-enrolment:${phase}:${userId}`;
		const where = [{ field: "key", value: key }];
		const row = await adapter.findOne<{ count: number; lastRequest: number }>({
			model: "rateLimit",
			where,
		});
		const now = Date.now();
		if (row === null) {
			await adapter.create({ model: "rateLimit", data: { key, count: 1, lastRequest: now } });
			return;
		}

		const withinWindow = now - row.lastRequest < 60_000;
		if (withinWindow && row.count >= 10) {
			throw APIError.fromStatus("TOO_MANY_REQUESTS");
		}

		await adapter.update({
			model: "rateLimit",
			where,
			update: withinWindow ? { count: row.count + 1 } : { count: 1, lastRequest: now },
		});
	});
}

async function freshCode(ctx: Context, factor: Factor, value: string) {
	const secret = await symmetricDecrypt({ key: ctx.context.secretConfig, data: factor.secret });
	const step = await matchingStep(secret, value);
	if (step === null || (factor.lastUsedStep !== null && factor.lastUsedStep >= step)) {
		throw APIError.from("UNAUTHORIZED", {
			code: step === null ? "INVALID_CODE" : "CODE_ALREADY_USED",
			message: "A fresh authenticator code is required.",
		});
	}

	return step;
}

function challengeCookie(ctx: Context, kind: Challenge["kind"]) {
	return ctx.context.createAuthCookie(`passkey-${kind}`, { maxAge: CHALLENGE_SECONDS });
}

async function saveChallenge(ctx: Context, payload: Challenge) {
	const token = randomBytes(32).toString("base64url");
	const cookie = challengeCookie(ctx, payload.kind);
	await ctx.context.internalAdapter.createVerificationValue({
		identifier: `passkey:${token}`,
		value: JSON.stringify(payload),
		expiresAt: new Date(Date.now() + CHALLENGE_SECONDS * 1000),
	});
	await ctx.setSignedCookie(cookie.name, token, ctx.context.secret, cookie.attributes);
}

async function consumeChallenge(ctx: Context, kind: Challenge["kind"]) {
	const cookie = challengeCookie(ctx, kind);
	const token = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
	if (!token) {
		invalid();
	}

	expireCookie(ctx, cookie);
	const row = await ctx.context.internalAdapter.consumeVerificationValue(`passkey:${token}`);
	if (row === null) {
		invalid();
	}

	const payload = challengePayload.parse(JSON.parse(row.value));
	if (payload.kind !== kind) {
		invalid();
	}

	return payload;
}

async function registrationSession(ctx: Context) {
	const session = await getAuthoritativeSessionFromCtx(ctx);
	if (session === null) {
		throw APIError.fromStatus("UNAUTHORIZED");
	}

	return session;
}

async function passwordStep(ctx: Context) {
	const pending = await pendingTwoFactor(ctx);
	if (pending === null || (await getAuthoritativeSessionFromCtx(ctx)) !== null) {
		missingPasswordStep();
	}

	// The password plugin's attempt budget still governs the pending step.
	const attempts = await ctx.context.internalAdapter.findVerificationValue(
		`2fa-attempts-${pending.identifier}`,
	);
	if (attempts === null || attempts.expiresAt <= new Date()) {
		missingPasswordStep();
	}
	if (Number(attempts.value) >= 5) {
		throw APIError.from("BAD_REQUEST", {
			code: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
			message: "The password step must be restarted.",
		});
	}

	return pending;
}

export function passkeyCeremonies(config: PasskeyConfiguration | null) {
	return {
		id: "passkey-ceremonies",
		schema: {
			passkey: {
				fields: {
					factorId: { type: "string", required: true, input: false, returned: false },
					userHandle: { type: "string", required: true, input: false, returned: false },
					lastUsedAt: { type: "date", required: false, input: false },
				},
			},
		},
		rateLimit: [
			{
				pathMatcher: (path) => path.startsWith("/passkey/") && path !== "/passkey/config",
				window: 60,
				max: 10,
			},
		],
		endpoints: {
			passkeyConfig: createAuthEndpoint("/passkey/config", { method: "GET" }, async (ctx) =>
				ctx.json({ available: config !== null, standalone: config?.standalone === true }),
			),
			passkeyRegistrationOptions: createAuthEndpoint(
				"/passkey/registration-options",
				{ method: "POST", body: registrationInput },
				async (ctx) => {
					const { rpID } = authConfig(config);
					const { session } = await registrationSession(ctx);
					const { user, factor } = await activeEnrollment(ctx, session.userId);
					await limitRegistration(ctx, user.id, "options");
					await freshCode(ctx, factor, ctx.body.code);

					const existing = await ctx.context.adapter.findMany<StoredKey>({
						model: "passkey",
						where: [{ field: "userId", value: user.id }],
					});
					const userHandle = randomBytes(32);
					const options = await generateRegistrationOptions({
						rpID,
						rpName: "Archant",
						userID: userHandle,
						userName: user.email,
						userDisplayName: user.name,
						attestationType: "none",
						authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
						excludeCredentials: existing.map(({ credentialID }) => ({ id: credentialID })),
					});
					await saveChallenge(ctx, {
						kind: "register",
						challenge: options.challenge,
						sessionId: session.id,
						factorId: factor.id,
						userHandle: userHandle.toString("base64url"),
						name: ctx.body.name,
					});

					return ctx.json(options);
				},
			),
			passkeyRegister: createAuthEndpoint(
				"/passkey/register",
				{ method: "POST", body: z.object({ code, response: registrationResponse }) },
				async (ctx) => {
					const { rpID, origins } = authConfig(config);
					const { session } = await registrationSession(ctx);
					await limitRegistration(ctx, session.userId, "verify");
					const payload = await consumeChallenge(ctx, "register");
					if (payload.kind !== "register" || payload.sessionId !== session.id) {
						invalid();
					}

					const result = await verifyRegistrationResponse({
						response: ctx.body.response,
						expectedChallenge: payload.challenge,
						expectedOrigin: origins,
						expectedRPID: rpID,
						requireUserVerification: false,
					}).catch(() => null);
					if (result?.registrationInfo === undefined || !result.verified) {
						invalid();
					}

					const info = result.registrationInfo;
					await runWithTransaction(ctx.context.adapter, async () => {
						const { user, factor } = await activeEnrollment(ctx, session.userId);
						const activeSession = await ctx.context.internalAdapter.findSession(session.token);
						if (
							factor.id !== payload.factorId ||
							activeSession === null ||
							activeSession.session.expiresAt <= new Date()
						) {
							invalid();
						}

						const step = await freshCode(ctx, factor, ctx.body.code);
						const adapter = await getCurrentAdapter(ctx.context.adapter);
						await adapter.update({
							model: "twoFactor",
							where: [{ field: "id", value: factor.id }],
							update: { lastUsedStep: step },
						});
						await adapter.create({
							model: "passkey",
							data: {
								name: payload.name,
								userId: user.id,
								factorId: factor.id,
								userHandle: payload.userHandle,
								credentialID: info.credential.id,
								publicKey: Buffer.from(info.credential.publicKey).toString("base64"),
								counter: info.credential.counter,
								deviceType: info.credentialDeviceType,
								backedUp: info.credentialBackedUp,
								transports: ctx.body.response.response.transports.join(","),
								createdAt: new Date(),
								aaguid: info.aaguid,
							},
						});
					});

					return ctx.json({ success: true });
				},
			),
			passkeySignInOptions: createAuthEndpoint(
				"/passkey/sign-in-options",
				{ method: "POST", body: z.object({ mode }) },
				async (ctx) => {
					const standalone = ctx.body.mode === "standalone";
					const { rpID } = authConfig(config, standalone);
					if (standalone) {
						const options = await generateAuthenticationOptions({
							rpID,
							userVerification: "required",
						});
						await saveChallenge(ctx, { kind: "standalone", challenge: options.challenge });

						return ctx.json(options);
					}

					const pending = await passwordStep(ctx);
					const { factor } = await activeEnrollment(ctx, pending.userId);
					if (factor.lockedUntil && factor.lockedUntil > new Date()) {
						throw APIError.fromStatus("TOO_MANY_REQUESTS");
					}
					const existing = await ctx.context.adapter.findMany<StoredKey>({
						model: "passkey",
						where: [{ field: "factorId", value: factor.id }],
					});
					if (existing.length === 0) {
						invalid();
					}

					const options = await generateAuthenticationOptions({
						rpID,
						userVerification: "preferred",
						allowCredentials: existing.map(({ credentialID }) => ({ id: credentialID })),
					});
					await saveChallenge(ctx, {
						kind: "second-factor",
						challenge: options.challenge,
						factorId: factor.id,
						...pending,
					});

					return ctx.json(options);
				},
			),
			passkeySignIn: createAuthEndpoint(
				"/passkey/sign-in",
				{ method: "POST", body: z.object({ mode, response: authenticationResponse }) },
				async (ctx) => {
					const standalone = ctx.body.mode === "standalone";
					const { rpID, origins } = authConfig(config, standalone);
					const payload = await consumeChallenge(ctx, ctx.body.mode);
					const pending = payload.kind === "second-factor" ? await passwordStep(ctx) : null;
					if (payload.kind === "second-factor" && pending?.identifier !== payload.identifier) {
						missingPasswordStep();
					}

					const response = ctx.body.response;
					const key = await ctx.context.adapter.findOne<StoredKey>({
						model: "passkey",
						where: [{ field: "credentialID", value: response.id }],
					});
					const { userHandle: handle, ...assertion } = response.response;
					if (
						key === null ||
						(standalone && handle === undefined) ||
						(handle !== undefined && handle !== key.userHandle) ||
						(payload.kind === "second-factor" &&
							(payload.userId !== key.userId || payload.factorId !== key.factorId))
					) {
						invalid();
					}

					const result = await verifyAuthenticationResponse({
						response: {
							...response,
							response: handle === undefined ? assertion : { ...assertion, userHandle: handle },
						},
						expectedChallenge: payload.challenge,
						expectedOrigin: origins,
						expectedRPID: rpID,
						requireUserVerification: standalone,
						credential: {
							id: key.credentialID,
							publicKey: Buffer.from(key.publicKey, "base64"),
							counter: key.counter,
						},
					}).catch(() => null);
					if (!result?.verified) {
						invalid();
					}

					// Consume outside the write transaction: Better Auth serialises
					// consumption of a pending password step with TOTP and backup codes.
					if (pending !== null) {
						const consumed = await ctx.context.internalAdapter.consumeVerificationValue(
							pending.identifier,
						);
						if (consumed?.value !== key.userId) {
							missingPasswordStep();
						}
					}

					const cookie = ctx.context.authCookies.dontRememberToken;
					const dontRemember = Boolean(await ctx.getSignedCookie(cookie.name, ctx.context.secret));
					const signedIn = await runWithTransaction(ctx.context.adapter, async () => {
						const { user, factor } = await activeEnrollment(ctx, key.userId);
						if (
							factor.id !== key.factorId ||
							(pending !== null && factor.lockedUntil && factor.lockedUntil > new Date())
						) {
							invalid();
						}

						const adapter = await getCurrentAdapter(ctx.context.adapter);
						const used = await adapter.incrementOne({
							model: "passkey",
							where: [
								{ field: "id", value: key.id },
								{ field: "counter", value: key.counter },
							],
							increment: {},
							set: { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() },
						});
						if (used === null) {
							invalid();
						}

						const session = await ctx.context.internalAdapter.createSession(user.id, dontRemember);
						if (session === null) {
							invalid();
						}

						return { session, user };
					});

					await setSessionCookie(ctx, signedIn, dontRemember);
					expireCookie(ctx, ctx.context.createAuthCookie(SECOND_FACTOR_COOKIE));

					return ctx.json({
						token: signedIn.session.token,
						user: parseUserOutput(ctx.context.options, signedIn.user),
					});
				},
			),
		},
	} satisfies BetterAuthPlugin;
}
