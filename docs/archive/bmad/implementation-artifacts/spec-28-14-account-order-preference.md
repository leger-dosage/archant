---
title: 'Story 28.14: Account order preference'
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_commit: '77176232c770cb2fdf91db6c4d935af32c6ad47a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure lets each user choose, in « Réglages › Préférences », how account lists are ordered: `settings/preferences/show.html.erb` offers `AccountOrder::ORDERS` (`name_asc`, the default, `name_desc`, `balance_asc`, `balance_desc`) as « Ordre d'affichage des comptes par défaut », saved in `users.default_account_order` with an `inclusion` validation, and `BalanceSheet#sorted` orders every classification group by it, which the sidebar's account groups and the dashboard's balance sheet read. Archant has no preferences page and always sorts by name in `listAccounts`.

**Approach:** Store the order per user in `users.default_account_order`, `name_asc` by default; add `GET` and `PATCH /api/preferences` for the signed-in user; sort each classification group of `listAccounts` by the user's order, so the accounts page, the accounts column and the dashboard's balance sheet, which all read `GET /api/accounts`, follow it; add « Réglages › Préférences » with Sure's « Général » section and its select.

## Boundaries & Constraints

**Always:**
- The orders, in Sure's order, are one list, `ACCOUNT_ORDERS` in a new `packages/data/account-orders.ts`, with `DEFAULT_ACCOUNT_ORDER = "name_asc"`; the server's schema, the column's check and the select read it.
- Labels are Sure's `account_order.*.label` from `config/locales/models/account/fr.yml`: « Nom (A-Z) », « Nom (Z-A) », « Solde (de bas en haut) », « Solde (haut à bas) ». The field's label is Sure's « Ordre d'affichage des comptes par défaut », the section Sure's « Général », the page and nav item Sure's « Préférences », with Sure's `bolt` icon (`BoltIcon`), placed after « Banques » as Sure's nav puts it after « Synchronisation bancaire ».
- Sorting is Sure's `BalanceSheet#sorted`: name ascending or its reverse; balance ascending or its reverse. Balance is each account's own balance, as Sure's `account.balance`, compared in major units across currencies without conversion, exactly with integers (`BigInt` scaled by `minorUnitsOf`), never a float. Names compare with the existing French collator, as today. Ties fall back to name A-Z, then id, so the order is stable.
- `PATCH /api/preferences` with `{ defaultAccountOrder }` saves and answers the preferences; an unknown order is refused `400 VALIDATION_ERROR` with `fields: [{ path: "defaultAccountOrder", code: "invalid_value" }]`, as Sure's `inclusion`. A viewer is refused by `viewerReadOnly`. `GET /api/preferences` returns the signed-in user's `{ defaultAccountOrder }`.
- The column is `text not null default 'name_asc'` with a check over `ACCOUNT_ORDERS`; existing users read `name_asc`, today's order.
- The select saves on change, as Sure's `auto-submit-form`, then shows Sure's notice « Votre profil a été mis à jour. » and refetches the accounts.
- Inactive accounts keep their place in the order on the accounts page, as today's name order lists them among the others.

**Never:** no `?order=` parameter (Sure's `Orderable` concern serves only views Archant does not have); no other preference on the page (household preferences are Story 36.6, the dashboard period Story 34.3); no order in the export or the assistant's `get_accounts`; no change to the default account (28.13).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default | new or existing user | `name_asc`; groups sorted A-Z | none |
| Name desc | `name_desc` | each group Z-A | none |
| Balance asc | `balance_asc` | each group lowest balance first | none |
| Balance desc | `balance_desc` | each group highest balance first | none |
| Mixed currencies | 100,00 EUR and 50 JPY | compared as 100 and 50 | none |
| Tie | two equal balances | name A-Z between them | none |
| Unknown | `{ defaultAccountOrder: "random" }` | refused | `400 VALIDATION_ERROR` |
| Per user | two admins | each list follows its own user's order | none |
| Viewer | viewer `PATCH` | refused | `403 FORBIDDEN` |

</frozen-after-approval>

## Code Map

- `packages/data/account-orders.ts` (new), `packages/data/package.json` `exports` -- `ACCOUNT_ORDERS`, `AccountOrder`, `DEFAULT_ACCOUNT_ORDER`.
- `packages/data/schema/auth.ts:28-55` -- `users.defaultAccountOrder` with `users_default_account_order_check` (`inList`); migration by `pnpm data generate` (next is `0082`), a rebuild of `users` as `0044_allow_viewer_role.sql`.
- `packages/api/src/domain/account-order.ts` (new) -- `sortAccounts(accounts, order)`, pure; spec beside it.
- `packages/api/src/services/accounts.ts:116-141` -- `listAccounts(deps, order = DEFAULT_ACCOUNT_ORDER)` sorts each group with `sortAccounts` instead of `byName`.
- `packages/api/src/services/preferences.ts`, `schemas/preferences.ts`, `routes/preferences.ts` (new) -- read and save the user's preferences; mounted in `app.ts` beside `/members`.
- `packages/api/src/routes/accounts.ts:46-55` -- `listFor` reads the user's order and passes it.
- `packages/app/src/hooks/usePreferences.ts` (new), `lib/query-keys.ts` -- `usePreferences`, `useUpdatePreferences` (sets the query, invalidates `queryKeys.accounts.all`).
- `packages/app/src/routes/_authed.settings.preferences.tsx` (new), `components/SettingsNav.tsx`, `locales/fr.json` -- the page, the nav item, the words.
- Tests to model on: `routes/prices.spec.ts` (settings `PUT`), `routes/accounts.spec.ts` (list, viewer and second admin of Story 28.13), `e2e/default-account.spec.ts`, `e2e/viewer.spec.ts:562-590`.
- `docs/sure-parity.md:72` -- « Account ordering » to Parity for the order; `:40` « Preferences » names the new page.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/account-order.spec.ts` -- each order, mixed currencies, ties; failing first.
- [x] `packages/api/src/routes/preferences.spec.ts` -- default read, each order saved, unknown refused, viewer `403`; `routes/accounts.spec.ts` -- the list follows the saved order, per user; failing first.
- [x] `packages/app/e2e/account-order.spec.ts` -- open « Réglages › Préférences », pick « Solde (haut à bas) », check the notice and the accounts page's order, then the column's; reset to `name_asc` after. `viewer.spec.ts` -- `/settings/preferences` redirects a viewer.
- [x] `packages/data/account-orders.ts`, `schema/auth.ts`, migration -- data.
- [x] `packages/api/src/domain/account-order.ts`, `services/accounts.ts`, `services/preferences.ts`, `schemas/preferences.ts`, `routes/preferences.ts`, `routes/accounts.ts`, `app.ts` -- server.
- [x] `packages/app/src/hooks/usePreferences.ts`, `lib/query-keys.ts`, `routes/_authed.settings.preferences.tsx`, `components/SettingsNav.tsx`, `locales/fr.json` -- interface.
- [x] `docs/sure-parity.md` -- rows.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass, and screenshots of « Réglages › Préférences » with its open select and of `/accounts` in « Solde (haut à bas) », light and dark, desktop and phone width, are reviewed against Sure's `settings/preferences/show.html.erb`.

## Implementation Notes

- `drizzle-kit generate` wrote `0082_account_order.sql` copying `default_account_order` from the old `users`, which has none; the copy is fixed by hand so existing users take the column's default, with a comment saying why. `migrate.spec.ts` carries a user, their default account and session through it.
- Archant's `Section` has no subtitle slot, so Sure's « Configurez vos préférences » is a muted line at the top of the section's body.
- The API's order reaches only the account lists; every account picker goes through `accountsByName` (`packages/app/src/lib/account-list.ts`), by name within each class, as Sure's pickers are `alphabetically`.
- The e2e test fills the query cache first and reaches each page through the app's links, so it fails without the `accounts.all` invalidation.
- Screenshots of « Réglages › Préférences », closed and open, and of `/accounts` and the dashboard in « Solde (haut à bas) », light and dark, at 1440 and 390 px, were reviewed against Sure's `settings/preferences/show.html.erb`.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | No test carries an existing user through 0082's rebuild of `users` | medium | patch | `migrate.spec.ts` covered 0044 only; a dropped `default_account_id` or a wrong default would pass CI. A 0082 test now checks the default account, the session, `name_asc` and the check. |
| 2 | A demoted administrator keeps a saved order the docs say a viewer never has | low | patch | `listFor` reads the column whatever the role, as Sure's `BalanceSheet#sorted` reads the user's; the parity row and the route's comment now say a viewer cannot change it. |
| 3 | The route spec resets the order only at its end | low | patch | A failed assertion would leak the order to later tests of the shared database; resets moved to `finally`. |
| 4 | The liability group's order is never checked | low | patch | Only `groups[0]` was read; two liabilities are now checked under `balance_desc`. |
| 5 | Nothing proves a save refreshes cached lists | low | patch | Every e2e check began with a full load; the test now reaches `/accounts` through the app's link. |
| 6 | The dashboard's balance sheet is not checked end to end | low | patch | The story names it; the e2e now reads its order. |
| 7 | The parity row omits Sure's `accounts#index` name order | low | patch | Sure's settings accounts page lists manual accounts by name; the row now says Archant's grouped page follows the order as Sure's sidebar does. |
| 8 | Inactive accounts keeping their place is untested | low | reject | `sortAccounts` never reads `active`; no branch to test. |
| 9 | Name ties by id untested | low | reject | One `||` fallback already exercised by the balance tie test. |
| 10 | `PATCH` answers 200 for a deleted user | false | reject | Deleting a user cascades to its sessions, so `requireSession` refuses the request first. |
| 11 | The page has no description nor retry on a read error | low | reject | Sure's preferences page has no description; other settings pages show the same alert. |
| 12 | 0082 lacks a final newline and its comment is ambiguous | low | reject | drizzle-kit writes its files without one; the comment says the copy was written by hand. |
| 13 | The assistant's list relies on the default parameter | low | reject | `listAccounts`'s default is `DEFAULT_ACCOUNT_ORDER`, explicit in its signature. |
| 14 | Account pickers (transactions filter, rules, bills, a transaction's bill dialog, goals) followed the list order | medium | patch | They flattened `GET /api/accounts` without sorting; Sure's pickers are `alphabetically`. `accountsByName` in `packages/app/src/lib/account-list.ts`, with its spec, now sorts them by name within each class, as before. |
| 15 | A throwaway QA script was staged | low | patch | `git add -N` picked up `.agents/qa/28-14/shots.mjs`; removed from the index and the disk. |
| 16 | The parity row says ties by name only | low | patch | `sortAccounts` then falls back to id; the row says so and notes pickers stay by name. |
| 17 | The captures never show the open select | low | reject | The run's earlier captures show it open; the final ones show the saved value closed. |
| 18 | A save invalidates every account query, not just the list | low | reject | `accounts.all` is the prefix every account write invalidates; one cheap refetch on a rare save. |
| 19 | The order test sits in the default account's `describe` | low | reject | It reuses that block's second administrator and viewer, signed in once for the rate limit. |
| 20 | The 0082 test checks fewer tables than 0044's | low | reject | It checks the session and `pragma_foreign_key_check`; the rebuild statements match 0044's, whose test covers the other tables. |
| 21 | `account-orders.ts` says « no data migration » for a new value | false | reject | A new value rebuilds the check, which is a schema migration with no data change, as `user-roles.ts` says. |
| 22 | No optimistic update while saving | low | reject | Sure's form waits for its redirect; the select is disabled for the round trip. |
| 23 | No test for an empty or non-JSON body | low | reject | `validated` and its own specs cover those for every route. |
| 24 | The e2e does not check liabilities | low | reject | The route spec checks the liability group in both balance orders. |
| 25 | `PATCH` answers 200 for a deleted user | false | reject | As row 10. |
| 26 | Toasts lost if the page unmounts mid-save | low | reject | The pattern of every settings page; the save still lands. |
| 27 | Error alert beside a cached select after a failed refetch | low | reject | Needs the server to fail while the page stays open; harmless. |
| 28 | The assistant's list relies on the default parameter | low | reject | As row 13. |
| 29 | The mixed-currency test cannot tell exact from naive comparison | false | reject | 75.500 KWD (75500 minor) sorts before 100,00 EUR (10000 minor) only when scaled; the test expects it. |

## Design Notes

Assumptions taken alone, each settled by Sure. Sure saves through `PATCH /users/:id`; Archant's users live in Better Auth, whose update endpoint should not take an app setting, so the preference gets its own `/api/preferences`, which Story 34.3's `default_period` can join. Sure compares `account.balance`, a decimal in the account's currency, without conversion; Archant compares the same major units exactly with integers. Sure's `sort_by` leaves ties unspecified; Archant breaks them by name for a stable list. Sure's name sort is byte order; Archant keeps its French collator, so « éco » does not land after « Z ». Sure lets every member save preferences; Archant's viewer writes nothing (AD-21) and keeps the default order, as Story 34.3 decides for `default_period`, until Story 36.2 brings Sure's roles. Sure's `accounts#index` lists manual accounts by name whatever the preference; the story asks the accounts page to follow it, and Archant's accounts page is Sure's grouped balance sheet list, so it follows `BalanceSheet#sorted`.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
