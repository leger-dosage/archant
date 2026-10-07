# Epic 26 Context: Let an assistant correct my accounts

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let an assistant connected through `/api/mcp` correct the household's accounts, not only classify them. The owner asked on 2026-10-04, after transfer matching paired two unrelated lines of the same amount and fixing it meant leaving the conversation. They named five things: create and delete a transaction, import a statement file, record a balance snapshot, create a savings goal, and pair or unpair a transfer. Sure was read on `origin/main` at `e480350d1` (4 October 2026); its tools live in `app/models/assistant/function/`. Epic 16 kept these writes out because a sentence hidden in a bank label could aim at them; Epic 26 shapes each write around that risk instead: the owner's agreement before every write, guards that name what the owner was shown, the interface's own service functions, and the call record of `assistant_calls`.

## Stories

- Story 26.1: Ask an assistant to fix a transfer
- Story 26.2: Ask an assistant to record a balance
- Story 26.3: Ask an assistant about my savings goals
- Story 26.4: Ask an assistant to record or delete a transaction
- Story 26.5: Ask an assistant to import a bank file

## Requirements & Constraints

- FR96 to FR100 and the revised NFR19: a tool deletes one transaction per call, and only while its account, date and amount still equal the ones the call names; every other write goes through the service function the interface calls.
- Read tools need `archant:read`, write tools `archant:write`. A token counts only while the user who consented is an administrator; a viewer connects no assistant. A write called with a read-only token answers `403 insufficient_scope` before any tool runs, and is recorded.
- Each call is recorded in `assistant_calls` with its client, tool, time, outcome and changed count, never its arguments or answer; a file sent to a tool is never logged nor recorded.
- No preview flag: Archant has none, so every tool is listed for every token holding its scope.
- Every input is parsed by a Zod schema in `schemas/assistants.ts`; amounts cross as decimal strings beside their currency, references as ids from a list tool, never names.
- Each read tool returning bank-written text carries `BANK_TEXT` in its description.
- The server's `INSTRUCTIONS` gain one paragraph per tool group, each ending on the owner's agreement before the write.
- Vitest covers each tool through the MCP handler, a read-only token refused and each write recorded with its count.

## Technical Decisions

- AD-19: tools live in `packages/api/src/mcp/`, one file per resource; each parses its input, calls exactly one service function with the route's `deps`, never imports `db`. Annotations from `mcp/tool.ts`: `READ_ONLY`, `CREATES`, `SETS`, `REPLACES`, `DESTROYS`.
- A transaction, a snapshot, a goal or a transfer an assistant creates is the user's (`origin: "user"`), as the owner asked for it; an import keeps the `sync` origin of every import (AD-10).
- Transfers (26.1): `get_transfer_candidates`, `pair_transfer` and `unpair_transfer`, which Sure lacks, call `listTransferCandidates`, `createTransfer`, `deleteTransfer` and `rejectTransfer` of `services/transfers.ts`, as « Rapprocher un virement », « Dissocier » and « Ne plus proposer » do (FR32, AD-11). A refused pair is never offered again by any search.
- Snapshots (26.2): `get_valuations` as Sure's, every active account's valuations, anchors included, or one account's, between optional dates, through `listValuations`; `record_valuation` through `createSnapshot`, replacing one on the same date, with Sure's required `source` citation appended to the snapshot's notes (AD-8).
- Goals (26.3): `get_goals` through `listGoals` and `getGoalsSummary`; `create_goal` through `createGoal` by account ids, reserves included, with no icon as Sure's, the goal showing its initial. Editing and ending a goal stay in the interface.
- Transactions (26.4): `create_transaction` through `createTransaction` in the account's currency, signed per AD-5, no external key (AD-7); `delete_transaction` names account, date and amount, compared inside the ledger's write, else `TRANSACTION_CHANGED` (409); a deleted bank line's keys become tombstones.
- Imports (26.5): `import_bank_statement`, `preview_import` and `confirm_import` through `services/imports.ts`, five lines of each group as Sure's preview, OFX, QIF and CSV, at most 1 MB decoded, `/api/mcp`'s body limit raised to 1.5 MB for it alone; confirm takes the five counts the owner saw, else `IMPORT_PREVIEW_STALE`.
- Snapshots are not deleted or moved, an import is not reverted, and no tool merges a possible duplicate or deletes in bulk.

## UX & Interaction Patterns

- No new screen. The consent page's write scope label in `packages/app/src/locales/fr.json` grows with each story: 26.1 « rapprocher vos virements », 26.2 « vos soldes », 26.3 « vos objectifs », 26.4 « saisir, classer et supprimer vos opérations », 26.5 « importer ». `packages/app/e2e/assistants.spec.ts` reads it.

## Cross-Story Dependencies

- Story 26.1 comes first: it is the owner's case. Stories 26.2 to 26.5 follow in any order, one at a time, since each edits `mcp/server.ts`, `docs/deployment.md` « Connecting an assistant » and `docs/security-model.md` « Assistants ».
- Outside the epic: Epic 16's MCP server and Story 23.6's bill tools, Spec 5.2's transfer matching, Story 21.1's goals, Epic 19's splits and attachments, Epic 2's imports.
