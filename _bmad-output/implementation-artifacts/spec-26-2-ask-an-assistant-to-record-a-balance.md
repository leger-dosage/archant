---
title: 'Story 26.2: Ask an assistant to record a balance'
type: 'feature'
created: '2026-10-07'
status: 'done'
baseline_commit: '6f86a6a0df00ae2299c63fc94224c936d0cbbedf'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-26-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An assistant connected through `/api/mcp` reads an account's balance today and its history, but neither the snapshots of its « Soldes » tab nor any way to record one: the owner types a loan table's, an appraisal's or a statement's figure in the dialog themselves.

**Approach:** Add Sure's `get_valuations` (`archant:read`) and `record_valuation` (`archant:write`) in a new `mcp/snapshots.ts`, calling `listAccountSnapshots` and `createSnapshot` of `services/snapshots.ts`, as the « Soldes » tab and its dialog do (AD-19, AD-8, FR98). Story 26.2 of `epics.md` is the acceptance contract; this spec adds what reading the code and Sure settled.

## Boundaries & Constraints

**Always:**
- `get_valuations`: `accountId`, `page` (default 1); 50 a page, the tab's `DEFAULT_PAGE_SIZE`, no `pageSize`. Returns `items`, each `id`, `date`, `balance`, `computed`, `gap` (decimal strings), `currency`, then `page`, `pageSize`, `total`, most recent first. Unknown account: `NOT_FOUND`. `READ_ONLY`; no `BANK_TEXT`, since nothing there is text.
- `record_valuation`: `accountId`, `date` (YYYY-MM-DD), `balance` (decimal string, parsed in the account's currency as the dialog's field). Passed raw to `createSnapshot`. Returns the snapshot as `get_valuations` gives it, plus `accountId` and `replacedExisting`. `REPLACES`; `changedRows` 1, new or replaced.
- `replacedExisting` is known inside the ledger's write: `recordSnapshot` in `services/ledger/snapshots.ts` returns `replaced` beside `id`, and `createSnapshot` returns `replacedExisting` beside the record, so `POST /api/accounts/:id/snapshots` answers it too.
- The description says the balance is the stored one (AD-5): what an asset holds or is worth, what a liability still owes, both positive; an overdraft is negative. From its date the balance follows the snapshot, then the transactions after it.
- Refusals are the dialog's: `VALIDATION_ERROR` on `date` with `not_after_opening_date` or `date_in_future`, on `balance` with `invalid_amount`; unknown account `NOT_FOUND`.
- `INSTRUCTIONS` gains: before `record_valuation`, tell the owner the account, the date, the balance and where the figure comes from, such as a statement, a loan table or an appraisal, and wait for their agreement; never record a figure the owner or a document did not give.
- The consent page's write scope reads « Créer et modifier vos règles, classer vos opérations, rapprocher vos virements, définir vos budgets et vos soldes, gérer vos factures ».

**Never:** no citation or `source` field (a snapshot has no notes, AD-8); no tool that moves or deletes a snapshot; no new route, screen or error code; no write from a read tool.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Page | checking with two snapshots | both, latest first, each with computed and gap; page 2 empty, total 2 |
| Record | checking, a past date after opening | the balance follows the figure from that date; `replacedExisting: false` |
| Replace | same date again | same id, new balance, one snapshot, `replacedExisting: true` |
| Before opening | the opening date | `VALIDATION_ERROR` `date` `not_after_opening_date`, nothing written |
| Future | tomorrow | `VALIDATION_ERROR` `date` `date_in_future` |
| Bad amount | `"12,345"` in euros | `VALIDATION_ERROR` `balance` `invalid_amount` |
| Liability | a mortgage, `"175000.00"` | `get_accounts` gives the loan `175000.00` owed |
| Unknown | `accountId` names nothing | `NOT_FOUND`, both tools |
| Read token | `record_valuation` | `403 insufficient_scope`, recorded, nothing written |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/snapshots.ts` -- `listAccountSnapshots`, `createSnapshot` (`REJECTION_FIELDS`).
- `packages/api/src/services/ledger/snapshots.ts:102` -- `recordSnapshot`, `RecordSnapshotResult`: `existing` already known there.
- `packages/api/src/schemas/snapshots.ts` -- `createSnapshotSchema`, the dialog's codes.
- `packages/api/src/schemas/transactions.ts:218` -- `DEFAULT_PAGE_SIZE`.
- `packages/api/src/mcp/transfers.ts`, `mcp/tool.ts` (`READ_ONLY`, `REPLACES`, `decimal`), `mcp/server.ts` (`TOOLS`, `INSTRUCTIONS`), `mcp/server.spec.ts` (`READ_TOOLS`, `WRITE_TOOLS`, hints, instructions).
- `packages/api/src/schemas/assistants.ts` -- the two inputs.
- `packages/api/src/mcp/transfers.spec.ts` -- the pattern: `ownDatabase`, `assistants()`, `calls()`.
- `packages/api/src/routes/accounts.spec.ts:1199` -- the replace test gains `replacedExisting`.
- `packages/app/src/locales/fr.json:2052`, `packages/app/e2e/assistants.spec.ts` (`READ_TOOLS`, consent label).
- Docs: `docs/deployment.md` « Connecting an assistant », `docs/security-model.md` « Assistants », `docs/sure-parity.md` « Entries and balances » and « Assistant tools ».

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/mcp/snapshots.spec.ts` -- first: every matrix row through the MCP handler, each call recorded with its count; the balance read through `get_accounts`' series.
- [x] `services/ledger/snapshots.ts`, `services/snapshots.ts`, `routes/accounts.spec.ts` -- `replaced` and `replacedExisting`.
- [x] `schemas/assistants.ts`, `mcp/snapshots.ts`, `mcp/server.ts`, `mcp/server.spec.ts` -- inputs, two tools, `TOOLS`, `INSTRUCTIONS`, lists and hints.
- [x] `fr.json`, `e2e/assistants.spec.ts` -- consent label, read tool list.
- [x] Docs in the Code Map; `epics.md` needs no edit, since Epic 26 already dropped snapshots from Epic 16's left-out list.

**Acceptance Criteria:**
- Given Story 26.2 of `epics.md`, when the story ships, then each criterion holds with the decisions this spec records.
- Given a read token, when `tools/list` runs, then `get_valuations` is listed read-only and `record_valuation` is not.

## Implementation Notes

- Sure, read at `afdac0a8c` in the local clone, settles every shape: `record_valuation` and `get_valuations` keep its names and its `replaced_existing`; the departures are the epic's (no citation, one account, a decimal string).
- On an account a bank syncs, a reconciliation fixes its own day and the days before derive from it (`recomputeBackward`, `bank-link.spec.ts`), so the description, `INSTRUCTIONS` and both docs add that today's balance stays the bank's there. « From its date » stays true of every other account, as the epic says.
- `INSTRUCTIONS` also tells the assistant to check `get_valuations` and say when a snapshot already holds the date, since the replace is silent, as the dialog's.
- `POST /api/accounts/:id/snapshots` answers `replacedExisting` too; the interface ignores it.
- `get_valuations` sits after `get_holdings`, `record_valuation` after `unpair_transfer`, in `TOOLS` and both tool lists.
- Standards review: the sign sentence repeated in the description, the input and `INSTRUCTIONS` is kept, each read by the assistant in its own place; `replaced` in the ledger and `replacedExisting` at the service follow the ledger's terse result and Sure's answer name.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind | « From that date the balance follows the snapshot » is wrong for a bank-linked account | medium | `recomputeBackward` in `services/ledger/balances.ts`: a reconciliation fixes its day and the days before derive from it; `bank-link.spec.ts:74` | patch: description, `INSTRUCTIONS`, both docs |
| blind | A replace overwrites the owner's figure without the assistant saying so | low | The dialog replaces too, and Sure answers `replaced_existing`; the instructions did not ask to check `get_valuations` first | patch: one instruction line |
| blind | A replace detaches an imported snapshot from its import | low | `recordSnapshot` sets `importId: null`, as the dialog's save does | rejected: same as the interface |
| blind | No test of a Sure-shaped call, `amount` as a number and a `source` | low | `recordValuationInput` is strict | patch: one test |
| blind | `"1,50"` reads as 1.50, not 150 | low | `parseAmount` is the dialog's reader; every amount tool passes it raw | rejected: consistent with `create_bill` and `update_budget` |
| edge | `"1,500"` in a three-decimal currency reads as 1.500 | low | Same reader as the dialog and every amount tool; assistants are told amounts are decimal strings | rejected: consistent across tools |
| blind | No overdraft or card case through the tool | low | `routes/accounts.spec.ts` « stores a card's amount owed and an overdraft as typed »; the tool passes the text raw | rejected: covered below the tool |
| blind | Refusal tests check a substring only; no date strictly before opening | low | The code substring names the code; `snapshotRejectionFor` is covered in the domain | rejected |
| blind, verification | `sprint-status.yaml` `last_updated` moved backwards | low | Earlier value 16:00 | patch |
| blind | Spec `in-review` while sprint status says `in-progress` | false | Mid-workflow; both become `done` at step 5 | rejected |
| blind | `get_valuations` does not say whether a snapshot came from an import | low | The « Soldes » tab does not either; Sure gives notes, which Archant has none of | rejected |
| blind | `changedRows` 1 undercounts the daily balances rewritten | false | `changedRows` counts the rows a tool writes on the owner's behalf, as every ledger tool does; balances are derived | rejected |
| edge | A negative balance on a liability is accepted | false | A card in credit is a negative liability; the dialog accepts it | rejected |
| edge | The snapshot deleted between the write and the re-read answers NOT_FOUND | low | Same path as the route; needs a concurrent delete within one request | rejected |
| edge | A huge `page` overflows the offset | low | `pageFields.page` is shared by every paged tool | rejected: pre-existing, unlikely |

## Design Notes

Sure's `record_valuation` takes `amount` as a JSON number and a required `source` citation stored in the entry's notes; Archant takes `balance` as a decimal string, the route's field name, and no citation (AD-8, epic). Sure's `get_valuations` lists every account's valuations, anchors included, with optional dates; Archant's reads one account's snapshots as the tab does, the opening balance and the bank's figure being in `get_accounts`. `replaced_existing` is Sure's answer field, kept in camel case.

The tool file is named after the service, `snapshots.ts`, as `transfers.ts` is; the tools keep Sure's names.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green
- `pnpm test:e2e` -- expected: green, consent label updated
