---
title: "Story 30.8: Reset all financial data"
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_commit: 'a64e0fb33119dfec6b2ca27adc9553d75b0e414c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-30-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) lets an administrator wipe the household's financial data and keep its users: « Zone dangereuse » at the foot of the profile page (`settings/profiles/show.html.erb`), « Réinitialiser le compte » behind a destructive confirmation, `DELETE /users/:id/reset` guarded by `ensure_admin`, then `FamilyResetJob` running `Family::FinancialDataReset#delete_financial_data!` in one transaction. Archant has no way to start over short of deleting its database file.

**Approach:** A ledger function deletes, in one immediate transaction, what Sure's `delete_financial_data!` deletes, mapped to Archant's tables; `DELETE /api/financial-data` calls it behind `requireRole("admin")`; « Réglages › Sécurité », Archant's profile page, ends with « Zone dangereuse » for an administrator, Sure's words and dialog, and « Votre compte a été réinitialisé. » after.

## Boundaries & Constraints

**Always:**
- Deleted, as Sure: imports and their mappings, accounts, entries (valuations, transactions, trades, split lines), entry keys, transfers, rejected transfers, taggings, attachments, holdings and cost basis locks, balances, recurring series with their rules, occurrences, allocations, rejections and price changes, rules with their conditions, actions and runs, budgets and their categories, categories, tags, merchants, bank connections and their bank accounts, goals' links to accounts.
- Kept, as Sure: users, sessions, Better Auth's and OAuth's tables (assistants), invitations, `settings` (bank credentials, preferences), assistant calls, goals (Sure's `delete_financial_data!` leaves `goals`, only their account links go), securities and their prices (Sure's are global).
- One immediate transaction: a failure leaves everything. A live sync lease refuses it with `SYNC_IN_PROGRESS` before anything is deleted, so no run writes into the ledger as it empties.
- The bank's session is not revoked at the provider, as Sure's reset (`destroy_all` on the items, no `revoke_session`).
- A viewer sees no « Zone dangereuse » and the route refuses them `403 FORBIDDEN`.
- Text from Sure's `fr.yml`: `reset_account`, `reset_account_warning`, `confirm_reset.title`, `confirm_reset.body`, `danger_zone_title`; the toast is the first sentence of `users.reset.success`, since Archant deletes at once, not in the background.

**Never:** no migration, no new dependency, no background job, no sample data (Story 30.9), no account deletion of the user (Sure's « Supprimer le compte »), no amount or name in a log line.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full household | every reset table holds rows | each reset table empty; every kept table unchanged; users' `default_account_id` null | none |
| Empty household | no ledger data | `200 { data: null }`, nothing changes | none |
| Split, subcategory, transfer | split children, a parent category with a child, a matched pair | deleted without a restrict failure | none |
| Sync running | a connection's `sync_started_at` within the lease | nothing deleted | `409 SYNC_IN_PROGRESS` |
| Viewer | viewer session, `DELETE /api/financial-data` | nothing deleted | `403 FORBIDDEN` |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger/accounts.ts` -- `deleteAccount`: the delete order to follow (keys, taggings, attachments, transfers, rejected, trades, transactions, split children before parents, entries, holdings, balances, imports, accounts).
- `packages/api/src/services/ledger/reset.ts` (new) -- `resetFinancialData(deps)`.
- `packages/api/src/services/bank-connections.ts` -- `LEASE_MS`, the live-lease test of `removeBankCredentials`.
- `packages/api/src/routes/financial-data.ts` (new), `app.ts` -- mount `/financial-data`.
- `packages/api/src/routes/middleware/roles.ts` -- `requireRole`; `roles.spec.ts` walks the new `DELETE` as a viewer.
- Schema FKs: `categories.parent_id`, `entries.parent_entry_id` restrict (delete children first); `users.default_account_id`, `accounts.bank_account_id`, `transactions.posted_match_id`, `recurring_allocations.entry_id` set null; `import_mappings`, `cost_basis_locks`, `goal_accounts`, `bank_accounts`, recurring children, rule children cascade.
- `packages/app/src/routes/_authed.settings.security.tsx` -- add `DangerZoneSection` under `TwoFactorSection`, shown when `useIsAdmin()`.
- `packages/app/src/components/ConfirmDialog.tsx`, `Section.tsx` -- reuse.
- `packages/app/src/hooks/` -- new `useResetFinancialData.ts`: `api["financial-data"].$delete()`, then `queryClient.invalidateQueries()`.
- `packages/app/src/locales/fr.json` -- `dangerZone.*`.
- `packages/app/playwright.config.ts` -- a `reset` project after `chromium`, before `password`, since a reset empties every other test's data.
- Docs: `docs/sure-parity.md` row « Onboarding, sample data, reset of all data », `docs/architecture.md` AD-2 and AD-21, `AGENTS.md` and `CONTRIBUTING.md` where they count Playwright projects.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/ledger/reset.spec.ts` -- seed every reset table (Sure archive import plus a bank connection, attachment, rule run, rejected transfer, cost basis lock, budget, goal), reset, assert each reset table empty and each kept table unchanged; every table of `sqlite_master` must be in one of the two lists; sync lease refusal -- test first.
- [x] `packages/api/src/services/ledger/reset.ts` -- the function.
- [x] `packages/api/src/routes/financial-data.ts` + spec -- admin 200, viewer 403 with data intact, no session 401.
- [x] Interface section, hook, locale keys.
- [x] `packages/app/e2e/reset.spec.ts` + config project -- reset, toast, no account left; viewer sees no section (`viewer.spec.ts`).
- [x] Docs; story and sprint status to done.

**Acceptance Criteria:**
- Given the administrator on « Réglages › Sécurité », when the page shows, then « Zone dangereuse » reads « Réinitialiser le compte » with Sure's warning; a viewer sees no such section.
- Given the button, when pressed, then « Réinitialiser le compte ? » asks with Sure's `confirm_reset.body`, focus on « Annuler »; confirming resets, toasts « Votre compte a été réinitialisé. » and every list reads empty without a reload.

## Implementation Notes

Decisions taken alone, the owner unavailable:

- `resetFinancialData(deps)` in `packages/api/src/services/ledger/reset.ts` returns nothing; the route logs `financial data reset` with no count, name or amount. It deletes children before parents (rule runs, rules, budgets, recurring series, entry keys, taggings, attachments, transfers, rejected pairs, trades, transactions, split lines, entries, holdings, cost basis locks, balances, imports, accounts, bank connections, subcategories, categories, tags, merchants); rule conditions and actions, budget categories, a series' rules, occurrences, allocations, rejections and price changes, import mappings, goal links and bank accounts go by their cascades, and `users.default_account_id` empties by its `set null`.
- The lease is read under the immediate transaction's write lock, on every connection whatever its status, with `LEASE_MS` from `services/bank-connections.ts`: a sync that takes its lease after the reset commits finds no connection. A lease older than `LEASE_MS`, a crashed sync's, does not refuse, as `removeBankCredentials`.
- Every rule run goes, those whose rule was deleted earlier (`rule_id` null) included: Sure's `has_many :rule_runs, dependent: :destroy` leaves no run without its rule, so Sure's reset leaves none either.
- Pending connections go with the active ones: Sure's `destroy_all` takes every item of the family, whatever its state.
- Categories have two levels at most, Sure's limit, so one pass over subcategories, then the rest, satisfies `categories.parent_id`'s restrict.
- `reset.spec.ts` seeds through a hand-written Sure archive imported with `importSureArchive`, a statement import for keys, then direct inserts for what an archive does not write (mapping, bank connection and account, attachment, rule run, a series' occurrence, payment, rejection and price change, goal and its link, and the kept tables' users, session, setting, invitation, assistant call, security and price). It asserts every reset table holds a row before the reset, so a seed that stops reaching one fails rather than passes.
- The interface: `DangerZoneSection` in `_authed.settings.security.tsx`, mounted when `useIsAdmin()`, with Sure's layout (heading and warning left, destructive button right) and `ConfirmDialog` with Sure's title, body and button text; Sure's `high_severity` only picks the destructive button variant, which `destructive` gives. `useResetFinancialData` invalidates every query after success, so each list refetches as it mounts.
- Playwright: a `reset` project between `chromium` and `password`, `password` now depending on it. `AGENTS.md` counts six projects; `CONTRIBUTING.md` counts none, so it is unchanged.
- Review follow-up: `resetFinancialData` takes `{ origin }` as every ledger function (AD-2); the route logs the administrator's `userId`; the confirmation ignores Annuler and Escape while the request runs, so it never reads as cancelled before the reset lands.
- Second review follow-up: `docs/security-model.md` says a reset deletes bank sessions without revoking them; `AGENTS.md` names the projects without `retries`, and `playwright.config.ts` no longer calls `password` last; `financial-data.spec.ts` tests the route's own `requireRole("admin")` behind the session guard alone and an empty household; the ledger seed holds a rule run whose rule is gone; `useResetFinancialData` resets every query but the session; the end-to-end spec holds a refused reset, Escape pressed while pending, and checks the empty categories after a reset.
- `docs/sure-parity.md`: the row reads Parity for the reset, keeping Sure's onboarding Dropped and Story 30.9 Later; the synchronous run is written as an internal difference, as the « Runtime » row already states Archant has no queue.

## Spec Change Log

## Review Triage Log

First pass, `bmad-build` review (Blind Hunter, Edge Case Hunter, Verification Gap).

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Categories gone for good: `defaults_seeded_at` stays, so the defaults never come back (two layers) | low | defer | Sure's reset leaves no category too; Sure restores them through `categories#bootstrap`, which Story 32.2 brings. Logged in `deferred-work.md`, said in `docs/sure-parity.md`. |
| 2 | `resetFinancialData` takes no `origin`, which AD-2 asks of every ledger function | low | patch | Takes `{ origin: "user" }` as `deleteAccount`. |
| 3 | Spec `in-review` while sprint status reads done | false | reject | The workflow sets the spec to done after review; both agree in the pull request. |
| 4 | Route spec comment says the log holds a count; the 409 test does not check the log (two layers) | low | patch | Comment matches the log; the 409 test asserts no reset line. |
| 5 | `AGENTS.md` « None of these three » after four projects | low | defer | Agent-context file; logged. |
| 6 | Parity row reads as if the kept sentence speaks of the background | low | patch | Reworded. |
| 7 | The log does not say which administrator reset | low | patch | Logs `userId`, an id only. |
| 8 | `SYNC_IN_PROGRESS` message names one connection | low | reject | The interface translates by code; the message is the one `removeBankCredentials` already sends. |
| 9 | No backup before the reset | low | reject | Sure takes none; the export exists and Sure's dialog says it cannot be undone. |
| 10 | The SQLite file keeps its size until a `VACUUM` | low | reject | Same as any deletion in Archant; not met in everyday use. |
| 11 | « A sync starting after finds no connection » untested; empty-household test checks kept tables only | low | reject | The connection rows are deleted in the same transaction the full-household test checks empty. |
| 12 | E2e comment promises the same first name, asserts `/^Bonjour/` | low | patch | Asserts `ADMIN_FIRST_NAME`. |
| 13 | Garbled comment in `routes/financial-data.ts` | low | patch | Rewritten. |
| 14 | Other tabs keep old lists | false | reject | React Query refetches on window focus, its default, which Archant keeps. |
| 15 | Annuler or Escape while pending closes the dialog, then the reset succeeds | low | patch | `onOpenChange` ignored while the request runs. |
| 16 | A sync past its lease still running when the reset deletes its connection | low | reject | The lease's own semantics, shared with `removeBankCredentials`; the sync then fails on missing rows, logged. |
| 17 | The route's own `requireRole` is masked by `viewerReadOnly` in tests | low | defer | As filed; logged. |
| 18 | No interface test of a 409 reset | low | defer | As filed; logged. |

Second pass, `bmad-code-review` (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor). The Edge Case Hunter found nothing. Rows 5, 17 and 18 of the first pass were patched here after all, their `deferred-work.md` entries removed.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `docs/security-model.md` says a disconnection revokes the session but not that a reset does not | low | patch | Row added: never sent on a reset, as Sure's; the consent ends at expiry or from the bank. |
| 2 | `AGENTS.md` « None of these three » (three layers) | low | patch | Names `password`, `two-factor` and `ceiling`. |
| 3 | The 409 path and the dialog's pending guard are testable with `page.route` (two layers) | low | patch | New first test in `e2e/reset.spec.ts`: Escape while pending keeps the dialog, the error toasts, the account stays. |
| 4 | The route's own `requireRole` is testable without `viewerReadOnly` (three layers) | low | patch | Test mounts the route behind `requireSession` only; it fails without the guard. |
| 5 | `invalidateQueries()` leaves inactive caches showing deleted rows on mount | low | patch | `resetQueries`, the session spared. |
| 6 | « Every list reads empty » checked on accounts only (two layers) | low | patch | The e2e test also reads both empty category groups. |
| 7 | No orphan rule run in the seed | low | patch | Seed adds a run with `rule_id` null. |
| 8 | Empty household not checked at the route (two layers) | low | patch | `200 { data: null }` on a fresh database. |
| 9 | `origin` taken and unused | false | reject | As `deleteAccount`'s `_options`; AD-2 asks every ledger function to take it. |
| 10 | `password` now depends on `reset`; its comment says « Last » | low | patch | Comment reworded; a failed dependency skips its dependants, as for every project. |
| 11 | Securities and typed prices kept | low | reject | Sure keeps securities and prices; no position or line refers to them after the reset. |
| 12 | `SYNC_IN_PROGRESS` toast does not say nothing was deleted | low | reject | Same toast as every refused write during a sync. |
| 13 | `review_loop_iteration` 0 after a review pass | false | reject | It counts loopbacks; no loopback happened. |
| 14 | No test shows a mid-sequence failure rolls back | low | reject | One `transaction` call wraps every delete; forging a constraint failure tests libSQL, not this code. |

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure or by Archant's model:

- Placement: Sure's danger zone ends its profile page; Archant's profile (first name) lives in « Sécurité », the one settings page a viewer also sees, so the section goes there, hidden for a viewer, who has no « Supprimer le compte » in Archant.
- Synchronous, where Sure enqueues a job: Archant has no job queue, and one transaction over SQLite is fast; so the toast drops Sure's « en arrière-plan » clause.
- Route `DELETE /api/financial-data`, named after `Family::FinancialDataReset`; `requireRole("admin")` beside `viewerReadOnly`, as the story asks for Sure's `ensure_admin`.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
