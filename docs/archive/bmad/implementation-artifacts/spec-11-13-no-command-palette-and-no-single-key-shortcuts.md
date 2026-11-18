---
title: 'Story 11.13: No command palette and no single-key shortcuts'
type: 'refactor'
created: '2026-09-26'
status: 'done'
baseline_commit: 'c7a5fcf60c9402df0005509415f2100a1af88cef'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.8 and Story 4.5 made the interface keyboard-first, as Linear: a `⌘K` palette, a `?` dialog, `g` navigation, list keys and key caps in tooltips. The owner's manual QA of 2026-09-25 found they carry weight nobody uses; UX-DR7 is withdrawn.

**Approach:** Delete the shortcut catalogue, the palette, the dialog and every binding, keeping what the browser and Radix already give: `Tab`, `Enter` on a focused button, arrows inside menus, tabs and comboboxes, `Esc` on a layer, plus the sheet's `⌘Enter`. Where a shortcut was the only way to do something, follow Sure.

## Boundaries & Constraints

**Always:**
- Every catalogue entry goes: `mod+k`, `?`, `g d/c/o/r/u/s`, `n`, `i`, `/`, `j`/`k` and row arrows, `e` and the list's `Enter` binding, `c`, `m`, `t`, `x`, `Shift`+move, the list's `Escape`, and `mod+b`. A focused row is a `button`, so native `Enter` still opens its sheet.
- The header's « Rechercher » and « Raccourcis clavier » buttons go; the header keeps the sidebar trigger. Tooltips that only showed keys go; a tooltip with a label keeps the label.
- The bulk bar gets Sure's ticked checkbox before its count, `aria-label` « Vider la sélection », which unticks every row (`transactions/_selection_bar.html.erb`, `bulk-select#deselectAll`). It replaces `Esc`, the only way to clear today.
- The row-level merchant and tag pickers go with `m` and `t`, their only trigger. Merchant and tags stay editable in the transaction sheet and the bulk bar; the row's category chip stays, being a button.
- `CommandsProvider` and `useCommands` go. `CreateAccountDialog` returns to the pages whose buttons open it, with local state.
- `matchesCommand` moves, renamed `matchesSearch`, to its own `lib/` file with its tests; the comboboxes and `TransactionFilters` import it.
- `react-hotkeys-hook` leaves `package.json` and `docs/tech-stack.md`. `cmdk` stays, used by every combobox through `ui/command.tsx`; its tech-stack row says so. `ui/kbd.tsx` goes if nothing imports it. `ui/command.tsx` stays as shadcn wrote it.
- The save button keeps its `⌘Entrée` `title`: the shortcut stays.
- Docs describe the current interface: `EXPERIENCE.md` (Interaction Primitives, surfaces table, component row, Linear inspiration), UX-DR7 in `epics.md` marked « Withdrawn by Story 11.13 », the Keyboard row of `docs/sure-parity.md`, `README.md`.

**Never:** no replacement shortcut, no new binding library, no hand-written global `keydown` listener; no change to Radix keyboard behaviour inside `ui/`; no API change; no edit to Story 1.8 or 4.5 text, `deferred-work.md` or `manual-qa-scenarios.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Former keys | `ControlOrMeta+K`, `?`, `g o`, `n`, `/` on their pages | no dialog, no navigation, no sheet, no focus move | N/A |
| Header | any page | no « Rechercher » or « Raccourcis clavier » button | N/A |
| Sidebar tooltip | hover « Comptes », collapsed | tooltip reads « Comptes », no key cap | N/A |
| Tab reach | `Tab` from the page start on `/transactions` | reaches the sidebar links, then a row; `Enter` opens its sheet | N/A |
| Sheet | sheet open, `⌘Enter`; then `Esc` on another | saves; closes and focus returns to the row | N/A |
| Clear selection | two rows ticked, click « Vider la sélection » | bar hidden, no row ticked | N/A |

</frozen-after-approval>

## Code Map

- `packages/app/src/lib/shortcuts.ts`, `shortcuts.spec.ts`, `hooks/useShortcut.ts`, `hooks/useListNavigation.ts`, `components/CommandPalette.tsx`, `ShortcutsDialog.tsx`, `ShortcutHint.tsx`, `CommandsProvider.tsx`, `hooks/useCommands.ts` -- deleted, after `matchesCommand` and its tests move.
- `packages/app/src/routes/_authed.tsx` -- `GlobalShortcuts`, `SidebarShortcut`, `HeaderActions`, `AccountDialog`, trigger tooltip (L43–150).
- `packages/app/src/routes/_authed.index.tsx:142`, `_authed.accounts.index.tsx:30` -- `setCreatingAccount`; each mounts `CreateAccountDialog`.
- `packages/app/src/routes/_authed.accounts.$accountId.tsx` -- `commands`, `usePageCommands`, two `useShortcut` (L301–340), hints (L418, L426).
- `packages/app/src/routes/_authed.transactions.tsx` -- `useShortcut("search")` (L60), hint (L115), comment (L50).
- `packages/app/src/components/TransactionList.tsx` -- `useListNavigation`, five `useShortcut` (L265–335), `RowPicker` state and its popovers, `onBulkPick`, hints on `CategoryChip` (L125) and `RowCheckbox` (L204), doc comments.
- `packages/app/src/components/BulkBar.tsx` -- `PickerButton` `shortcut` prop and tooltip (L53–80), three call sites (L178–214); the count is where the checkbox goes. `ui/checkbox.tsx` as in `RowCheckbox`.
- `packages/app/src/components/AppSidebar.tsx` -- five `ShortcutHint` (L139–205), comment L155.
- `packages/app/src/components/ui/sidebar.tsx:89` -- stale `⌘B` comment.
- `CategoryCombobox.tsx`, `MerchantCombobox.tsx`, `TagCombobox.tsx`, `TransactionFilters.tsx` -- import `matchesCommand`.
- `packages/app/src/locales/fr.json` -- `commands.*`, `shortcuts.*` (L41–100); keys still read, as `commands.importFile` for the import button, move beside their feature. `transactions.form.saveShortcut` stays.
- `packages/app/package.json` -- `react-hotkeys-hook`; `pnpm-lock.yaml` follows.
- `packages/app/e2e/keyboard.spec.ts` -- rewritten. Shortcut-driven steps: `import-ofx.spec.ts` (L138, L273–280, L428), `import-qif.spec.ts:133`, `import-csv.spec.ts` (L152, L180), `rules.spec.ts:71`, `recurring.spec.ts:237`, `password.spec.ts:91`, `transfers.spec.ts` (L225, L257, L312), `categorise.spec.ts:134–148`, `merchant.spec.ts:68–83`, `tag.spec.ts:39–74`, `bulk.spec.ts` (L101–105, L173).
- `docs/tech-stack.md:60–61`, `docs/sure-parity.md:226`, `README.md:33`, `epics.md:165`, `EXPERIENCE.md` L30–36, L79, L105–116, L144.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/lib/search-match.ts`, `search-match.spec.ts` -- `matchesSearch` and the tests from `shortcuts.spec.ts`; switch the four importers.
- [x] `packages/app/e2e/keyboard.spec.ts` -- one test per matrix row, written before the removal.
- [x] `packages/app/e2e/bulk.spec.ts` -- replace the `x`/`Shift+J` test with « Vider la sélection »; `t` becomes the bar's button.
- [x] Other e2e files of the Code Map -- click the visible button, link or chip; drop `merchant.spec.ts` and `tag.spec.ts` tests of the row pickers.
- [x] Source files of the Code Map -- remove bindings, hints, palette, dialog, provider and row pickers; add the bar checkbox; move `CreateAccountDialog`; prune `fr.json`.
- [x] `packages/app/package.json`, `pnpm-lock.yaml` -- drop `react-hotkeys-hook` with `pnpm --filter @archant/app remove react-hotkeys-hook`.
- [x] `docs/tech-stack.md`, `docs/sure-parity.md`, `README.md`, `epics.md`, `EXPERIENCE.md` -- current state.

**Acceptance Criteria:**
- Given the finished story, when `grep -rn "react-hotkeys-hook\|useShortcut\|ShortcutHint\|CommandPalette" packages/app` runs, then nothing matches.
- Given the finished story, when the AGENTS.md verification gate and `pnpm test:e2e` run, then all pass and no tracked file changes.

## Implementation Notes

- Tooltips that only repeated a control's visible text went with their key caps: the search field, « Ajouter une opération », and the bulk bar's Catégorie, Marchand and Étiquettes buttons. The import button's tooltip now reads `imports.title`.
- Removing the row pickers left `useSetTransactionMerchant`, `useSetTransactionTags`, their `ROW_FIELDS` entries and strings, and `Selection.add` unused; they went too.
- The bulk bar's open picker is now `BulkBar` state: it lived in the page only so `c`, `m` and `t` could open it.
- `EXPERIENCE.md` journeys 1 and 2 relied on `i`, `/`, `x` and `c`; they now name the visible controls.
- The `Tab` test runs at 900 px: at full width the sidebar lists every account the shared e2e database accumulates, and a row lies beyond 100 presses.
- `keyboard.spec.ts` was written after the removal, so its tests were never seen failing on the old code.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| The former-keys test presses `Shift+/`, so `/` is never tried (blind) | medium | Playwright types `?` for `Shift+/`; the matrix row lists `/`. | patch |
| The account-page presses never check focus (edge) | low | Only the `/transactions` half asserts `:focus`; a direct assertion. | patch |
| The « Vider la sélection » test exists twice (blind) | low | `keyboard.spec.ts` repeats `bulk.spec.ts` step for step; direct deletion. | patch |
| The dashboard's « Ajouter un compte » is never clicked (verification) | medium | `dashboard.spec.ts` only checks the button visible; the dialog now mounts per page. | patch |
| Clearing from the bar drops focus to `body` (blind, edge) | medium | `selection.clear()` unmounts the bar holding the focused checkbox. | patch |
| `⌘Enter` is announced by `title` only (blind) | low | A `title` shows neither on focus nor on touch; `aria-keyshortcuts` is one attribute. | patch |
| `EXPERIENCE.md` Bulk bar row misses the checkbox, carries history, drops the chart cursor from primitives (blind) | low | L74, L113, arrow-keys bullet; AGENTS.md wants current state. | patch |
| `epic-11-context.md` still says EXPERIENCE.md waits for this story (blind) | low | L61, rewritten by this very change. | patch |
| No skip link: a keyboard user crosses every sidebar account before the page (blind) | medium | The sidebar's length predates this story; `<main>` is a landmark screen readers jump to; the `g` keys it loses were never a bypass for Tab users. | defer |
| The bar checkbox styles `data-checked`, which Radix never sets (edge) | false | `ui/checkbox.tsx` itself styles `data-checked:`; the vendored primitive sets it. | rejected |
| Task says tests written before removal, notes say after (blind) | low | Fix would edit this spec; the notes state the fact. | rejected |
| Spec `in-review` while sprint status says `in-progress` (blind) | false | Step 5 moves the story to `review`. | rejected |
| `useSetRowField` stays generic for one field (blind) | low | Works as is; collapsing it is a refactor beyond a deletion, no named harm. | rejected |
| `epic-11-context.md` carries changes from other stories (blind) | false | The workflow regenerated a stale context from current planning docs. | rejected |
| The row checkbox tooltip repeats its `aria-label` (blind) | low | The `aria-label` is invisible; the tooltip is what a sighted user reads. | rejected |
| `search-match.spec.ts` examples come from the palette (blind) | low | Cosmetic; the fold under test is unchanged. | rejected |
| The former-keys test skips `j`, `x`, `mod+b` and late reactions (blind) | low | Every binding goes through the deleted `useShortcut`, which the grep criterion proves gone. | rejected |

## Design Notes

Why `⌘B` goes: the owner asked for an interface without keyboard shortcuts, the tooltip that taught it goes, and Sure has no sidebar key. Why row arrows go: `Tab` reaches every row and Sure's transaction list has none; arrows scroll the page again. Why a checkbox rather than keeping `Esc`: keeping it needs the layer detection and the capture listener of `useShortcut.ts` to stop a combobox's `Esc` from clearing the selection; Sure's bar clears with a ticked checkbox, visible to mouse and keyboard alike.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, `git status` clean afterwards.
- `pnpm test:e2e` -- all pass.
