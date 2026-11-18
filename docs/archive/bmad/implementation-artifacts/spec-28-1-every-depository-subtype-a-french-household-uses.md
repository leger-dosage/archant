---
title: 'Story 28.1: Every depository subtype a French household uses'
type: 'feature'
created: '2026-10-14'
status: 'done'
baseline_commit: 'b554b2139d0b7c7fd98d13266de786cab8a0c1da'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A depository account is only `checking` or `savings`, and its subtype is mandatory; Sure's `Depository::SUBTYPES` also has `cash`, `cd` and `money_market`, and its form saves no subtype through `include_blank` « Aucun » (Sure `00dd977fb`).

**Approach:** `ACCOUNT_TYPES.depository` lists Sure's subtypes less `hsa` in Sure's order and admits a null subtype; the database check, the API, the dialogs, the labels and the export follow.

## Boundaries & Constraints

**Always:**
- Subtypes in Sure's order: `cash`, `checking`, `savings`, `cd`, `money_market`. Labels « Espèces » (`cash`, no key in Sure's `fr.yml`, French a user expects), « Compte courant » and « Épargne » as today, « Certificat de dépôt » and « Marché monétaire » (Sure's `depositories.subtypes.*.long`).
- A null subtype is legal for `depository` only; every other type keeps its rule. `isSubtypeOf("depository", null)` is true, as Sure's `allow_blank`.
- Schema: `accounts_subtype_check` admits `subtype is null` for depository; migration 0073 by `pnpm data generate` (table rebuild, as 0064); no data step, every existing row stays valid.
- Interface: one new kind for the empty subtype, labelled « Liquidités » (Sure's `accounts.types.depository`) wherever an account's kind is shown and in the creation dialog's flat « Type » list; the edit dialog labels the same choice « Aucun » (Sure's `depositories.form.none`) and lists it first, as Rails' `include_blank`. The creation default stays « Compte courant », Sure's `DEFAULT_SUBTYPE`.
- Export: the subtype, null included, goes to `subtype`, `accountable.subtype` and `archant.subtype` unchanged.
- Classification stays the type's: the new subtypes and the empty one are assets in the depository group on the accounts page, the dashboard and `get_accounts`.

**Never:** no `hsa`; no change to `BANK_ACCOUNT_TARGETS` or `CASH_ACCOUNT_TYPE_MAP` (Sure maps `CASH` to checking and `MOMA` to savings); no stepwise creation (Story 28.16); no subtype in `get_accounts` (Sure has none); no change to goal eligibility, which reads the type.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create cash | `POST /api/accounts` depository `cash` | 201, listed as « Espèces » | none |
| Create blank | depository, `subtype: null` | 201, listed as « Liquidités » | none |
| Edit to blank | checking account, edit dialog « Aucun » | subtype null | none |
| Blank elsewhere | loan, `subtype: null` | nothing written | 400 `invalid_subtype` |
| Unknown | depository `hsa` | nothing written | 400 `invalid_subtype` |
| Export | depository `cd` and a null one | `cd`, then null, in all three places | none |

</frozen-after-approval>

## Code Map

- `packages/data/account-types.ts:13,67-71` -- `ACCOUNT_TYPES.depository` (subtypes and a flag for an optional subtype), `isSubtypeOf`. `ACCOUNT_SUBTYPES` derives itself.
- `packages/data/schema/accounts.ts:44-55` -- check generator: an optional-subtype type emits `(type = 'depository' and (subtype is null or subtype in (...)))`.
- `packages/data/drizzle/0073_*.sql` -- generated; `packages/data/migrate.spec.ts` (see the 0064 test near line 903) pins it.
- `packages/api/src/schemas/accounts.ts:38,288-312,368-391` and `services/accounts.ts:230` -- already route through `isSubtypeOf`/`ACCOUNT_SUBTYPES`; the edit form's `z.enum(ACCOUNT_SUBTYPES).nullable()` at 391 already sends null. No change expected.
- `packages/app/src/lib/account-kinds.ts` -- add kinds `depository` (null), `cash`, `cd`, `money_market`, depository kinds in the order above. `kindOf` keeps its fallback.
- `packages/app/src/components/EditAccountDialog.tsx:109,178-208` -- label the null kind « Aucun ».
- `packages/app/src/components/CreateAccountDialog.tsx:54,151-183` -- unchanged except through `ACCOUNT_KINDS`.
- `packages/app/src/locales/fr.json:135-157` -- `accounts.subtypes.{depository,cash,cd,money_market}`; « Aucun » key under `accountActions.form`.
- Labels read through `kindOf` in `AccountGroups.tsx:68`, `AppShell.tsx:203`, `BalanceSheetSection.tsx:87`, `routes/_authed.accounts.$accountId.tsx:634` -- no change needed once the kinds exist.
- `packages/api/src/services/export.ts:231-233,483,795-816` -- `sureSubtype` passes the value through; `testing/sure-preflight.ts:42,740` already admits these values.
- Tests: `packages/data/account-types.spec.ts:33,56-97` (asserts null refused today), `packages/app/src/lib/account-kinds.spec.ts`, `packages/api/src/routes/accounts.spec.ts:122-170,606-660`, `packages/api/src/services/export.spec.ts`, `packages/app/e2e/accounts.spec.ts`, `packages/app/e2e/manage-accounts.spec.ts:63-89`.
- `docs/sure-parity.md:61` -- the Depository row becomes Parity, `hsa` stays Different.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/account-types.spec.ts`, `packages/data/migrate.spec.ts`, `packages/api/src/routes/accounts.spec.ts`, `packages/api/src/services/export.spec.ts`, `packages/app/src/lib/account-kinds.spec.ts` -- write the I/O matrix as failing tests first, plus a `get_accounts` case for a cash account (asset, `Depository`) -- test-first.
- [x] `packages/data/account-types.ts`, `packages/data/schema/accounts.ts` -- subtypes, optional flag, check clause; `pnpm data generate` -- one list drives API and database.
- [x] `packages/app/src/lib/account-kinds.ts`, `EditAccountDialog.tsx`, `locales/fr.json` -- kinds, « Aucun », labels.
- [x] `packages/app/e2e/accounts.spec.ts`, `manage-accounts.spec.ts` -- create « Espèces » through the dialog and find it under that label; switch a checking account to « Aucun » and read « Liquidités ».
- [x] `docs/sure-parity.md` -- update the row.

**Acceptance Criteria:**
- Given an existing database, when migration 0073 runs, then every account keeps its subtype and a later null depository insert succeeds.
- Given the edit dialog of a depository account, when the subtype list opens, then it reads « Aucun », « Espèces », « Compte courant », « Épargne », « Certificat de dépôt », « Marché monétaire ».

## Implementation Notes

- `admitsNoSubtype` in `packages/data/account-types.ts` serves both `isSubtypeOf` and the check generator. Migration renamed `0073_depository_subtypes.sql`, journal tag updated.
- Two existing tests assumed a mandatory depository subtype: `migrate.spec.ts` now refuses `hsa`, `routes/accounts.spec.ts` refuses a loan without a subtype.
- QA on a built instance (port 8791, temporary database): accounts page, creation list, edit list and account page captured and checked.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence / route |
|-------|---------|---------|------------------|
| blind | « Liquidités » also names an investment's cash line (`trades.cash`, `positions.cash`) | low | Same meaning, liquid money, never on the same screen as a depository row; rejected. |
| blind | Sure's French `savings` is « Compte d'épargne », not « Épargne » | false | The frozen intent keeps « Épargne » as today. |
| blind | Sure's sidebar shows short labels « CD » and « MM » | low | Real departure, unrecorded; patched: recorded in `docs/sure-parity.md`. |
| blind | « (Spec 28.1) » citation form inconsistent | false | `docs/sure-parity.md` already cites « (Spec 1.6) », « (Spec 10.3) » and others. |
| blind, edge | 0073 test has no child row, so a cascade on `DROP TABLE` would go unseen | medium | Patched: an entry on `a1` is inserted before 0073 and read back after. |
| blind | No e2e creates a blank depository through the creation dialog | low | Covered by the API test and `kindOf`; a further e2e adds little; rejected. |
| blind | Default « Compte courant » not asserted | false | `e2e/accounts.spec.ts` existing creation test asserts the dialog's default. |
| blind | PATCH to `cash`, from blank, `hsa` untested | low | `isSubtypeOf` unit tests cover each value; the route calls it once; rejected. |
| blind | « Aucun » keyed on `subtype === null` could mislabel a future type | false | Only the depository has a null kind among several kinds today; speculative. |
| blind | `admitsNoSubtype` repeats the empty-list test in the generator | low | Cosmetic; rejected. |
| blind | Dashboard and sidebar untested for the new kinds | low | Group comes from the type, unchanged; labels shown in QA captures; rejected. |
| blind | `kindOf` falls back to « Compte courant » for an unknown pair | false | The database check refuses any unknown pair; pre-existing. |
| gap | none | — | — |

## Design Notes

« Liquidités » rather than Sure's French fallback: a null subtype shows `display_name`, whose `fr.yml` value is « Espèces », the label `cash` takes here, so two kinds would read alike. Sure's English shows "Cash" for both; the French user needs them apart.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all green, no tracked file changed after.

**Manual checks (if no CLI):**
- Screenshots of the creation list, the edit dialog list, and the accounts page with a cash and a blank depository account, looked at in self-review and QA.
