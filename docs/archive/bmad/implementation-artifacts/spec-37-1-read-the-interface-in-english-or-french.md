---
title: "Story 37.1: Read the interface in English or French"
type: 'feature'
created: '2026-11-02'
status: 'done'
baseline_commit: '0147bb3d950a7912c559635c106016295eedbf51'
route: 'dispatch'
review_loop_iteration: 0
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** the interface reads French only: `i18n.ts` forces `lng: "fr"`, about thirty `Intl` formatters are built with `"fr"` or `"fr-FR"`, and the README says « The interface is in French only ». Sure (`00dd977fb`) has a `users.locale`, filled from `Accept-Language` by `Localize#locale_from_accept_language`, and eighteen locales.

**Approach:** English beside French. `users.locale` is `en`, `fr` or null, null following the browser (`pickLocale`, Sure's `accept_language_top_locale`), saved by `PATCH /api/preferences`. The page reads its language once, from `localStorage` else the browser, and a change reloads it: every `Intl` formatter is built at module load from `intlLocale`. `en.json` is typed from `fr.json`.

## Boundaries & Constraints

**Always:** `en-US` for English, as Sure's English (`Oct 14, 2026`, `1,234.56`). The date typed in a field is month first in English. `ofMonth` drops the French « de » particle in English. The English wording is Sure's where Sure has the string.

**Never:** no stored name or server-written text changes with the language (Story 37.2); the API's messages stay English; no locale for `name-key` and `tint`, which fold names the same for every language.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Browser in English, nothing saved | `navigator.languages = ["en-GB"]` | English, `<html lang="en">`, sign-in included | none |
| Browser in German | `["de"]` | English, the default | none |
| Saved `fr` on a new device | `users.locale = "fr"` | first paint follows the browser, then one reload in French | none |
| No `localStorage` | storage throws | never reloads | none |
| `PATCH {locale: "de"}` | | 400 `VALIDATION_ERROR` | toast from code |

</frozen-after-approval>

## Code Map

- `packages/data/locales.ts` -- `LOCALES`, `DEFAULT_LOCALE`, `INTL_LOCALES`, `pickLocale`.
- `packages/data/schema/auth.ts`, `drizzle/0102_user_locale.sql` -- `users.locale`, a check; the migration is by hand, since Drizzle's rebuild selects the new column from the old table.
- `packages/api/src/schemas/preferences.ts`, `services/preferences.ts` -- the field.
- `packages/app/src/lib/locale.ts` -- `activeLocale`, `intlLocale`, `followSavedLocale`; `hooks/useFollowSavedLocale.ts` in `_authed.tsx`.
- `packages/app/src/lib/format-money.ts` -- `formatMoney` in the page's language; `dates.ts` -- `isoToInput`, `inputToIso`, `ofMonth`.
- `packages/app/src/locales/en.json`, `locales.spec.ts` -- the English file and its shape.
- `routes/_authed.settings.preferences.tsx` -- « Langue ».
- `packages/app/vitest.setup.ts` -- the specs run as a French browser; `e2e/language.spec.ts` -- an English browser.

## Tasks & Acceptance

**Execution:**
- [x] Failing Vitest first: `pickLocale`, the preference round trip, the English file's keys and placeholders.
- [x] Locale module, column, preference, migration.
- [x] `en.json` from `fr.json` (seven chunks translated in parallel, each checked for keys and placeholders).
- [x] Formatters, money, dates, `<html lang>`, the selector.
- [x] README, `docs/architecture.md`, `docs/sure-parity.md`, Epic 37 and `sprint-status.yaml`.

**Acceptance Criteria:**
- Given an English browser and no saved language, then the interface is in English from the sign-in page on.
- Given « Réglages › Préférences », then « Langue » offers « Langue du navigateur », English and Français, saves with Sure's notice and reloads in the language.
- Given the English file, then it has every key and placeholder of the French one.
- Given the finished story, `pnpm test` and `pnpm test:e2e` pass.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | The English strings were written from the French and a glossary, not mined from Sure's `en.yml` | medium | accept | Matching Sure's French to its English mapped « Nom » to « Last Name » and Title Case everywhere; the glossary and sentence case give a more consistent file. Sure's wording stays the model for later passes. |
| 2 | The saved language reloads the page once on a new device | low | accept | The choice lives on the server; the next load reads it from storage. |
| 3 | `1,234.56` typed in English is refused | low | accept | `parseAmount` refuses a grouped thousand after a comma by design (`1,234` is not a valid euro amount). |

## Design Notes

- The reload on change replaces a reactive `Intl` layer: thirty module-level formatters keep their shape.
- Sure's blank `locale` is null; Sure also auto-saves the detected language, Archant keeps null so the browser's changes are followed.

## Verification

**Commands:**
- `pnpm --filter @archant/app test`, `pnpm data test`, `pnpm --filter @archant/api exec vitest run --project unit src/routes/preferences.spec.ts` -- expected: pass.
- The repository's verification gate in `AGENTS.md` -- expected: pass, no tracked file changed after it.
