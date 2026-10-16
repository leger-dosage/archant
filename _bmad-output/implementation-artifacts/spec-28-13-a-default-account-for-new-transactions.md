---
title: 'Story 28.13: A default account for new transactions'
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_commit: '8586881552782bbdf9a6d51dd4107b5f965691a6'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure lets each user mark one account « Par défaut » from its row's menu (`accounts_controller#set_default`, `#remove_default`), stored in `users.default_account_id`, and its new-transaction form starts its « Compte » field on it (`User#default_account_for_transactions`). Archant has neither the setting nor a new-transaction form with an account field: a transaction is only added from its account's page.

**Approach:** Store the default per user in a nullable `users.default_account_id`; add `PUT` and `DELETE /api/accounts/:id/default` and return the user's `defaultAccountId` with `GET /api/accounts`; give the row menu Sure's two items and the row Sure's « Par défaut » caption; add Sure's « Nouvelle transaction » entry to `/transactions`, a sheet whose « Compte » field starts on the default account when it is eligible.

## Boundaries & Constraints

**Always:**
- Eligibility as Sure's `Account#eligible_for_transaction_default?`: type `depository` or `credit_card` (`supports_default?`), active, not linked. One helper in `packages/data/account-types.ts`, used by the server's refusal, the menu and the form.
- Storage as Sure's: `users.default_account_id` references `accounts(id)` `on delete set null`, per user. Deactivating or linking keeps it, as Sure does; the form ignores it while the account is ineligible, so the account is cleared from the form, and reactivating restores it. Deletion clears the column.
- `PUT /api/accounts/:id/default` sets the signed-in user's default; an ineligible account is refused `409` `DEFAULT_ACCOUNT_NOT_ELIGIBLE`, translated with Sure's `accounts.set_default.depository_only`. `DELETE /api/accounts/:id/default` clears it unconditionally, as `remove_default`. Unknown id `404`. Both are writes, so `viewerReadOnly` refuses a viewer.
- `GET /api/accounts` adds `defaultAccountId`, the stored value; `listAccounts` callers outside the route (assistant) unchanged.
- Row, as Sure's `accounts/_account.html.erb`: « Par défaut » as a caption under the subtype when the account is the user's default and `supports_default?`, muted but without Sure's `opacity-50` (contrast). Menu: after the exclude item and before the delete separator, « Retirer par défaut » (`StarOffIcon`) on the default account, else « Définir par défaut » (`StarIcon`) on an eligible one, else nothing. No toast, as Sure redirects with no flash.
- `/transactions`, administrators only: Archant's « Ajouter une opération » button in the page actions opens the transaction sheet with a « Compte » select after « Libellé », as Sure's `transactions/_form` places it after the description: active, unlinked accounts sorted by name (Sure's `manual.active.alphabetically`), placeholder « Sélectionnez un compte », starting on the eligible default. Saving without an account shows « Ce champ est obligatoire. » and sends nothing. The amount parses in the chosen account's currency; typed values survive a change of account.
- The account page's sheet keeps its fixed account and no field, as Sure's `account_id` hidden field.

**Never:** no default item in the account page's `AccountMenu` (Sure's `show/_menu` has none); no default in the export, `get_accounts` or Better Auth's session; no modal instead of the sheet (Story 34.10); no ordering preference (28.14); no change to the accounts column or dashboard.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Set | admin, active manual checking A | row A shows « Par défaut », menu reads « Retirer par défaut » | none |
| Switch | default A, set B | B shows « Par défaut », A no longer | none |
| Remove | default A, « Retirer par défaut » | no caption, `defaultAccountId` null | none |
| Ineligible | loan, inactive or linked account | no « Définir par défaut » | `PUT` → `409 DEFAULT_ACCOUNT_NOT_ELIGIBLE` |
| Per user | two admins | each reads only their own default | none |
| Deactivated | default A deactivated | caption stays, form starts empty | none |
| Deleted | default A deleted | `defaultAccountId` null | none |
| New transaction | default A, `/transactions` « Ajouter une opération » | « Compte » shows A; save adds to A | API errors as today |
| No account | no default, save | « Ce champ est obligatoire. » under « Compte » | nothing sent |
| Viewer | viewer on `/accounts`, `/transactions` | no default items, no add button | `PUT`/`DELETE` `403` |

</frozen-after-approval>

## Code Map

- `packages/data/schema/auth.ts:28-48` -- `users`; add `defaultAccountId` referencing `accounts.id` `set null`. Migration by `pnpm data generate` (next is `0081`).
- `packages/data/account-types.ts:210-223` -- beside `supportsTrades`: add `supportsDefault(type)` and `eligibleForTransactionDefault({ type, active, linked })`; tests in `account-types.spec.ts`.
- `packages/api/src/services/accounts.ts:41-125` -- `AccountSummary.linked`, `listAccounts`; add `getDefaultAccountId`, `setDefaultAccount`, `removeDefaultAccount` (user id parameter).
- `packages/api/src/routes/accounts.ts:39-50` -- `new Hono<SessionEnv>()`, `signedInUser(c).id` as `routes/members.ts`; list adds `defaultAccountId`; the two routes.
- `packages/api/src/lib/errors.ts` -- `DEFAULT_ACCOUNT_NOT_ELIGIBLE: 409`; `packages/app/src/locales/fr.json` `errors` gets its text.
- `packages/app/src/hooks/useAccounts.ts` -- `useSetDefaultAccount`, `useRemoveDefaultAccount` invalidating `queryKeys.accounts.all`.
- `packages/app/src/components/AccountGroups.tsx`, `AccountRowMenu.tsx` -- caption and items; `isDefault` passed from `list.defaultAccountId`.
- `packages/app/src/components/TransactionSheet.tsx`, `TransactionForm.tsx` -- optional account choice for a new transaction; `useCreateTransaction(account.id)` (`hooks/useTransactions.ts:83`) binds the chosen id; `transactionFormSchema(currency)` from the chosen account, else `list.reportingCurrency`. Account `Select` as `BillDialog.tsx:443-472`.
- `packages/app/src/routes/_authed.transactions.tsx:245` -- `Page` `actions`, as `_authed.accounts.index.tsx:33-38`.
- Tests to model on: `routes/accounts.spec.ts:2782` and `:1247`, `routes/members.spec.ts` (two users), `e2e/manage-accounts.spec.ts:400-460` (menu order, now with « Définir par défaut » on a checking account), `e2e/viewer.spec.ts:216`, `e2e/bank-connections.spec.ts:805` (linked row).
- `docs/sure-parity.md:71` -- split « Default account » to Parity; `:139` mentions the account field.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/account-types.spec.ts` -- eligibility per type, inactive, linked; failing first.
- [x] `packages/api/src/routes/accounts.spec.ts` -- set, switch, remove, refusals (loan, inactive, linked, unknown), per-user isolation with a second admin, deletion clearing, deactivation keeping; viewer `403`; failing first.
- [x] `packages/app/e2e/default-account.spec.ts` -- set a default from the row, caption, then « Ajouter une opération » on `/transactions` starts on it and saves there; « Retirer par défaut »; save without account refused; linked or loan row offers no item. Update `manage-accounts.spec.ts` menu lists and `viewer.spec.ts`.
- [x] `packages/data/schema/auth.ts`, migration -- the column.
- [x] `packages/data/account-types.ts`, `packages/api/src/services/accounts.ts`, `routes/accounts.ts`, `lib/errors.ts` -- server.
- [x] `packages/app/src/hooks/useAccounts.ts`, `components/AccountGroups.tsx`, `AccountRowMenu.tsx`, `TransactionSheet.tsx`, `TransactionForm.tsx`, `routes/_authed.transactions.tsx`, `locales/fr.json` -- interface.
- [x] `docs/sure-parity.md`, `docs/architecture.md` only if a decision there names per-user data -- docs.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass, and screenshots of `/accounts` with a default account and its open menu, and of `/transactions`' new sheet on it, light and dark, desktop and phone width, are reviewed against Sure's views.

## Implementation Notes

- `drizzle-kit generate` wrote `0081_default_account.sql` without the `ON DELETE set null` its snapshot records; the line is fixed by hand, as earlier `ADD ... REFERENCES` migrations were, with a comment saying why.
- `DELETE /api/accounts/:id/default` answers `404` for an unknown id, then clears the user's default whichever account it was, as Sure's `remove_default`.
- `TransactionForm`'s `account` prop takes either a fixed `SheetAccount` or an `AccountChoice` (accounts, initial id, fallback currency). The picked account lives in component state beside the form, so typed values survive a change; a change of account counts as unsaved for the discard prompt. Saving without an account shows `errors.fields.too_small` under « Compte » and sends nothing.
- The route spec's block signs in its own viewer (`reader@example.test`) and a second administrator after clearing `rate_limits`, since the earlier viewer block already created `addViewer`'s user in the shared database.
- The linked row's menu without « Définir par défaut » is covered by the unchanged list in `e2e/bank-connections.spec.ts`; `api.clearDefaultAccount` was added to `e2e/fixtures.ts`. Mocked `/api/accounts` bodies in `accounts`, `dashboard` and `shell` e2e specs gained `defaultAccountId: null`.
- `docs/architecture.md` names no per-user data decision, so it is unchanged.
- `accountChoiceOf` starts the form on the default only when it is among the accounts offered.
- Screenshots of `/accounts` with its open row menu and of `/transactions`' new sheet, light and dark, at 1440 and 390 px, were reviewed against Sure's `accounts/_account.html.erb` and `transactions/_form.html.erb`.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Deactivated default: caption and empty form untested in the interface | medium | patch | Only the API kept-column test covered it; `default-account.spec.ts` now deactivates, checks the caption and « Sélectionnez un compte », reactivates and checks the form starts on it. |
| 2 | `initialAccountId` taken from the unfiltered list | low | patch | A default dropped by the currency filter would start the Select on an id with no option; now looked up among the accounts offered. |
| 3 | Save from `/transactions` not checked in that page's list | low | patch | The test navigated away first; it now reads the new row on `/transactions`. |
| 4 | A change of account alone not tested as unsaved | low | patch | `accountChanged` had no test; Escape after picking another account now shows the discard confirmation. |
| 5 | `.first()` on a unique button | low | patch | Dropped. |
| 6 | Parity and comment wording « no bank feeds by name » | low | patch | Now « no bank feeds, sorted by name ». |
| 7 | Button shown when no account can be picked | low | reject | Sure's « Nouvelle transaction » shows whatever the accounts; the form then refuses the save. |
| 8 | `DEFAULT_ACCOUNT_NOT_ELIGIBLE` names only the type | low | reject | Sure's `depository_only` message, the same for every cause; French wording is Sure's. |
| 9 | Eligibility read then write without a transaction | low | reject | Sure's `set_default` reads then updates the same way; one household, one tab acting at a time. |
| 10 | Account deleted between the check and the write gives a 500 | low | reject | Same race as 9, never met in use. |
| 11 | Session could carry `default_account_id` | false | reject | Better Auth's `transformOutput` copies only its own schema's fields. |
| 12 | API spec clears `rate_limits` before signing in | false | reject | The pattern of `assistants.spec.ts` and `members.spec.ts`. |
| 13 | `accountChoiceOf` has no unit test | low | reject | Its filter, order and start are asserted end to end in `default-account.spec.ts`. |
| 14 | Stale `initialAccountId` or dropped account after a refetch while open | low | reject | Needs the default or the account changed in another tab while the sheet is open. |
| 15 | No button when the account list fails | low | reject | The accounts column and the filter read the same list and fail with it; no account means no form to fill. |
| 16 | Snapshot JSON absent from the review diff | false | reject | Left out of the review diff on purpose; it records `onDelete: 'set null'`. |
| 17 | Spec and sprint statuses, e2e not run | false | reject | Both move to `done` together after the full gate, which now runs. |

## Design Notes

Assumptions taken alone, each settled by Sure: Sure keeps `default_account_id` when the account is deactivated or linked and filters it in `default_account_for_transactions`; the story's « cleared » is read as the form's outcome, deletion alone nulling the column (`on_delete: :nullify`). Archant has no new-transaction form outside an account page, an old divergence from Sure's `transactions/index` « Nouvelle transaction »; the story aligns it instead of designing around it. The button keeps Archant's « Ajouter une opération », the word every Archant screen uses for a transaction. Sure lets any member set a default; Archant's viewer writes nothing (AD-21), and adds no transaction either.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
