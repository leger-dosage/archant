---
title: 'Story 1.8: Command palette and keyboard shortcuts'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_commit: '37275f11e1988eaee8ce596b9dd8420db257b2ae'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every page and action needs the mouse; EXPERIENCE.md promises a keyboard-first tool, as in Linear.

**Approach:** A global layer in the root layout: a `⌘K` / `Ctrl+K` command palette, `g` navigation, list keys on transaction lists, `/`, `n` and a `?` dialog, all driven by one shortcut catalogue that also feeds the tooltips of their visible equivalents.

## Boundaries & Constraints

**Always:**
- New dependencies: shadcn `command` (brings `cmdk` 1.1.x) and `kbd`, added with the shadcn CLI into `components/ui/`; `react-hotkeys-hook` 5.3.x for bindings, sequences and form-field exclusion. The pull request states why.
- One catalogue, `lib/shortcuts.ts`: id, keys, i18n label key, section. The bindings, the `?` dialog and every tooltip read it, so a shortcut cannot exist unlisted.
- Keys match the typed character (`useKey`), not the physical key: on AZERTY, `?` and `/` need `Shift`. Labels read `⌘K` on Apple platforms, `Ctrl K` elsewhere.
- Single-letter shortcuts never fire in `input`, `textarea`, `select` or `contenteditable`. `⌘K` fires in text fields too.
- Every shortcut, `⌘K` included, is off while a dialog, sheet, menu or popover is open: layers stack one deep (EXPERIENCE.md). `Esc` closes the palette and focus returns where it was.
- Palette groups, in order: « Aller à » (Comptes `g c`, Opérations `g o`); « Actions » (« Ajouter un compte » everywhere; « Ajouter une opération » `n` and « Enregistrer un solde » on an account page, under the same conditions as their buttons; the three theme choices; « Afficher les raccourcis » `?`); « Comptes » (active accounts with their balance, opening the account page). Filtering ignores case and accents. `Enter` runs the highlighted item.
- `g` then `c` or `o` within one second navigates. `n` opens the new-transaction sheet on an account page.
- On a transaction list (`/operations`, account page Opérations tab): `j` / `k` move focus to the next / previous row, from the first row when none has focus, stopping at the ends of the page; arrows do the same once a row has focus; `e` or `Enter` opens the focused row's sheet. `/` focuses and selects the `/operations` search field; elsewhere it does nothing.
- Visible equivalents with the shortcut in their tooltip: a header « Rechercher » button (`⌘K`) and a « Raccourcis clavier » button (`?`); the sidebar Comptes and Opérations entries, expanded or not; the search field; « Ajouter une opération ». Row keys have no per-row tooltip; the `?` dialog lists them.
- Every acceptance criterion and interface row of the matrix has a Playwright test; the pure parts of `lib/shortcuts.ts` have Vitest tests.

**Never:**
- No « Opérations » group or recent items in the palette (deferred), no `x`, `c`, `m`, `t`, `i`, `Backspace`, `g d/r/u/s` (their pages or actions do not exist yet). No API change. No customisable shortcuts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Palette | `Ctrl+K` on `/operations`, type « livret », `Enter` | Account « Livret A » page opens, palette closed | — |
| Accents | Type « operations » | « Opérations » is offered | — |
| In a field | Focus in search field, type `g c` | Field reads « gc », no navigation | — |
| Layer open | Transaction sheet open, press `Ctrl+K` or `g o` | Nothing | — |
| List end | Last row focused, `j` | Focus stays | — |
| No search | `/` on an account page | Nothing | — |
| Inactive | Deactivated account | Not in « Comptes » group | — |

</frozen-after-approval>

## Code Map

- `packages/web/src/routes/__root.tsx` -- mount point: provider, palette, shortcuts dialog, global bindings, header buttons next to `SidebarTrigger`.
- `packages/web/src/routes/comptes.index.tsx` (L29, L83) -- `CreateAccountDialog` and its `creating` state move to the root layout; its buttons open it through the provider.
- `packages/web/src/routes/comptes.$accountId.tsx` (L243–244, L325) -- `openNew`, `openNewSnapshot` and the snapshot `canAdd` rule: register the account's actions and bind `n` here.
- `packages/web/src/routes/operations.tsx` -- `SearchField` input (L81) is the `/` target.
- `packages/web/src/components/TransactionList.tsx` -- rows are `button[data-transaction-id]`; focus moves between them. `TransactionSheet.tsx` L326–366 already returns focus to the row on close.
- `packages/web/src/components/AppSidebar.tsx` -- nav buttons' `tooltip`; `ui/sidebar.tsx` L511 hides tooltips when expanded, override with `hidden: false` in the tooltip object rather than editing `ui/`.
- `packages/web/src/components/ThemeMenu.tsx`, `lib/theme.ts` -- `THEME_CHOICES`, `setThemeChoice` for the theme actions.
- `packages/web/src/components/AccountBalance.tsx`, `hooks/useAccounts.ts` -- account rows of the palette, filtered on `active`.
- `packages/web/src/locales/fr.json` -- new keys under `commands.*` and `shortcuts.*`.
- `packages/web/e2e/fixtures.ts` (`openAccount`, `addTransaction`, `uniqueName`), `e2e/operations.spec.ts` (`searchBox`, narrowing to own rows) -- one shared database: narrow lists by a unique label first.

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/src/lib/shortcuts.spec.ts`, `lib/shortcuts.ts` -- tests first: catalogue ids and keys unique, every label key present in `fr.json`, key labels on Apple and other platforms, `isTypingTarget`, next/previous row index clamped, accent- and case-insensitive command match; then the code.
- [x] `packages/web/package.json`, `components/ui/command.tsx`, `components/ui/kbd.tsx` -- shadcn CLI and `react-hotkeys-hook`.
- [x] `packages/web/src/components/CommandPalette.tsx`, `components/ShortcutsDialog.tsx`, `hooks/useCommands.ts` (new) -- provider holding contextual commands and the dialogs' open state; palette; `?` dialog grouped by section.
- [x] `packages/web/src/hooks/useListNavigation.ts` (new), `TransactionList.tsx` -- `j`/`k`/arrows/`e`.
- [x] `packages/web/src/routes/__root.tsx`, `comptes.index.tsx`, `comptes.$accountId.tsx`, `operations.tsx`, `AppSidebar.tsx`, `locales/fr.json` -- bindings, header buttons, tooltips, registered actions.
- [x] `packages/web/e2e/keyboard.spec.ts` (new) -- Playwright for each acceptance criterion and interface row of the matrix.

**Acceptance Criteria:**
- Given any page, when I press `ControlOrMeta+K`, then the palette shows « Aller à », « Actions » and « Comptes »; `Esc` closes it and focus returns to where it was.
- Given the palette on an account page, when I run « Ajouter une opération », then the new-transaction sheet opens; « Ajouter un compte » from `/operations` opens the account dialog.
- Given any page, when I type `g c` or `g o`, then `/comptes` or `/operations` opens.
- Given my own rows on `/operations`, when I press `j` three times, `k`, then `e`, then the second row's sheet opens; `/` puts focus in the search field.
- Given any page, when I press `?`, then a dialog lists every catalogue shortcut; hovering the sidebar Comptes entry shows `G C`.
- Given the finished story, when the AGENTS.md verification gate and `pnpm test:e2e` run, then every command passes and no tracked file is modified.

## Implementation Notes

- `j` or `k` with no row focused lands on the first row, as in Linear and as the frozen constraint reads.
- `mod+k` is bound as both `meta+k` and `ctrl+k`. react-hotkeys-hook picks `mod` from the user agent, which Playwright's Desktop Chrome device spoofs as Windows, so `ControlOrMeta+K` on a macOS host would miss. Labels still follow the platform (`navigator.platform`).
- Open layers are detected in the DOM (`[role=dialog|alertdialog|menu|listbox][data-state=open]`), not through React state, so any future Radix layer is covered without wiring.
- Two small files beyond the code map: `hooks/useShortcut.ts` (binds a catalogue entry with the layer, field and modifier rules) and `components/ShortcutHint.tsx` (key caps for tooltips, palette and the `?` dialog).
- The shadcn CLI added `input-group.tsx` and `textarea.tsx` as dependencies of `command`; `input-group.tsx` lost an `as HTMLElement` cast to satisfy `no-unsafe-type-assertion`. Existing `button`, `input` and `dialog` were kept, not overwritten.
- The palette runs the chosen item from `onCloseAutoFocus`, after focus is back where it was, so a sheet it opens records the page's element as its opener.
- The search field's tooltip opens on hover only; opening on focus would cover the filter chips while typing.
- The sidebar's `⌘B` toggle joined the catalogue, since the `?` dialog must list every shortcut; `ui/sidebar.tsx` no longer binds it itself, `useShortcut` does, so it obeys the layer rule.
- Verified in Chromium on a throwaway database: `⌘K` on `/operations` shows the groups with `G C` / `G O` / `?` keys, « livret » then `Enter` opens « Livret A », `g o` then `j j` focuses « Salaire », `Shift+?` lists eleven shortcuts, the sidebar « Comptes » tooltip reads « Comptes G C ». Light 1280 px and dark 600 px checked. Not checked: a physical AZERTY keyboard and a Linux host.

## Spec Change Log

- The acceptance criterion read `j` twice, `k`, `e` opens the second row, which contradicts the frozen « from the first row when none has focus »: the first `j` focuses row one. The criterion now reads `j` three times. Avoids a first `j` that skips the first row. KEEP: clamping at both ends.

## Review Triage Log

| # | Source | Location | Finding | Verdict | Evidence | Route |
|---|--------|----------|---------|---------|----------|-------|
| 1 | blind | spec Implementation Notes | Note says `⌘B` stays outside the catalogue; the code lists it | low | The note predates the catalogue entry. | patch |
| 2 | blind, edge | `ui/sidebar.tsx`, `lib/shortcuts.ts` | `⌘B` fires under an open layer and is not bound from the catalogue | medium | shadcn's own `keydown` listener never calls `isLayerOpen`. | patch |
| 3 | blind | `lib/shortcuts.ts` `hotkeysOf` | `mod+k` bound to `ctrl+k` on macOS takes kill-to-end-of-line from fields | low | Dual binding added as a test workaround; a direct correction. | patch |
| 4 | blind, edge | `hooks/useShortcut.ts` | `Ctrl+K` under an open layer reaches the browser | medium | The library returns on `ignoreEventWhen` before its `preventDefault` (dist `index.js` L263). | patch |
| 5 | blind, edge | `hooks/useShortcut.ts` sequences | The first key of `g c` skips the layer and modifier checks (`Ctrl+G` then `c`) | low | Real (library records sequence keys unchecked) but needs a hand-written sequence buffer; rare. Rejected. |  |
| 6 | blind | `hooks/useShortcut.ts` | One-second window relies on the library default | false | `sequenceTimeoutMs ?? 1e3` in the library matches the spec. |  |
| 7 | blind, verification | `e2e/keyboard.spec.ts` | `⌘K` from a text field and focus return on a list page untested | medium | No test fires it from a field. | patch |
| 8 | blind | `routes/__root.tsx` | Header button and search field share the name « Rechercher » | low | Two controls, one accessible name on `/operations`; direct rename. | patch |
| 9 | blind | `hooks/useListNavigation.ts` | Two lists on one page would both react to `j` | low | No page has two lists; speculative. Rejected. |  |
| 10 | blind | `components/ui/*` | Unused shadcn exports and `"use client"` | low | shadcn copies whole components, as the existing `ui/` files do. Rejected. |  |
| 11 | blind | `sprint-status.yaml` | Story `in-progress` while the spec is `in-review` | false | Step 5 syncs the story to `review`. |  |
| 12 | blind | `hooks/useCommands.ts` | A component lives in a camelCase hooks file through `createElement` | low | AGENTS.md: components PascalCase, hooks camelCase; direct move. | patch |
| 13 | blind | spec Manual checks | Manual checks not done | false | Run in the QA pass before the pull request. |  |
| 14 | blind | `lib/shortcuts.ts` `keysText` | Other modifiers render raw | low | No catalogue entry uses them. Rejected. |  |
| 15 | edge | `hooks/useShortcut.ts` | CapsLock breaks `g c` | low | Library compares raw `event.key`; rare, fix adds a branch. Rejected. |  |
| 16 | edge | `hooks/useShortcut.ts` | `g g c` does nothing | low | Rare; rejected. |  |
| 17 | edge | `hooks/useShortcut.ts` | AltGr layouts report Ctrl+Alt for `?` | low | French AZERTY types `?` and `/` with Shift; rejected. |  |
| 18 | edge | `components/CommandPalette.tsx` | `⌘K` during the closing animation keeps a pending action | low | Needs a keypress within the animation; rejected. |  |
| 19 | edge | `routes/comptes.$accountId.tsx` | `n` with a non-ISO currency opens no sheet | false | Same condition as the existing header button; the API only stores ISO codes. |  |
| 20 | edge | `routes/__root.tsx` | Account dialog in the root survives the back button | low | `close` resets the form; back with a modal open is rare. Rejected. |  |
| 21 | edge | `components/CommandPalette.tsx` | « Comptes » heading hidden with no active account | low | An empty heading helps no one; rejected. |  |
| 22 | verification | `hooks/useShortcut.ts` `hasForeignModifier` | Shift allowance untested; Playwright sends `?` without Shift | medium | Pre-verified gap. | patch |
| 23 | verification | `hooks/useListNavigation.ts` `openRow` | `Enter` on non-row controls of list pages untested | medium | Pre-verified gap. | patch |
| 24 | verification | `routes/comptes.$accountId.tsx` | « Enregistrer un solde » absent for an account opened today untested | low | Pre-verified gap. | patch |

## Design Notes

Assumptions taken from the story over EXPERIENCE.md: the story lists three palette groups, so the « Opérations » search group and recent items wait (entry in `deferred-work.md`). `n` comes from `epic-1-context.md` and stays on the account page, where « Ajouter une opération » exists; `/operations` has no add button. Disabling shortcuts under any open layer keeps the one-layer rule and stops `g o` from leaving a sheet with unsaved changes. Sure uses `@github/hotkey` (21k weekly downloads); `react-hotkeys-hook` (3M) gives the same sequences and form exclusion as a React hook.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, `git status` clean afterwards.
- `pnpm test:e2e` -- `keyboard.spec.ts` and the existing suite pass.

**Manual checks:**
- AZERTY layout on macOS: `?`, `/`, `g c`, `⌘K`; Chromium on Linux: `Ctrl+K` label. Light and dark, 1280 and 600 px.
