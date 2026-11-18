## Approach

Keep creation in dialogs. Scope the responsive drawer layout to existing snapshots, trades and transactions. Keep the existing Escape, discard confirmation and focus behaviour, and keep the transaction form's explicit save from Story 34.9.

Use a note-only write on blur. In a snapshot it must not commit a pending reconciliation, and in a trade or transaction it must not submit other edited fields. Keep a failed note in the form and expose the error so the editor can retry. Trades need to read and write their entry note on the server.

`LoanOverview.tsx` uses two columns on a phone because full-size money values overflowed. Fit three at 390 px with readable wrapping or smaller type. At narrower or zoomed widths, allow the cards to reflow before they overflow.

## Source

Story 34.10 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.
