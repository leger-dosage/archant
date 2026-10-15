---
title: 'Story 28.5: Investment subtypes for Europe and everywhere'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: '913f08225feada2ecbe02ce96304b3139dd3ddab'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An investment account is only `pea`, `assurance_vie`, `brokerage` or `other`, in a flat list; Sure's `Investment::SUBTYPES` also has European and generic subtypes, grouped by region in `subtypes_grouped_for_select`, and its form saves no subtype through `include_blank` « Aucun » (Sure `00dd977fb`).

**Approach:** `ACCOUNT_TYPES.investment` takes Sure's « Europe » and « Général » subtypes and a null subtype; the select groups them as Sure does for `EUR`; the four new tax-deferred subtypes join `TAX_ADVANTAGED_SUBTYPES`; database check, labels and tests follow.

## Boundaries & Constraints

**Always:**
- Subtypes and order as Sure's for `EUR` (`CURRENCY_REGION_MAP` puts `eu` first, then generic, then `us`): « Europe »: `assurance_vie`, `pea`, `pillar_3a`, `riester`; « Général »: `pension`, `retirement`, `mutual_fund`, `gold`, `angel`, `trust`, `other`; « États-Unis »: `brokerage`. Region labels are Sure's `accounts.subtype_regions`. Archant's reporting currency is always `EUR` (`getReportingCurrency`), so the order is fixed, not computed.
- Select labels are Sure's `investments.subtypes.*.long` in `fr.yml`: « Plan d'Épargne en Actions », « Prévoyance privée (Pilier 3a) », « Riester-Rente », « Retraite », « Compte de retraite », « Fonds commun de placement », « Or (physique ou numérique) », « Investissement providentiel », « Fiducie », « Autre investissement ». Two exceptions where Sure reads wrong in French: « Assurance-vie » (Sure has no French key and falls back to « Assurance Vie »), « Compte-titres » (Sure's « Courtier » names a person).
- Every other place an account's kind shows (`kindOf` callers) keeps one short label, Sure's `short`: « PEA », « Assurance-vie », « Pilier 3a », « Riester », « Retraite » (pension and retirement alike, as Sure), « Fonds commun », « Or », « Business angel », « Fiducie », « Autre », « Compte-titres ».
- A null subtype is legal for `investment`, as depository since Story 28.1: kind labelled « Investissement » (Sure's `accounts.types.investment`), listed first as « Aucun » in the edit dialog.
- Tax treatment: `pillar_3a`, `riester`, `pension`, `retirement` join `pea` and `assurance_vie` in `TAX_ADVANTAGED_SUBTYPES` (Sure's `tax_deferred`; the others are `taxable`). They leave cash flow, budgets and transaction-list income and expense; net worth and account-group totals still count them. A null subtype is taxable, as Sure's `|| :taxable`.
- Migration 0075 by `pnpm data generate`, a table rebuild as 0073; no data step.

**Never:** no US subtype but `brokerage`, no UK, Canadian, Australian or Indian subtype (owner's decision of 2026-10-14, `docs/sure-parity.md` Investment row); no tax-treatment badge or report section; no subtype in `get_accounts` (Sure has none); no stepwise creation (Story 28.16); no change to trades, holdings or export code, which read the type.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create Pilier 3a | `POST /api/accounts` investment `pillar_3a` | 201, listed as « Pilier 3a » | none |
| Create blank | investment, `subtype: null` | 201, listed as « Investissement » | none |
| Unknown | investment `401k` | nothing written | 400 `invalid_subtype` |
| Cash flow | expense on a `retirement` account | absent from `getCashFlow` and budget actuals; present in net worth | none |
| Taxable | expense on a `gold` or null-subtype account | counted in cash flow | none |
| Income statement filter | `accountIds` names a `riester` account | refused | 400 `unknown_account`, as a PEA today |
| Export | `mutual_fund` and a null investment | value unchanged in `subtype`, `accountable.subtype`, `archant.subtype` | none |

</frozen-after-approval>

## Code Map

- `packages/data/account-types.ts:27-31` -- `ACCOUNT_TYPES.investment`: subtypes in Sure's order, `subtypeOptional: true`. `:90-102` `TAX_ADVANTAGED_SUBTYPES`/`isTaxAdvantaged`: add the four. `ACCOUNT_SUBTYPES` dedupes `other` already.
- `packages/data/schema/accounts.ts:45-61` -- check generator already handles `subtypeOptional`; regenerate only.
- `packages/data/drizzle/0075_*.sql` -- generated, renamed `0075_investment_subtypes.sql`, journal tag updated; template `0073_depository_subtypes.sql`.
- `packages/api/src/services/reports.ts:107-111` `cashFlowAccounts`, `services/ledger/queries.ts:437-445` `taxAdvantagedAccountIds`, `services/budgets.ts` -- read the list; no change expected.
- `packages/api/src/schemas/accounts.ts:43,480,499-502,565,600` and `services/accounts.ts:257` -- route through `isSubtypeOf`/`ACCOUNT_SUBTYPES`; no change expected.
- `packages/app/src/lib/account-kinds.ts:26-30` -- investment kinds: `investment` (null), then Sure's order; ids `other_investment` and `brokerage` kept. Add the region grouping beside the kinds (region id → kind ids), used by both dialogs.
- `packages/app/src/components/CreateAccountDialog.tsx:162-194` -- flat « Type » list: render the investment kinds as `SelectGroup`s with a `SelectLabel` per region, long labels, a `SelectSeparator` before and after so property kinds do not read as « États-Unis ». Precedent: `routes/_authed.settings.banks_.$connectionId.tsx:322-343`.
- `packages/app/src/components/EditAccountDialog.tsx:184-292` -- investment account: « Aucun » first, then the same region groups with long labels.
- `packages/app/src/locales/fr.json:135-161` -- short labels under `accounts.subtypes`; new `accounts.subtypeLongs` for investment kinds; `accounts.subtypeRegions` (`eu`, `generic`, `us`).
- `packages/api/src/testing/sure-preflight.ts:37-100` -- already admits Sure's full list.
- Tests: `packages/data/account-types.spec.ts:27,61,88,111-117`; `packages/data/migrate.spec.ts:931` (pattern), `:1009`; `packages/api/src/services/reports.spec.ts:241,370`; `services/ledger/queries.spec.ts:790`; `routes/accounts.spec.ts`; `services/export.spec.ts:214`; `packages/app/src/lib/account-kinds.spec.ts:18,29`; `packages/app/e2e/accounts.spec.ts:1189-1211` (PEA creation template).
- `docs/sure-parity.md:64` -- Investment row; `:236` Cash flow row names PEA and assurance-vie.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/account-types.spec.ts`, `packages/data/migrate.spec.ts`, `packages/api/src/routes/accounts.spec.ts`, `packages/api/src/services/reports.spec.ts`, `packages/api/src/services/ledger/queries.spec.ts`, `packages/api/src/routes/budgets.spec.ts`, `packages/api/src/services/export.spec.ts`, `packages/app/src/lib/account-kinds.spec.ts` -- the I/O matrix as failing tests first: each new subtype's tax treatment, the grouping order and labels, migration 0075 keeping every row -- test-first.
- [x] `packages/data/account-types.ts`, `packages/data/schema/accounts.ts` -- subtypes, optional flag, tax list; `pnpm data generate` -- one list drives API and database.
- [x] `packages/app/src/lib/account-kinds.ts`, `locales/fr.json` -- kinds, regions, short and long labels.
- [x] `packages/app/src/components/CreateAccountDialog.tsx`, `EditAccountDialog.tsx` -- grouped investment options.
- [x] `packages/app/e2e/accounts.spec.ts` -- create « Prévoyance privée (Pilier 3a) » under the « Europe » group through the form, find it listed as « Pilier 3a »; `manage-accounts.spec.ts` -- switch an investment to « Aucun », read « Investissement ».
- [x] `docs/sure-parity.md` -- Investment row to Parity for European and generic subtypes and none; Cash flow row names the tax-deferred subtypes.

**Acceptance Criteria:**
- Given the creation dialog, when « Type » opens, then the investment options read, under « Europe », « Assurance-vie », « Plan d'Épargne en Actions », « Prévoyance privée (Pilier 3a) », « Riester-Rente »; under « Général », the seven generic long labels in Sure's order; under « États-Unis », « Compte-titres ».
- Given an existing database, when migration 0075 runs, then every account keeps its subtype and a later `pillar_3a` or null investment insert succeeds.
- Given an account of a new subtype, when a trade is recorded and the export runs, then it behaves as a PEA does.

## Implementation Notes

- `INVESTMENT_REGIONS` in `packages/app/src/lib/account-kinds.ts` lists the kind ids per region; `InvestmentKindGroups.tsx` renders them in both dialogs. The creation dialog renders the whole investment section where the blank kind sits, between two `SelectSeparator`s.
- « Autre placement » becomes « Autre », Sure's short label; the existing PEA creation e2e now picks « Plan d'Épargne en Actions ».
- `docs/architecture.md` (AD-9 rule), the `get_income_statement` description in `mcp/reports.ts` and the `cashFlowAccounts` comment name the retirement subtypes beside the PEA and the assurance-vie.
- QA on a built instance (port 8791, temporary database): the creation list (separators, « Investissement », the three region groups, properties after), a pillar 3a created through it and listed as « Pilier 3a » on the accounts page and in the accounts column, and the edit list of that account, captured and checked.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence / route |
|-------|---------|---------|------------------|
| verification-gap, blind | No test covers the creation dialog's blank « Investissement » option | medium | Removing its `SelectItem` fails nothing: the e2e reads only the region groups. Patched: an e2e creates one through the form. |
| blind | `docs/sure-parity.md` Budgets row still names only PEA and assurance-vie | low | The budget reads `cashFlowAccounts`, which now leaves the four retirement subtypes out. Patched. |
| blind | `EditAccountDialog.tsx` hardcodes `value="investment"` for « Aucun » | low | A renamed kind id would leave « Aucun » inert; the other branch derives it from `subtype === null`. Patched. |
| blind | `InvestmentKindGroups.tsx` cites `grouped_options_for_select` as Sure's | low | That is the Rails helper; Sure's method is `Investment.subtypes_grouped_for_select`. Patched. |
| blind | Sprint status `in-progress` while the spec reads `in-review` | false | The completion step sets both to `done`; sprint tracking has no in-review state for this workflow. |
| blind | `pension` and `retirement` both read « Retraite » outside the select | false | Both are Sure's `short` labels in `fr.yml`; the frozen intent keeps them. |
| blind | « Autre » loses « placement » in the account header | low | Sure's short label, chosen in the frozen intent; the header sits under the investment group. Rejected. |
| blind | The edit e2e checks only « Europe » | low | `account-kinds.spec.ts` pins every group and label; the browser adds nothing. Rejected. |
| blind | `ACCOUNT_KINDS` and `INVESTMENT_REGIONS` keep two orders by hand | low | `account-kinds.spec.ts` asserts each region kind appears once, in the kinds' order. Rejected. |
| blind | Sure's `subtype_prompt` « Sélectionnez le type d'investissement » is not carried | low | Rails shows a prompt only on a nil value; Archant's select always holds a value, « Aucun » for none. Rejected. |
| blind | The MCP description says « a retirement plan » rather than naming subtypes | low | `get_accounts` exposes no subtype, as Sure's; naming keys would help no assistant. Rejected. |
| blind | `openPea` opens a gold or blank account in `queries.spec.ts` | low | `openPea` is itself `openChecking` with overrides; the test names each account. Rejected. |
| blind | No service test uses `pension` | low | Every exclusion reads `TAX_ADVANTAGED_SUBTYPES`, which `account-types.spec.ts` pins per subtype. Rejected. |
| blind | No screenshot recorded in the spec | false | QA screenshots are taken in the review pass, not stored in the spec. |
| edge-case | No findings | — | — |
| standards | Both dialogs repeat the blank investment choice before `InvestmentKindGroups` | low | Same block, label aside. Patched: the component renders the blank choice from a `blankLabel`. |
| standards | `openPea` opens gold, riester and blank accounts | low | Carried from the blind row: the helper predates the story and is used across specs. Rejected. |
| standards | Investment subtypes listed in five places | low | Carried from the blind row on two orders. Rejected. |
| spec | No findings beyond `pension` lacking a service test | low | Carried. Rejected. |

## Design Notes

Sure shows the long label in its select and on the accounts page row (`accounts/_account`), the short one in the sidebar group and reports. Archant has one label per kind everywhere; this story adds long labels for the select only and leaves the other types' single label alone.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm test` -- expected: green.
- `pnpm test:e2e` -- expected: green.

**Manual checks (if no CLI):**
- Screenshots of the creation list (investment groups and the separators around them), the edit list of an investment account, and the accounts page listing « Pilier 3a ».
