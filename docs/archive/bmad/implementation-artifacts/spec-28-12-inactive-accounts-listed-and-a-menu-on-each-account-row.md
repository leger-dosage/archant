---
title: 'Story 28.12: Inactive accounts listed, and a menu on each account row'
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_commit: 'bf21056423dd0b8140642ce336fee49f5565e45c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/accounts` hides an inactive account until the « Afficher les comptes inactifs » switch is on, then flags it with an « Inactif » badge, and a row is a bare link: deactivating, excluding or deleting an account means opening its page first. Sure `00dd977fb` lists inactive accounts among the others (`Account.listable_manual`, `accounts_controller.rb:12`), names and balances in `text-subdued` (`accounts/_account.html.erb:26,60`), with no hide toggle and a menu on every row.

**Approach:** Drop the switch and the `showInactive` search param; render every account of `GET /api/accounts` in its group, inactive ones muted; give each row, for an administrator, a menu with Sure's items, wording and order, reusing the account page's mutations and delete confirmation; add `linked` to the list's `AccountSummary` so the row knows whether to offer deletion.

## Boundaries & Constraints

**Always:**
- Inactive row as Sure's: the name and the balance in `text-muted-foreground`, the subtype caption unchanged; no visible badge. A visually hidden « inactif » follows the name, so the state is not carried by colour alone for a screen reader.
- Excluded row as Sure's l.28-32: the eye-off `ExcludedMarker` with « Exclu des rapports » right after the name, not before the balance; the balance muted only when the account is inactive. The accounts column and the dashboard keep `AccountBalance` as it is.
- Row menu, administrators only (`useIsAdmin()`), items as Sure's `accounts/_account.html.erb`, keys from `fr.accounts.account`, each with Sure's lucide icon:
  1. « Modifier » (`PencilLineIcon`) opens `EditAccountDialog`;
  2. separator, then « Désactiver le compte » (`ToggleRightIcon`) on an active account or « Activer le compte » (`ToggleLeftIcon`) on an inactive one;
  3. « Exclure de tous les rapports » (`EyeOffIcon`) or « Inclure dans les rapports » (`EyeIcon`);
  4. on an account with `linked: false` only, separator then « Supprimer le compte » (`Trash2Icon`), which opens the same confirmation as the account page's menu.
- Writes go through `PATCH /api/accounts/:id` (`active`, `excludedFromReports`) and `DELETE /api/accounts/:id`, already guarded by `viewerReadOnly`; no new route. Deactivating needs no confirmation, as Sure's `toggle_active`. The page menu's toasts are reused.
- The menu trigger sits beside the row's `Link`, never inside it, labelled `accountActions.menu` « Actions du compte {{name}} ». Its edit and delete data load only when chosen: the account's detail through `useAccount` for the dialog, the transaction count when the confirmation opens. No request per row on page load.
- `AccountSummary.linked`: `bankAccountId !== null`, the condition `deleteAccount` refuses on. `listAssistantAccounts` reads it instead of its own join; `get_accounts` output is unchanged.
- Group totals unchanged: inactive and excluded balances stay out of them.
- `docs/sure-parity.md` « Deactivate, exclude from reports » row to Parity; DESIGN.md states the inactive row and where the excluded marker sits.

**Never:** no change to the account page's `AccountMenu` items or wording (Sure's `accounts/show/_menu` differs, see Design Notes); no « Définir par défaut » (Story 28.13), no ordering (28.14), no institution after « • » (28.15); no change to the accounts column or the dashboard, which keep hiding inactive accounts as Sure's `visible`; no grouping by type nor per-provider cards; no unlink item.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Inactive listed | one inactive asset | listed by name in « Actifs », name and balance muted, no switch on the page | none |
| Old link | `/accounts?showInactive=true` | same page, every account listed | none |
| Deactivate from row | admin, active account, « Désactiver le compte » | row turns muted, menu now reads « Activer le compte », toast « Compte « X » désactivé. » | API error toast |
| Exclude from row | « Exclure de tous les rapports » | eye-off marker after the name, group total drops the balance | API error toast |
| Linked row | account fed by a bank | menu has no separator nor « Supprimer le compte » | `409 ACCOUNT_LINKED` if forced |
| Delete from row | unlinked, 3 transactions | « Supprimer le compte « X » et ses 3 opérations ? », then row gone | API error toast |
| Viewer | viewer opens `/accounts` | no « Actions du compte … » button | `PATCH`/`DELETE` refused `403` `FORBIDDEN` |

</frozen-after-approval>

## Code Map

- `packages/app/src/routes/_authed.accounts.index.tsx:19-21,63-77` -- `showInactive` in `validateSearch` and the `Switch` `#show-inactive`; both go.
- `packages/app/src/components/AccountGroups.tsx:14-73` -- `showInactive` prop and filter, the « Inactif » `Badge`, the inline row `<li><Link>`; becomes a row with a sibling menu.
- `packages/app/src/components/AccountMenu.tsx:44-160` -- the account page's menu: reuse `useUpdateAccount`, `useDeleteAccount`, the toasts and the `ConfirmDialog` with its count (`accountActions.delete.*`). Extract the confirmation into `DeleteAccountDialog.tsx` so both menus share it; its count query (`useAccountTransactions(id, 1)`, `hooks/useTransactions.ts:32`) runs only while open.
- `packages/app/src/components/EditAccountDialog.tsx:179,197` -- takes `AccountDetailData`; the row loads it with `useAccount` (`hooks/useAccount.ts:13`).
- `packages/app/src/components/AccountBalance.tsx`, `ExcludedMarker.tsx`, `Money.tsx:19-39` (`muted`) -- the row uses `ExcludedMarker` and `Money` directly.
- `packages/app/src/locales/fr.json:204-208,331-361` -- drop `accounts.showInactive`, and `accounts.inactive` if nothing else reads it; add `accounts.rowMenu` keys with Sure's texts and the hidden « inactif ».
- `packages/api/src/services/accounts.ts:41-55,104-125` -- `AccountSummary`, `summarise`, `listAccounts`; add `linked`.
- `packages/api/src/services/balances.ts:82-115` -- `AssistantAccount.linked` and the join it replaces.
- `docs/sure-parity.md:69`, `_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md` (money and excluded amounts).
- Tests to model on: `routes/accounts.spec.ts:2782` (« GET /api/accounts with inactive and excluded accounts »), `mcp/server.spec.ts` (`get_accounts` `is_linked`), `e2e/manage-accounts.spec.ts:194,250,329,362,389,450`, `e2e/viewer.spec.ts:58,224,240`, `e2e/bank-connections.spec.ts:792`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/routes/accounts.spec.ts` -- the list returns `linked` false for a manual account and true for a linked one, inactive accounts listed in their group by name; failing first. `mcp/server.spec.ts` keeps `is_linked` passing.
- [x] `packages/app/e2e/manage-accounts.spec.ts` -- rewrite :250 to deactivate from the row's menu, find the row muted on `/accounts` and gone from the accounts column, `/transactions` and the filter, then « Activer le compte » restores it; replace :329 by « an inactive account is listed with no switch »; :362 asserts the marker after the name; add a row-menu test for the item order and for « Exclure de tous les rapports » / « Supprimer le compte » from the row; a linked row offers no deletion (`bank-connections.spec.ts`); failing first.
- [x] `packages/app/e2e/viewer.spec.ts` -- `/accounts` has no « Actions du compte … » button.
- [x] `packages/api/src/services/accounts.ts`, `services/balances.ts` -- `linked` on the summary; the assistant reads it.
- [x] `packages/app/src/components/DeleteAccountDialog.tsx`, `AccountMenu.tsx` -- extract the confirmation, behaviour unchanged.
- [x] `packages/app/src/components/AccountRowMenu.tsx` -- the row menu as Boundaries say.
- [x] `packages/app/src/components/AccountGroups.tsx`, `routes/_authed.accounts.index.tsx`, `locales/fr.json` -- muted rows, marker, menu, toggle removed.
- [x] `docs/sure-parity.md`, DESIGN.md -- rows updated.

**Acceptance Criteria:**
- Given an administrator, when a row's menu opens, then its items read, in order, « Modifier », « Désactiver le compte » or « Activer le compte », « Exclure de tous les rapports » or « Inclure dans les rapports », and « Supprimer le compte » for an unlinked account.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass, and screenshots of `/accounts` with an inactive, an excluded and a linked account and an open row menu, light and dark, desktop and phone width, are reviewed.

## Implementation Notes

- `useAccount` and `useAccountTransactions` take an `enabled` option, so the row's edit dialog and the confirmation's count load only once chosen.
- The deactivate and exclude toggles and their toasts moved to `hooks/useAccountToggles.ts`, shared by both menus.
- The confirmation opens once the count is known, so its title never reads as an empty account while loading; an error since that opening closes it, the query cache having toasted it. The account page's menu item is no longer disabled while counting: its dialog waits instead, and the Opérations tab has usually cached the count.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Confirmation opens titled as an empty account before the count lands | medium | patch | `DeleteAccountDialog` showed `titleEmpty` while `count` was undefined, then retitled; now opens only once the count is known. |
| 2 | Confirm button disabled forever when the count query fails | medium | patch | `pending={count === undefined …}` with no error branch; an error since opening now closes the dialog, the QueryCache toasting it. |
| 3 | Count never refreshed after a failed delete | low | patch | `enabled: open && deleteAccount.isIdle` stayed false once the mutation errored; now `!isPending && !isSuccess`. |
| 4 | No test that the confirmation waits for the count | medium | patch | Removing the guard passed every test; `manage-accounts.spec.ts` now holds the count request and asserts no dialog until it answers. |
| 5 | Account page menu behaviour changed by the extraction | low | patch | Same root cause as 1; the page's item opens the dialog once its count is there, as before. |
| 6 | « Modifier » on a row does nothing when the detail fails | medium | patch | `useAccount` is `notFoundInline`, so no global toast and `editing` stayed true; now toasts and resets. |
| 7 | No feedback while the edit detail loads | low | reject | One cached-key request; the dialog appears when it answers, and a guard adds state for a delay rarely seen. |
| 8 | `setEditChosen(false)` on delete unexplained | low | patch | Contradicted its own comment; deleted. |
| 9 | Inactive and excluded together untested | low | reject | Two independent conditions each asserted; a combined test adds nothing a reader would meet. |
| 10 | Marker assertion tied to markup (`locator("p")`) | low | patch | Now asserts the link's accessible name, as the repo drives tests by role and name. |
| 11 | Rows with the same name share accessible names | low | reject | Pre-existing for the row links; only test fixtures repeat names. |
| 12 | `linked` after a disconnection untested | false | reject | `bank_accounts.bank_connection_id` cascades and `accounts.bank_account_id` sets null, so the column is the join; `mcp/server.spec.ts` covers both values. |
| 13 | « Activer le compte » toasts « réactivé » | low | reject | « réactivé » is the past of activating an account again; Sure shows no flash at all. |
| 14 | Parity row omits Sure's default items | low | patch | Row now names Story 28.13 for « Définir/Retirer par défaut ». |
| 15 | DESIGN.md Money bullet contradicts itself | low | patch | First sentence now scopes excluded amounts outside the accounts page. |
| 16 | Sprint status and spec status disagree | false | reject | Both move to `done` together at the end of the story. |
| 17 | `?showInactive=true` stays in the URL | low | reject | Harmless; the page ignores it and the old-link test proves it. |

## Design Notes

Sure's account page menu (`accounts/show/_menu.html.erb`) has no deactivate item and other entries (« Partage », « Relevés », imports); Spec 11.11 put « Désactiver » there on purpose. Aligning that menu is separate work, so the two menus word deactivation differently for now, as Sure's own two menus use different keys.

Sure's index total sums every account of a type, inactive and excluded included (`index/_account_groups.erb:24`); Archant's group total leaves them out, as the page always has. This story keeps it.

Sure's delete confirmation is the generic `CustomConfirm.for_resource_deletion("account")`, which names the resource in English; the row reuses Archant's, which counts the transactions it removes (Spec 11.11, Parity row « Delete an account »).

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
