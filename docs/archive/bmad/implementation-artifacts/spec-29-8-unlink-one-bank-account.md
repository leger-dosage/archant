---
title: "Story 29.8: Unlink one bank account"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: '39140ef57d0b872b88c6b1fd01c454caa2f5c71c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-29-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) offers « Délier du fournisseur » in a linked account's row menu (`accounts/_account.html.erb`, administrators only). It opens `accounts/confirm_unlink.html.erb`, « Délier le compte du fournisseur ? », which names the account and its provider, lists four warnings under « Ce que cela signifie » and ends on « Confirmer et délier ». `AccountsController#unlink` (`DELETE /accounts/:id/unlink`, refused by `ensure_linked_account` for an account no provider feeds) destroys the account's `account_providers` rows and nothing else: the account keeps every entry and balance and becomes manual, the provider account survives and is offered for linking again, and the item and its other accounts keep syncing. The notice reads « Compte délié avec succès. C'est maintenant un compte manuel. » Archant only unlinks every account at once by disconnecting the bank.

**Approach:** A route `DELETE /api/accounts/:id/unlink` runs the ledger's existing `unlinkBankAccount` on one account, under its connection's sync lease. The row menu on `/accounts` offers « Délier du fournisseur » on a linked account, opening Sure's dialog; the toast is Sure's.

## Boundaries & Constraints

**Always:**
- `unlinkAccount(deps, accountId)` in `services/bank-connections.ts`: an unknown account answers `404 NOT_FOUND`; an account no bank account feeds answers `409 ACCOUNT_NOT_LINKED`, Sure's `not_linked`. Otherwise it takes the connection's lease, as `disconnectConnection` does, so a running sync answers `409 SYNC_IN_PROGRESS` and no sync writes into the account while it turns manual; it calls `unlinkBankAccount(deps, id, { origin: "user" })` and releases the lease, on failure too. It answers `{ id }`.
- The lease taken by `disconnectConnection` and by the unlink is one helper, so both refuse the same way.
- The bank account row stays, with its connection. Nothing of the account is deleted: its entries, valuations, keys and the connection id on its lines stay. The next sync of the connection no longer reads it, since `runSync` reads only bank accounts an account is linked to; `listBankAccounts` offers it again with its candidates, the unlinked account among them, and linking it again resets its window as any link does.
- The connection's `last_synced_at`, `last_error` and every other account are untouched.
- The route sits in `routes/accounts.ts`, `DELETE`, so `viewerReadOnly` refuses a viewer (AD-21); no role check of its own.
- Row menu (`AccountRowMenu`), shown to an administrator only as today: on a linked account, « Délier du fournisseur » with Lucide's `unlink` icon right after « Modifier », as Sure's order (« Partage » has no counterpart); never on a manual account.
- Dialog (`UnlinkAccountDialog`): title « Délier le compte du fournisseur ? »; description « Vous êtes sur le point de délier **<name>** de **Enable Banking**. Cela le convertira en compte manuel. »; a warning box titled « Ce que cela signifie » listing Sure's four warnings in Sure's order (`warning_no_sync`, `warning_manual_updates`, `warning_transactions_kept`, `warning_can_delete`); one full-width button « Confirmer et délier »; the close button closes it. On success, the toast « Compte délié avec succès. C'est maintenant un compte manuel. » and the dialog closes; on failure, the error's translated toast and the dialog stays.
- After the unlink, the client refreshes the account lists, the account, its transactions and the bank connection queries.
- `ACCOUNT_NOT_LINKED` gets its French text, Sure's « Le compte n'est pas lié à un fournisseur. »
- `docs/sure-parity.md` « Disconnect » states the per-account unlink; AD-8 names the unlink beside the disconnection.

**Never:** no change to `unlinkBankAccount`'s balance handling (Story 29.10 computes the account forward); no relink from the account's menu (Sure's « Lier avec un fournisseur » is not in this story); no unlink on the account page's own menu, which Sure's `accounts/show/_menu` does not offer; no session revocation; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unlink | linked checking account of a connection feeding two | `{ id }`; account manual, lines and balances kept; card still linked | none |
| Sync after | same connection synced again | card read and ingested; checking not read; its bank account listed unlinked with candidates | none |
| Relink | link the bank account to the account again | linked, window reset | none |
| Manual account | `DELETE /:id/unlink` | refused | `409 ACCOUNT_NOT_LINKED` |
| Unknown id | `DELETE /:id/unlink` | refused | `404 NOT_FOUND` |
| Running sync | lease held | refused, account still linked | `409 SYNC_IN_PROGRESS` |
| Viewer | `DELETE /:id/unlink` | refused | `403 FORBIDDEN` |
| Menu, manual | row menu | no « Délier du fournisseur » | none |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/bank-connections.ts` -- `unlinkAccount`; the lease helper shared with `disconnectConnection`.
- `packages/api/src/routes/accounts.ts` -- `DELETE /:id/unlink`.
- `packages/api/src/lib/errors.ts` -- `ACCOUNT_NOT_LINKED: 409`.
- `packages/app/src/hooks/useAccounts.ts` -- `useUnlinkAccount`.
- `packages/app/src/components/AccountRowMenu.tsx`, `components/UnlinkAccountDialog.tsx` (new), `locales/fr.json` -- menu item, dialog, toast, error text.
- `packages/app/e2e/bank-connections.spec.ts` -- unlink one account of a connection; the existing row-menu test gains the item.
- Specs: `services/bank-connections.spec.ts` or `routes/accounts.spec.ts` beside the code they test, `services/sync.spec.ts` for the sync after.
- Docs: `docs/architecture.md` AD-8; `docs/sure-parity.md` « Disconnect ».
- Sure, read-only, at `00dd977fb`: `app/controllers/accounts_controller.rb` (`confirm_unlink`, `unlink`, `ensure_linked_account`), `app/views/accounts/confirm_unlink.html.erb`, `app/views/accounts/_account.html.erb`, `config/locales/views/accounts/fr.yml`.

## Tasks & Acceptance

**Execution:**
- [x] Vitest first, failing: unlink of one account of two keeps its lines and balances and leaves the other linked; a sync after it reads only the other; `listBankAccounts` offers the bank account again; refusals (`ACCOUNT_NOT_LINKED`, `NOT_FOUND`, `SYNC_IN_PROGRESS` with the account still linked, viewer `FORBIDDEN`); the lease released after an unlink so a sync can run.
- [x] Service, lease helper, route, error code.
- [x] Hook, row menu item, dialog, locale strings.
- [x] Playwright: unlink one account of a connection from `/accounts`; the existing row-menu test lists the new item.
- [x] AD-8 and the parity row.

**Acceptance Criteria:**
- Given a linked account, when the administrator opens its row menu, then it offers « Délier du fournisseur », which opens « Délier le compte du fournisseur ? » with Sure's four warnings and « Confirmer et délier ».
- Given the confirmation, when the account is unlinked, then it is a manual account with its lines, the toast reads « Compte délié avec succès. C'est maintenant un compte manuel. », the connection and its other accounts keep syncing, and the bank account is offered for linking again.
- Given a manual account, when its menu opens, then it offers no unlink.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass with no request reaching Enable Banking.

### Review Findings

Second pass, `bmad-code-review` (four layers) over the committed branch.

- [x] [Review][Patch] `deleteAccount`'s comment still justified the refusal by a bank account « offered for linking again », what the unlink now does on purpose [packages/api/src/services/accounts.ts]
- [x] [Review][Patch] The parity row « Delete an account » said the account menu leads to the bank to disconnect, omitting the row menu's unlink [docs/sure-parity.md]
- [x] [Review][Patch] The dialog could be closed while the unlink ran, its error toast then landing on no dialog [packages/app/src/components/UnlinkAccountDialog.tsx]
- [x] [Review][Patch] The row-menu end-to-end test's title still said the menu offers no unlink-like action; the query keys' comment omitted `list` [packages/app/e2e/bank-connections.spec.ts, packages/app/src/lib/query-keys.ts]
- [x] [Review][Defer] Unlinking a connection's last account leaves `runSync` returning before it stamps `last_synced_at`, so the « synchronisation arrêtée » banner shows after 48 hours — deferred: the same holds today for a connection whose accounts are all deactivated or skipped; stamping an empty run waits for Story 29.9, which removes the hour between two syncs that an empty stamp would impose on the next link

Rejected:
- `false` Spec `done` while sprint status reads `review`: both read `done` at the workflow's end, in this pull request.
- `false` The menu reopened before the list refreshes still offers the unlink: `useUnlinkAccount` awaits the invalidations before `mutateAsync` resolves and the toast shows.
- `false` `{ origin: "user" }` presented as meaningful: it is the ledger's calling convention, as every other ledger call passes one.
- `low` « d'Enable Banking » where the frozen description reads « de »: French elision before a vowel, as a French reader expects; Sure's own sentence interpolates a raw identifier.
- `low` `ACCOUNT_LINKED` now says to unlink while the account page's menu still leads to the disconnection: already deferred with that menu.
- `low` `ACCOUNT_LINKED`'s wording changed outside the frozen scope: Sure's `cannot_delete_linked`, now that unlinking exists.
- `low` A relink elsewhere within the lease's milliseconds answers `SYNC_IN_PROGRESS`, untested: a race no interface can produce; the comparison is one line.
- `low` The re-read comment names a concurrent unlink, which the re-read itself refuses with `ACCOUNT_NOT_LINKED`: the comment says the link may have changed, which is what both cases are.
- `low` An `ACCOUNT_NOT_LINKED` or `NOT_FOUND` answer does not refresh the list: only another tab or a disconnection meanwhile produces it, and the next visit refreshes.
- `low` `linkBankAccounts` takes no lease: pre-existing, and it refuses a bank account already taken.
- `low` The end-to-end check of the bank accounts' refresh would also pass past the 30-second stale time: the run takes a few seconds; pinning the browser clock for one assertion costs more than it proves.
- `low` The sync test's two filters overlap and do not check the unlinked account's balances: the account's bank account is never read, which the request filter proves.

## Design Notes

Assumptions taken alone, each settled by Sure. The route is Sure's own, `DELETE /accounts/:id/unlink`. The dialog names the provider « Enable Banking »: Sure interpolates its adapter's `provider_name`, the raw `enable_banking`, which no French user should read. Sure's dialog has no cancel button, only its close button, kept as is. The unlink takes the connection's sync lease: Sure has no lease, but in Archant a sync running meanwhile would write the bank's anchor back onto the account it just unlinked. The toast is a success toast, Sure's `notice`. The account stays on `/accounts`, where Sure redirects. The balances follow today's `unlinkBankAccount`, the one a disconnection uses; Story 29.10 makes both compute forward.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | The second `feedingConnection` read under the lease discards its result, so a relink elsewhere meanwhile runs the unlink under the wrong lease; its comment names a disconnection the lease already excludes | low | patch | The re-read id is now compared with the leased connection, refused `SYNC_IN_PROGRESS` when it differs; the comment names the concurrent unlink or relink. |
| 2 | A disconnection finishing between the first read and the lease answers `SYNC_IN_PROGRESS` rather than `ACCOUNT_NOT_LINKED` | low | reject | Only the error code of a race of milliseconds; the account is manual either way, and the toast is accurate enough. |
| 3 | `ACCOUNT_LINKED` still tells to disconnect the whole bank, while unlinking the account now suffices | medium | patch | The French and API messages are now Sure's `cannot_delete_linked`, « Impossible de supprimer un compte lié. Veuillez d'abord le délier. » |
| 4 | The account page's own menu still offers « Déconnecter … pour supprimer ce compte » | low | defer | Pre-existing Archant item that Sure's `accounts/show/_menu` lacks; the spec keeps the account page out. |
| 5 | The dialog unmounts without its closing animation once the refreshed list says the account is manual | low | patch | Mounted flag set when chosen, as `editMounted`. |
| 6 | No test of the failure path keeping the dialog open | low | patch | Playwright answers the first confirm `409 SYNC_IN_PROGRESS`, checks the toast and the open dialog, then confirms. |
| 7 | `toHaveURL(/\/accounts$/u)` proves nothing, the test never left `/accounts` | low | patch | Removed. |
| 8 | The final sync's block does not show the unlinked account untouched | low | patch | It now checks the balance and the manual menu after the sync. |
| 9 | The invalidation of the connection's bank accounts is unproven, the test reloading the page | low | patch | The connection page is cached first and reached again by in-app navigation. |
| 10 | No sync after a relink proving the kept lines are recognised by their keys | low | reject | Linking an account whose lines carry keys is covered by the existing relink and reconnection tests; nothing here changes key matching. |
| 11 | No test that the re-read under the lease refuses a concurrent unlink | low | reject | A concurrent second unlink only changes the code answered; the patched comparison is one line. |
| 12 | Spec `in-review` while sprint status reads `in-progress` | false | reject | Both move to `done` at the workflow's end, in this pull request. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
