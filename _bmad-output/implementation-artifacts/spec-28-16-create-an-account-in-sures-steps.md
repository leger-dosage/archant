---
title: "Story 28.16: Create an account in Sure's steps"
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_commit: '3e8fbc76dd3fc22f22c5441657cbffdfb6d2196e'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure creates an account in steps: `accounts/new.html.erb` lists the types, each with its icon and colour (« Que voulez-vous ajouter ? »); `accounts/new/_method_selector.html.erb` then asks « Comment voulez-vous l'ajouter ? » with « Saisir le solde du compte » and, for a type Enable Banking links, « Lier avec Enable Banking »; then the type's own `new.html.erb` opens its form under its own title, and a property walks « Vue d'ensemble », « Valeur », « Adresse » with « Suivant ». Archant has one dialog with a type select. Its creation also lacks the « Exclure de tous les rapports » switch that Sure's form holds in « Détails supplémentaires », left out by Story 28.15 for this story.

**Approach:** Rebuild `CreateAccountDialog.tsx` as Sure's steps, client-side in one dialog over one form: types, method, then the type's form; the property's three steps before one `POST`. A pure module holds the step order so Vitest covers it. `POST /api/accounts` takes `excludedFromReports`, and the creation disclosure gets the switch.

## Boundaries & Constraints

**Always:**
- Types in Sure's `accounts/new.html.erb` order: depository, investment, crypto, property, vehicle, credit card, loan, other asset, other liability. Each row is the type's `TintedIcon` (`ACCOUNT_TYPE_TINTS`, DESIGN.md's tokens for Sure's colours), its name as Sure's `accounts.types` (« Liquidités », « Investissement », « Cryptomonnaie », Archant's word, « Bien immobilier », « Véhicule », « Carte de crédit », « Prêt », « Autre actif », « Autre passif ») and a chevron. Title « Que voulez-vous ajouter ? ».
- Method step only where Sure's type view renders it: depository, investment, crypto, credit card, loan. Title « Comment voulez-vous l'ajouter ? », a back arrow to the types, « Saisir le solde du compte » (keyboard icon), and for depository and credit card, Sure's `EnableBankingAdapter.supported_account_types`, « Lier avec Enable Banking » (link icon), Sure's `link_with_provider`, which closes the dialog and opens `/settings/banks`, where Archant starts the Enable Banking flow. Property, vehicle, other asset and other liability go straight to their form, as Sure's views ignore `step=method_select` for them (no valuation provider in Archant).
- Type and method lists take ↑/↓ (and Sure's `j`/`k`) between rows, and show Sure's container footer from `md` up: « Sélectionnez ↵ », « Naviguer ↑ ↓ », « Fermer » with `ESC`.
- The form's title is Sure's `<type>.new.title`: « Saisir le solde du compte » (depository, investment, crypto), « Saisir les détails de la carte de crédit », « Saisir les détails du prêt », « Saisir les détails du véhicule », « Saisir les détails de l'actif », « Saisir les détails de la dette »; property « Saisir les détails de la propriété », then « Saisir la propriété manuellement » on « Valeur » and « Adresse ». A back arrow returns to the previous step.
- Field order as Sure's `accounts/_form`: « Nom du compte », « Devise » and « Solde à la date : », « Date du solde d'ouverture » (two years ago), then the type's own fields (subtype select for depository, investment and crypto, defaulting to « Aucun » as Sure's `include_blank`; crypto's tax treatment; card, vehicle and loan details, the loan's subtype required with Sure's prompt « Sélectionner le type de prêt »), then « Détails supplémentaires » with the institution, the notes and, last, « Exclure des rapports ». The other asset notice comes first, as Sure's `other_assets/new`.
- Property: Sure's left tabs « Vue d'ensemble », « Valeur », « Adresse », the current one marked (`aria-current="step"`), an earlier one clickable. « Vue d'ensemble »: « Nom », « Type de propriété » required with prompt « Sélectionnez le type », year built and area. « Valeur »: « Devise », « Valeur marchande estimée », and « Date du solde d'ouverture » (kept reachable). « Adresse »: the address fields, then « Détails supplémentaires ». « Suivant » checks the step's fields before moving; the last step posts. A refusal from the API opens the step holding the first refused field.
- Choosing a type starts that type's values afresh; going back within a type keeps what was typed.
- `POST /api/accounts` accepts optional `excludedFromReports` (boolean, default `false`), stored on the new account; anything else refused `400`.
- Every field the single dialog had stays reachable.

**Never:** no account import row (Archant has no account import, Sure's `AccountImport`); no `classification` filter (Archant's opener has none); no valuation provider step; no draft account (one `POST` at the end, so no half-made account); no change to the edit dialog beyond sharing the exclusion switch; no Zillow/Redfin tooltip on the property value; no change to `BANK_ACCOUNT_TARGETS`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Depository | type, « Saisir le solde du compte », name, balance | created, subtype null, listed « Liquidités » | none |
| Link | depository, « Lier avec Enable Banking » | dialog closed, `/settings/banks` | none |
| Vehicle | type | form at once, « Saisir les détails du véhicule » | none |
| Investment | type | method step without the link | none |
| Back | method step, back | types | none |
| Property | overview → Suivant without name | stays, name refused | field message |
| Property refusal | API refuses `openingBalance` on « Adresse » | « Valeur » opens with the message | field message |
| Excluded | switch on | account `excludedFromReports: true` | none |
| Excluded not boolean | `excludedFromReports: "yes"` | refused | `400 VALIDATION_ERROR` |
| Loan without subtype | no subtype chosen | refused before sending | « invalid_subtype » message |

</frozen-after-approval>

## Code Map

- `packages/app/src/lib/account-creation.ts` (new) -- `NEW_ACCOUNT_TYPES`, `hasMethodStep`, `linksBank`, the `CreationStep` union, `stepAfterType`, `previousStep`, `PROPERTY_STEPS`, `propertyStepOfField`; spec beside it.
- `packages/app/src/components/CreateAccountDialog.tsx` -- the steps; `AccountTypeStep`, `MethodStep` and `PropertySteps` as local components or small files beside it; form defaults per type replace the all-types resolver.
- `packages/app/src/components/AccountSubtypeSelect.tsx` (new) -- the subtype select of `EditAccountDialog.tsx:333-384`, shared with creation, with Sure's prompt for a required subtype.
- `packages/app/src/components/AccountAdditionalDetails.tsx` -- `ExcludedFromReportsSwitch`, shared by both dialogs.
- `packages/app/src/components/PropertyDetailsFields.tsx` -- split into overview and address parts for the steps; the edit dialog renders both.
- `packages/api/src/schemas/accounts.ts:727` -- `excludedFromReports: z.boolean().optional()` on creation.
- `packages/api/src/services/ledger/accounts.ts:26-64` -- `NewAccountInput.excludedFromReports`.
- `packages/app/src/locales/fr.json` -- titles, method options, type names, footer, property steps.
- Tests to update: every creation in `e2e/accounts.spec.ts`, `account-details.spec.ts`, `trades.spec.ts:419`, `serving.spec.ts:98`, `proportions.spec.ts:658`, `shell.spec.ts:259`, `dashboard.spec.ts:79,419`; a shared helper `e2e/new-account.ts`.
- `docs/sure-parity.md:73` -- « Account creation wizard » to Parity.
- Sure, read-only at `~/github/sure`: `app/views/accounts/new.html.erb`, `accounts/new/_container.html.erb`, `accounts/new/_method_selector.html.erb`, `accounts/_account_type.html.erb`, `accounts/_form.html.erb`, each type's `new.html.erb` and `_form.html.erb`, `properties/_form_tabs.html.erb`, `_overview_fields.html.erb`, `balances.html.erb`, `address.html.erb`; words in `config/locales/views/**/fr.yml`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/lib/account-creation.spec.ts` -- order, method step and link per type, back from each step, property step order, field-to-step routing; failing first.
- [x] `packages/api/src/routes/accounts.spec.ts` -- create with `excludedFromReports: true` reads back excluded; a non-boolean refused; failing first.
- [x] `packages/app/e2e/new-account.ts` (new) and `e2e/account-steps.spec.ts` (new) -- types listed in order, back, link to `/settings/banks`, a depository, a credit card and a property created through the steps, the property's « Suivant » check and a refusal reopening « Valeur », the exclusion switch.
- [x] `packages/api/src/schemas/accounts.ts`, `services/ledger/accounts.ts` -- server.
- [x] `packages/app/src/lib/account-creation.ts`, `components/CreateAccountDialog.tsx`, `AccountSubtypeSelect.tsx`, `AccountAdditionalDetails.tsx`, `PropertyDetailsFields.tsx`, `EditAccountDialog.tsx`, `locales/fr.json` -- interface.
- [x] Existing e2e creations moved to the steps.
- [x] `docs/sure-parity.md` -- row.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass, and screenshots of the type list, the method step, a depository form, a credit card form and each property step, light and dark, desktop and phone width, are reviewed against Sure's `accounts/new.html.erb`, `accounts/new/_method_selector.html.erb` and `properties/new.html.erb`.

## Design Notes

Assumptions taken alone, each settled by Sure. The link option reads « Lier avec Enable Banking », Sure's rendered `link_with_provider`, not the unused `connected_entry_eu` the epic quoted, and shows for depository and credit card only, Sure's adapter list. It leads to `/settings/banks`, Archant's place for Sure's `new_enable_banking_item` modal. Property, vehicle and the two other types skip the method step, as Sure's views do. The steps live in the browser and post once: Sure's property draft exists because each of its steps is a server page; one `POST` keeps Archant's single creation path and leaves no half-made account. The property's « Valeur » step keeps « Date du solde d'ouverture » so the opening date stays reachable, as the story requires. A form step gets a back arrow, since in Sure the browser's back button walks its pages and Archant's dialog has no history. « Nom de compte d'exemple », Sure's name placeholder, reads as a mistranslation, so the field has none; « Zone (facultatif) » becomes Archant's « Surface habitable ». Subtype labels keep Archant's « Type », the word its edit dialog already uses. The submit keeps « Ajouter le compte », since the click creates the account.

## Implementation Notes

- The form step drops « Annuler », as Sure's forms have none; the dialog closes with its cross, `Escape`, or « Fermer » in the list steps' footer. The orphaned `accounts.form.cancel` key is gone.
- A depository now starts with no subtype, « Aucun », Sure's `include_blank`; the single dialog started on « Compte courant ».
- The creation name field is Sure's « Nom du compte », so the e2e tests reach it by that label; `e2e/new-account.ts` opens the dialog and walks to a type's form, and every test that created an account through the dialog uses it.
- The footer's « Fermer » is a small ghost button: `proportions.spec.ts` refuses a control under 28 px, where Sure's is a bare text button.
- A refusal opens the earliest property step holding a refused field, in the form's order, and focuses the refused field.
- Screenshots of the type list, the method step, the depository form with « Détails supplémentaires » open, the credit card form, each property step and the vehicle form, light and dark, at 1440 and 390 px, were reviewed against Sure's `accounts/new.html.erb`, `accounts/new/_method_selector.html.erb`, `accounts/_form.html.erb` and `properties/new.html.erb`.

### Review Findings

- [x] [Review][Patch] An empty required subtype read « Type de compte invalide. » rather than a presence message [packages/app/src/components/AccountSubtypeSelect.tsx]
- [x] [Review][Patch] A refusal that reopened a property step focused its first field, not the refused one [packages/app/src/components/CreateAccountDialog.tsx]
- [x] [Review][Patch] Sure's ← and → hotkeys were missing from the type and method lists [packages/app/src/components/AccountCreationChoices.tsx]
- [x] [Review][Patch] The e2e helper read the method-step types from the code it tests [packages/app/e2e/new-account.ts]
- [x] [Review][Patch] The keyboard handler's start from a control that is not a row, and a modified key, had no test [packages/app/e2e/account-steps.spec.ts]
- [x] [Review][Patch] `accounts.form.cancel` left unused [packages/app/src/locales/fr.json]

Rejected:
- « Exclure des rapports » against Sure's « Exclure de tous les rapports » (low): the word Archant's edit dialog already uses for the same switch, kept since Story 28.15.
- The bank link shown though Enable Banking may be unset (false): Sure's `can_connect_enable_banking?` is always true, so Sure always shows it; « Banques » then says what is missing.
- The chosen type not carried to « Banques » (low): Sure's `accountable_type` only presets its setup screen; Archant picks each bank account's type on the connection's page.
- A root error on `details` would be silent (false): the form always sends its type's complete details, so the resolver never raises one.
- A double-click on « Suivant » in « Valeur » could post from « Adresse » (low): every address field is optional and editable later; a guard adds state for a rare case.
- `type` refusals shown nowhere (false): the form's type is set by the step, never refused.
- An edit dialog loan with no subtype shows a blank select (false): a loan or property is always stored with a subtype.
- Only the type list is measured by `proportions.spec.ts` (low): the other steps use the same primitives the floor scan covers elsewhere.
- The parity doc and status mismatch (false): the doc's rows were reviewed apart from the diff; both statuses are set to done at completion.
- The edit dialog changes beyond the switch (false): it takes the shared subtype select the Code Map names, with no visible change.
- The earliest step rather than the API's first field (low): the form's order is the reading of « first » a user meets.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Empty required subtype reads « Type de compte invalide. » | low | patch | `invalid_subtype` is the only code for a null loan or property subtype; the select now shows « Ce champ est obligatoire. » when nothing is chosen. |
| 2 | Focus after a refusal goes to the step's first field | low | patch | `focusFirst` ran on the new step; it now prefers `[aria-invalid="true"]`, rendered in the same pass as `setError`. |
| 3 | ← and → missing | low | patch | Sure's `_container.html.erb` binds `ArrowLeft` and `ArrowRight`. |
| 4 | e2e helper imports `hasMethodStep` | low | patch | A wrong list would pass; the helper now names Sure's five types. |
| 5 | `moveBetweenChoices` from no row, with a modifier, untested | low | patch | Verification-gap finding; the e2e now starts from the dialog's close button and presses `Control+j`. |
| 6 | Orphaned `accounts.form.cancel` | low | patch | No caller left once « Annuler » went. |
| 7 | Switch label differs from Sure's | low | reject | Archant's word since Story 28.15. |
| 8 | Bank link always shown | false | reject | Sure's `can_connect_enable_banking?` returns true. |
| 9 | Type not passed to « Banques » | low | reject | Archant chooses types per bank account after consent. |
| 10 | Root `details` error silent | false | reject | Unreachable from the form. |
| 11 | Double-click on « Suivant » posts | low | reject | Optional fields, rare, guard adds state. |
| 12 | `type` refusal unshown | false | reject | Type fixed by the step. |
| 13 | Edit dialog null subtype | false | reject | Stored loans and properties always have one. |
| 14 | Proportions cover only the list | low | reject | Shared primitives already scanned. |
| 15 | Parity rows outside the diff, status mismatch | false | reject | Reviewed apart; set together at completion. |
| 16 | Edit dialog changed beyond the switch | false | reject | Shared select, same rendering. |
| 17 | Earliest step, not API order | low | reject | Form order is what a user reads as first. |
| 18 | Screenshots not shown | false | reject | Taken and reviewed, listed above. |
| 19 | « Annuler » removed silently | false | reject | Sure's forms have none; recorded above. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
