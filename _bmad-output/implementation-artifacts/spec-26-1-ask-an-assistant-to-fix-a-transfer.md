---
title: 'Story 26.1: Ask an assistant to fix a transfer'
type: 'feature'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
baseline_commit: 'b62cbd7e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-26-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Transfer matching paired two unrelated lines of the same amount, and an assistant connected through `/api/mcp` can see a transfer's kind and other account but neither its id nor its other side, and has no tool to pair, unpair or refuse a pair: the owner leaves the conversation for « Rapprocher un virement », « Dissocier » or « Ne plus proposer ».

**Approach:** Give the read tools the transfer's id, the other side's transaction id and the list's suggestion flag, and add three tools Sure lacks in a new `mcp/transfers.ts`: `get_transfer_candidates` (`archant:read`), `pair_transfer` and `unpair_transfer` (`archant:write`), each calling the service function of `services/transfers.ts` the interface calls (AD-19, AD-11, FR32, FR100). Story 26.1 of `epics.md` is the acceptance contract; this spec adds what reading the code settled.

## Boundaries & Constraints

**Always:**
- `transfer` in `get_transactions` and `get_transaction` gains `id` and `counterpartTransactionId` beside `kind` and the account fields; each item of both gains `transferSuggested`. `transferColumns` in `services/ledger/shared.ts` selects `counterpartEntry.id` as `counterpartTransactionId`, so `TransferLink` carries it for the routes too.
- `get_transfer_candidates`: `transactionId`; returns `candidates`, each `id`, `date`, `label`, `amount` (signed decimal string), `currency`, `accountId`, `accountName`, in `listTransferCandidates`' order. Unknown id: `NOT_FOUND`. In a transfer: empty list. `BANK_TEXT`; `READ_ONLY`.
- `pair_transfer`: `transactionId`, `counterpartId`, through `createTransfer`; returns `id`, `kind`, `outflowTransactionId`, `inflowTransactionId`. No candidate, a refused pair included: `VALIDATION_ERROR` on `counterpartId`, `not_a_candidate`. Unknown `transactionId`: `NOT_FOUND`. `CREATES`; `changedRows` 1.
- `unpair_transfer`: `transferId`, `neverPropose` (boolean, default false). False goes through `deleteTransfer`, true through `rejectTransfer`; the description says a refusal cannot be undone. Returns `transferId`, `outflowTransactionId`, `inflowTransactionId` and `neverPropose`, the two ledger functions returning the pair they deleted. Unknown id: `NOT_FOUND`. `DESTROYS`; `changedRows` 1, the transfer undone.
- `INSTRUCTIONS` gains: before `pair_transfer` or `unpair_transfer`, show the owner both sides with `get_transaction` and wait for their agreement; ask whether the pair should never be proposed again before passing `neverPropose`.
- The consent page's write scope reads « Créer et modifier vos règles, classer vos opérations, rapprocher vos virements, définir vos budgets, gérer vos factures ».

**Never:** no tool creates a transfer's leg (Sure's « Créer un virement », AD-11 links existing rows only); no way to lift a refusal; no new route or screen; no write from a read tool; no new error code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Linked pair | −500 checking, +500 Livret A, matched | both read tools give `transfer.id` and the other side's id |
| Suggested | −500 checking, +500 on two other accounts | `transferSuggested: true` on the checking line |
| Candidates | the checking line, unlinked | the Livret A line, decimal amount, account name |
| In a transfer | a linked side | `candidates: []` |
| Unknown | `transactionId` names nothing | `NOT_FOUND` |
| Pair | checking line and its candidate | transfer `internal_move`, outflow the checking line |
| Not a candidate | a line of the same account or another amount | `VALIDATION_ERROR` `counterpartId` `not_a_candidate`, nothing written |
| Unpair | `neverPropose` omitted | transfer gone; categories, locks and tags as they were; the pair is a candidate again |
| Refuse | `neverPropose: true` | transfer gone, the pair is no candidate, `pair_transfer` on it refused |
| Unknown transfer | `transferId` names nothing | `NOT_FOUND` |
| Read token | `pair_transfer` or `unpair_transfer` | `403 insufficient_scope`, recorded, nothing written |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/transfers.ts` -- `listTransferCandidates`, `createTransfer`, `deleteTransfer`, `rejectTransfer`.
- `packages/api/src/services/ledger/transfers.ts` -- `transferCandidates`, `matchTransfer` (`not_a_candidate`), `unmatchTransfer`, `rejectTransfer`; the last two return the deleted pair.
- `packages/api/src/services/ledger/shared.ts:274` `transferColumns`, `TransferColumns`; `services/ledger/queries.ts:83` `TransferLink`, `withTransferLink`.
- `packages/api/src/mcp/transactions.ts` -- `transaction`, `itemOf`, `transactionDetail`, `detailOf`.
- `packages/api/src/mcp/tool.ts`, `mcp/server.ts` (`TOOLS`, `INSTRUCTIONS`), `mcp/server.spec.ts` (`READ_TOOLS`, `WRITE_TOOLS`, annotations).
- `packages/api/src/schemas/assistants.ts` -- the three inputs.
- `packages/app/src/components/TransactionLinks.tsx:60` -- builds a `TransferLink` after a match: gains `counterpartTransactionId`.
- `packages/app/src/locales/fr.json:2033`, `packages/app/e2e/assistants.spec.ts:240` -- consent label.
- Docs: `docs/deployment.md` « Connecting an assistant », `docs/security-model.md` « Assistants », `docs/sure-parity.md` « Pairing by an assistant » and « Assistant tools » rows.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/mcp/transfers.spec.ts` -- first: every matrix row through the MCP handler, each call recorded with its count.
- [x] `services/ledger/shared.ts`, `services/ledger/queries.ts`, `services/ledger/transfers.ts`, `services/transfers.ts` -- `counterpartTransactionId`; the pair returned by an unpair.
- [x] `schemas/assistants.ts`, `mcp/transactions.ts`, `mcp/transfers.ts`, `mcp/server.ts`, `mcp/server.spec.ts` -- read fields, three tools, `TOOLS`, `INSTRUCTIONS`, tool lists and annotations.
- [x] `TransactionLinks.tsx`, `fr.json`, `e2e/assistants.spec.ts` -- the new field and the consent label.
- [x] Docs in the Code Map; `epics.md` needs no edit, since Epic 26 already dropped transfers from Epic 16's left-out list.

**Acceptance Criteria:**
- Given Story 26.1 of `epics.md`, when the story ships, then each criterion holds with the decisions this spec records.
- Given a read token, when `tools/list` runs, then `get_transfer_candidates` is listed read-only and neither write is.

## Design Notes

Sure has no transfer tool, so the three tools follow Archant's own interface: the picker, « Dissocier » and « Ne plus proposer », through the same service functions, so the candidate search that refuses a rejected pair in the picker, an import and a sync refuses it here too.

Inputs name `transactionId` and `counterpartId`, the body of `POST /api/transfers`, rather than `get_transaction`'s `id`, so the two transfer tools read alike.

`unpair_transfer` is one tool with a flag, as the epic names it, rather than two: « Dissocier » and « Ne plus proposer » sit side by side on the sheet. Its answer gives the two sides so the assistant can read them again for the owner.

`changedRows` counts transfers: one for a pair, one for an unpair whether it refuses the pair or not. The transactions themselves keep every field.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green
- `pnpm test:e2e` -- expected: green, consent label updated

## Implementation Notes

- Sure, read at `e480350d1`, has no transfer tool, so nothing here departs from a Sure tool; the shapes follow Archant's picker and `POST /api/transfers`.
- The consent label keeps « gérer vos factures », which Story 23.6 added after the epic was written; « rapprocher vos virements » goes where the story places it.
- `DELETE /api/transfers/:id` and `POST /api/transfers/:id/reject` now answer the two sides beside the id, since `deleteTransfer` and `rejectTransfer` return what the tool gives; the interface ignores the answer.
- `transferSuggested` also reaches `get_transaction`, which extends `get_transactions`' shape.
- MCP specs may not read the database (`.oxlintrc.json`, AD-19): `mcp/transfers.spec.ts` reads transfers through the transaction list. Locks surviving an unpair stay covered by `services/ledger/transfers.spec.ts`.
- `packages/app/e2e/assistants.spec.ts` lists `get_transfer_candidates` among the read tools.

## Spec Change Log

- Owner rule of 2026-10-07, checked against Sure at `56140319d`: Sure still has no transfer tool, so nothing here departs from one; no change.
- Owner rule of 2026-10-07, settled for the field names: every assistant tool names its input and output fields in snake case, Sure's names where Sure's function has the field, the snake case of Archant's own otherwise, so the server uses one style throughout; a refusal names the tool's field. The HTTP API keeps camel case. KEEP: amounts as decimal strings (money). Here: `transaction_id`, `counterpart_id`, `transfer_id`, `never_propose`, `outflow_transaction_id`, `inflow_transaction_id`; a candidate's label is `name`.

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| spec | Locks after an unpair not asserted through the MCP handler | low | An MCP spec may not import the schema; `services/ledger/transfers.spec.ts` asserts `lockedFields` around `unmatchTransfer` and `rejectTransfer` | rejected: covered below the tool |
| spec | `unpair_transfer` NOT_FOUND not checked in `assistant_calls` | low | Every other test checks it | patch |
| spec | Spec status and checklist behind `sprint-status.yaml` | low | Mid-workflow state | patch |
| standards | `get_transfer_candidates` does not say an excluded line or a split's line has none | low | `matchableSide` in `services/ledger/transfers.ts` | patch: description |
| standards | `INSTRUCTIONS` simplify matching to « the only one nearby » | low | `mutualMatches`: each side the other's only candidate | patch |
| standards | `pair_transfer` does not name `NOT_FOUND` | low | `matchTransfer` throws it for an unknown id | patch: description |
| standards | `household()` hides a failed automatic match behind `""` | low | Later assertions would fail with a misleading message | patch: throws |
