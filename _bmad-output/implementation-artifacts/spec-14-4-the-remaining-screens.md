---
title: 'Story 14.4: The remaining screens'
type: 'feature'
created: '2026-09-29'
status: 'in-review'
baseline_commit: '0787fdc52125f702e8ad22d56084a9eb11c1a5e3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-14-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After Stories 14.1 to 14.3, the recurring page, the rules page and the settings pages still draw their lists as Epic 12's bordered sections with 36 px table rows and 20 px icons, their introductions sit in the content rather than the page header, empty states are dashed boxes or bare blocks, badges are 20 px, and small text and controls remain: 12.8 px small buttons, a 13 px IBAN, 24 px chip buttons, a 27 px tab.

**Approach:** Apply Sure's settings list pattern (a card holding inset groups, `layouts/settings.html.erb`, `categories/index`, `tags/index`, `recurring_transactions/index`, `rules/index`) with Story 14.2's `InsetGroup`, turn every empty state into `DESIGN.md`'s card, and sweep the remaining sizes under the floor.

## Boundaries & Constraints

**Always:**
- Page headers. Recurring and rules: their introduction becomes `Page`'s `description`. A list's add button moves from its section to the page's actions at the default size (merchants, tags), as in Sure.
- Lists. Each list is a card (`rounded-xl border bg-card p-4`) holding one `InsetGroup` per group, the group's name and count in its header and the heading at level 2, so region names survive: recurring (a table: `overline` column heads inside the inner block, rows `h-14`, merchant `md` and account `sm` tinted icons), rules and recent runs, categories (one group per kind, children indented), merchants, tags, connected banks and a bank's accounts. List rows are at least 56 px (`min-h-14 px-4`) and hover on `bg-hover`. Forms stay `Section` cards (profile, password, two-factor, the Enable Banking application, connect a bank, synchronisation) and fill the 896 px column: `max-w-md` and `max-w-3xl` go; submit buttons sit at their content width.
- Dialogs: import and rule 700 px, creation and edit 550 px, confirmations (`ConfirmDialog`) 300 px, as Story 14.1 set them; tests assert each width at 1440 px.
- Empty states. `EmptyState` is itself `DESIGN.md`'s card (`rounded-xl border bg-card`): an `lg` tinted icon, a `card-title` heading, one sentence, one primary button. A caller that wrapped it in a card or section drops the wrapper. Every `border-dashed` empty box (accounts page, account tabs, rules on a phone, `BalanceChart`) becomes an `EmptyState` when it offers an action, else a card holding its sentence in the muted colour.
- Banners. `BankAlerts` and the locked notice as Sure's `DS::Alert`: `rounded-lg border px-4 py-3`, a 16 px icon, `text-sm`. Badges (`ui/badge.tsx`, `StatusBadge.tsx`, the import tab counter): 22 px high, `rounded-md`, `text-xs`, 12 px icon.
- Floor. `ui/button.tsx` drops the unused `xs` and `icon-xs` sizes; `sm` and `ui/toggle.tsx` `sm` use `text-sm`; tab triggers are 28 px; `ui/input-group.tsx` is 36 px; the filter chip's remove button is 28 px. Body text below 14 px is allowed only for captions (the line under a label, a field's hint or error, a subtype, a date, an axis label, a badge), `overline` headers, `code` (the IBAN, 12 px Geist Mono) and the rail's 11 px labels. Checkboxes, switches and radios keep their size with a 24 px target.
- Outside the shell. Sign-in, setup and the root error title their card with an `h1` at the page title's 24 px; `type-display` is removed.

**Never:** no route, API or behaviour change; no new dependency; no change to the dashboard, accounts or transactions layouts beyond empty states and the floor.

</frozen-after-approval>

## Code Map

- `packages/app/src/routes/_authed.recurring.tsx:131-219` -- header, intro `p` (142), `Section` + `Table` rows `h-9` (175-192), `TintedIcon sm`.
- `packages/app/src/routes/_authed.rules.tsx:115-138,181-240,350-417` -- `RuleRow`, runs table, header, intro (370), mobile notice (373), `Section className="max-w-3xl"`.
- `packages/app/src/routes/_authed.settings.{banks,banks_.$connectionId,categories,merchants,tags,security}.tsx` -- `Section` lists and forms; merchants:138 and tags:117 `size="sm"` add buttons; banks:267 locked notice; banks:403 BIC; `$connectionId`:259 `text-[13px]` IBAN; security `max-w-md`.
- `packages/app/src/components/{EmptyState,DashboardEmpty,BankAlerts,StatusBadge,Pagination,ImportDialog,TransactionFilters,OutsideShell,RootError}.tsx`, `routes/{sign-in,setup}.tsx` -- per the constraints.
- `packages/app/src/components/ui/{button,toggle,tabs,input-group,badge}.tsx` -- sizes.
- `packages/app/src/components/{InsetGroup,Section}.tsx` -- Story 14.2's primitives; reuse, do not fork.
- Sure: `app/views/layouts/settings.html.erb`, `categories/index.html.erb`, `tags/index.html.erb`, `recurring_transactions/index.html.erb`, `rules/index.html.erb`, `settings/_section.html.erb`, `app/components/DS/{alert,dialog,empty_state}.rb`.
- Tests to keep green, with their structural locators: `e2e/rules.spec.ts:715-719` (`region "Dépenses" > ul > li > div`), `bank-connections.spec.ts:263` (h2 order), `shell.spec.ts:271-293` (896 px column), `empty-states.spec.ts`, `recurring.spec.ts:215`, `import-ofx.spec.ts:83-94` (counter 20 px becomes 22 px), `outside-shell.spec.ts`, `brand.spec.ts:94-115`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/app/src/components/ui/*`, `StatusBadge.tsx`, `BankAlerts.tsx`, `EmptyState.tsx` -- floor, badges, banners, empty state card.
- [ ] `packages/app/src/routes/_authed.recurring.tsx`, `_authed.rules.tsx` -- header description, card and inset groups.
- [ ] `packages/app/src/routes/_authed.settings.*.tsx` -- lists as inset groups, forms full width, add buttons in the header.
- [ ] Remaining empty boxes, `OutsideShell`, `RootError`, sign-in, setup, `styles.css` (`type-display`).
- [ ] `packages/app/e2e/*` -- per screen at 1440 px: lists inside a card on `inset` trays with uppercase headers and rows at least 56 px; dialog widths; empty states as cards with a 36 px icon and one primary button; banners and badges; a sweep over every signed-in screen and the three outside pages asserting no visible text under 12 px except the rail's labels, headings and row labels at 14 px or more, and no visible button, input, select trigger or tab under 28 px high.

**Acceptance Criteria:**
- Given any existing end-to-end test, when the gate runs, then it passes with its assertions kept or made stricter.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | blind, edge, verification | `/transactions` keeps two dashed empty boxes | medium | `_authed.transactions.tsx` still has `border-dashed p-8` for « Aucune opération » and « Aucune ne correspond »; the only dashed check runs on an account's page | patch, after the rebase on Story 14.3 |
| 2 | blind, edge | Empty states lost the section's `h2`, the outline jumps to `h3` | medium | recurring, rules, merchants and tags pass no `level` | patch |
| 3 | blind | `EmptyState` doc forbids a card inside a card, two callers strip its frame by class | low | banks and categories pass `rounded-none border-0` | patch |
| 4 | blind, edge | `BalanceChart`'s empty note is a card inside the chart's card | low | `EmptyNote` inside `Section` on the dashboard and an account | patch |
| 5 | blind | `overline` classes copied three times | medium | `InsetGroup`, recurring and rules column heads; Story 14.3 adds a fourth | patch, after the rebase |
| 6 | blind | Page title classes copied five times once `type-display` went | low | `Page`, `RootError`, `setup`, `sign-in` ×2 | patch |
| 7 | blind | An account's empty tab repeats the header's « Ajouter une opération » | low | the header's actions belong to the account, not the list | reject |
| 8 | blind, edge, verification | The floor sweep skips the connection page, an account's other tabs, dialogs, the bank search and an applied filter | medium | `scanFloor` only visits routes | patch |
| 9 | blind, verification | `InsetGroup`'s count untested | medium | no assertion reads it | patch |
| 10 | blind | Dialog widths asserted for four dialogs only; security buttons checked loosely | low | account, category and merchant dialogs unmeasured | patch |
| 11 | blind | Stale comment in `empty-states.spec.ts`; `SECTION_TABLE_INSET` exported by `Section` for inset tables | low | recurring and rules import `Section` only for it | patch |
| 12 | blind | Spec status and notes | false | a spec edit; notes are filled at the end of the run | reject |
| 13 | verification | `sm` buttons and toggles at 14 px untested | medium | the sweep flags text under 12 px only | patch |
| 14 | verification | Empty states inside a group untested for their missing frame | low | two callers | patch |
| 15 | verification | The runs' count is the total over all pages | low | `count` doc says rows the group holds; the reconciled prop documents a count | patch, after the rebase |
| 16 | verification | Filter chip may be 30 px, not 28 | false | the floor is a minimum; 30 px passes | reject |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all pass.
- `bash /tmp/archant-e2e-locked.sh` instead of a bare `pnpm test:e2e` -- another worktree may be running the suite on port 8788; the script waits for it, then runs the suite (pass Playwright arguments to run a subset). Start it in the background: waiting plus the run can exceed ten minutes.
