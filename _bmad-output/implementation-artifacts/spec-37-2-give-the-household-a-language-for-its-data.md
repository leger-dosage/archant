---
title: "Story 37.2: Give the household a language for its data"
type: 'feature'
created: '2026-11-02'
status: 'done'
baseline_commit: '626ebbc1'
route: 'dispatch'
review_loop_iteration: 0
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** the server writes French into the household's data whatever the member reads: `DEFAULT_CATEGORIES` (« Courses »), the fees and contributions categories, and a transfer's lines (« Virement vers »). Sure keeps `families.locale` apart from `users.locale` and names these through `I18n.with_locale(family.locale)`.

**Approach:** a `settings` row `locale`, absent meaning `fr`. Setup writes it, from the page's language, and seeds the default categories then, since the start of the server cannot know it. Sure's English names serve `en`. An administrator changes it in « Préférences »; nothing stored is renamed.

## Boundaries & Constraints

**Always:** an absent row reads `fr`, so every household before keeps its names. The seed at start runs only once a user exists. A viewer never writes it (`viewerReadOnly`) nor sees the control.

**Never:** no stored category, label or merchant is renamed by a change of language; no label an import or a bank sync writes, nor the sample household or the assistant's amounts, which Story 37.4 takes.

## Code Map

- `services/household-locale.ts` -- `householdLocale`, `saveHouseholdLocale`.
- `services/default-categories.ts` -- `defaultCategoriesFor`, `investmentContributionsCategoryFor`, `transferFeesCategoryFor`.
- `services/seed.ts`, `services/categories.ts#bootstrapCategories`, `services/ledger/transfers.ts` -- read the language.
- `services/setup.ts`, `schemas/setup.ts`, `index.ts` -- write it and seed at setup.
- `services/preferences.ts`, `schemas/preferences.ts` -- `householdLocale`.
- `routes/setup.tsx`, `routes/_authed.settings.preferences.tsx`, `components/ChoiceField.tsx`, `locales/*.json`.

## Tasks & Acceptance

- [x] Failing Vitest first: the setting, the seed and the setup in both languages, a transfer and its fees in English, the preference.
- [x] Service, seed at setup, transfer names, bootstrap, preference, setup page, selector.
- [x] README, `docs/sure-parity.md`, Epic 37 (Story 37.4 added) and `sprint-status.yaml`.

**Acceptance Criteria:**
- Given a setup in English, then the default categories are Sure's English names and the row is `en`.
- Given a household with no row, then it reads `fr` and nothing changes.
- Given an English household, then a transfer reads « Transfer to », its fee « Transfer fee » in « Fees ».
- Given the finished story, `pnpm test` and `pnpm test:e2e` pass.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | An instance started on 37.1 and not yet set up already seeded French at start | low | accept | Rare, and the categories rename like any. |
| 2 | Labels an import or a bank sync writes, and the sample household, stay French | medium | defer | Pure parsers and the connector's fingerprint key (AD-7) need the language threaded; Story 37.4. |
| 3 | `setup.ts` imports `seed.ts` | low | accept | Setup is where the language first exists. |

## Design Notes

- `locale` is a `settings` row, like the other household switches: no migration.
- `categoryIdFor` already finds by name, case aside, so a household that changes language finds its old « Frais » and keeps using it rather than creating « Fees ».

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run --project unit src/services/seed.spec.ts src/services/setup.spec.ts src/services/household-locale.spec.ts src/services/ledger/transfers-create.spec.ts src/routes/preferences.spec.ts` -- expected: pass.
- The repository's verification gate in `AGENTS.md` -- expected: pass.
