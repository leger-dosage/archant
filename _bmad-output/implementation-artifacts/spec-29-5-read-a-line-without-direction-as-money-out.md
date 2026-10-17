---
title: "Story 29.5: Read a line without direction as money out, as Sure"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: '2842d8aef5dcf2c29f5ba6075e1856531f273c6f'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-29-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure's `EnableBankingEntry::Processor` (at `00dd977fb`) signs a line by `credit_debit_indicator == "CRDT" ? -absolute_amount : absolute_amount` (`amount_value`), reads the counterparty on the debtor side for `CRDT` and on the creditor side otherwise (`counterparty_name`), and names a line with no text `"CRDT" ? "Incoming Transfer" : "Outgoing Transfer"` (`name`): only `CRDT` is money in, and a line with no indicator, or one Sure does not know, is money out. Archant's `toTransaction` refuses such a line with `INVALID_AMOUNT`, so a line Sure keeps is missing from the statement.

**Approach:** The Enable Banking connector keeps the bank's indicator as it comes, and `toTransaction` reads a line as a credit only when it is exactly `CRDT`; every other line is a debit, its counterparty, label and merchant read as a debit's.

## Boundaries & Constraints

**Always:**
- `transactionSchema.credit_debit_indicator` keeps any string the bank sends, else `null`; `toTransaction` reads `debit = indicator !== "CRDT"`, compared exactly as Sure's `==`, so `crdt`, `OTHR`, an empty string and a missing field are money out.
- A debit is negative, its counterparty the creditor, its last-resort label « Virement sortant », for `labelOf`, `keyLabelOf` and `merchantNameOf` alike.
- `contentKey` hashes the indicator as the bank sent it, as Sure's `compute_external_id` and importer dedup key use the raw `direction`: two copies differing only by an unknown indicator stay two lines, a missing and an unknown one included.
- A line without a readable amount still refuses with `INVALID_AMOUNT`; only the direction stops refusing.
- AD-18 states only `CRDT` is money in; `docs/sure-parity.md` « Line without debit/credit indicator » becomes Parity.

**Never:** no change to the balance's sign (`balanceSchema`, `chooseBalance`); no change to the CSV, OFX or QIF connectors; no pending rule change (Story 29.6); no migration; no new dependency; no visible change beyond the line now listed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Missing indicator | no `credit_debit_indicator`, creditor `Boulangerie`, `10.00` | `-1000`, label and merchant `Boulangerie` | none |
| `null` indicator | `credit_debit_indicator: null` | same as missing | none |
| Unknown indicator | `OTHR`, `crdt`, `""`, a number | money out, creditor read | none |
| Negative amount, no indicator | `-10.00` | `-1000` | none |
| No text at all | no indicator, no counterparty, code or remittance | label and key label « Virement sortant », no merchant | none |
| Debtor only | no indicator, debtor `Employeur`, no creditor | debtor ignored, label from the code or remittance | none |
| `CRDT` | unchanged | positive, debtor read | none |
| Unreadable amount | no indicator, amount `douze` | refused | `INVALID_AMOUNT` |
| Copies | same content, indicator missing in one, `OTHR` in the other | two lines | none |

</frozen-after-approval>

## Code Map

- `packages/api/src/connectors/enable-banking/schemas.ts` -- `transactionSchema.credit_debit_indicator` becomes a forgiving string.
- `packages/api/src/connectors/enable-banking/client.ts` -- `toTransaction` reads `debit` as anything but `CRDT` and no longer refuses a line for its direction; its comment and doc.
- `packages/api/src/connectors/enable-banking/client.spec.ts` -- missing, `null` and unknown indicators, the sign, the creditor, « Virement sortant », the refusal kept for the amount, the content key.
- Docs: `docs/architecture.md` AD-18, `docs/sure-parity.md` row « Line without debit/credit indicator ».
- Sure, read-only, at `00dd977fb`: `app/models/enable_banking_entry/processor.rb` (`amount_value`, `counterparty_name`, `name`, `compute_external_id`).

## Tasks & Acceptance

**Execution:**
- [x] Vitest first, failing: a missing, a `null` and an unknown indicator mapped as money out with the creditor; a negative amount without indicator; « Virement sortant » for a line without text; the unreadable amount still refused; two copies differing by an unknown indicator kept apart; the statement no longer rejecting the line.
- [x] Schema and `toTransaction`.
- [x] AD-18 and the parity row.

**Acceptance Criteria:**
- Given a bank line whose `credit_debit_indicator` is missing or unreadable, when the sync reads it, then it is ingested as money out with its creditor as counterparty, never refused with `INVALID_AMOUNT`.
- Given such a line with no counterparty, code description or remittance, when its label is chosen, then it reads « Virement sortant ».
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass with no request reaching Enable Banking.

### Review Findings

Second pass, `bmad-code-review` (four layers) over the committed tree.

- [x] [Review][Patch] The why of reading a line without indicator as money out, a signed amount included, left unsaid [packages/api/src/connectors/enable-banking/client.ts]
- [x] [Review][Patch] « as the bank sent it » held only for a string; `contentKey` is also Sure's `build_transaction_content_key` [packages/api/src/connectors/enable-banking/schemas.ts, docs/architecture.md]
- [x] [Review][Patch] No test of a line with only a debtor and no text naming « Virement sortant » [packages/api/src/connectors/enable-banking/client.spec.ts]

Rejected:
- `low` A non-string indicator hashed as none, where Sure's `to_s` keeps it: no bank is known to send one; AD-18 and the schema now say so.
- `low` A test where the key is truly absent rather than `undefined`: Zod reads both the same.
- `low` No `withoutSettledPending` test for a pending line without indicator and a booked `DBIT` copy: Sure keys them apart the same way, and the ledger's pending match still pairs them.
- `low` No `""` or `crdt` variant in the copies test: `OTHR` and a missing one already pin the raw key.
- `low` No warning logged for an unknown indicator: Sure logs none; the line is listed.
- `low` Lines refused before this story are lost beyond the next window: true, said in the pull request; a re-read is out of the story.
- `false` « Same line twice » parity row outdated: it still says the direction is part of the key, which holds.

## Design Notes

Assumptions taken alone, each settled by Sure. The comparison is exact and case-sensitive, as Sure's `== "CRDT"`. The content key keeps the raw indicator, as Sure's `compute_external_id` joins `direction.to_s`. Lines refused before this story arrive on the next sync whose window covers them, like any new line; nothing needs a migration. No Playwright test and no screenshot: the story asks Vitest only, and no screen changes, the line appearing in the existing transaction list. The balance's own indicator is left as it is: the story covers lines only.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | AD-18's new sentence reads as covering balances, which still negate only `DBIT` | low | patch | AD-18 now says a line's sign, and that a balance's is negative only for `DBIT`. |
| 2 | Parity row says « Parity. » without its story | low | patch | Now « Parity. Story 29.5. », as its neighbours. |
| 3 | Parity row hides the case-sensitive comparison | low | patch | The Archant cell now says « compared exactly ». |
| 4 | Content key tells `null` from `""`, and a non-string indicator falls to `null`, where Sure's `to_s` differs | low | reject | Two copies of one line differing only so are not seen; normalising adds a branch for no known bank. |
| 5 | An unknown indicator is now silent, with no log | low | reject | Sure logs nothing either; the line is listed, not lost. |
| 6 | Lines refused before this story only return if the next window covers them | low | reject | True: a later sync reads from the last success less 7 days. The fix would edit this spec; the pull request says it plainly. |
| 7 | No sync-level test of a line without indicator | low | reject | The ingest is unchanged; `fetchStatement` covers the line reaching the statement unrefused. |
| 8 | A pending copy without indicator and a booked `DBIT` copy stay two lines in one response | false | reject | Sure's `compute_external_id` and dedup key hash the raw direction too; the ledger's pending match still pairs them. |
| 9 | The indicator loop does not say which value failed | low | reject | Cosmetic; `toMatchObject` shows the received line. |
| 10 | No side-by-side `CRDT` and `crdt` test | false | reject | « keeps a credit positive and names its debtor » and the new loop cover both sides. |
| 11 | `toTransaction` doc and `INVALID_AMOUNT`'s MCP description not updated | false | reject | Both still hold: a line can still be refused, and `INVALID_AMOUNT` still means an unreadable amount. |
| 12 | Spec and sprint status missing from the diff | false | reject | Excluded from the review diff on purpose. |
| 13 | A bank that signs amounts and omits the indicator books income as an expense | false | reject | Sure's `amount_value` takes the absolute value too; the story asks for Sure's reading. |
| 14 | `CRDT ` with padding or `crdt` booked as a debit | false | reject | Sure's `== "CRDT"` does the same; the story asks for it. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
