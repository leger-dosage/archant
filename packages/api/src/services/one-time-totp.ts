import type { BetterAuthPlugin } from "better-auth";

import { createOTP } from "@better-auth/utils/otp";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { constantTimeEqual, symmetricDecrypt } from "better-auth/crypto";
import { z } from "zod";

/** The `twoFactor` plugin's defaults, which `services/auth.ts` keeps. */
const PERIOD_SECONDS = 30;
const DIGITS = 6;

/** Better Auth accepts the code of the current step and of one step on either side. */
const WINDOW = [-1, 0, 1];

type TwoFactorRow = { id: string; secret: string };

/** What claiming a code's step gave: a wrong code matches no step. */
type Claim = "claimed" | "replayed" | "unmatched";

/** The body `/two-factor/verify-totp` takes, which its own schema checks again. */
const verifyTotpBodySchema = z.object({ code: z.string(), trustDevice: z.boolean().optional() });

/**
 * Better Auth's `verifyTOTP` keeps no record of a step already used, so a code
 * read over a shoulder or relayed by a phishing page signs in again within
 * its window. This claims each step once, as Sure's `claim_otp_time_step!`;
 * Better Auth still checks the code, counts failures and creates the session
 * (AD-13). The `twoFactor` plugin's own `schema` option only renames fields,
 * so the column is declared here, and Better Auth merges it into its model.
 */
export function oneTimeTotp() {
	return {
		id: "one-time-totp",
		schema: {
			twoFactor: {
				fields: {
					lastUsedStep: { type: "number", required: false, input: false, returned: false },
				},
			},
		},
		hooks: {
			before: [
				{
					matcher: (context) => context.path === "/two-factor/verify-totp",
					handler: createAuthMiddleware(async (ctx) => {
						const body = verifyTotpBodySchema.safeParse(ctx.body);
						const session = await getSessionFromCtx(ctx);
						const userId = session?.user.id ?? (await challengedUserId(ctx));
						const replayed =
							body.success &&
							userId !== null &&
							(await claimStep(ctx, userId, body.data.code)) === "replayed";

						if (replayed && session !== null) {
							// Activation, as Sure's enrollment answers `:replayed`: the
							// pending secret stays and the next code turns it on.
							throw APIError.from("UNAUTHORIZED", {
								code: "CODE_ALREADY_USED",
								message: "This code was already used",
							});
						}

						// At sign-in a replay is a wrong code, as in Sure. An empty code
						// fails Better Auth's comparison on its length, so its handler
						// refuses it and counts the attempt and the lockout itself:
						// those counters are not exported.
						return {
							context: replayed && body.success ? { body: { ...body.data, code: "" } } : {},
						};
					}),
				},
			],
			after: [
				{
					matcher: (context) => context.path === "/two-factor/enable",
					// Setting up a new secret forgets the old one's step, as Sure's
					// `setup_mfa!`. Turning it off deletes the row.
					handler: createAuthMiddleware(async (ctx) => {
						const session = await getSessionFromCtx(ctx);

						if (isAPIError(ctx.context.returned) || session === null) {
							return;
						}

						await ctx.context.adapter.update({
							model: "twoFactor",
							where: [{ field: "userId", value: session.user.id }],
							update: { lastUsedStep: null },
						});
					}),
				},
			],
		},
	} satisfies BetterAuthPlugin;
}

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** The user of the password step, read from its signed cookie as Better Auth does. */
async function challengedUserId(ctx: HookContext): Promise<string | null> {
	const cookie = ctx.context.createAuthCookie("two_factor");
	const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);

	if (!identifier) {
		return null;
	}

	const verification = await ctx.context.internalAdapter.findVerificationValue(identifier);

	return verification?.value ?? null;
}

/**
 * Claims the step a correct code matches, unless an earlier request used it
 * or a later step. A wrong code, or a user without a secret, claims nothing:
 * Better Auth refuses those itself.
 */
async function claimStep(ctx: HookContext, userId: string, code: string): Promise<Claim> {
	const row = await ctx.context.adapter.findOne<TwoFactorRow>({
		model: "twoFactor",
		where: [{ field: "userId", value: userId }],
	});

	if (row === null) {
		return "unmatched";
	}

	const secret = await symmetricDecrypt({ key: ctx.context.secretConfig, data: row.secret });
	const step = await matchingStep(secret, code);

	if (step === null) {
		return "unmatched";
	}

	// One conditional update: of two requests carrying the same code, only one
	// changes the row. The secret must still be the one read, so a claim
	// cannot land on a factor set up meanwhile. `incrementOne` with nothing to
	// increment, because the adapter's `update` does not say whether its
	// condition matched a row.
	const claimed = await ctx.context.adapter.incrementOne({
		model: "twoFactor",
		where: [
			{ field: "id", value: row.id },
			{ field: "secret", value: row.secret },
			{ field: "lastUsedStep", value: null, connector: "OR" },
			{ field: "lastUsedStep", operator: "lt", value: step, connector: "OR" },
		],
		increment: {},
		set: { lastUsedStep: step },
	});

	return claimed === null ? "replayed" : "claimed";
}

/** The step whose code this is, among those Better Auth accepts now. */
async function matchingStep(secret: string, code: string): Promise<number | null> {
	const otp = createOTP(secret, { period: PERIOD_SECONDS, digits: DIGITS });
	const now = Math.floor(Date.now() / (PERIOD_SECONDS * 1000));
	const steps = WINDOW.map((offset) => now + offset);
	// Every step is computed and compared, so the time taken says nothing
	// about which one matched.
	const codes = await Promise.all(steps.map(async (step) => otp.hotp(step)));
	const matches = codes.map((expected) => constantTimeEqual(expected, code));

	return steps.find((_, index) => matches[index]) ?? null;
}
