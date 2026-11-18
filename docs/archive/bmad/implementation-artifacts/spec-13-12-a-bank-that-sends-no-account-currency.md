---
title: 'Story 13.12: A bank that sends no account currency'
type: 'bugfix'
created: '2026-09-29'
status: 'done'
baseline_commit: '63abbe17b3eb0601ce09139224b1510f3ee34eb2'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On 2026-09-29 Boursorama gave every account of a production session the currency `XXX`, ISO 4217's « no currency ». `sessionAccountSchema` refuses it, `sessionResponseSchema` turns each refused account into `null` and filters it out without a trace, so the connection was stored with no account and the log said only `accounts: 0`. The balances and lines of those accounts carry real currencies (EUR, some USD).

**Approach:** Follow Sure's `EnableBankingAccount#upsert_enable_banking_snapshot!`: a session account whose currency is `XXX`, missing or unknown is kept, with the currency its stored bank account already has, else `EUR`. An account still unreadable is dropped with a log naming the failing fields, and the connection page stops claiming the bank shared nothing.

## Boundaries & Constraints

**Always:**
- The connector reports an unusable currency as `null`; the service resolves it, because only the service sees stored rows. Resolution order: the currency of the stored `bank_accounts` row with the same `bank_connection_id` and `identification_hash`, else `DEFAULT_CURRENCY` (`EUR`). A linked row always holds its Archant account's currency (`isLinkCandidate` and `createAccount` enforce it), so this is the epic's « currency of the Archant account it is linked to ».
- One `warn` line per completed connection that defaulted any currency: `connectionId` and the count, never a uid, a name or an IBAN.
- The session's `accounts` are parsed one by one, as `transactionsPageSchema` does for lines. One `warn` line per completed connection that dropped any: `connectionId`, the count, and the distinct failing field paths (`uid`, `identification_hash`…), never an input value. A non-object entry reports the path `(account)`.
- A dropped account never fails the session: the callback's code is single use.
- The connection page's empty state says no readable account arrived, and tells the reader to renew the consent choosing the accounts to share, then to read the server logs if the list stays empty. Key `banks.accounts.empty` in `fr.json`, vouvoiement, no exclamation mark.
- A renewal (`completeConnection` on an active row) goes through the same path: the owner's existing Boursorama connection recovers with « Renouveler le consentement », no migration.

**Never:** no conversion and no change to how balances or lines read their own currency; no schema or migration change; no new error code; no count of dropped accounts stored for the page; no change to the sync.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Boursorama | new connection, accounts with `currency: "XXX"` | every account stored in `EUR`, listed on the page | one `warn` with `connectionId`, count |
| Missing or odd currency | `currency` absent, `null`, `42`, `"ZZZ"` | same as `XXX` | same |
| Renewal | stored row `USD`, session sends `XXX` for its hash | row keeps `USD` | same `warn` |
| No uid | `{ currency: "EUR" }` beside readable accounts | readable ones kept | `warn`: `dropped: 1`, `fields: ["uid"]` |
| Nothing readable | every account lacks a uid | connection active, page shows the new empty state | `warn` as above |

</frozen-after-approval>

## Code Map

- `packages/api/src/connectors/enable-banking/schemas.ts` -- `sessionAccountSchema.currency` becomes `currency.nullish().catch(null)` (`XXX` is not in `MINOR_UNITS`, so one rule covers it); `sessionResponseSchema.accounts` becomes `z.array(z.unknown()).default([])`. Keep the `.catch` style of the other fields.
- `packages/api/src/connectors/enable-banking/client.ts:517-530` -- `completeAuthorization`: `safeParse` each account with `sessionAccountSchema`, map the good ones through `toBankAccount`, collect issue paths (joined with `.`) of the bad ones. `toBankAccount:76` passes `currency` through, now nullable.
- `packages/api/src/connectors/bank-connector.ts:29-49` -- `BankAccountRef.currency: CurrencyCode | null` (doc: `null` when the bank gave none usable); `BankSession` gains `dropped: { count: number; fields: string[] }`.
- `packages/api/src/services/bank-connections.ts:321-437` -- `completeConnection`: inside the transaction, before the insert, read stored `currency` by `identificationHash` for accounts whose currency is `null`, then insert with the resolved one; `excluded(bankAccounts.currency)` stays right since the value is resolved first. Log both `warn` lines with `deps.logger` next to the `"bank connected"` `info`. `DEFAULT_CURRENCY` comes from `@archant/data/money`.
- `packages/api/src/connectors/enable-banking/client.spec.ts:311` -- « drops an account it cannot read » asserts `XXX` is dropped: rewrite it to the new behaviour (`XXX` kept with `currency: null`, no-uid dropped with `fields: ["uid"]`).
- `packages/api/src/services/bank-connections.spec.ts:478` -- « completeConnection and the session's accounts » uses `connected(handler)` with msw and `logLines`; add the matrix rows there. `renewConnection` tests at `:1070` show how to renew.
- `packages/app/e2e/fake-enable-banking.ts` -- `/sessions` at `:326`; banks keyed by name as `FAILING_BANK`. Add `NO_CURRENCY_BANK` (accounts sent with `XXX`) and `UNREADABLE_BANK` (accounts without `uid`) to `FAKE_BANKS`; `bank-connections.spec.ts:238` counts `FAKE_BANKS.length`, so it follows.
- `packages/app/e2e/bank-connections.spec.ts:428` -- « a new connection shows each bank account with its masked IBAN, its currency » is the model for the two new tests.
- `packages/app/src/locales/fr.json` `banks.accounts.empty` -- today « La banque n'a partagé aucun compte. », shown by `_authed.settings.banks_.$connectionId.tsx:447`. Only the text changes.
- Do not touch `linkBankAccounts`, `isLinkCandidate`, `currencyOf` or the ledger.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/connectors/enable-banking/client.spec.ts` -- rewrite the drop test, add a `XXX` replay shaped like Boursorama's session, assert `dropped` -- test first.
- [x] `packages/api/src/services/bank-connections.spec.ts` -- matrix rows: stored `EUR`, renewal keeping `USD`, both `warn` lines without uid, name or IBAN in `logLines` -- test first.
- [x] `schemas.ts`, `client.ts`, `bank-connector.ts` -- nullable currency, per-account parse, `dropped` -- the connector reports, never guesses.
- [x] `services/bank-connections.ts` -- resolve currencies, log -- the only place that sees stored rows.
- [x] `packages/app/e2e/fake-enable-banking.ts`, `packages/app/e2e/bank-connections.spec.ts` -- two banks, two tests: `XXX` accounts listed in EUR; unreadable accounts show the new empty state.
- [x] `packages/app/src/locales/fr.json` -- new `banks.accounts.empty` text.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `13-7` to `done` (merged in #78), `13-12` per the workflow.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` runs, then a test replays a session whose accounts carry `XXX` and every matrix row has a Vitest test.
- Given `pnpm test:e2e`, when a bank sends `XXX`, then its accounts are listed with `EUR`; when it sends none readable, then the page shows the new empty state.
- Given any log line this story adds, when the test reads `logLines`, then it holds no uid, account name or IBAN fragment.

## Implementation Notes

- `sessionAccountSchema.currency` is `currency.nullable().catch(null)`, not `nullish()`: `catch` already turns an absent currency into `null`, and the port type has no `undefined`.
- The log checks look for the IBAN head and the `ibanLast4` key, not four bare digits that a timestamp could contain.
- `session-no-currency.json` replays the shape of Boursorama's session of 2026-09-29, anonymised.
- `sprint-status.yaml` also moves 13.7 to `done`, merged in #78.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / route |
|---|---|---|
| Lower-case `usd` now stored as `EUR` instead of dropped | low | No bank seen sends it, and its balances would fail the same `currency` check. Rejected. |
| A renewal that drops accounts marks their stored rows unlisted | medium | Pre-existing: a dropped account was already missing from `session.accounts` before this story; the new `warn` now says so. Deferred. |
| The currency `warn` counts stored-currency accounts with the `EUR` ones | low | The line says « without a usable currency », true of both. Rejected. |
| The currency `warn` omits the raw code | low | Needs raw values carried through the port; the spec keeps counts only. Rejected. |
| A new connection to the same bank does not reuse another connection's currency | false | Scoped per connection by design, as Sure scopes per item. Rejected. |
| A defaulted `EUR` becomes permanent once linked | low | The intent chooses `EUR` as Sure does; an account's currency never changes after creation. Rejected. |
| Spec says `nullish`, code `nullable` | false | Recorded in Implementation Notes. Rejected. |
| Spec and sprint status disagree | false | Step 05 syncs them. Rejected. |
| Log test matches a JSON substring | low | Direct fix. Patch. |
| e2e `getByText("XXX")` checks little | low | Direct fix. Patch. |
| Docs do not name the new `warn` lines | low | The messages read on their own. Rejected. |
| Duplicate hashes inflate the count | low | Direct fix with a `Set`. Patch. |
| `accounts: null` fails the whole session | low | Pre-existing, no bank seen sends it. Rejected. |
| A transaction failure skips the dropped `warn` | low | The connection fails with its own error then. Rejected. |
| « Nothing readable » test does not assert the `warn` | low | Direct fix. Patch. |
| Stored-currency lookup's connection scope untested | medium | Removing the filter passes every test. Patch: a two-connection test. |

## Design Notes

The currency stays with the service because the connector is stateless and Sure's order needs the stored row. `XXX` needs no special case: it is absent from `MINOR_UNITS`.

Lines in USD on an EUR account, seen on Boursorama, are the sync's concern and stay out of this story.

## Verification

**Commands:**
- `pnpm lint:code && pnpm typecheck && pnpm test` -- expected: green.
- `pnpm test:e2e` -- expected: green, the two new tests included.
- `pnpm format && pnpm lint:format` -- expected: green, no tracked file changed by the second run.
