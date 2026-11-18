---
title: 'Story 10.2: Link bank accounts'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_commit: 'c01fbf0d9fbc5793d5c7d28e32be33ee2efb4f5b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A connection from 10.1 holds a consent but no account: `completeAuthorization` drops the `accounts` array `POST /sessions` returns, and nothing lets the household decide where each bank account goes (FR49) or make the bank balance the reference (FR56).

**Approach:** Port Sure's setup (`EnableBankingItem#import_accounts_from_session`, `setup_accounts`, `complete_account_setup`, `link_existing_account`, `Balance::ReverseCalculator`): the callback stores the session's bank accounts, a connection page lets the user skip, create or link each one, linking fetches the bank balance once and writes a `current_anchor`, and a linked account's history is computed backward from it.

## Boundaries & Constraints

**Always:**
- New table `bank_accounts`: `id`, `bank_connection_id` (cascade), `identification_hash` (unique per connection, the identity 10.5 matches on renewal), `provider_uid` (session-scoped, used for data calls), `name`, `iban_last4` nullable, `currency`, `cash_account_type` nullable, timestamps. Name is the first of `details`, `product`, `name`, else « Compte •••• 1234 ». Only the last four IBAN characters are ever stored.
- `accounts.bank_account_id` nullable, unique, `on delete set null`: one bank account feeds at most one account and the reverse. It realises AD-8's `bank_connection_id`: the connection is reached through it.
- The callback upserts `bank_accounts` from the `POST /sessions` accounts in the same write as the session; `AccountResource` is parsed by Zod, unknown keys dropped.
- Default choice from Sure's `CASH_ACCOUNT_TYPE_MAP` (CACC, TRAN, SALA, ODFT, NREX, TAXE, TRAS, CASH → depository checking; SVGS, MOMA, ONDP → depository savings; CARD, CRCD → credit card; LOAN → loan other; MORT → loan mortgage); anything else defaults to « Ignorer ». Creatable types: those four targets.
- Link candidates: active, not linked, same currency, type depository, credit card or loan, and the mapped type when one is known. The server computes them and refuses any other target.
- Create: name and currency from the bank, the chosen type, `opening_anchor` two years before today (Sure's `OpeningBalanceManager.default_date`) at the bank balance. Link: existing entries, opening anchor and reconciliations stay untouched.
- Linking or creating calls `GET /accounts/{uid}/balances` for each chosen bank account before any write, keeps `ITBD` else `CLBD` (AD-18), parses the decimal string with `parseAmount`, applies `DBIT` if present, and writes a `current_anchor` dated today in `deps.timeZone`. Stored as the signed amount for an asset, its absolute value for a liability (Sure's `.abs`). One provider failure answers 502 `BANK_PROVIDER_ERROR` and writes nothing.
- Balance direction: an account with `bank_account_id` and a `current_anchor` is computed backward from it; any other forward, as today. Backward: the anchor day is the anchor; each earlier day is the next day's balance minus the next day's movements; a `reconciliation` overrides its day's balance; the `opening_anchor` amount is ignored, its date still bounds the range; days after the anchor go forward from it. A linked account recomputes from its opening date on every change.
- API, session-guarded, 503 when unavailable: `GET /api/bank-connections/:id/accounts` → `{ id, name, ibanLast4, currency, suggestion, account, candidates }[]`; `POST /api/bank-connections/:id/accounts` `{ links: ({ bankAccountId, action: "create", type, subtype } | { bankAccountId, action: "link", accountId })[] }`. Invalid targets answer `VALIDATION_ERROR` with `fields`; unknown connection `NOT_FOUND`.
- Page `/settings/banks/$connectionId`: one row per bank account with name, `•••• 1234` in `{typography.code}`, currency, and either the linked account (a link to it) or a select (Ignorer / new account types / « Associer à » candidates) and one « Valider » button. The callback lands there; each connection on `/settings/banks` links to it.

**Never:** no transaction fetch, no sync route, no lease (10.3); no pending handling (10.4); no unlink, renewal, disconnect (10.5); no `GET /accounts/{uid}/details` or `GET /sessions/{id}` call; no backfill for connections made before this story (reconnecting fills them); no currency conversion; no full IBAN, uid or balance in logs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create | CACC, ITBD `1234.56` EUR | depository checking, opening anchor 2 years ago, `current_anchor` 123456 today | — |
| Link file-fed | account with entries, bank ITBD 1000.00 | today 100000; each earlier day = next minus next day's movements | — |
| Reconciliation | linked, reconciliation 500.00 ten days ago | that day 50000, earlier days derived from it | — |
| Card | CARD, `-300.00` | credit card owing 30000 | — |
| Skip | « Ignorer » | nothing written, row stays linkable | — |
| Wrong currency | link USD bank account to EUR account | nothing written | 400 `VALIDATION_ERROR`, `links.0.accountId` |
| Already linked | target has `bank_account_id` | nothing written | 400 `VALIDATION_ERROR` |
| No usable balance | only `XPCD` | linked, no `current_anchor`, forward computation | — |
| Provider down | balances 500 | nothing written | 502 `BANK_PROVIDER_ERROR` |

</frozen-after-approval>

## Code Map

- `packages/data/schema/accounts.ts`, new `schema/bank-accounts.ts`, `types.ts`, `package.json` `exports`, `migrate.spec.ts` -- migration `0027_*` via `pnpm --filter @archant/data generate`; `ACCOUNT_TYPES` in `account-types.ts`; `VALUATION_KINDS` already holds `current_anchor`.
- `packages/api/src/connectors/bank-connector.ts` -- `BankSession` gains `accounts`; add `fetchBalance(uid)`. `listAccounts` of the spine is not needed: accounts come with the session.
- `packages/api/src/connectors/enable-banking/schemas.ts`, `client.ts` (`call`), `fixtures/session.json` (add `cash_account_type`, a card), new `fixtures/balances.json` -- 100 % branches.
- `packages/api/src/services/bank-connections.ts` `completeConnection` (L239) -- upsert bank accounts; `decrypt` is not needed, data calls use the uid.
- `packages/api/src/domain/balances/forward.ts` + `forward.spec.ts` -- mirror as `reverse.ts`; `stored-balance.ts` for the sign.
- `packages/api/src/services/ledger.ts` -- `FORWARD_VALUATION_KINDS` (L172), `recomputeBalances` (L195) picks the direction; `createAccount` (L288) for the new account; add a `linkBankAccount` writing `bank_account_id` and the `current_anchor` in one transaction with `origin: "sync"`.
- `packages/api/src/routes/bank-connections.ts`, `schemas/bank-connections.ts`, `lib/errors.ts` -- route pattern from 10.1.
- `packages/web/src/routes/_authed.settings.banks.tsx` `Connections()` (L229), `_authed.settings.banks_.callback.tsx` (L73), new `_authed.settings.banks_.$connectionId.tsx`, `hooks/useBankConnections.ts`, `lib/query-keys.ts`, `locales/fr.json` `banks.*`.
- `packages/web/e2e/fake-enable-banking.ts` -- `/sessions` returns two accounts (CACC with IBAN, CARD); add `GET /accounts/:uid/balances` after the JWT check.
- Sure: `app/models/enable_banking_account.rb` 65–132, `app/controllers/enable_banking_items_controller.rb` 337–548, `app/models/balance/reverse_calculator.rb`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/migrate.spec.ts`, `schema/bank-accounts.ts`, `schema/accounts.ts`, `drizzle/0027_*` -- failing tests for the two unique constraints and the cascade, then the table and column.
- [x] `packages/api/src/domain/balances/reverse.spec.ts`, `reverse.ts` -- every backward matrix row, liability, days after the anchor, opening amount ignored.
- [x] `packages/api/src/connectors/enable-banking/*.spec.ts`, `schemas.ts`, `client.ts`, `fixtures/*`, `bank-connector.ts` -- session accounts, name fallback, IBAN cut to four, balance choice and sign.
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- direction switch, `linkBankAccount`, full recompute on change of a linked account.
- [x] `packages/api/src/services/bank-connections.spec.ts`, `bank-connections.ts`, `schemas/bank-connections.ts` -- the rest of the matrix, candidates, a log capture holding no uid.
- [x] `packages/api/src/routes/bank-connections.ts`, `app.spec.ts` -- the two routes, 401, 503, 404.
- [x] `packages/web/e2e/fake-enable-banking.ts`, web routes, hook, `fr.json` -- the connection page.
- [x] `packages/web/e2e/bank-connections.spec.ts` -- connect lands on the page; create shows the bank balance in the sidebar; link an account created through the API keeps its transactions and ends on the bank balance; skip leaves the row selectable.
- [x] `_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md` AD-8, `epic-10-context.md` -- replace `bank_connection_id` with `bank_account_id`.

**Acceptance Criteria:**
- Given a new connection, when its page opens, then each bank account shows name, masked IBAN and currency with skip, create and compatible link choices.
- Given a linked account, when its balance comes from the bank, then today's balance equals it and the chart's earlier days are derived backward.

## Implementation Notes

- Five creatable targets, not four: Sure's map yields checking, savings, credit card, loan other and loan mortgage (`BANK_ACCOUNT_TARGETS` in `packages/data/account-types.ts`).
- drizzle-kit dropped `ON DELETE set null` from the generated `ALTER TABLE`; `0027_add_bank_accounts.sql` carries it by hand, with a comment and a test.
- A balance in another currency than the bank account counts as none; an account created without a balance opens at 0; balances are read in parallel.
- Deleting a connection clears `bank_account_id` through the foreign key and leaves the `current_anchor` unread; turning it into a reconciliation is 10.5's disconnect.
- Review: relinking always drops the old `current_anchor`; a snapshot before the anchor of a backward account measures its gap against the next day; an unreadable session account is dropped instead of failing the session; bank labels are capped at the account name limit.
- Standards review: the upsert names its `excluded` columns from the schema through `sql.identifier`; one name collator serves banks and accounts.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / route |
|---|---|---|
| Stale `current_anchor` revived on relink without balance (blind, verification) | low | Unreachable until 10.5 deletes connections, fix is one moved delete. Patch. |
| Connection delete bypasses the ledger, no recompute (blind) | low | Only pending connections are deleted today; disconnect is 10.5 per intent. Rejected. |
| Anchor dated today while `CLBD` refers to its `reference_date` (blind) | low | `ITBD` comes first; Sure dates the anchor `Date.current`; 10.3's sync rewrites it with transactions. Deferred. |
| First `ITBD` wins among several, or in another currency (blind, edge ×2) | low | Multi-currency or repeated balances are rare for a French household; fix adds a port parameter. Rejected. |
| Concurrent POSTs pass validation, unique index gives a 500 (blind, edge ×2, verification) | low | The button is disabled while pending; only a race reaches it, and nothing is written wrongly. Rejected. |
| No feedback when no balance is usable (blind, edge) | low | The matrix row asks for exactly this, as Sure does. Rejected. |
| Reconnecting the same bank offers to create a duplicate (blind) | low | Sure allows several connections; « Ignorer » is one click; renewal is 10.5. Rejected. |
| Holder name used as account name; comment says it is dropped (blind) | low | The name order is the intent's; the comment is wrong. Patch: comment. |
| `uid` fallback when the hash is missing (blind) | false | `identification_hash` is required by the API reference; the fallback is Sure's. |
| Up to 100 parallel balance calls against PSD2 quotas (blind, edge) | low | The user is present right after consent; a household has a few accounts. Rejected. |
| Same existing account chosen on two rows gives a generic toast (blind, edge) | low | The server refuses and writes nothing; fix adds UI filtering. Rejected. |
| `origin: "sync"` for a user click (blind) | false | The intent names a non-user origin for bank writes (epic context). |
| Sprint status and spec status disagree (blind) | false | The status sync runs when the review ends. |
| No e2e for error paths (blind) | low | API tests cover 502 and no balance. Rejected. |
| Duplicate hash in one session breaks the upsert (edge) | false | Test « keeps one row per identification hash, the last one listed » passes. |
| One account with an unknown currency fails the whole session after the code is spent (edge) | medium | `z.array(sessionAccountSchema)` rejects the whole response. Patch: drop the account. |
| Bank label up to 200 characters exceeds the 100-character account name (edge) | low | A created account then fails its own edit form. Patch: cap at 100. |
| Stale `link:` choice after refetch (edge) | low | Server refuses; rare. Rejected. |
| Upsert rewrites a linked bank account's currency (edge) | low | Upsert runs only on a new session; a bank account's currency does not change. Rejected. |
| Snapshot gap is always 0 on a backward account (verification) | medium | `gapReader` derives from the day before, which backward derives from the snapshot. Patch. |
| Atomicity of the write phase untested (verification) | medium | No failure is reachable mid-batch today but a race. Deferred. |
| NOT_FOUND branch of the connection page untested (verification) | low | Patch: e2e test. |

## Design Notes

The bank accounts are kept at the callback, as Sure does, because `GET /sessions/{id}` returns only uids and hashes: listing later would cost one `details` call per account on every page view. The balance is fetched at link time because FR56 has no source otherwise until 10.3; 10.3's sync rewrites the same `current_anchor`. Ignoring the opening amount backward avoids the jump Sure records as a cash adjustment; 10.5's disconnect should set it to the derived balance before switching forward.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: green, 100 % branches on `connectors/**`, `domain/**`, `services/ledger.ts`.
- `pnpm test:e2e` -- expected: green, no request leaves loopback.
