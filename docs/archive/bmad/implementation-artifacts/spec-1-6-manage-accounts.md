---
title: 'Story 1.6: Manage accounts'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_commit: '4dd2a6ff00e8ab9a2bae95518eddf4909cf65902'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An account can only be created. It cannot be renamed, retired, kept out of totals or removed, so the list drifts from the household's real situation.

**Approach:** Add the account detail's « Paramètres » tab (EXPERIENCE.md information architecture): a form for name and subtype plus a switch « Exclure des rapports », then « Désactiver le compte » / « Réactiver le compte » and « Supprimer le compte ». The API gains `PATCH` and `DELETE /api/accounts/:id`; deletion goes through a new ledger function.

## Boundaries & Constraints

**Always:**
- Spine AD-1, AD-2, AD-5, AD-6, AD-15 and the Consistency Conventions bind; `scaffolding-lessons.md` pitfalls apply.
- Two `accounts` columns, integer-mode booleans: `active` (not null, default true) and `excluded_from_reports` (not null, default false). Migration `0004`.
- `PATCH /api/accounts/:id` takes any non-empty subset of `name` (same rule as creation), `subtype`, `active`, `excludedFromReports`, and answers the account detail. `subtype` must satisfy `isSubtypeOf(account.type, subtype)`, else `400` field `subtype` `invalid_subtype`. Type, currency, opening balance and opening date are not editable.
- `DELETE /api/accounts/:id` calls `ledger.deleteAccount(accountId, { origin: "user" })`, which deletes in one `immediate` transaction the account's `transactions` rows, all its `entries` (transactions, snapshots, opening anchor), its `balances`, then the account. Answers `{ data: { id } }`. Deletes use subqueries on `account_id`, never an id list, so 50,000 transactions stay within SQLite's parameter cap.
- Account items and details gain `active` and `excludedFromReports`. `GET /api/accounts` keeps returning every account; a group's `total` counts only accounts that are active, not excluded and in the reporting currency, as Sure's balance sheet sums only `visible` and `included_in_reports` accounts. `excludedCount` keeps its meaning: active, included accounts in another currency.
- Inactive accounts are hidden from `/comptes`, the sidebar and the account options of `/operations` filters. Their transactions stay in `/operations`, and a chip for an inactive account still shows its name. `/comptes?showInactive=true`, toggled by « Afficher les comptes inactifs » shown only when one exists, lists them in their group with a badge « Inactif ». An inactive account's page stays reachable and writable, with the badge next to its name.
- An excluded account stays listed everywhere; its balance on `/comptes` and in the sidebar is muted and paired with the eye-off icon, tooltip « Exclu des rapports ».
- Delete confirmation through `ConfirmDialog`, focus on Annuler: title « Supprimer le compte « {name} » et ses N opérations ? » (« Supprimer le compte « {name} » ? » at zero), description saying snapshots and balance history go too, button « Supprimer le compte ». N is `total` from `GET /api/accounts/:id/transactions`. On success: toast « Compte « {name} » supprimé. », navigate to `/comptes`.
- Every account write invalidates `accounts.all` and `transactions.all`; a delete also removes `accounts.detail(id)`.
- Every acceptance criterion and interface row of the I/O matrix has a Playwright test; the rest has Vitest tests.

**Never:**
- No type, currency or opening-balance edit, no net-worth or report code, no soft delete or background deletion job, no undo. No row menu on `/comptes`. No raw SQL in application code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rename | `PATCH { name: " Livret A " }` | Name `Livret A`, sidebar and `/operations` rows follow | — |
| Subtype | checking → `{ subtype: "savings" }` | Saved, balance unchanged | — |
| Bad subtype | credit card, `{ subtype: "savings" }` | Nothing saved | `400`, field `subtype` `invalid_subtype` |
| Empty patch | `{}` | Nothing saved | `400 VALIDATION_ERROR` |
| Deactivate | `{ active: false }`, balance 100 € in Actifs | Group total drops by 100 €; hidden from page, sidebar, filter options; transactions still listed | — |
| Exclude | `{ excludedFromReports: true }` | Still listed with marker; group total drops by its balance | — |
| Delete | 3 transactions, 1 snapshot, second account untouched | Account and its entries, transactions, balances gone; other account's rows unchanged | — |
| Unknown id | `PATCH` or `DELETE` on unknown id | — | `404 NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `packages/data/schema/accounts.ts` (L9–39) -- add both columns; `0003_add_transaction_exclusion.sql` is the template. `pnpm data generate --name manage_accounts` writes `drizzle/0004_*.sql`. `account-types.ts` `isSubtypeOf`.
- `packages/data/schema/entries.ts` (L26–28), `balances.ts` (L13–15), `transactions.ts` (L22–24) -- FKs are `ON DELETE RESTRICT`; keep them, the ledger deletes children first.
- `packages/api/src/services/ledger.ts` -- add `deleteAccount` beside `deleteTransaction` (L422–439), same transaction pattern as `createAccount` (L188–224); `accountWithOpeningDate` (L160) throws `NOT_FOUND`. `Origin` at L45.
- `packages/api/src/services/accounts.ts` -- `summarise` (L40) gains both flags; `listAccounts` (L64) totals; add `updateAccount` (updating `accounts` here is allowed by `.oxlintrc.json`, only entries/balances/transactions are restricted).
- `packages/api/src/schemas/accounts.ts` -- `updateAccountSchema` reusing the name rule of `createAccountSchema`; the `invalid_subtype` check needs the stored type, so it runs in the service and raises the same field error.
- `packages/api/src/routes/accounts.ts`, `routes/transactions.ts` (L25, L38 for the PATCH/DELETE pattern), `app.spec.ts` helpers `request`, `openAccount`, `postTransaction`, `postSnapshot`; `ledger.spec.ts`; `testing/temp-database.ts`.
- `packages/web/src/routes/comptes.$accountId.tsx` -- `ACCOUNT_TABS`, `searchSchema` (L40–47), tabs (L299), header (L280–295); add `settings`. Not-found state (L230–238).
- `packages/web/src/routes/comptes.index.tsx`, `components/AccountGroups.tsx`, `AppSidebar.tsx` (`SidebarAccounts` L76), `routes/operations.tsx` (`accountOptions` L130–139), `TransactionFilters.tsx` (`names` L270 must keep inactive accounts).
- `packages/web/src/components/CreateAccountDialog.tsx` -- name field, `ACCOUNT_KINDS` / `lib/account-kinds.ts`, `applyFieldErrors`, toasts to copy. `ConfirmDialog.tsx` for the delete. `ui/switch.tsx`, `ui/badge.tsx`, `ui/tooltip.tsx` exist.
- `packages/web/src/hooks/useAccounts.ts`, `useAccount.ts`, `lib/query-keys.ts`; `useInvalidateAccount` is duplicated in `useTransactions.ts` (L60) and `useSnapshots.ts` (L40): extract one into `hooks/useInvalidateAccount.ts`.
- `packages/web/src/locales/fr.json` -- `accounts.excluded_*` already means "other currency"; name the new keys `accounts.excludedFromReports`, `accounts.inactive`, `accountSettings.*`.
- `packages/web/e2e/fixtures.ts` (`openAccount`, `addTransaction`, `recordSnapshot`, `groupTotal`, `uniqueName`), `e2e/accounts.spec.ts` locators `pageGroupHeader`, `sidebarGroup`. One shared database: assert totals as differences read through `groupTotal`, never absolute values.
- `~/github/sure/app/models/account.rb` (L44–66 scopes, L703–710 transfer cleanup for Epic 5), `balance_sheet/account_totals.rb` (L31–33).

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/schema/accounts.ts`, `drizzle/0004_*.sql` -- both columns.
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- tests first: `deleteAccount` removes every row of the account in the four tables, leaves a second account intact, throws `NOT_FOUND`; then the code.
- [x] `packages/api/src/app.spec.ts`, `schemas/accounts.ts`, `services/accounts.ts`, `routes/accounts.ts` -- tests first for every matrix row and the totals rule; then `PATCH`, `DELETE` and the flags.
- [x] `packages/web/src/hooks/useInvalidateAccount.ts` (new), `useAccounts.ts`, `useAccount.ts` -- `useUpdateAccount`, `useDeleteAccount`, shared invalidation.
- [x] `packages/web/src/components/AccountSettings.tsx` (new), `routes/comptes.$accountId.tsx` -- Paramètres tab, form, switch, deactivate/reactivate, delete confirmation, badge in the header.
- [x] `packages/web/src/routes/comptes.index.tsx`, `AccountGroups.tsx`, `AppSidebar.tsx`, `operations.tsx`, `locales/fr.json` -- hide inactive, `showInactive` toggle, badge, excluded marker.
- [x] `packages/web/e2e/manage-accounts.spec.ts` (new) -- Playwright for each acceptance criterion below and each interface row of the matrix.

**Acceptance Criteria:**
- Given an account, when I change its name or subtype in Paramètres and save, then the header, sidebar and `/comptes` show the change after reload.
- Given an account I deactivate, then it disappears from `/comptes`, the sidebar and the `/operations` account filter; with « Afficher les comptes inactifs » it shows with « Inactif », and « Réactiver le compte » brings it back everywhere.
- Given an account I exclude, then it stays listed with the muted balance and eye-off icon, and its group total no longer counts it.
- Given an account with 3 transactions, when I choose « Supprimer le compte », then the dialog reads « … et ses 3 opérations ? »; confirming lands on `/comptes` without it, and `/operations` no longer lists its transactions.
- Given the finished story, when the AGENTS.md verification gate and `pnpm test:e2e` run, then every command passes and no tracked file is modified.

## Implementation Notes

- `useDeleteAccount` navigates to `/comptes` before removing the account's queries: in the other order the still-mounted page refetched the deleted account and showed a NOT_FOUND toast. The e2e test records every `GET /api/accounts/<id>` after confirming and expects none.
- The « Inactif » badge sits inside the account page's `h1`, so its accessible name reads « Nom Inactif » for an inactive account; the existing e2e locators find the header through the `h1`'s parent.
- « Exclure des rapports » saves with Enregistrer, as the transaction sheet's switch does; deactivation saves at once, since it loses nothing and is undone in one click.
- French plural: one transaction reads « … et son opération ? »; zero has its own key.
- `useInvalidateAccount` is now one shared hook; snapshot writes also refresh `transactions.all`, a harmless extra fetch.
- `accountSettingsFormSchema` lives beside `createAccountSchema` in `schemas/accounts.ts`, so the form and the API share the name rule.
- Verified in Chromium on a throwaway database: excluding « Livret A » drops Actifs from 8 189,10 € to 3 189,10 € with the eye-off marker; deactivating « Compte joint » hides it from the sidebar and the `/operations` account filter while its 3 transactions stay listed; the delete dialog reads « Supprimer le compte « Compte joint » et ses 3 opérations ? » with focus on Annuler. Light 1280 px and dark 600 px checked.

## Spec Change Log

## Review Triage Log

| # | Source | Location | Finding | Verdict | Evidence | Route |
|---|--------|----------|---------|---------|----------|-------|
| 1 | blind, edge | `TransactionFilters.tsx` `AccountEditor` | An inactive account in `?account=` stays selected but is not offered, so Appliquer re-sends it and it cannot be unchecked | medium | `selected` starts from `filters.account`; the checkboxes list `offered` only. | patch |
| 2 | blind | `manage-accounts.spec.ts` | `toHaveCount(0)` on the NOT_FOUND toast passes at once, so it cannot catch a refetch of the deleted account | medium | A retrying assertion that already holds returns immediately. | patch |
| 3 | blind | `services/accounts.ts` `AccountSummary.active` | Comment says the API hides inactive accounts; `listAccounts` returns them | low | Direct correction of a comment. | patch |
| 4 | verification | `drizzle/0004_manage_accounts.sql` | `DEFAULT false` on `active` passes every suite | medium | `createAccount` writes both flags explicitly; `migrate.spec.ts` never reads them. | patch |
| 5 | verification | `query-keys.ts` `ofAccount` | No test checks it prefixes `byAccount` | low | `query-keys.spec.ts` checks the other prefixes; a wrong key leaves stale pages silently. | patch |
| 6 | blind, edge | `comptes.index.tsx`, `AppSidebar.tsx` | Every account inactive leaves `/comptes` with the switch only and the sidebar empty | low | Real, but a household deactivating every account is rare and the switch is on screen. Rejected. |  |
| 7 | blind | `AccountSettings.tsx` `DeleteSection` | Delete stays disabled when the count request fails | low | The Opérations tab shows the same failure with a retry; rejected. |  |
| 8 | blind | `schemas/accounts.ts` `updateAccountSchema` | Unknown keys such as `currency` are stripped silently | low | Same as every request schema since Story 1.2; rejected. |  |
| 9 | blind | `schemas/accounts.ts` | Empty-patch error has an empty path and no translation | low | The form cannot send an empty patch; API-only. Rejected. |  |
| 10 | blind | `AccountGroups.tsx` | Shown inactive rows are not muted, so rows no longer sum to the total | low | They carry « Inactif »; totals follow Sure. Rejected. |  |
| 11 | blind | `services/*` | An inactive account still accepts writes | false | The frozen intent says its page stays reachable and writable. |  |
| 12 | blind | `ledger.ts` `deleteAccount` | `_options` unused | false | Same signature as `createAccount`, `deleteTransaction` and the snapshot writers (AD-2). |  |
| 13 | blind | `ledger.spec.ts` | No guard against a future child table | low | Speculative until Epic 2 adds `entry_keys`; rejected. |  |
| 14 | blind | web | No Vitest for the inactive filters and field-error routing | low | Playwright covers each; rejected. |  |
| 15 | blind | `AccountSettings.tsx` | Form and activation button can PATCH concurrently | low | Last write wins on distinct fields; rejected. |  |
| 16 | blind | `manage-accounts.spec.ts` | Muted amount asserted through a Tailwind class | low | Story 1.5's tests do the same; rejected. |  |
| 17 | blind | review diff | Spec missing from the diff | false | Left out on purpose; it is the claims file. |  |
| 18 | edge | `services/accounts.ts` `updateAccount` | Select and update not atomic | false | A concurrent delete makes `getAccount` answer `404 NOT_FOUND`, the right answer. |  |

## Design Notes

Totals follow Sure: an excluded or inactive account is left out of its group total, since the sum of group totals is the net worth Epic 6 will show; AD-9 already names "an account excluded from reports" for cash flow. Unlike Sure, inactive accounts leave `/comptes` too, as the story requires; the toggle replaces Sure's always-listed index. Deletion is synchronous: Sure's `DestroyJob` exists for linked providers and dozens of dependent tables, and here four deletes on indexed columns run in one transaction. When Epic 5 adds `transfers`, `deleteAccount` must delete the transfers touching the account first, as Sure's `cleanup_transfers` does, leaving the other side as an ordinary transaction.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, `git status` clean afterwards.
- `pnpm test:e2e` -- `manage-accounts.spec.ts` and the existing suite pass.
- `pnpm data migrate:local` -- applies `0004` on an existing local database.

**Manual checks:**
- Two EUR accounts and one USD: rename, switch subtype, exclude, deactivate, show inactive, reactivate, delete one with transactions and snapshots; light and dark, 1280 and 600 px.
