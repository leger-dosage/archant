---
title: "Story 37.4: Write an import's labels and the sample household in the household's language"
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: '71cc194e'
route: 'dispatch'
review_loop_iteration: 0
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** after Story 37.2 an English household still reads « Opération importée », « Virement sortant » and a sample household in French, because imports, bank syncs and the sample load write their own text.

**Approach:** each reads `householdLocale`. `lib/import-labels.ts` holds the three labels an unnamed line gets (CSV, archive, bank), the QIF reader holds its own table, and the sample plan is translated after it is generated, so the seeded draws, rows and amounts stay the same in both languages.

## Boundaries & Constraints

**Always:** `keyLabelOf` stays French and never reads the language: the fingerprint of a synced line must not change (AD-7). A lower-level function takes `locale` last and defaults to `fr`, so every existing caller reads as before.

**Never:** nothing stored is renamed. The assistant's tool descriptions and the `language` Enable Banking's `/auth` call sends stay French; neither is part of this story.

## Code Map

- `lib/import-labels.ts` -- `IMPORT_LABELS`, outside `services/` because a connector may not import a service (AD-1).
- `connectors/enable-banking/labels.ts`, `client.ts`, `bank-connector.ts`, `services/sync.ts` -- the bank's unnamed line.
- `services/csv-import*.ts`, `qif-import.ts`, `sure-import-plan.ts` -- the file's unnamed line and the QIF actions.
- `services/sample-data-english.ts`, `sample-data.ts` -- the translated sample household.

## Verification

`pnpm test` and `pnpm test:e2e` pass; `sample-data-english.spec.ts` fails on any French accent or article left in an English name.

</frozen-after-approval>

## Spec Change Log

None.
