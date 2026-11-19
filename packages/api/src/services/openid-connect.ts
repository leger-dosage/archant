import type { BetterAuthPlugin } from "better-auth";

import {
	defineRequestState,
	getCurrentAdapter,
	runWithTransaction,
} from "@better-auth/core/context";
import {
	addOAuthServerContext,
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
	getAuthoritativeSessionFromCtx,
	getOAuthState,
	sensitiveSessionMiddleware,
} from "better-auth/api";
import { and, eq, gt, ne } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { z } from "zod";

import type { Database } from "@archant/data/client";
import { authAccounts, sessions, ssoAuditLogs, users } from "@archant/data/schema/auth";
import { USER_ROLES } from "@archant/data/user-roles";

import { PASSWORD_MAX_LENGTH } from "../schemas/setup.ts";
import { shareExistingAccounts } from "./account-access.ts";
import { hashInvitationToken } from "./invitations.ts";
import { allowsPassword, type LocalLoginPolicy } from "./local-login-policy.ts";
import { type OpenIdConnectConfig, openIdAccountId, OPENID_PROVIDER } from "./openid-provider.ts";

const SECURITY_PAGE = "/settings/security";
const SIGN_IN_FAILED = "/sign-in?oidc=failed";
const LINK_FAILED = `${SECURITY_PAGE}?oidc=failed`;
const CALLBACK = "/callback/:id";
const verifiedSubject = defineRequestState<string | null>(() => null);

type AuditEvent = typeof ssoAuditLogs.$inferInsert.eventType;

const discardTokens = {
	accessToken: null,
	refreshToken: null,
	idToken: null,
	accessTokenExpiresAt: null,
	refreshTokenExpiresAt: null,
	scope: null,
};

// Bind the proof to the credential without putting the password hash in OAuth state.
const credentialProof = (secret: string, hash: string): string =>
	createHmac("sha256", secret).update("archant-openid-link:").update(hash).digest("hex");

const denied = () => APIError.fromStatus("FORBIDDEN", { message: "OpenID Connect was refused." });

const extraSchema = z.object({
	invitationToken: z
		.string()
		.regex(/^[A-Za-z0-9_-]{43}$/u)
		.optional(),
	password: z.string().min(1).max(PASSWORD_MAX_LENGTH).optional(),
});

export function openIdConnect(
	db: Database,
	baseURL: string,
	config: OpenIdConnectConfig,
	policy: LocalLoginPolicy,
) {
	const { domains, issuer } = config;
	const origin = new URL(baseURL).origin;
	const errorURL = new URL(SIGN_IN_FAILED, origin);
	return {
		id: "archant-openid-connect",
		// The same adapter and transaction that Better Auth uses to create the
		// invited user and identity must consume the invitation.
		schema: {
			invitation: {
				fields: {
					inviterId: { type: "string", required: true },
					createdAt: { type: "number", required: true },
					email: { type: "string", required: true },
					role: { type: "string", required: true },
					tokenHash: { type: "string", required: true },
					expiresAt: { type: "number", required: true },
					acceptedAt: { type: "number", required: false },
				},
			},
			ssoAuditLog: {
				fields: {
					eventType: { type: "string", required: true },
					userId: { type: "string", required: false },
					createdAt: { type: "date", required: false },
				},
			},
		},
		init: () => ({
			options: {
				user: {
					validateUserInfo: async ({ source }, ctx) => {
						if (source.oauth?.providerId !== OPENID_PROVIDER) {
							return undefined;
						}
						const state = await getOAuthState();
						const subject = source.oauth.profile?.["sub"];
						if (
							ctx.path !== CALLBACK ||
							ctx.params?.id !== OPENID_PROVIDER ||
							typeof subject !== "string" ||
							(source.action === "link-account" &&
								typeof state?.serverContext?.["linkSessionId"] !== "string")
						) {
							return { error: "openid_connect_refused" };
						}
						await verifiedSubject.set(subject);
						return undefined;
					},
				},
				databaseHooks: {
					user: {
						create: {
							before: async (user, ctx) => {
								if (ctx?.path !== CALLBACK || ctx.params?.id !== OPENID_PROVIDER) {
									return undefined;
								}
								const state = await getOAuthState();
								const tokenHash = state?.serverContext?.["invitationHash"];
								const domain = user.email.split("@").at(-1) ?? "";
								if (
									typeof tokenHash !== "string" ||
									(domains.length > 0 && !domains.includes(domain))
								) {
									throw denied();
								}

								const adapter = await getCurrentAdapter(ctx.context.adapter);
								const now = Date.now();
								const where = [
									{ field: "tokenHash", value: tokenHash },
									{ field: "email", value: user.email },
									{ field: "acceptedAt", value: null },
									{ field: "expiresAt", value: now, operator: "gt" as const },
								];
								const invitation = await adapter.findOne<{ role: string }>({
									model: "invitation",
									where,
								});
								const role = z.enum(USER_ROLES).safeParse(invitation?.role);
								if (
									!role.success ||
									(await adapter.updateMany({
										model: "invitation",
										where,
										update: { acceptedAt: now },
									})) !== 1
								) {
									throw denied();
								}

								return { data: { ...user, role: role.data } };
							},
							after: async (user, ctx) => {
								if (ctx?.path !== CALLBACK || ctx.params?.id !== OPENID_PROVIDER) {
									return;
								}
								const role = z.enum(USER_ROLES).parse(user.role);
								await db.transaction((tx) => shareExistingAccounts(tx, { id: user.id, role }), {
									behavior: "immediate",
								});
							},
						},
					},
				},
			},
		}),
		hooks: {
			before: [
				{
					matcher: (ctx) => ctx.path === CALLBACK && ctx.params?.id === OPENID_PROVIDER,
					handler: createAuthMiddleware(async (ctx) => {
						const { adapter, internalAdapter } = ctx.context;
						const audit = async (eventType: AuditEvent, userId: string) =>
							(await getCurrentAdapter(adapter)).create({
								model: "ssoAuditLog",
								data: { eventType, userId, createdAt: new Date() },
							});

						// Another request may unlink the identity after Better Auth reads
						// it. Recheck it in the same transaction as the session insert.
						const createSession: typeof internalAdapter.createSession = async (userId, ...args) =>
							runWithTransaction(adapter, async () => {
								const subject = await verifiedSubject.get();
								if (subject === null) {
									throw denied();
								}
								const account = await internalAdapter.findAccountByKey({
									providerId: OPENID_PROVIDER,
									accountId: openIdAccountId(issuer, subject),
								});
								if (account?.userId !== userId) {
									throw denied();
								}
								const session = await internalAdapter.createSession(userId, ...args);
								if (session) {
									await audit("login", userId);
								}
								return session;
							});

						const createAccount: typeof internalAdapter.createAccount = async (account) =>
							runWithTransaction(adapter, async () => {
								const state = await getOAuthState();
								const linkSessionId = state?.serverContext?.["linkSessionId"];
								if (state?.link) {
									const current =
										typeof linkSessionId === "string" &&
										(await (
											await getCurrentAdapter(adapter)
										).findOne({
											model: "session",
											where: [
												{ field: "id", value: linkSessionId },
												{ field: "userId", value: account.userId },
												{ field: "expiresAt", value: new Date(), operator: "gt" },
											],
										}));
									const credential = current
										? await internalAdapter.findCredentialAccount(account.userId)
										: null;
									if (
										!credential ||
										!credential.password ||
										state.serverContext?.["linkCredential"] !==
											credentialProof(ctx.context.secret, credential.password)
									) {
										throw ctx.redirect(new URL(LINK_FAILED, origin).href);
									}
								}

								const saved = await internalAdapter.createAccount({ ...account, ...discardTokens });
								if (!saved) {
									throw denied();
								}
								await audit(state?.link ? "link" : "jit_account_created", account.userId);
								return saved;
							});
						const updateAccount: typeof internalAdapter.updateAccount = (id, data) =>
							internalAdapter.updateAccount(id, { ...data, ...discardTokens });

						return {
							context: {
								context: { internalAdapter: { createSession, createAccount, updateAccount } },
							},
						};
					}),
				},
				{
					matcher: (ctx) =>
						(ctx.path === "/sign-in/social" || ctx.path === "/link-social") &&
						ctx.body?.provider === OPENID_PROVIDER,
					handler: createAuthMiddleware(async (ctx) => {
						const body: unknown = ctx.body;
						const incoming = z
							.object({
								idToken: z.unknown().optional(),
								additionalData: extraSchema.optional(),
							})
							.safeParse(body);
						if (
							!incoming.success ||
							incoming.data.idToken !== undefined ||
							typeof body !== "object" ||
							body === null
						) {
							throw denied();
						}
						const { password, invitationToken } = incoming.data.additionalData ?? {};

						const linking = ctx.path === "/link-social";
						if (linking) {
							const session = await getAuthoritativeSessionFromCtx(ctx);
							if (!session) {
								throw APIError.fromStatus("UNAUTHORIZED");
							}
							const account = await ctx.context.internalAdapter.findCredentialAccount(
								session.user.id,
							);
							if (
								!password ||
								!account?.password ||
								!(await ctx.context.password.verify({
									hash: account.password,
									password: password,
								}))
							) {
								throw APIError.from("BAD_REQUEST", {
									code: "INVALID_PASSWORD",
									message: "Invalid password",
								});
							}
							await addOAuthServerContext({
								linkSessionId: session.session.id,
								linkCredential: credentialProof(ctx.context.secret, account.password),
							});
						} else if (invitationToken) {
							await addOAuthServerContext({
								invitationHash: hashInvitationToken(invitationToken),
							});
						}

						// Better Auth serializes additionalData into state. Only our
						// hash or confirmation flag may survive this request.
						Reflect.deleteProperty(body, "additionalData");
						Reflect.deleteProperty(body, "additionalParams");
						Reflect.deleteProperty(body, "scopes");
						Reflect.deleteProperty(body, "newUserCallbackURL");
						Object.assign(body, {
							errorCallbackURL: linking ? new URL(LINK_FAILED, origin).href : errorURL.href,
							requestSignUp: !linking && invitationToken !== undefined,
							...(linking ? { callbackURL: new URL(SECURITY_PAGE, origin).href } : {}),
						});
					}),
				},
			],
		},
		endpoints: {
			unlinkOpenIdConnect: createAuthEndpoint(
				"/unlink-openid-connect",
				{ method: "POST", use: [sensitiveSessionMiddleware] },
				async (ctx) => {
					const { user, session } = ctx.context.session;
					await db.transaction(
						async (tx) => {
							const current = await tx
								.select({ role: users.role })
								.from(users)
								.innerJoin(sessions, eq(sessions.userId, users.id))
								.where(
									and(
										eq(users.id, user.id),
										eq(sessions.id, session.id),
										gt(sessions.expiresAt, new Date()),
									),
								)
								.get();
							const credential = await tx
								.select({ password: authAccounts.password })
								.from(authAccounts)
								.where(
									and(eq(authAccounts.userId, user.id), eq(authAccounts.providerId, "credential")),
								)
								.get();
							if (!current || !credential?.password || !allowsPassword(policy, current.role)) {
								throw denied();
							}

							const removed = await tx
								.delete(authAccounts)
								.where(
									and(
										eq(authAccounts.userId, user.id),
										eq(authAccounts.providerId, OPENID_PROVIDER),
									),
								)
								.returning({ id: authAccounts.id });
							if (removed.length !== 1) {
								throw denied();
							}

							await tx
								.delete(sessions)
								.where(and(eq(sessions.userId, user.id), ne(sessions.id, session.id)));
							await tx
								.insert(ssoAuditLogs)
								.values({ id: crypto.randomUUID(), eventType: "unlink", userId: user.id });
						},
						{ behavior: "immediate" },
					);
					return ctx.json({ status: true });
				},
			),
		},
	} satisfies BetterAuthPlugin;
}

export async function openIdCallbackResponse(
	db: Pick<Database, "insert">,
	baseURL: string,
	response: Response,
) {
	const location = response.headers.get("location");
	const origin = new URL(baseURL).origin;
	const destination = location === null ? null : new URL(location, origin);
	const markedFailure =
		destination?.origin === origin && destination.searchParams.get("oidc") === "failed";
	const linkFailed = markedFailure && destination.pathname === SECURITY_PAGE;
	const signInFailed =
		destination?.origin === origin &&
		(destination.pathname === "/api/auth/error" ||
			(markedFailure && destination.pathname === "/sign-in"));
	if (response.status < 400 && destination !== null && !linkFailed && !signInFailed) {
		return response;
	}

	await db.insert(ssoAuditLogs).values({ id: crypto.randomUUID(), eventType: "login_failed" });
	const headers = new Headers(response.headers);
	headers.delete("content-length");
	headers.set("location", new URL(linkFailed ? LINK_FAILED : SIGN_IN_FAILED, origin).href);
	return new Response(null, { status: 302, headers });
}
