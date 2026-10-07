---
title: 'Story 26.5: Ask an assistant to import a bank file'
type: 'feature'
created: '2026-10-07'
status: 'done'
baseline_commit: 'cf7e184aa94ba9ae150340ca77c054b586b32a0e'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-26-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An assistant connected through `/api/mcp` can record a line at a time but cannot feed an account from the statement file the owner's bank exported: the owner leaves the conversation for the import dialog, or the assistant types each line with `create_transaction`, skipping the dialog's deduplication.

**Approach:** Add `import_bank_statement`, `preview_import` and `confirm_import` (`archant:write`) in a new `mcp/imports.ts`, through `createImport`, `previewImport` and `confirmImport` of `services/imports.ts`, as the dialog's upload, Aperçu and « Importer » (AD-19, FR97). Story 26.5 of `epics.md` is the acceptance contract; the owner's rule of 2026-10-07, no divergence from Sure unless forced, overrides it where recorded below.

## Boundaries & Constraints

**Always:**
- `/api/mcp`'s body limit is 1.5 MB (`MAX_MCP_BODY_BYTES`), left out of the 64 KB like the two uploads and checked once the token is, as theirs once the session is, `PAYLOAD_TOO_LARGE` « The request body is larger than 1.5 MB. »; the SDK's `maxRequestBodySize` is the same constant.
- `import_bank_statement`: `accountId`, `filename` (with its extension), `contentBase64`, as Sure's `upload_account_statement`. Base64 that does not decode answers `VALIDATION_ERROR` on `contentBase64`; the bytes go to `createImport` with a 1 MB cap (`MAX_ASSISTANT_FILE_BYTES`), above which, or unreadable, `INVALID_IMPORT_FILE`, logged as the dialog's refusal. `CREATES`; `changedRows` 0.
- One preview output for `import_bank_statement` and `preview_import`: `importId`, `filename`, `source`, `currency`, `counts` (the five), up to 5 `lines` of each group, Sure's preview count, (`date`, `label`, `amount`; a rejected line also `reason`, and `null` fields when the source could not read it), `openingSuggestion`, `opening` (`date`, `balance`), `statementBalance` (status, date, balance, and `recorded`, `gap` or `reason` by status), `csv` (`sample`: the file's first records up to the in-use skip, a header and 10 records; `mapping`, `saved`, `prefill`) and `qif` (`dateOrder`, `ambiguous`). Amounts as decimal strings in `currency`. `BANK_TEXT` in both descriptions.
- `preview_import`: `importId`, optional `csv` (the dialog's mapping, each enum described), `qif.dateOrder`, `moveOpeningDate` (date or null, absent = null, as the dialog sends it). Through `previewImport`; a mapping without one date, a label and an amount answers `VALIDATION_ERROR` on `csv.columns`. `SETS`; `changedRows` 0.
- `confirm_import`: `importId`, `expectedCounts` (the five, integers ≥ 0). `confirmImport` passes them to `ingest`, which compares them with the groups inside its write, after the digest: a difference, or a changed digest, throws `IMPORT_PREVIEW_STALE` with `params` the five counts now, as strings, and writes nothing. Answers `importId` and `counts`. `DESTROYS`; `changedRows` created + duplicates + matched (rows written or keyed).
- The REST confirm keeps its body and answer; `IMPORT_PREVIEW_STALE` gains `params` there too, which the interface ignores.
- `ImportPreview` gains `currency`, the account's, read where it is already.
- `INSTRUCTIONS`: the 26.4 line on `externalId` for a statement's lines becomes a pointer to `import_bank_statement`, and a paragraph gives the workflow: import the file; for a CSV without a mapping, read the sample, propose the columns to the owner, call `preview_import`; for a QIF whose dates are ambiguous, ask the owner the order; for lines refused before the opening date, offer `openingSuggestion`; show the owner the counts, the possible duplicates, the rejected lines with their reasons and what happens to the closing balance; once they agree, `confirm_import` with those counts; on `IMPORT_PREVIEW_STALE` preview again and show the owner; a file above 1 MB goes through the import dialog; an import is reverted in the « Imports » tab.
- `fr.json`: write scope « Créer et modifier vos règles, saisir, importer, classer et supprimer vos opérations, rapprocher vos virements, définir vos budgets, vos soldes et vos objectifs, gérer vos factures ».

**Never:** no `contentText`; no revert tool; no new screen, no change to the dialog or the « Imports » tab; the file never reaches a log line or `assistant_calls`; no PDF.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| OFX | Crédit Agricole fixture in base64 | `source: "ofx"`, 5 created, `confirm_import` writes them, recorded with 5 rows |
| Again | same file, confirmed | all present, confirm writes nothing, 0 rows |
| CSV first | CSV with no saved mapping | groups empty, sample and French prefill, `saved: false`; confirm `VALIDATION_ERROR` |
| CSV mapped | `preview_import` with a mapping, confirmed | lines created; the mapping saved for the account |
| CSV second | another CSV with the same columns | previewed at once with the saved mapping, `saved: true` |
| QIF | dates that read both ways | `qif.ambiguous: true`; `preview_import` with `month-first` reads them so |
| Stale | `expectedCounts` differs | `IMPORT_PREVIEW_STALE`, params the counts now, nothing written |
| Big | 1 MB + 1 decoded | `INVALID_IMPORT_FILE` |
| Body | body above 1.5 MB | 413 `PAYLOAD_TOO_LARGE`, no call recorded |
| Bad base64 | `"%%%"` | `VALIDATION_ERROR` `contentBase64` |
| Read token | any of the three | `403 insufficient_scope`, recorded |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/imports.ts` -- `createImport` (gains `{ maxBytes }`), `previewImport`, `confirmImport` (gains `expectedCounts`), `ImportPreview` (gains `currency`), `MAX_IMPORT_BYTES` in `schemas/imports.ts`.
- `packages/api/src/services/ledger/ingest.ts:122` `IngestOptions` gains `expectedCounts`; the stale check at `:790`; `countsOf`.
- `packages/api/src/app.ts:392` -- the `/api/*` `bodyLimit` excepts `/api/mcp`; `mcp/server.ts` reads its body after the token.
- `packages/api/src/mcp/server.ts` -- `MAX_BODY_BYTES`, `TOOLS`, `INSTRUCTIONS:160`; `mcp/tool.ts` `CREATES`, `SETS`, `DESTROYS`, `BANK_TEXT`, `decimal`.
- `packages/api/src/schemas/assistants.ts` -- three inputs, reusing `csvMappingSchema` pieces and `importPreviewSchema` of `schemas/imports.ts`.
- `packages/api/src/mcp/snapshots.spec.ts` -- the test pattern; `testing/app.ts` `creditAgricole`, `paddedOfx`; fixtures under `connectors/{ofx,csv,qif}/fixtures/`.
- `packages/api/src/app.spec.ts:341` -- `/api/mcp` leaves the 64 KB list.
- `packages/app/src/locales/fr.json:2108`, `packages/app/e2e/assistants.spec.ts:245`.
- Docs: `docs/deployment.md` « Connecting an assistant », `docs/security-model.md` « Assistants », `docs/sure-parity.md:137`, `:248`, `docs/architecture.md` AD-19 (base64 only).

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/mcp/imports.spec.ts` -- first: every matrix row through the MCP handler, each call recorded with its count and without the file.
- [x] `services/ledger/ingest.ts`, `services/imports.ts` -- expected counts, `maxBytes`, `currency`; `routes/imports.spec.ts` for params.
- [x] `schemas/assistants.ts`, `mcp/imports.ts`, `mcp/server.ts`, `mcp/server.spec.ts`, `app.ts`, `app.spec.ts`.
- [x] `fr.json`, `e2e/assistants.spec.ts`, docs in the Code Map, `sprint-status.yaml` (story and `epic-26` done).

**Acceptance Criteria:**
- Given Story 26.5 of `epics.md`, when the story ships, then each criterion holds with the decisions this spec records.
- Given an import confirmed by an assistant, when the owner opens the account, then the « Imports » tab lists it and « Annuler l'import » reverts it.

## Design Notes

Sure, `origin/main` at `56140319d` (7 October 2026): `import_bank_statement` takes a PDF already uploaded, has its language model extract the lines into a CSV `TransactionImport`, returns five of them and leaves publishing to the import page; `upload_account_statement` takes `filename` and `content_base64`. Archant calls no language model (FR39 withdrawn), so the tool takes the file itself in Sure's `upload_account_statement` shape, and the epic's `contentText` is dropped to keep it. `preview_import` and `confirm_import` are additions, as 26.1's transfer tools: Archant has no page to resume a preview, and the epic adds no screen. Forced departures: 1 MB and the 1.5 MB body limit (Sure's controller has none; a cap on what one call makes the server hold); errors as `VALIDATION_ERROR` and `INVALID_IMPORT_FILE` rather than Sure's ad hoc codes (API contract); `accountId` required where Sure answers the account list, since an error carries only its fields (API error contract) and `get_accounts` gives the ids.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green
- `pnpm test:e2e` (under `/tmp/archant-e2e.lock`) -- expected: green, consent label updated

**Manual checks:**
- Consent page with the new label; an account's « Imports » tab after an assistant's import, reverted.

## Implementation Notes

- Implemented directly from this spec, test first: `mcp/imports.spec.ts` covers the matrix, the closing balance's `kept` and `skipped`, the opening date moved, and the call record without the file, its name or a label, in the record and the log.
- The body limit moved out of `app.ts` during review: Hono's `bodyLimit` reads a chunked body whole before any check, so an anonymous caller would have made the server hold 1.5 MB. `withinLimit` in `mcp/server.ts` reads it after `authenticate`, and `app.spec.ts` proves an anonymous chunked body stays unread.
- `IMPORT_PREVIEW_STALE` says « The counts given are not the preview's. » when only `expectedCounts` differ, « The account changed since the preview. » when the groups did.
- `McpDeps` and the tools' deps become `ImportDeps`, which the import service needs (`logger`, `$client`).
- Visual QA on the dev servers with a fresh database: the consent page with « importer », an assistant's OFX import in the « Imports » tab, its lines, and « Annuler l'import ». Screenshots in the pull request.

## Spec Change Log

- Owner rule of 2026-10-07, no divergence from Sure unless forced by money, French text, accessibility, security or the API error contract. Amended Boundaries: 5 lines of each group, as Sure's `import_bank_statement` previews five, not 20. KEEP: the 1 MB and 1.5 MB limits and the counts `confirm_import` compares (security); `VALIDATION_ERROR` and `INVALID_IMPORT_FILE`, and a refused field for a missing `accountId` rather than Sure's account list (API error contract); `preview_import` and `confirm_import`, which Sure leaves to its import page, Archant having none to resume a preview.

## Review Triage Log

| Layer | Finding | Verdict | Route |
|---|---|---|---|
| standards | The 1.5 MB body is read before the token is checked | high | patch: `withinLimit` after `authenticate`; test with a chunked body |
| standards, spec | « The account changed » when only the counts differ | low | patch: its own message |
| standards | The 1.5 MB handler duplicates `tooLarge`, the constant lives in `schemas/` | low | patch: both moved to `mcp/server.ts` |
| spec | Bad base64 test does not check the call record | low | patch |
| standards | The five counts' shape repeated in four places | low | rejected: input schema, output schema, ledger tally and its comparison each need it; a shared list would cross AD-19's boundary for a literal |
| spec | `source` and `reason` are free strings in the output | low | rejected: outputs describe their values, as other tools' do; the closed enums are on inputs |
