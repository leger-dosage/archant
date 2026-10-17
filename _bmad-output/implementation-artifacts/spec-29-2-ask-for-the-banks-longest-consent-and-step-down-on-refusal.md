---
title: "Story 29.2: Ask for the bank's longest consent and step down on refusal, as Sure"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: 'cee4afea14a4572bc01a8a02b67efed64db87504'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-29-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure's `Provider::EnableBanking#start_authorization` walks `consent_seconds_ladder`: the bank's `maximum_consent_validity` capped at `ENABLE_BANKING_CONSENT_DAYS` (180 by default, `config/initializers/enable_banking.rb`), then each of `CONSENT_FALLBACK_DAYS` (180, 90, 45, 30) shorter than the first, each less 60 seconds, retrying only while the bank answers a consent-validity refusal (`wrong_consent_validity?`). Archant caps every consent at 90 days and fails on the first refusal, so a household reconnects twice as often, and a bank such as Trade Republic (Sure #2857), which refuses its own advertised maximum, cannot be connected at all.

**Approach:** The Enable Banking connector builds Sure's ladder from a `consentDays` setting and tries each rung in order; `ENABLE_BANKING_CONSENT_DAYS` feeds it through the bank dependencies.

## Boundaries & Constraints

**Always:**
- Ladder: `primary = min(bank maximum ?? cap, cap)` seconds, then 180, 90, 45, 30 days strictly shorter than `primary`, each less 60 seconds, duplicates dropped. Each attempt dates `valid_until` from the clock at that attempt.
- Retry only on HTTP 422 whose body has `error: "WRONG_REQUEST_PARAMETERS"` and a `message` matching `/consent validity/i`, as Sure's `wrong_consent_validity?` (`:validation_error` is 422). Any other failure fails at once, `REDIRECT_URI_NOT_ALLOWED` still becoming `BANK_REDIRECT_NOT_ALLOWED`. All rungs refused: the last refusal is thrown, `BANK_PROVIDER_ERROR` with status 422 and code `WRONG_REQUEST_PARAMETERS`.
- The provider's `message` is only matched, never kept, logged or returned (AD-14).
- `ENABLE_BANKING_CONSENT_DAYS`: digits only, a positive safe integer, else 180; a bad value is ignored, never a startup failure, as Sure's initializer. Listed in `.env.example` and `docs/deployment.md`.
- AD-18's consent sentence states Sure's ladder; `docs/sure-parity.md` « Consent length » becomes Parity; `docs/deployment.md`, `docs/troubleshooting.md`, `docs/project-overview.md` and the AD configuration row follow.

**Never:** no change to how the session's `access.valid_until` is stored, to renewal warnings, or to the transactions-period retry (Story 29.3); no stored `requested_valid_until` (Sure keeps it for the PSU address purge, Story 29.9); no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bank above cap | max 400 d, cap 180 | one call, 180 d − 60 s | none |
| Bank below cap | max 60 d | 60 d − 60 s | none |
| No maximum | `null` | 180 d − 60 s | none |
| Overridden cap | cap 90, max 180 d | 90 d − 60 s | none |
| Trade Republic | max 90 d, first refused | 90 d − 60 s, then 45 d − 60 s | none |
| All refused | max 90 d | 90, 45, 30 days tried | last 422 thrown |
| Other 422 | `WRONG_REQUEST_PARAMETERS`, other message | one call | thrown at once |
| Variable | `"0"`, `"-5"`, `"abc"`, `" 90"`, `"1.5"`, unset | cap 180 | no startup failure |

</frozen-after-approval>

## Code Map

- `packages/api/src/connectors/enable-banking/client.ts` -- replace `MAX_CONSENT_SECONDS` and `consentValidUntil` by an exported `consentLadder(maximumConsentValidity, consentDays)` (seconds); `EnableBankingConfig` gains `consentDays`; `call` throws a module-local `BankProviderError` subclass for a consent-validity refusal; `startAuthorization` loops the ladder.
- `packages/api/src/connectors/enable-banking/schemas.ts` -- `errorResponseSchema` also reads an optional `message` (`.catch(undefined)`), used for the match only.
- `packages/api/src/env.ts` -- `ENABLE_BANKING_CONSENT_DAYS` with Sure's leniency; `env.spec.ts` covers it.
- `packages/api/src/services/bank-connections.ts` -- `BankEnv` and `bankDepsFromEnv` return `bankConsentDays`.
- `packages/api/src/services/bank-credentials.ts` -- `BankCredentialDeps.bankConsentDays`; `connectorFor` passes `consentDays`.
- Test deps: `testing/auth.ts` `NO_BANK` and `TestBank`, `testing/ledger.ts` `bankDeps`, `testing/app.ts` `configuredBank`, `services/bank-credentials.spec.ts` `deps`, `connectors/enable-banking/client.spec.ts` connector.
- `packages/api/src/testing/enable-banking.ts` and `connectors/enable-banking/fixtures/` -- a `error-wrong-consent-validity.json` fixture with Sure's test message.
- Specs: `client.spec.ts` (`consentLadder`, `startAuthorization`), `services/bank-connections.spec.ts` (180 days asked of a 180-day bank).
- `packages/app/e2e/fake-enable-banking.ts` -- `SHORT_CONSENT_BANK` advertising no maximum and refusing beyond 90 days with Sure's 422; `bank-connections.spec.ts` expects 180 days for « Banque Démo » and 90 for it.
- Docs: `docs/architecture.md` AD-18 and row 251, `.env.example`, `docs/deployment.md`, `docs/troubleshooting.md`, `docs/project-overview.md`, `docs/sure-parity.md` row 117.
- Sure, read-only, at `00dd977fb`: `app/models/provider/enable_banking.rb`, `config/initializers/enable_banking.rb`, `test/models/provider/enable_banking_test.rb`.

## Tasks & Acceptance

**Execution:**
- [x] Vitest first, failing: the ladder (cap, bank below, absent, override, rungs strictly shorter, no duplicates), `startAuthorization` stepping down on Sure's 422, stopping on another 422 and another error, throwing the last refusal, and the message kept out of the error; `ENABLE_BANKING_CONSENT_DAYS`.
- [x] Schema, client, env, deps plumbing.
- [x] Playwright: the fake's short-consent bank connects with a consent ending in 90 days; « Banque Démo » in 180.
- [x] Docs and parity row.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass with no request reaching Enable Banking.

### Review Findings

Second pass, `bmad-code-review` (four layers) over the patched tree.

- [x] [Review][Patch] `docker-compose.yml` never passes `ENABLE_BANKING_CONSENT_DAYS`, nor `ENABLE_BANKING_COUNTRY` from Story 29.1, so the reference container ignores both [docker-compose.yml]
- [x] [Review][Patch] « asked again for each of 180, 90, 45 and 30 days shorter than the first ask » reads as « 180 days less »; reworded in `.env.example`, `docs/deployment.md` and AD-18 [docs/architecture.md]
- [x] [Review][Patch] `docs/security-model.md` gives one `POST /auth` per connection; it now says the call repeats with a shorter consent [docs/security-model.md]
- [x] [Review][Patch] No test of a cap above 180, where 180 is the first fallback [client.spec.ts]
- [x] [Review][Patch] No test at the variable's bounds, 1 and 36,500 kept, 36,501 ignored [env.spec.ts]
- [x] [Review][Patch] `new Set` in `consentLadder` guards a repeat that cannot happen [client.ts]
- [x] [Review][Patch] The 36,500-day bound departs from Sure without a record; `docs/sure-parity.md` « Consent length » now records it [docs/sure-parity.md]

Rejected:
- `false` Sure's initializer reads « 90 » with a space as 90: its `\A\d+\z` refuses it, so 180 applies there too.
- `false` `/consent validity/i` may be narrower than Sure: it is Sure's exact pattern in `wrong_consent_validity?`.
- `false` Case-insensitive match untested beyond lower case: Sure's pattern is `/i`.
- `false` The diff left out the spec: the review diff excluded `_bmad-output/` on purpose.
- `low` No warning when the variable is ignored: Sure ignores it silently.
- `low` No log of the consent length accepted: Sure logs none; the consent end shows on the connection.
- `low` No troubleshooting section for every rung refused: rare, and it shows the usual provider error.
- `low` `ConsentLengthRefused` can come from any endpoint: it is a `BankProviderError` with the same code everywhere; only `/auth` reacts to it.
- `low` No renewal step-down test: `renewConnection` calls the same `startAuthorization`.
- `low` Up to four sequential timeouts: Sure runs its rungs in sequence too; a refusal answers at once.
- `low` A bank maximum just above a rung yields a rung a few seconds shorter: Sure's ladder does the same.
- `low` The fake accepts an unreadable `valid_until`: the API always sends an ISO date, pinned by Vitest.
- `low` The e2e test does not prove a refusal came first, and plays « 180 refused, 90 accepted » rather than the matrix's 90 then 45: Vitest pins both.
- `low` An upgrade note for banks that would refuse 180 without Sure's message: such a bank fails on Sure as well; existing consents keep their end.

## Implementation Notes

- `ENABLE_BANKING_CONSENT_DAYS` above 36,500 days is ignored as well as a non-number: a hundred million days overflowed `Date` and failed every connection with a 500. Recorded as Different in `docs/sure-parity.md`.
- The provider's error message is reduced to a boolean inside `errorResponseSchema`; its text never reaches `call`.
- The fake's `SHORT_CONSENT_BANK` lists no maximum and refuses beyond 90 days, so the e2e test plays Sure's step-down from 180 to 90.
- `docker-compose.yml` passes `ENABLE_BANKING_CONSENT_DAYS`, and `ENABLE_BANKING_COUNTRY`, which Story 29.1 left out.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `.env.example` says a refused bank is asked again for 180, 90, 45 then 30 days | low | patch | `consentLadder` keeps only rungs strictly shorter than the first ask; reworded. |
| 2 | A huge `ENABLE_BANKING_CONSENT_DAYS` makes `toISOString` throw, every connection a 500 | low | patch | `100000000` days passes `Number.isSafeInteger` and overflows `Date`; values above 36,500 days are now ignored. |
| 3 | `errorResponseSchema` hands the provider's free-text message out of the parser | low | patch | Only a comment kept it from a log; the schema now reduces it to a boolean. |
| 4 | `ConsentLengthRefused` repeats `failed()`'s code and message | low | reject | Two literals beside each other in one file; no caller diverges today. |
| 5 | No test of renewal stepping down | low | reject | `renewConnection` calls the same `startAuthorization`, covered rung by rung in `client.spec.ts`. |
| 6 | The Playwright test does not prove a 180-day ask was refused first | low | reject | The fake would need to record refusals; Vitest pins the order of asks. |
| 7 | Consent-end expectations off by a day in the minute before midnight | low | patch | The API asks N days less 60 s; the tests now subtract the minute. |
| 8 | `docs/troubleshooting.md` joins two ideas with « so »; no section for every rung refused | low | patch / reject | Sentence rewritten; the all-refused case is rare and shows the usual provider error. |
| 9 | `docs/deployment.md` limits the step-down to a bank refusing what it advertised | low | patch | A bank advertising nothing steps down too; reworded. |
| 10 | AD configuration row speaks of « the two `ENABLE_BANKING_*` variables » | false | reject | The row names the pair, then `ENABLE_BANKING_COUNTRY` apart; the new variable is listed in the row's variable list. |
| 11 | Default 180 repeated in test deps | low | reject | Test fixtures; a changed default fails `env.spec.ts` first. |
| 12 | Spec status and sprint status disagree; Code Map cites row numbers | false | reject | The workflow moves both to `done` together; a fix would edit the spec. |
| 13 | No log of the consent length accepted | low | reject | Sure logs none; the consent end shows on the connection. |
| 14 | Up to four sequential 30-second timeouts on one start | low | reject | Sure runs its rungs in sequence with a 120-second timeout each; a refusal answers at once. |
| 15 | No test proves `ENABLE_BANKING_CONSENT_DAYS` reaches the `/auth` body | medium | patch | Every test reaching `startAuthorization` used 180; one now starts a connection with 90. |

## Design Notes

Assumptions taken alone, each settled by Sure. The retry wants HTTP 422, since `wrong_consent_validity?` checks `:validation_error`. Every attempt is dated afresh, as Sure computes `Time.current` per rung. Sure's margin `min(60, seconds − 1)` is always 60 here, the shortest rung being a day. A bad `ENABLE_BANKING_CONSENT_DAYS` is ignored rather than refused at startup, unlike Archant's other variables, because Sure's initializer and the story say so. The fake's short-consent bank mirrors Sure's Trade Republic test: it lists no maximum, so the 180-day cap is refused, then 90 days less a minute passes.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
