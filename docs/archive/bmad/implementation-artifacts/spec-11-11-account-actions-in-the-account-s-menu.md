---
title: "Story 11.11: Account actions in the account's menu"
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_commit: 'c5941f63ba6e2b5af948253a8b6b471b4d4a692c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Renaming, excluding, deactivating or deleting an account hides behind the account page's « Paramètres » tab (`?tab=settings`), which the owner did not find during manual QA. And `DELETE /api/accounts/:id` deletes a bank-linked account, leaving its `bank_accounts` row unlinked and offered for linking again, where Sure refuses (`accounts_controller#destroy`, `cannot_delete_linked`).

**Approach:** A « … » menu beside the account name, as Sure's `accounts/show/_menu.html.erb`, carries the actions; « Modifier » opens a dialog holding the former tab's form; the tab goes. The account detail exposes its bank connection, and the API refuses to delete a linked account with `409 ACCOUNT_LINKED`.

## Boundaries & Constraints

**Always:**
- Menu items, in order: « Modifier »; « Exclure des rapports » or « Inclure dans les rapports »; « Désactiver » or « Réactiver »; a separator; « Supprimer le compte » (`variant="destructive"`). Trigger: ghost icon button with `EllipsisIcon`, `aria-label` « Actions du compte {name} », as in `_authed.recurring.tsx`.
- Exclude/include and deactivate/reactivate apply at once through `useUpdateAccount`, with the toasts `ActivationSection` shows today and a new pair for exclusion; no confirmation, as today and as Sure.
- « Modifier » opens a `Dialog` titled « Modifier le compte » holding today's `SettingsForm` unchanged: name, subtype when the type has more than one kind, a loan's three details, the « Exclure des rapports » switch (Sure's edit form keeps it too), same schema `accountSettingsFormSchema`, same `applyFieldErrors`. Saving closes the dialog; `Esc` or « Annuler » closes it without saving and resets the form.
- « Supprimer le compte » opens today's `ConfirmDialog` with the same title, count, description, button and navigation to `/accounts`.
- `AccountDetail` gains `bankConnection: { id: string; institutionName: string } | null`, joined from `accounts.bank_account_id` through `bank_accounts` to `bank_connections`. A linked account's menu has no « Supprimer le compte »; in its place an item links to `/settings/banks/$connectionId`, labelled « Déconnecter {institutionName} pour supprimer ce compte ».
- `services/accounts.ts` `deleteAccount` reads the account first: unknown id stays `404 NOT_FOUND`; `bank_account_id` set throws `ACCOUNT_LINKED` (409, English message « Disconnect the bank before deleting this account. ») and deletes nothing. `ledger.deleteAccount` keeps no check, so disconnection and its own tests are unchanged.
- `ACCOUNT_LINKED` joins `ERROR_STATUSES` in `packages/api/src/lib/errors.ts` and `errors.ACCOUNT_LINKED` in `fr.json`.
- `settings` leaves `ACCOUNT_TABS`; an old `?tab=settings` link falls back to Opérations through the existing `.catch(undefined)`.
- Documented rules follow: `EXPERIENCE.md` account-detail row (tabs Opérations, Soldes, Imports; actions in the « … » menu), `docs/sure-parity.md` « Delete an account » row becomes parity.

**Never:** no per-account unlink, no action on the `/accounts` rows, no confirmation for deactivate or exclude, no change to what the form edits (type, currency, opening balance and date stay read-only), no change to `ledger.deleteAccount`, no import or sync item in the menu.

## I/O & Edge-Case Matrix

| Scenario | State | Expected |
|----------|-------|----------|
| Manual account menu | active, included | Modifier, Exclure des rapports, Désactiver, Supprimer le compte; no « Paramètres » tab |
| Toggled states | excluded, inactive | Inclure dans les rapports, Réactiver |
| Edit | Modifier, new name, Enregistrer | dialog closes, header and sidebar show the name |
| Edit invalid | blank name | field error, dialog stays open, nothing saved |
| Linked account menu | `bank_account_id` set | no Supprimer; item to the connection page |
| API delete linked | `DELETE` on linked account | `409 ACCOUNT_LINKED`; account, entries and bank link unchanged |
| API delete after disconnect | connection disconnected | `200 { id }` |
| API detail | linked / manual | `bankConnection` `{ id, institutionName }` / `null` |

</frozen-after-approval>

## Code Map

- `packages/app/src/routes/_authed.accounts.$accountId.tsx` -- `ACCOUNT_TABS` (L45), `searchSchema` (L58), tab triggers (L443–449) and settings content (L471–473) go; header `h1` (L390–393) gets the menu beside the name.
- `packages/app/src/components/AccountSettings.tsx` -- `SettingsForm` (L79–216) moves into `EditAccountDialog.tsx` (new); `ActivationSection` (L218–258) and `DeleteSection` (L260–316) logic moves into `AccountMenu.tsx` (new); the file goes. Delete count comes from `useAccountTransactions(id, 1).total`.
- `packages/app/src/routes/_authed.recurring.tsx` (L61–88) -- « … » menu pattern; `components/ui/dropdown-menu.tsx`, `ui/dialog.tsx`, `ConfirmDialog.tsx`; `CreateAccountDialog.tsx` for the dialog shell and reset on close.
- `packages/app/src/hooks/useAccounts.ts` (L34–66) -- `useUpdateAccount`, `useDeleteAccount`, reuse. `hooks/useAccount.ts:8` `AccountDetailData` infers the new field.
- `packages/app/src/locales/fr.json` -- `accountSettings.*` (L187–217) and `accountDetail.tabs.settings` (L173); rename the namespace `accountActions.*`, add menu, dialog, exclusion toasts, linked item, `errors.ACCOUNT_LINKED` (L1089+).
- `packages/api/src/services/accounts.ts` -- `AccountDetail` (L129–135), `getAccount` (L138–152) gains the join; `deleteAccount` (L212–216) gains the check.
- `packages/data/schema/accounts.ts` (L28–34) `bankAccountId`; `schema/bank-accounts.ts` `bankConnectionId`; `schema/bank-connections.ts:30` `institutionName`.
- `packages/api/src/lib/errors.ts` (L7–50) -- `ERROR_STATUSES`, 409 codes as model.
- `packages/api/src/schemas/accounts.ts:217` -- comment naming the Paramètres form; reword.
- `packages/api/src/app.spec.ts` -- `DELETE /api/accounts/:id` (L2425–2465); `connectedApp()` and the link-create flow (L6982–7019) make a linked account.
- `packages/app/e2e/manage-accounts.spec.ts` -- every test drives the tab (L20–21, L33, L65, L80, L182, L208, L265); `e2e/accounts.spec.ts:182–200` loan rate through `?tab=settings`.
- `packages/app/e2e/bank-connections.spec.ts` -- `connect` (L81), `choose`, `validate`, `linkedAccountId` (L112); the fake bank is `e2e/fake-enable-banking.ts`.
- `_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md:29`, `docs/sure-parity.md:66`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/app.spec.ts` -- tests first: delete linked answers 409 `ACCOUNT_LINKED` and leaves account and link; delete after disconnect answers 200; detail returns `bankConnection` for a linked account and `null` for a manual one.
- [x] `packages/api/src/lib/errors.ts`, `services/accounts.ts`, `schemas/accounts.ts` -- the code, the check, the join, the comment.
- [x] `packages/app/e2e/manage-accounts.spec.ts`, `e2e/accounts.spec.ts` -- rewrite the tab steps as menu steps; add the menu items test, toggled labels and the tab's absence. Written before the components.
- [x] `packages/app/e2e/bank-connections.spec.ts` -- after linking an account, its menu has no « Supprimer le compte » and its item opens the connection page. Kept in this file because its helpers and the shared fake bank live there.
- [x] `packages/app/src/components/AccountMenu.tsx`, `EditAccountDialog.tsx` (new), `AccountSettings.tsx` (removed), `routes/_authed.accounts.$accountId.tsx`, `locales/fr.json` -- menu, dialog, tab removal, strings.
- [x] `EXPERIENCE.md`, `docs/sure-parity.md` -- the two rows.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every matrix row has an automated test: Playwright for the menu and dialog, Vitest for the API rows.

## Implementation Notes

- The header's name block became one wrapping row, name and menu first, the subtype, loan summary and balance below in the same block: many e2e helpers read the header as the parent of the `h1`.
- The edit dialog carries a `DialogDescription` naming what never changes after creation (currency, opening balance, opening date), which Radix expects for an accessible dialog.
- The menu content takes `className="w-auto"`, as `BulkBar` does: the default width follows the « … » trigger, and a QA screenshot showed the labels wrapping onto two lines.
- The API test adds a hand-entered transaction after linking, since the fake link syncs none, so the refused delete has entries to keep.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| Nothing checks the menu offers deletion again after disconnecting without a reload (verification) | medium | The e2e test stopped at the connection URL; the other disconnect test reloads with `page.goto`, so the client cache invalidation is untested. | patch |
| The 409 API test asserts the balance, not the entries (blind) | low | A linked balance is computed backward from the bank anchor, so it holds even if entries went. Direct assertion. | patch |
| The dialog description omits the opening date (blind) | low | Direct text fix; « Type » stays out, since the form's Type field edits the subtype. | patch |
| `EXPERIENCE.md` row mixes French and English labels (blind) | low | Direct rewording. | patch |
| Linked check sits outside the ledger's transaction (blind, edge) | low | Needs a link and a delete within milliseconds for one household; moving it into `ledger.deleteAccount` contradicts the spec's Never. | rejected |
| The disconnect label hides that every account of the bank becomes manual (blind) | false | The connection page's confirmation states « Les N comptes liés deviennent des comptes manuels ». | rejected |
| The first-page transactions query runs on every account page, linked ones included (blind) | low | One cached request, shared with the Opérations tab's first page; gating adds a branch. | rejected |
| A 409 from a stale page leaves the confirmation open and the menu unchanged (blind, edge) | low | Needs a link in another tab between load and delete; the toast gives the translated reason; a handler adds a branch. | rejected |
| Esc during an in-flight save still saves, or sets errors on a closed form (edge) | low | Saving is sub-second on SQLite; a guard adds state. | rejected |
| The menu and the dialog race two `useUpdateAccount` mutations (blind, edge) | false | The dialog is modal: the menu cannot be opened while it is. | rejected |
| A failed count query leaves « Supprimer le compte » disabled (edge) | low | Same behaviour as the former tab's button; a failing first page shows its own error. | rejected |
| `FieldMessage` duplicated with `LoanDetailsFields` (blind) | low | Moved as is from `AccountSettings.tsx`, no new duplication. | rejected |
| Focus return not checked after « Annuler » or a save (blind) | low | Radix returns focus the same way for every close; `Esc` is checked. | rejected |
| UX `.memlog.md` still lists the Paramètres tab (blind) | false | The memlog is a dated working log, not a rule; `EXPERIENCE.md` is the rule and changed. | rejected |

## Design Notes

Why « Désactiver » sits in this menu although Sure puts it only in the accounts-list row menu: the epic's acceptance criterion names it, and Spec 1.6 refused a row menu on `/accounts`; this menu becomes the one place for every account action.

Why the refusal lives in `services/accounts.ts` and not the ledger: `ledger.deleteAccount` is also the contract its own spec tests against a linked account (`ledger.spec.ts:8151`), and Sure's check sits in the controller, not the model.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm test` -- expected: green.
- `pnpm test:e2e` -- expected: green.
