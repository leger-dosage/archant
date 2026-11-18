# Epic 19 Context: Split a transaction and attach receipts

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A mixed receipt becomes several lines with their own categories, and a receipt or an invoice sits beside its transaction. A supermarket receipt mixes food and household goods; a transfer to a joint account covers rent and savings. Archant takes Sure's model: a split keeps its parent and adds children that sum to it (`Entry#split!`), the parent is left out of every figure and the children counted instead (`excluding_split_parents`), and a transaction holds up to ten attached files of 10 MB (`has_many_attached :attachments`). It departs from Sure where Archant's ledger rules demand it: restricted foreign keys, stable child ids on edit, children never matched against bank lines, and attachments stored in SQLite.

## Stories

- Story 19.1: Split a transaction in the ledger
- Story 19.2: Split from the interface
- Story 19.3: Attach a receipt to a transaction

## Requirements & Constraints

- The children's amounts sum to the parent's exactly, in integer minor units, mixed signs allowed. Each child copies the parent's account, date, currency and merchant, and has its own label, amount, category, tags and notes.
- The parent keeps its bank figures and its deduplication keys. It is excluded, with `excluded` locked under `origin: "user"`.
- The children count everywhere and the parent nowhere: balances, the list with its count and totals, `cashFlowByCategory`, `countsInCashFlow` and its SQL twin, rule candidates and recurring detection. Transfer matching takes neither a parent nor a child. A rule never clears a parent's exclusion. The cash flow parity test covers splits.
- A transfer side, a pending, excluded or possibly duplicated transaction, a parent or a child cannot be split: `NOT_SPLITTABLE`, as Sure's `splittable?`.
- Editing a split updates children sent with their id in place, creates the others and deletes the missing ones. Sure deletes and recreates them, losing tags, notes and attachments. Unsplitting deletes the children and lifts the parent's exclusion.
- An ingested bank or file line finds a parent through its keys and writes nothing. A child is never a pairing or duplicate candidate, and is never absorbed; a parent cannot be absorbed or merged. QIF split records stay unread.
- Deleting a parent, whether alone, in bulk, by an import revert or with its account, deletes its children first in the same transaction, and tombstones its bank keys as today.
- MCP: `get_transactions` lists children, not parents. `update_transaction` refuses amount and exclusion changes on a parent or a child.
- Attachments: at most 10 per transaction, 10 MB each, JPEG, PNG, GIF, WebP or PDF, as Sure's `validate_attachments`. The type is read from the file's first bytes and must match an allowed type. The name is cleaned. An eleventh file or an oversized one is refused with a field code. The upload route has its own body limit, and every upload is parsed by Zod.
- An attachment is served with its type, `Content-Disposition` naming the file, `X-Content-Type-Options: nosniff` and a `sandbox` Content-Security-Policy.
- Deleting a transaction, its account, or reverting its import deletes its attachments in the same transaction.
- The ledger's split module is covered to the branch. Every acceptance criterion has a test: Playwright for what the interface shows, Vitest for the rest.

## Technical Decisions

- `entries.parent_entry_id` references `entries` with `ON DELETE RESTRICT`; the ledger deletes children first rather than cascading. Only `services/ledger/` writes `entries`, `transactions`, keys, balances and transfers.
- `services/ledger/splits.ts` owns `splitTransaction`, `editSplit` and `unsplitTransaction`. Each takes an `origin` and runs in one transaction opened with `behavior: "immediate"`, recomputing the affected balances before committing.
- Entry ids never change. An edited split keeps its children by id, so tags, notes and attachments stay attached.
- Cash flow is defined once in `domain/cash-flow.ts` and the report query builder in `services/reports.ts`. A split parent is excluded, so cash flow drops it unchanged; every other reader drops parents through one predicate in `services/ledger/shared.ts`.
- Transfer matching in `domain/transfer-matching.ts` must exclude children as candidates, and the parent is already excluded.
- Only a `user` origin writes `locked_fields`; the parent's `excluded` lock follows that rule.
- Attachments live in `transaction_attachments (id, transaction_id, filename, content_type, byte_size, content, created_at)`, the content stored as a blob, like `imports.content`. The `VACUUM INTO` backup and a Turso database then hold them, and the container's root filesystem stays read-only. Service code goes in `services/attachments.ts`.
- The attachment download sits outside the `{ data }` envelope, like the export.
- Export: `all.ndjson` nests `split_lines` under the parent and `transactions.csv` lists the children, as Sure's exporter. `attachments.json` lists attachments without their content, as Sure's manifest. Every new column or table goes into `EXPORTED_COLUMNS` or `LEFT_OUT` in `services/ledger/export.ts`, or the export spec fails.
- Logs never carry an amount, a label or a file name tied to an identity. Failures are sanitised `AppError`s with closed SCREAMING_SNAKE_CASE codes.

## UX & Interaction Patterns

- A splittable transaction's sheet offers « Diviser ». The dialog lists lines of label, amount and category, « Ajouter une ligne », and a « Reste à répartir » counter that turns red until it reaches zero; « Diviser » stays disabled until then, as Sure's split dialog.
- The list always groups children under their parent, with no preference to turn it off. The parent shows muted with a « Divisée » badge and its children indented below it. Filters, count and totals follow the children.
- A parent's sheet lists its children with « Modifier la division » and « Annuler la division ». A child's sheet shows its parent and edits its own label, category, tags and notes, never its date or account.
- « Pièces jointes » in the sheet lists each file with its size, « Ajouter », and a delete with confirmation. A child of a split has its own attachments. Images and PDFs open in a new tab; other files download.
- Visible strings go through i18next in French. The sheet stays usable with the keyboard alone and meets WCAG 2.2 AA contrast.

## Cross-Story Dependencies

- Story 19.1 comes first, then 19.2, which builds the interface on its ledger functions. Story 19.3 is independent.
- Epic 18's export already exists; this epic extends it in the same stories.
- Epic 20's viewer role refuses every write, so split and attachment routes must be mutating methods covered by its middleware.
- Epic 22 reuses the split parent's rules: a transaction converted into a trade is a parent whose only child is the trade, excluded, locked and keeping its keys.
