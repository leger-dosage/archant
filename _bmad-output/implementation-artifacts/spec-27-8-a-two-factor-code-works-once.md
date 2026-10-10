---
title: "Story 27.8: A two-factor code works once"
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: '4ca4b2d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Better Auth 1.7.7's `/two-factor/verify-totp` checks a code against the current 30-second step and the ones on either side (`verifyTOTP` in `@better-auth/utils/otp`, `window = 1`) and records no used step, so a code read over a shoulder or relayed by a phishing page signs in again for about 90 seconds, the password still required. Sure (`origin/main` `00dd977fb`, #3830 `a11d671fe`) stores `otp_last_used_at` and claims each step once with `claim_otp_time_step!`.

**Approach:** a small Better Auth plugin beside `twoFactor`, in `packages/api/src/services/one-time-totp.ts`. It declares a nullable `lastUsedStep` on the `twoFactor` model, claims the step a correct code matches in a `before` hook on `/two-factor/verify-totp` with one conditional update, and clears it in an `after` hook on `/two-factor/enable`. Better Auth still verifies the code, counts failures and creates the session (AD-13, NFR6).

## Boundaries & Constraints

**Always:**
- `two_factors.last_used_step`, integer, nullable, the step number (`floor(ms / 30000)`), one generated migration `0068_*`; `lastUsedStep` in `packages/data/schema/auth.ts`, and in the plugin's `schema` as `{ type: "number", required: false, input: false, returned: false }`, so Better Auth's adapter knows the field. The plugin sits after `twoFactor(...)` in `createAuth`'s plugin list.
- The `before` hook resolves the user as Better Auth's `verifyTwoFactor` does: the session through `getSessionFromCtx`, else the signed `two_factor` cookie (`ctx.context.createAuthCookie("two_factor")`, `ctx.getSignedCookie`) and `internalAdapter.findVerificationValue`. No user or no `twoFactor` row: the hook does nothing and Better Auth refuses as today.
- It decrypts the secret with `symmetricDecrypt({ key: ctx.context.secretConfig, data })` from `better-auth/crypto`, computes the code of the current step and of the steps on either side with `createOTP(secret, { digits: 6, period: 30 }).hotp(step)` from `@better-auth/utils/otp`, and compares each with `constantTimeEqual`. No match: it does nothing, and Better Auth refuses the wrong code itself.
- A match claims the step with one `ctx.context.adapter.incrementOne` on `twoFactor`: `id` and `secret` equal to the row read (Sure's `otp_secret` guard against a secret replaced meanwhile), `lastUsedStep` null or `lt` the step, `set: { lastUsedStep: step }`. A non-null result is the claim; the request continues untouched.
- A refused claim, no session (a sign-in): the hook returns `{ context: { body: { ...body, code: "" } } }`, so Better Auth's own handler refuses it as a wrong code: `INVALID_CODE` 401, one more attempt on the challenge's five, one more on the account's lockout count. As Sure's sign-in, a replay reads as an invalid code.
- A refused claim with a session (activation from « Réglages › Sécurité »): the hook throws `APIError` 401 with code `CODE_ALREADY_USED`, as Sure's enrollment answers `:replayed`. The security page shows Sure's `code_already_used`, « Ce code a déjà été utilisé. Veuillez saisir le code suivant de votre application d'authentification. », under the code field; the pending secret stays.
- The `after` hook on `/two-factor/enable` sets `lastUsedStep` to null for the user's row when the endpoint succeeded, as Sure's `setup_mfa!`. `/two-factor/disable` and `resetPassword` in `services/password.ts` delete the row, which clears it. Backup codes keep Better Auth's single use.
- `@better-auth/utils` becomes a direct dependency of `@archant/api` at `^0.4.2`, the version `better-auth` 1.7.7 pins: the TOTP generator Better Auth itself uses, no second implementation.
- Docs: `docs/security-model.md` « Sign-in limits » replaces the paragraph on a code accepted more than once with the check; AD-13 in `docs/architecture.md` names `one-time-totp.ts`; `docs/sure-parity.md` « Two-factor codes, passkeys » says each code works once.

**Never:** no hand-rolled session, cookie or failure counter; no change to Better Auth's window (±1 step, where Sure accepts 15 seconds behind and none ahead: the plugin takes no window option); no change to backup codes; no raw SQL; no new endpoint.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First use | correct code of step S, `lastUsedStep` null | signed in; `lastUsedStep` = S | none |
| Replay at sign-in | same code again, new password step | refused, attempt counted | 401 `INVALID_CODE` |
| Next step | code of S+1 after S used | signed in; `lastUsedStep` = S+1 | none |
| Earlier step | code of S−1 after S+1 used, still in window | refused | 401 `INVALID_CODE` |
| Race | two verifications of one code at once | exactly one 200 | the other 401 `INVALID_CODE` |
| Activation replay | activation code of a step already claimed | stays off, secret kept | 401 `CODE_ALREADY_USED`, Sure's message |
| Turned on again | after a sign-in at S, re-enable and confirm with the new secret's code of S | turned on | none |
| Turned off | disable | row deleted, nothing left | none |
| Wrong code | code matching no step | Better Auth's refusal unchanged | 401 `INVALID_CODE` |

</frozen-after-approval>

## Code Map

- `packages/data/schema/auth.ts:119-133` -- `lastUsedStep: integer("last_used_step")` on `twoFactors`, its doc comment saying why; `pnpm data generate` writes `drizzle/0068_*`.
- New `packages/api/src/services/one-time-totp.ts` -- the plugin: `id`, `schema`, `hooks.before` (`matcher` on `/two-factor/verify-totp`, `createAuthMiddleware` from `better-auth/api`), `hooks.after` on `/two-factor/enable`.
- `packages/api/src/services/auth.ts:213-225` -- add the plugin after `twoFactor({ issuer: "Archant" })`; the comment listing the plugin's defaults says a code works once.
- `packages/api/package.json` -- `@better-auth/utils`.
- `packages/app/src/routes/_authed.settings.security.tsx:463-468` -- `CODE_ALREADY_USED` beside `INVALID_CODE`; `packages/app/src/locales/fr.json` the message.
- `packages/api/src/services/two-factor.spec.ts` -- the clock stands still (`vi.useFakeTimers({ toFake: ["Date"] })`): `enable()` consumes the current step, so it moves the clock one step on before returning, and every later code is computed after.
- `packages/app/e2e/totp.ts` -- a code generator that never hands out a step twice in a run: it remembers the last step it gave and, when the current one is spent, gives the next step's code, which Better Auth accepts; past that, it waits for the step to come.
- `packages/app/e2e/two-factor.spec.ts`, `sign-in-ceiling.spec.ts`, `assistants.spec.ts` -- every `totp(secret)` that submits a code goes through it.
- `docs/security-model.md:139`, `docs/architecture.md` AD-13, `docs/sure-parity.md:51`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/schema/auth.ts`, migration -- the column.
- [x] `packages/api/src/services/two-factor.spec.ts` -- fix `enable()` for the claimed step, then failing first: a code accepted then refused at once with `INVALID_CODE` and the challenge's attempt counted; the next step's code accepted; an earlier step refused after a later one; two simultaneous `verify-totp` with one code, one 200; an activation replay answering `CODE_ALREADY_USED` with the secret kept; `lastUsedStep` null after turning off and after turning on again; logs still carry no code.
- [x] `packages/api/src/services/one-time-totp.ts`, `services/auth.ts`, `package.json` -- the plugin.
- [x] `packages/app/src/routes/_authed.settings.security.tsx`, `locales/fr.json` -- the activation message.
- [x] `packages/app/e2e/totp.ts` and its callers -- one step per code; `two-factor.spec.ts` signs in twice in a row with two codes, and a replayed code shows « Code incorrect. Vérifiez l'heure de votre téléphone… », the existing `invalid_two_factor_code` message.
- [x] `docs/security-model.md`, `docs/architecture.md`, `docs/sure-parity.md`.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass, the `two-factor` project included.
- Given `deferred-work.md`'s entry « Accept each TOTP code once », when the story ships, then it is marked resolved by Story 27.8.

## Implementation Notes

- The claim lives in `claimStep`, which answers `claimed`, `replayed` or `unmatched`; the hook reads only `replayed`.
- Waiting for a step in `freshTotp` can add up to 30 seconds to a test, so `playwright.config.ts` gives the `two-factor` project 90 seconds per test and `ceiling` 120.
- The logs test now sends a claimed code and its replay too.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| `isReplay` writes, which a predicate's name hides | low | It claims the step. | patch: `claimStep` returning an outcome |
| `incrementOne` with nothing to increment reads as a misuse | low | The adapter's `update` does not report whether its condition matched. | patch: comment |
| `TwoFactorRow.userId` never read | low | Cosmetic. | patch |
| The logs test never sends a correct code | low | The plugin's claim and replay paths went unlogged-checked. | patch: test |
| No `one-time-totp.spec.ts` beside the plugin | low | The plugin is reached only through Better Auth's routes; `services/auth.ts` is tested the same way, in `two-factor.spec.ts`. | rejected |
| `challengedUserId` and the empty code depend on Better Auth's internals | medium | Both are covered by `two-factor.spec.ts`, which fails on a Better Auth upgrade that changes either. | rejected |
| `^0.4.2` may resolve apart from `better-auth`'s exact `0.4.2` | low | Caret ranges are the rule; TOTP is RFC 6238 whatever the copy, and the lockfile resolves one. | rejected |
| The 30-second period is named in three places | low | Server, Vitest and Playwright helpers live in different packages; the e2e helper must not import the server. | rejected |
| `turnTwoFactorOn` duplicated in two e2e files | low | Predates the story. | rejected |
| `CODE_ALREADY_USED` also answers a signed-in user with two-factor already on | low | Only a hand-made request reaches it; the interface calls `verify-totp` with a session during activation only. | rejected |

## Design Notes

A plugin, not the `twoFactor` plugin's `schema` option: in 1.7.7 that option only renames fields (`mergeSchema` in `better-auth/dist/db/schema.mjs`), while `buildAuthTables` merges the fields every plugin declares for a model. Declared there, `lastUsedStep` goes through Better Auth's adapter like `failedVerificationCount`, and the epic's « Better Auth keeps owning the table » holds.

Replacing the code with `""` rather than throwing on a replayed sign-in: Better Auth's attempt and lockout counters live inside `verifyTwoFactor` and are not exported. An empty code fails its constant-time comparison on length, so the handler counts and refuses it exactly as a wrong code, with no copy of its counters.

The claim comes before Better Auth's own checks of the challenge and the lockout, as Sure claims inside `verify_otp?`. A correct code sent on a spent challenge or a locked account burns its step: the owner types the next one, and whoever sent it already held the code.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean, knip seeing `@better-auth/utils` used.
- `pnpm test` -- expected: both Vitest projects pass.
- `pnpm test:e2e` -- expected: green, with the e2e lock if worktrees run in parallel.

**Manual checks:**
- Screenshot the security page showing the activation replay message, and the sign-in code step refusing a replayed code.
