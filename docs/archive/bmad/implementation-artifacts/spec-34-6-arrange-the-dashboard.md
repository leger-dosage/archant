---
title: 'Story 34.6: Arrange the dashboard'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: 'd18ab6ce1d930a84157854dbcec666c7cbbbf67b'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant's dashboard is fixed. Sure (`00dd977fb`, `pages/dashboard.html.erb`, `PagesController`, `User#update_dashboard_preferences`, `dashboard_{sortable,section,widget_size,masonry}_controller.js`) lets each user reorder, collapse, resize and hide its widgets, kept in `users.preferences`.

**Approach:** one JSON column on `users` holding Sure's four preferences, read and merged by `GET`/`PATCH /api/dashboard/layout`; one widget wrapper on the dashboard that ports Sure's controllers to React, with the controls in each `Section` header.

## Boundaries & Constraints

**Always:** widget keys are Sure's minus `insights_feed` (no insights in Archant), plus `goals` until Story 35.10: `cashflow_sankey`, `outflows_donut`, `net_worth_chart`, `balance_sheet`, `money_flow`, `spending_trend`, `investment_summary`, `goals`. The default order is Sure's effective one, its `default_dashboard_section_order` then the unlisted keys: that list's order, `goals` last. Guardrails are Sure's `DASHBOARD_SECTION_LAYOUTS`: Sankey full by default, the others half; height presets `compact` 208, `auto` 288 (default), `tall` 416 px only on `net_worth_chart` and `spending_trend`; « Largeur » on every widget but `outflows_donut` and `goals`; the donut has no size menu. Stored as Sure: `sectionOrder`, `collapsedSections`, `hiddenSections`, `sectionLayout` (`height`, `colSpan`); a `PATCH` merges each map key by key (Sure's `deep_merge`), hides or shows one key at a time (`update_dashboard_section_hidden`), and keeps hidden keys in place when an order omits them (`keep_hidden_sections_in_order`); read-modify-write runs in one transaction. Reading drops a stored key the code no longer knows and appends a missing one. Controls as Sure: the chevron « Afficher/masquer la section », the size menu « Ajuster la taille » (« Largeur » « Moitié »/« Plein », « Hauteur » « Compact »/« Auto »/« Grand ») and the grip « Glisser pour réorganiser la section » in every header; « Personnaliser » (`layout-grid` icon, `?customize=true`) adds the eye button « Masquer %{title} » and the « Widgets masqués » card; « Terminé » leaves. With every widget hidden and not customising, Sure's `all_hidden` empty state. Keyboard as `dashboard_sortable_controller.js`: on the focused widget, `Enter`/`Space` grabs or releases, `ArrowUp`/`ArrowDown` move, `Escape` releases, a release saves; keys on a control inside belong to it. Mouse drag and an 800 ms touch hold, nearest-centre drop, as Sure. From 1536 px, two columns packed as `dashboard_masonry_controller.js` (1 px rows, dense flow, spans from measured heights). Collapsed widgets stay mounted; hidden ones are not mounted. Every change applies at once and saves; a failed save puts the layout back and says so. English-only Sure strings get French a user expects; both locale files.

**Never:** no control and no write for a viewer, who sees the default layout (AD-21); no reports-page arranging (Story 34.7); no « Mise en page à deux colonnes » setting (two columns stay automatic, as today); no new dependency; no raw SQL.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh user | nothing stored | Sure's default order, nothing hidden or collapsed, sizes default | N/A |
| Unknown key | `PATCH { sectionOrder: ["insights_feed"] }` or `hiddenSections: { foo: true }` | nothing stored | `400 VALIDATION_ERROR` with `fields` |
| Size not offered | `sectionLayout: { outflows_donut: { height: "tall" } }` | nothing stored | `400 VALIDATION_ERROR` |
| Order omits a hidden widget | `money_flow` hidden, order without it | `money_flow` stays after its predecessor | N/A |
| Partial size | `{ net_worth_chart: { colSpan: "full" } }` after `height: "compact"` | both kept | N/A |
| Stale stored key | stored order holds a removed key | dropped on read | N/A |
| Viewer | any `PATCH` | layout unchanged | `403 FORBIDDEN` from `viewerReadOnly` |
| No investment account | `investment_summary` hidden | not offered in « Widgets masqués » | N/A |

</frozen-after-approval>

## Code Map

- `packages/data/dashboard-sections.ts` (new) -- `DASHBOARD_SECTIONS`, `DEFAULT_DASHBOARD_ORDER`, `DASHBOARD_SECTION_LAYOUTS` (`colSpan`, `grow`, `widthToggle`), `DASHBOARD_HEIGHT_PRESETS`, types; shared by API and app as `periods.ts` is.
- `packages/data/schema/auth.ts` `users` -- add `dashboardLayout: text("dashboard_layout", { mode: "json" }).$type<StoredDashboardLayout>()`, nullable; then `pnpm data generate`.
- `packages/api/src/domain/dashboard-layout.ts` (new) -- pure: `resolveLayout(stored)`, `mergeLayout(stored, patch)`, `keepHiddenInOrder(next, previous, hidden)`.
- `packages/api/src/schemas/dashboard-layout.ts` (new) -- strict Zod body; `superRefine` refuses a height or width the guardrails do not offer.
- `packages/api/src/services/dashboard-layout.ts` (new) -- `getDashboardLayout`, `updateDashboardLayout` in `deps.db.transaction` (pattern: `services/bank-connections.ts`).
- `packages/api/src/routes/dashboard.ts` (new), mounted in `app.ts` beside `/preferences` -- `GET /layout`, `PATCH /layout`, `signedInUser(c)` from `middleware/roles.ts`.
- `packages/app/src/hooks/useDashboardLayout.ts` (new) -- query `queryKeys.dashboardLayout` in `lib/query-keys.ts`; optimistic mutation with rollback and `showFailureToast`, `scope` serialised as `useSaveDefaultPeriod` in `hooks/usePreferences.ts`.
- `packages/app/src/components/DashboardWidget.tsx` (new) -- focusable `role="listitem"` wrapper: drag, touch (non-passive listeners in an effect), keyboard; provides `DashboardWidgetContext` (header controls, `collapsed`, `heightPx`, `colSpan`).
- `packages/app/src/components/Section.tsx` -- reads the optional context: chevron before the title, controls before `action`, content hidden when collapsed; unchanged elsewhere.
- `packages/app/src/hooks/useDashboardMasonry.ts` (new) -- port of the masonry controller with `ResizeObserver`.
- `NetWorthSection.tsx`, `SpendingTrendSection.tsx` -- chart height from context, 208 px fallback (Sure's `13rem`); `MoneyFlowSection.tsx` -- chart and summary side by side when `colSpan` is `full` (Sure's `stacked`).
- `packages/app/src/routes/_authed.index.tsx` -- `customize` search param; widgets keyed and rendered in layout order; « Personnaliser »/« Terminé » for `useIsAdmin()` only; « Widgets masqués » card, `investment_summary` offered only with an active account whose type `holdsSecurities` (`@archant/data/account-types`); all-hidden empty state; grid `role="list"` « Sections du tableau de bord ».
- `packages/app/src/locales/{fr,en}.json` -- `dashboard.customize.*`, `dashboard.widgetSize.*`, toggle, grip and the widget's keyboard instructions.
- `packages/app/e2e/dashboard-layout.spec.ts` (new) and `playwright.config.ts` -- a `layout` project depending on `chromium`, and `reset` now depending on `layout`, since the layout is the single administrator's and `chromium` tests read the dashboard in parallel.
- `packages/app/e2e/dashboard.spec.ts` -- the 1440/1600 px layout test follows the new default order and the masonry.
- `AGENTS.md` « Testing » -- seven projects, `layout` explained. `docs/sure-parity.md` « Customisable dashboard » row to Parity; « Preferences » row no longer defers the layout.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/dashboard-layout.spec.ts` then `dashboard-layout.ts` -- failing tests first: default resolve, stale key dropped, missing key appended, hidden kept in order (Sure's `money_flow` test), deep merge of sizes, hide then show.
- [x] `packages/api/src/routes/dashboard.spec.ts` -- `useSignedInApp()`: round trip, unknown key and refused size → `400`, viewer `PATCH` → `403`, another user untouched.
- [x] Data constants, column and migration; schema, service, route.
- [x] Hook, `DashboardWidget`, `Section`, masonry hook, widget heights, money flow width, dashboard route, locales.
- [x] `packages/app/e2e/dashboard-layout.spec.ts` -- moves « Bilan » up with `Space`, `ArrowUp`, `Space`; collapses one; hides « Dépenses » in « Personnaliser »; reloads and finds all three kept; adds « Dépenses » back from « Widgets masqués »; hides every widget and reads the all-hidden state; restores the default through the API at the end.
- [x] `dashboard.spec.ts` layout test, `playwright.config.ts`, `AGENTS.md`, `docs/sure-parity.md`.

**Acceptance Criteria:**
- Given an administrator at 1600 px, when they set « Patrimoine net » to « Plein » and « Grand », then it spans both columns with a 416 px chart, and keeps both after a reload.
- Given a viewer, when the dashboard renders, then no chevron, grip, size menu nor « Personnaliser » shows.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass.

## Implementation Notes

- The mouse drags from the grip only, where Sure drags the whole card: a whole-card `draggable` would take the net worth chart's range drag. The touch hold stays on the whole card, as Sure.
- A widget that renders nothing (« Sorties » without spending) keeps an empty, hidden wrapper; keyboard moves and drops skip it.
- The pure layout functions live in `@archant/data`, so the interface applies a change optimistically with the server's own merge.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | A drag always lands before the nearest widget, never last | false | reject | Sure's `drop` inserts before `getDragAfterElement`, the nearest; the keyboard reaches the end, as in Sure. |
| 2 | A drop that changes nothing still sends a `PATCH` | low | reject | Sure's `saveOrder` does the same; the write is idempotent. |
| 3 | A malformed stored `dashboard_layout` answers 500 | low | reject | Only the service writes the column, through the Zod-parsed merge; a hand-edited row is the only way, and the fix adds guards. |
| 4 | A stored height survives on a widget that does not grow | low | patch | `sizeOf` checked `widthToggle` for the width but not `grow` for the height. |
| 5 | The default layout and the merge are written twice; `applied` lacks `keepHiddenInOrder` | medium | patch | An optimistic order drops hidden keys, so a widget shown before the answer stays absent. |
| 6 | A grabbed widget stays grabbed after blur | false | reject | Sure's controller has no blur handler either; nothing is saved until release. |
| 7 | No live announcement during a keyboard move | low | reject | Sure announces nothing beyond `aria-grabbed`; an accessibility addition beyond parity. |
| 8 | The grip is a focusable button that does nothing | false | reject | Sure's grip is the same `button`, kept so the icons align. |
| 9 | All-hidden state missed when only empty widgets remain | low | reject | Needs every other widget hidden and the donut and investments empty; the fix needs each widget's render state in the route. |
| 10 | A viewer fetches a layout it discards | low | patch | `enabled: admin`. |
| 11 | A failed save is not tested | medium | patch | `onError` rollback and toast unverified; the repo tests it for the saved period. |
| 12 | The parity row reads « Parity. » over real differences | low | patch | The Sure cell was stale and the status hid four differences. |
| 13 | `sprint-status.yaml` and the spec disagree | false | reject | Step 5 moves both to `done`. |
| 14 | Hiding the investment widget without an investment account loses focus | low | reject | Needs the widget hidden while it renders nothing; focus lands on the page. |
| 15 | Arrow keys stop scrolling on a focused widget | false | reject | Sure's `handleKeyDown` prevents the default on both arrows too. |
| 16 | A drop over the dragged widget itself lands before a neighbour | false | reject | Sure's `getDragAfterElement` filters the dragged element out the same way. |
| 17 | A second touch orphans the hold timer | low | patch | `onStart` set a timer without clearing the pending one. |
| 18 | `touchcancel` counts as a drop | false | reject | Sure binds `touchcancel->touchEnd`, which drops. |
| 19 | A queued change rolled back after another failed restores a refused change | maybe-false | reject | Same pattern as `useSaveDefaultPeriod`; would need TanStack's scoped `onMutate` timing; low if true. |
| 20 | Focus after « Widgets masqués » runs before the widget mounts | maybe-false | reject | The e2e focuses the widget added back; would need a slow optimistic update to show. |
| 21 | Mouse drag untested | medium | patch | Only the keyboard path is exercised. |
| 22 | « Dépenses » height untested | low | patch | Only the net worth chart's height is asserted. |
| 23 | « Investissements » offer in « Widgets masqués » untested | low | defer | The shared e2e database always holds a PEA before `reset`. |
| 24 | The 1600 px test does not check packing | medium | patch | Only x positions were asserted; an overlap or hole would pass. |
| 25 | Money flow side by side at full width untested | low | defer | Visual only; covered by the screenshots. |

## Design Notes

Decision, Sure settles it: the default order changes to Sure's effective one (`cashflow_sankey`, `outflows_donut`, `net_worth_chart`, `balance_sheet`, `money_flow`, `spending_trend`, `investment_summary`); Stories 34.4 and 34.5 read the builder's order, which a user without a saved order never sees. The net worth and spending charts grow to 288 px, Sure's `auto`.

Decision: the chevron, grip and size menu live in every header, not only in customise mode, as Sure's view; customise mode adds hiding. The story's criterion groups them loosely.

Decision: Sure's controllers ported rather than `@dnd-kit`: Sure's keyboard model (release saves, `Escape` keeps the move) is the reference, the port is about 200 lines, and no dependency is added.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: green, the new domain and route specs included.
- `pnpm test:e2e` -- expected: green, the `layout` project included.

**Manual checks:**
- Screenshot customise mode, the size menu and the hidden-widgets card in French and English at 1440 px and 1600 px, and a keyboard grab's ring.
