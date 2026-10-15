---
title: 'Story 28.8: Property and vehicle details and overview'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: 'a73b530c5370e17fdd9a0fcb5ed6341cb95e8f66'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A property or a vehicle holds a value and nothing else. Sure (`00dd977fb`) records a property's subtype among ten, year built, area and address (`properties/_form.html.erb`, `Property`, `Address`) and a vehicle's make, model, year and mileage (`vehicles/_form.html.erb`, `Vehicle`), and shows them in an overview tab (`properties/tabs/_overview`, `vehicles/tabs/_overview`, `UI::AccountPage#tabs`).

**Approach:** Property and vehicle details in `accounts.details`, each type with its Zod schema (AD-6), in the creation and edit dialogs; `GET /api/accounts/:id/overview` answers a property's or a vehicle's purchase price and trend; an « Aperçu » tab shows Sure's cards.

## Boundaries & Constraints

**Always:**
- Property subtypes: Sure's ten keys in Sure's order (`single_family_home`, `multi_family_home`, `condominium`, `townhouse`, `investment_property`, `second_home`, `apartment`, `plot`, `commercial`, `agri_land`); the six existing labels stay, the new ones read « Maison plurifamiliale », « Copropriété », « Maison de ville », « Terrain agricole ».
- Property fields in Sure's form order and rows, Sure's `fr.yml` labels and placeholders: « Année de construction » (`2000`); « Surface habitable » (`2000`) beside « Unité de mesure » (« Pieds carrés », « Mètres carrés »); « Adresse » (`123, rue de la Paix`); « Ville » (`Paris`) beside « Région/Département » (`Île-de-France`); « Code postal/ZIP » (`75000`) beside « Pays » (`FR`). Vehicle: « Marque » (`Toyota`) beside « Modèle » (`Camry`); « Année » (`2023`), « Kilométrage » (`15000`) and « Unité » (« Miles », « Kilomètres »). All optional, in creation and edit.
- Stored: property `{ yearBuilt, areaValue, areaUnit, addressLine1, locality, region, postalCode, country }`, vehicle `{ make, model, year, mileageValue, mileageUnit }`. Numbers are integers, units `sqft | sqm` and `mi | km`, defaulting to `sqm` and `km`; texts trimmed, blank stored `null`, at most 255 characters (`too_long`).
- Bounds as 28.4: the API refuses only a non-integer number; the dialog adds Sure's form `min`/`max`: year built 1500 to the current year, vehicle year 1900 to next year, area and mileage ≥ 0.
- Overview, Sure's cards in Sure's order. Property: « Valeur marchande » (balance), « Prix d'achat », « Tendance », « Année de construction », « Surface habitable ». Vehicle: « Marque et modèle », « Année », « Kilométrage », « Prix d'achat », « Prix actuel », « Tendance ». « Prix d'achat » is the amount of the account's earliest valuation, the balance when none, as Sure's `first_valuation_amount`. « Tendance » is balance minus purchase price with its percentage, `balanceChange` semantics (no percentage from zero), coloured as Sure's `Trend`. A missing value reads « Inconnu »; area and mileage read `120 m²`, `15 000 km`. Below, « Modifier les détails du compte » for an administrator opens `EditAccountDialog`.
- Tab placement as Sure: after « Opérations », labelled « Aperçu » as the loan's (Sure's `accounts.show.tabs.overview`). A property's address, Sure's `Address#to_s` order, sits under the account's caption, as Sure's page subtitle.
- Export: `accountable` carries Sure's columns, property `year_built`, `area_value`, `area_unit`, vehicle `make`, `model`, `year`, `mileage_value`, `mileage_unit`, null when blank; the address goes under `archant.address` (`line1`, `locality`, `region`, `postal_code`, `country`), since Sure's exporter leaves its `Address` row out. `sure-preflight.ts` admits them.
- A viewer sees no edit button; `viewerReadOnly` refuses the writes.

**Never:** no automatic valuation, RentCast or Realie (dropped 2026-10-14); no « Vue d'ensemble », « Valeur », « Adresse » steps (Story 28.16); no `line2` or `county`; no details in `get_accounts` (Sure's assistant has none); no balance rule change (Story 28.9); no migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create property | `agri_land`, area `"120"` sqm, city `" Lyon "` | 201, `areaValue 120`, `locality "Lyon"`, others null | none |
| Create vehicle | make `"Peugeot"`, mileage `"15000"` km | 201, details stored | none |
| API bounds | year built `"1200"` through the API | saved | none |
| Dialog bounds | year built `"1200"`, mileage `"-1"` in the dialog | nothing written | `details.yearBuilt` `invalid_year`, `details.mileageValue` `invalid_mileage` |
| Bad number | area `"12,5"` | nothing written | 400 `details.areaValue` `invalid_number` |
| Foreign details | vehicle fields on a property, any on a depository | nothing written | 400 `invalid_details` |
| Overview | opening 300 000, snapshot later at 320 000 | price 300 000, trend +20 000 (+6,7 %) | none |
| From zero | opening 0, balance 5 000 | trend +5 000, no percentage | none |
| Old account | property created before 28.8, `details` null | every detail « Inconnu », PATCH saves details | none |

</frozen-after-approval>

## Code Map

- `packages/data/account-types.ts` -- `ACCOUNT_TYPES.property.subtypes` in Sure's order; `PropertyDetails`, `VehicleDetails` in the `AccountDetails` union with `propertyDetailsOf`, `vehicleDetailsOf` beside `creditCardDetailsOf` (narrow on `areaUnit`, `mileageUnit`); comment on `schema/accounts.ts:18` follows.
- `packages/api/src/schemas/accounts.ts:312-460` -- input schemas and parsers beside `parseCreditCardDetails`; 28.2's review deferred to this story the per-type table: replace the loan/card branching of `hasForeignDetails`, `reportDetailsIssues`, the creation transform and `isCreditCardDetailsInput` (`:579`) with one map from type to parser and fields. `dialog` adds the bounds, as `reportLoanDetailsIssues`.
- `packages/api/src/services/accounts.ts:244-300` -- `updateAccount` parses through the same map.
- `packages/api/src/services/loans.ts:226` -- `loanOverview`; new `services/asset-overview.ts` reads the earliest valuation (`entries.kind = 'valuation'`, by date) and reuses `balanceChange` from `domain/balances/history.ts:44`; `routes/accounts.ts:100` dispatches by type, both answers carrying `kind`.
- `packages/app/src/components/LoanDetailsFields.tsx`, `CreditCardDetailsFields.tsx`, `lib/credit-card-details.ts` -- patterns for `PropertyDetailsFields.tsx`, `VehicleDetailsFields.tsx`, `lib/asset-details.ts`; wire into `CreateAccountDialog.tsx:280` and `EditAccountDialog.tsx:77,143-160`.
- `packages/app/src/routes/_authed.accounts.$accountId.tsx:500-520,668-730` -- `overview` tab for property and vehicle, `OverviewPanel` per kind, caption at `:631`; `hooks/useLoanOverview.ts` narrows on `kind`.
- `packages/app/src/components/SummaryCard.tsx`, `LoanOverview.tsx` -- card grid for new `AssetOverview.tsx`; `lib/balance-change.ts` `changeText`, `formatSignedMoney`.
- `packages/app/src/locales/fr.json:163` -- subtypes; new `propertyDetails.*`, `vehicleDetails.*`, `assetOverview.*`.
- `packages/api/src/services/export.ts:175-212,828-838`, `testing/sure-preflight.ts:258-277` -- `propertyAccountable`, `vehicleAccountable`, `archant.address`.
- `packages/app/e2e/accounts.spec.ts:1293` -- Story 7.3's property and vehicle tests.
- `docs/sure-parity.md:65-66` -- Property and Vehicle rows.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/account-types.spec.ts`, `routes/accounts.spec.ts`, `services/asset-overview.spec.ts`, `services/export.spec.ts` -- every matrix row, the overview's viewer read and the export columns, failing first.
- [x] `packages/data/account-types.ts` -- subtypes, types, readers.
- [x] `schemas/accounts.ts`, `services/accounts.ts` -- parsers and the per-type table.
- [x] `services/account-overview.ts`, `routes/accounts.ts` -- overview.
- [x] `services/export.ts`, `testing/sure-preflight.ts` -- export.
- [x] `packages/app/src/**` -- fields, tab, cards, subtitle, labels.
- [x] `packages/app/e2e/accounts.spec.ts` -- create a property with its address and a vehicle with its mileage, read their « Aperçu » cards and the address; edit a detail from « Modifier les détails du compte »; `e2e/viewer.spec.ts` -- no edit button.
- [x] `docs/sure-parity.md` -- both rows Parity, the valuation drop kept.

**Acceptance Criteria:**
- Given a saved detail, when the edit dialog reopens, then it shows the stored value and unit.
- Given a property without address, when its page opens, then no empty subtitle line shows.

## Implementation Notes

- The spec's « no migration » was wrong: `accounts_subtype_check` lists each type's subtypes, so the four new property subtypes need `0077_property_subtypes.sql`, a table rebuild generated by `drizzle-kit` as Story 28.5's 0075, no row changed (`migrate.spec.ts`).
- One table, `DETAILS_BY_TYPE` in `schemas/accounts.ts`, replaces the loan and card branching; `parseAccountDetails` serves creation and `updateAccount`, and `isCreditCardDetailsInput` is gone.
- The earliest valuation is read by `firstValuationOf` in `services/ledger/balances.ts`, since the lint keeps `entries` reads in the ledger; `accountOverview` in `services/account-overview.ts` picks the overview by type, so the route calls one service (AD-1).
- `hooks/useLoanOverview.ts` became `hooks/useAccountOverview.ts`, serving the three types.
- The overview's tests sit in `routes/accounts.spec.ts` and `services/ledger/balances.spec.ts` rather than a `services/asset-overview.spec.ts`: the asset overview only joins `firstValuationOf` and `balanceChange`, each tested where it lives.
- Square feet display as « pi² », the French symbol.

## Spec Change Log

## Review Triage Log

| Source | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind | Parity rows label the unit defaults and French labels « Parity. » and cite no story | low | the Investment row files such departures under « Different. French text… » | patch |
| blind | Drizzle snapshot absent from the diff | false | excluded from the review diff on purpose; `pnpm data generate` reports nothing pending | rejected |
| blind | Migration leaves existing property and vehicle `details` null | false | every reader handles null, as cards saved before 28.2; the matrix's « Old account » row asks for « Inconnu » | rejected |
| blind, edge | A PATCH with a property object plus a vehicle field strips the foreign key and answers 200 | low | same as 28.2's triage: a malformed request no dialog sends; strict members add a branch | rejected |
| blind | `"1e3"` mileage refusal masked by the invalid unit in the same request | low | the enum failure stops the refinement; only `mileageUnit` is asserted | patch |
| blind, edge | Asset overview shows the loan's skeleton while loading | low | `OverviewPanel` renders `LoanOverviewSkeleton` for every kind | patch |
| blind | Three exports of `schemas/accounts.ts` imported nowhere | low | knip tolerates them as a published module; « Nothing unused » | patch |
| blind | `assetOverview` builds two points to reuse `balanceChange`; `kind` repeats `account.type` | low | the spec asks for `balanceChange` semantics; cosmetic | rejected |
| blind | Viewer tests cover the property only | low | the vehicle shares `accountOverview`'s branch and the same `admin` guard | rejected |
| blind | `firstValuationOf`'s same-day tie-break untested | low | the purchase price is a money path, covered to the branch | patch |
| blind, verification-gap | No test opens the property edit dialog or changes the area unit; the no-address check counts `<p>` | medium | a regression blanking a property's details on rename would pass | patch |
| blind | Negative area through the API untested | low | the API saves any integer as Sure's model; the year case proves the rule | rejected |
| edge | 255-character cap counts UTF-16 units, so emoji count double | low | every text limit of the API uses Zod's `max`, alike | rejected |
| edge | Ticked task names `services/asset-overview.spec.ts`, which does not exist | low | the overview is tested through the route and `firstValuationOf`; recorded in Implementation Notes | rejected |
| standards | The route reads the account and picks a service by type, where AD-1 wants one service call | medium | `routes/accounts.ts` called `getAccount`, `loanOverview` and `assetOverview` | patch: `accountOverview` in `services/account-overview.ts` |
| standards | Per-type branching repeated across the dialogs, export and page | low | the server has its table; a client table for four types adds an abstraction no fifth type needs yet | rejected |
| standards | `PropertyDetailsFields` and `VehicleDetailsFields` share an input helper and a unit select | low | two short copies, as 28.2's card and loan fields | rejected |
| standards | The skeleton's 5 or 6 repeats the card count | low | one line beside the grid it mirrors; off by one card is harmless | rejected |
| spec | Tendance coloured with Archant's income and destructive tokens rather than Sure's | false | same direction and meaning as Sure's `Trend`; `LoanOverview.tsx` gives the contrast reason for the token | rejected |
| spec | `INTEGER_PATTERN` refuses ten digits | false | Sure's columns are 32-bit integers, which refuse it too | rejected |

## Design Notes

The epic's criterion names the tab « Vue d'ensemble », the property form's first step in Sure; Sure's account page labels the tab « Aperçu », as Archant's loan. Sure's `fr.yml` has no French label for six property subtypes and falls back to English; Archant's existing French labels stay. Sure defaults units to `sqft` and `mi` for every family; a French household measures in m² and km, so those are the defaults while both units stay offered.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.

**Manual checks (if no CLI):**
- Screenshots, light and dark, of both creation dialogs, a property's and a vehicle's « Aperçu », and the property subtitle on a phone width.
