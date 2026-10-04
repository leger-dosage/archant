import type { ServiceDeps } from "./deps.ts";

import { and, eq, max } from "drizzle-orm";
import { z } from "zod";

import { assistantCalls } from "@archant/data/schema/assistant-calls";
import { users } from "@archant/data/schema/auth";
import {
	oauthAccessTokens,
	oauthClients,
	oauthConsents,
	oauthRefreshTokens,
} from "@archant/data/schema/oauth";

import { AppError } from "../lib/errors.ts";

/** The scopes an assistant can hold that the owner sees; `offline_access` only renews them. */
export const ARCHANT_SCOPES = ["archant:read", "archant:write"] as const;

export type ArchantScope = (typeof ARCHANT_SCOPES)[number];

export type AssistantSummary = {
	clientId: string;
	/** The name the assistant registered under; `null` when it gave none. */
	name: string | null;
	scopes: ArchantScope[];
	/** When the owner first allowed it, epoch milliseconds. */
	connectedAt: number;
	/** Its latest tool call, `null` before the first. */
	lastCallAt: number | null;
};

// Better Auth stores a `string[]` as JSON text on SQLite (`schema/oauth.ts`).
const storedScopes = z.string().transform((text, context) => {
	const parsed = z.array(z.string()).safeParse(JSON.parse(text));

	if (!parsed.success) {
		context.addIssue({ code: "custom", message: "Stored scopes are not a list." });

		return z.NEVER;
	}

	return parsed.data;
});

function archantScopes(stored: string): ArchantScope[] {
	const scopes = new Set(storedScopes.parse(stored));

	return ARCHANT_SCOPES.filter((scope) => scopes.has(scope));
}

/**
 * Every assistant `userId` has allowed, oldest first: a consent row is a
 * connected assistant, and its removal a disconnection. Another
 * administrator's stay theirs, to list and to disconnect (AD-21).
 */
export async function listAssistants(
	deps: ServiceDeps,
	userId: string,
): Promise<AssistantSummary[]> {
	const lastCalls = deps.db
		.select({
			clientId: assistantCalls.clientId,
			lastCallAt: max(assistantCalls.createdAt).as("last_call_at"),
		})
		.from(assistantCalls)
		.groupBy(assistantCalls.clientId)
		.as("last_calls");

	const rows = await deps.db
		.select({
			clientId: oauthConsents.clientId,
			name: oauthClients.name,
			scopes: oauthConsents.scopes,
			connectedAt: oauthConsents.createdAt,
			lastCallAt: lastCalls.lastCallAt,
		})
		.from(oauthConsents)
		.innerJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
		.leftJoin(lastCalls, eq(lastCalls.clientId, oauthConsents.clientId))
		.where(eq(oauthConsents.userId, userId))
		.orderBy(oauthConsents.createdAt, oauthConsents.clientId);

	return rows.map((row) => ({
		clientId: row.clientId,
		name: row.name,
		scopes: archantScopes(row.scopes),
		connectedAt: row.connectedAt.getTime(),
		lastCallAt: row.lastCallAt,
	}));
}

/**
 * Disconnects `userId`'s assistant at once: their consent, then every token
 * it holds for them, in one transaction. Another administrator's consent to
 * the same client is not theirs to remove, and answers as unknown. Better
 * Auth's own consent deletion leaves the refresh tokens valid, since its
 * refresh grant never reads consents; the deletes below are the ones its
 * `invalidateRefreshFamily` makes after a replay. The client row stays: Better Auth refuses deleting a client nobody owns, and a
 * self-registered one has no owner. An access token already issued is a JWT
 * nothing can recall; `/api/mcp` refuses it because the consent is gone.
 */
export async function disconnectAssistant(
	deps: ServiceDeps,
	userId: string,
	clientId: string,
): Promise<void> {
	await deps.db.transaction(async (tx) => {
		const removed = await tx
			.delete(oauthConsents)
			.where(and(eq(oauthConsents.clientId, clientId), eq(oauthConsents.userId, userId)))
			.returning({ id: oauthConsents.id });

		if (removed.length === 0) {
			throw new AppError("ASSISTANT_NOT_FOUND", "No connected assistant has this id.");
		}

		await tx
			.delete(oauthAccessTokens)
			.where(and(eq(oauthAccessTokens.clientId, clientId), eq(oauthAccessTokens.userId, userId)));
		await tx
			.delete(oauthRefreshTokens)
			.where(and(eq(oauthRefreshTokens.clientId, clientId), eq(oauthRefreshTokens.userId, userId)));
	});
}

/**
 * The Archant scopes `userId` still grants `clientId`, `null` once it was
 * disconnected or once `userId` is no longer an administrator. A token's own
 * scopes are what it was issued; these are what that administrator allows
 * now, and a call gets no more than both. An assistant has no session, so this is the
 * one reader of `role` besides `requireRole` (AD-21): a consent counts only
 * while its user is an administrator, and a demoted one's tokens stop at once.
 */
export async function grantedScopes(
	deps: ServiceDeps,
	clientId: string,
	userId: string,
): Promise<ArchantScope[] | null> {
	const consent = await deps.db
		.select({ scopes: oauthConsents.scopes })
		.from(oauthConsents)
		.innerJoin(users, eq(users.id, oauthConsents.userId))
		.where(
			and(
				eq(oauthConsents.clientId, clientId),
				eq(oauthConsents.userId, userId),
				eq(users.role, "admin"),
			),
		)
		.get();

	return consent === undefined ? null : archantScopes(consent.scopes);
}
