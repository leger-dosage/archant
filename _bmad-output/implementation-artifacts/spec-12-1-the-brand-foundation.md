---
title: 'Story 12.1: The brand foundation'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_commit: '5dcf5d9b2800e1eaeaaccedd91ba685dd8db5fa6'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The interface still wears Epic 1's skin: Geist, a placeholder « A » logo, no favicon, an 8 px dot for every colour, a 48 px header holding only the sidebar toggle, and each page drawing its own `text-3xl` heading. Stories 12.2 to 12.4 need one set of surfaces, type, icons and logo to build on.

**Approach:** Replace the theme with `DESIGN.md`'s Linear Light and Linear Classic Dark tokens and Inter, put every signed-in page in the inset panel under a title bar, add a `TintedIcon` and a `CategoryPill` fed by one OKLCH contrast helper, switch the category palette, and ship the arch logo and favicon.

## Boundaries & Constraints

**Always:**
- Token mapping onto shadcn names: `--sidebar` is DESIGN's `background`, `--background` and `--card` are `panel`, `--accent` is `hover`, `--sidebar-accent` is `active`. New tokens: `section`, `hover`, `selection`, `badge`, `foreground-secondary`, `border-strong`, `line`, `grid`, `link`, `trend-up`, `trend-down`, `type-*`, `transfer`, `logo`. Unlisted shadcn tokens keep the neutral base. Dark chart tokens get their own values.
- AA wins over a hex. Four DESIGN pairs miss 4.5:1 by a hair: light `muted-foreground` and `money-income` on `selection` (4.50 and 4.48), dark `destructive` on `panel` (4.4997) and on `section` (4.18). Darken or lighten each in OKLCH, hue and chroma kept, to the least change that passes, and write the new hex into `DESIGN.md`'s front matter.
- Radii `sm` 5, `md` 6, `lg` 8, `xl` 10 px, larger steps 10 px. Only popovers, menus, selects, sheets, dialogs, chart tooltips and `BulkBar` keep a shadow; the inset panel gets a 1 px `border` instead.
- Body text 13 px, weights 400/510/590, `cv01` and `ss03` on the root.
- `components/Page.tsx` owns the frame: a 44 px title bar (the sidebar trigger, the page's lucide icon, the title as the page's single `h1` in `label` type, actions on the right, a `line` divider), then `BankAlerts`, then content padded 24/28 px up to 1200 px. `_authed.tsx` stops rendering the header and `BankAlerts`. Every signed-in route renders through `Page`, moving its current heading and header actions into it; settings keep « Réglages » as `h1` and their `h2`.
- Sidebar: `variant="inset"` on `--sidebar`, arch logo 20 px beside « Archant », entries 28 px with the mock's icons (`LayoutDashboard`, `Wallet`, `Receipt`, `Calendar`, `Funnel`), active entry on `--sidebar-accent` with no left bar, each account row with a 20 px `TintedIcon` of its type then its balance. Réglages stays in the footer menu, as `EXPERIENCE.md` places it.
- `lib/tint.ts` resolves what to draw: account type → lucide icon and `type-*` colour; transfer → `ArrowLeftRight` in `transfer`; uncategorised → `CircleDashed`, muted; merchant without category → its first letter, muted; category → its icon and colour. `TRANSFER_COLOR` becomes `#5e6ad2`.
- `lib/contrast.ts`: WCAG ratio, `#rrggbb` ↔ OKLCH, and `adjustToContrast(colour, background, target)` moving lightness only and clamping chroma into sRGB. Targets on the hover row (`#f4f4f4`, `#2b2d30`): pill text 4.6 light / 6.5 dark, icon 3. Fill is `color-mix(in oklab, <colour> 10% light / 17% dark, transparent)`. Components pick the mode through `useResolvedTheme()`.
- `CATEGORY_COLORS` becomes DESIGN's ten, lowercase, orange first; `fr.json` names them. A colour outside the palette stays selectable, as today. The category dialog shows a live `lg` `TintedIcon` of the category, as Sure's form does.
- Favicon: `public/favicon.svg` is `mockups/logo.svg` with its `prefers-color-scheme` style, plus `public/favicon-32.png` rendered once with `rsvg-convert`. Settings nav icons follow Sure: `Banknote`, `Shapes`, `Store`, `Tags`, `ShieldCheck`.

**Never:** no sidebar search or new-item button (no search feature exists since 11.13), no colour library (the OKLCH math is short and tested), no recolouring of stored or default categories, no restyle of lists, dashboard or dialogs beyond this list (Stories 12.2 to 12.4), no edit to `components/ui/*` beyond the inset shadow, no `theme-color` meta.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pale colour | `#f0bf00` in light | pill text darkened to ≥ 4.6:1 on `#f4f4f4`, same hue | N/A |
| Dark colour | `#5e6ad2` in dark | pill text lightened to ≥ 6.5:1 on `#2b2d30` | N/A |
| Already enough | `#282a30` in light | returned unchanged | N/A |
| Unreachable chroma | saturated blue lightened | chroma reduced to stay in sRGB, ratio still met | N/A |
| Off-palette category | `#22c55e` from the defaults | edit dialog lists it first, selected, preview uses it | N/A |
| Mode switch | Thème : Sombre | icons and pills recompute without reload | N/A |

</frozen-after-approval>

## Code Map

- `packages/app/src/styles.css` -- `@theme inline` (:15-64), `:root` (:66-105), `.dark` (:107-141), base 14 px (:143-159), `amount-hero` (:162-167); Geist imports (:1-5).
- `packages/app/package.json:17` -- swap `@fontsource-variable/geist` for `@fontsource-variable/inter` ^5.3.0; `docs/tech-stack.md:65`.
- `packages/app/index.html` -- add the two `<link rel="icon">`; no `public/` exists yet, the API serves root files through `serveInterface` (`packages/api/src/app.ts:111-125`).
- `packages/app/src/routes/_authed.tsx:34-66` -- layout to slim; widths 240/56 stay.
- `packages/app/src/components/AppSidebar.tsx` -- header placeholder (:122-129), nav (:131-200), `ACTIVE_INDICATOR` (:35), account groups (:38-110).
- `packages/app/src/components/ui/sidebar.tsx:219,282` -- inset `shadow-sm`, override from `SidebarInset`'s `className` if possible.
- Headings to move into `Page`: `_authed.index.tsx:168`, `_authed.accounts.index.tsx:40-45`, `_authed.accounts.$accountId.tsx:346` (name and `AccountMenu`; badge and balance stay in content), `_authed.transactions.tsx:184`, `_authed.recurring.tsx:129`, `_authed.rules.tsx:346`, `_authed.settings.tsx:21`; bank sub-routes render inside settings.
- `packages/app/src/routes/_authed.settings.tsx:8-14` -- `SECTIONS`, add icons.
- `packages/data/category-presets.ts:10-21` -- `CATEGORY_COLORS`; `lib/new-category.ts:10` takes `[0]`; `CategoryDialog.tsx:49,102-103,203-229` swatches; `fr.json:599-610` `categories.colors`.
- `packages/app/src/lib/transfers.ts:6`, `lib/category-icons.ts:51` (`CATEGORY_ICON_COMPONENTS`), `lib/theme.ts:77` (`useResolvedTheme`), `components/CategoryDot.tsx` (left in place for 12.3/12.4).
- `packages/app/vite.config.ts:30-33` -- Vitest runs in `node`, no jsdom: test pure `lib/` modules and `styles.css?raw`.
- e2e to update: `categories.spec.ts:59-136` (swatch names, first `span[aria-hidden]` colour), `import-ofx.spec.ts:44`, `snapshots.spec.ts:11`, `transactions.spec.ts:9` (read the `h1`'s parent, which becomes the title bar), sidebar `^Actifs` matchers in `accounts.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/lib/contrast.spec.ts`, `contrast.ts` -- matrix rows 1-4, ratio against known pairs (`#ffffff`/`#5e6ad2` = 4.70).
- [x] `packages/app/src/lib/tint.spec.ts`, `tint.ts` -- one case per kind, all six account types, both modes.
- [x] `packages/app/src/styles.spec.ts` -- parse `:root` and `.dark` from `styles.css?raw`; assert ≥ 4.5 for `foreground`, `foreground-secondary`, `muted-foreground` on `background`, `panel`, `section`, `hover`, `selection`; `link`, `money-income`, `destructive` on `panel`, `section`, `hover`; `primary-foreground` on `primary`. Written before the tokens.
- [x] `packages/app/e2e/brand.spec.ts` -- written first: `link[rel=icon]` to `/favicon.svg` and the PNG answer 200; the sidebar shows the logo named « Archant »; an account row holds its type icon; each nav and settings entry has an icon; the title bar holds the page's `h1` and actions; the body's `font-family` starts with « Inter Variable »; the inset panel has no `box-shadow`; after « Thème : Sombre » the panel background is `rgb(31, 32, 35)`.
- [x] `styles.css`, `package.json`, `docs/tech-stack.md` -- tokens, radii, Inter, 13 px body; adjusted hexes back into `DESIGN.md`.
- [x] `components/TintedIcon.tsx`, `components/CategoryPill.tsx`, `components/ArchLogo.tsx` -- sizes 20/22/32, pill 20 px high with a 12 px icon, « Sans catégorie » muted; logo `currentColor` in `--logo`.
- [x] `components/Page.tsx`, `_authed.tsx`, every signed-in route -- the frame, then the headings moved.
- [x] `components/AppSidebar.tsx`, `_authed.settings.tsx` -- logo, icons, active background, account type icons.
- [x] `category-presets.ts`, `CategoryDialog.tsx`, `lib/transfers.ts`, `fr.json` -- palette, names, preview; `categories.spec.ts` asserts the ten swatches and the preview.
- [x] `public/favicon.svg`, `public/favicon-32.png`, `index.html`.
- [x] Remaining e2e fixes from the Code Map.

**Acceptance Criteria:**
- Given the finished story, when `grep -rn "shadow-" packages/app/src` runs, then only the floating layers listed above, `shadow-none` resets and shadcn components `DESIGN.md` uses unchanged (`ui/tabs.tsx`, unused `ui/sidebar.tsx` variants) match.
- Given the finished story, when the `AGENTS.md` verification gate and `pnpm test:e2e` run, then all pass and no tracked file changes.

## Implementation Notes

- AA pairs. The contrast test also covers the selected, hovered and active rows, so more hexes moved than the four the intent names, each by the least OKLCH lightness change passing on every surface: light `muted-foreground` and `money-muted` `#6C6B73`, `money-income` `#1D7F34`, `link` `#5A65CC`; dark `destructive` `#FE5C5A`. All written back into `DESIGN.md` and `epic-12-context.md`. Dark `--input` is shadcn's neutral `oklch(1 0 0 / 15%)`.
- Vitest blanks CSS imports, `?raw` included; `vite.config.ts` sets `test.css.include` to `styles.css` so `styles.spec.ts` and `tint.spec.ts` read the real stylesheet.
- `--text-sm` is 13 px and `--font-weight-medium`/`-semibold` are 510/590 in `@theme`, so shadcn's controls follow DESIGN's `body`/`label` type without touching `components/ui/*`.
- Account page: the name is the title bar's `h1`; « Importer », « Ajouter une opération » and the account's « … » menu are its actions. Subtype, the « Inactif » badge, the loan summary and the balance stay in content, in a `section` labelled by the `h1` (`PAGE_TITLE_ID`). The e2e helpers that read « the h1's parent » now read that region.
- `keyboard.spec.ts` asserted a header holding the sidebar trigger only; it now asserts the trigger plus the page's own actions, still no search or command button.
- `grep -rn "shadow-" packages/app/src` still matches, beyond the floating layers: `ui/tabs.tsx` (active tab `shadow-sm`), `ui/sidebar.tsx` floating variant and outline button (both unused), and `shadow-none` resets. Removing the tab's shadow means editing `components/ui/*` beyond the inset, which the intent forbids; left for 12.3.
- Spec-review pass: `HOVER_ROW` is exported from `lib/tint.ts` and checked against `--accent` in both modes; `ResolvedTheme` is declared once in `lib/theme.ts`; the e2e `rgb` helper moved to `fixtures.ts`; `tintFill` and `TintedIconSize` are no longer exported. The title bar keeps `min-h-11 flex-wrap`: 44 px whenever the actions fit, wrapping only on a narrow screen rather than hiding an action.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Route | Evidence |
|-------|---------|---------|-------|----------|
| blind | Favicon test passes without the file | medium | patch | `serveInterface` answers `index.html` with 200 for any path; now asserts `content-type` |
| blind, gap, edge | AA pairs untested on `selection` and `sidebar-accent`; link, destructive, muted fail there | medium | patch | measured 4.43, 4.49, 4.32; surfaces added, three hexes retuned, DESIGN.md updated |
| blind | `styles.css` comment counts four moved pairs | low | patch | direct correction |
| blind | `epic-12-context.md` quotes superseded hexes | low | patch | later stories load it |
| blind | Dark `--input` nearly invisible on the new panel | medium | patch | `#242424` was the neutral base flattened over near-black; now shadcn's `oklch(1 0 0 / 15%)` |
| blind, edge | Title bar overflows on narrow screens | medium | patch | fixed `h-11`, no wrap, three actions on the account page |
| blind | Active settings entry looks hovered | low | patch | both used `bg-accent`; direct correction |
| blind | `font-feature-settings` not asserted | low | patch | spec requires it; one assertion |
| blind, edge | `keyboard.spec.ts` title bar test depends on an earlier test | medium | patch | « Ajouter un compte » needs an account |
| edge | NFD merchant name or `ß` gives a wrong letter | low | patch | bank labels can arrive decomposed; one-line normalisation |
| gap | Parent colour in the dialog preview untested | low | patch | removing the lookup kept the suite green |
| blind | Cards take 10 px radius, sections should be 8 | low | reject | cosmetic; sections are built in 12.2 to 12.4 |
| blind | `CategoryPill` and `md` size not rendered by any test | low | reject | colours covered through `resolveTint`; first use and its test land in 12.3 |
| blind, edge | `adjustToContrast` silently returns an unreachable target | low | reject | black and white exceed 6.5:1 on both hover rows, the only backgrounds used |
| blind | Cache key not lower-cased | low | reject | a duplicate cache entry at worst |
| blind | Sprint status `in-progress` while spec is `in-review` | false | reject | the workflow keeps the sprint at `in-progress` until done |
| blind | No story puts the logo on sign-in and setup | false | reject | Story 12.4's first criterion names them |
| blind | `CATEGORY_COLOR_PATTERN` may accept `#rgb` | false | reject | `/^#[0-9a-f]{6}$/u` |
| edge | Type icons fall to 2.8-3.0:1 on the active sidebar row | low | reject | the frozen intent measures on the hover row |
| edge, gap | Transfer colour equals the Indigo swatch | false | reject | DESIGN.md sets both; the transfer label carries the meaning |

## Design Notes

The title bar's title is the page's `h1`, so the 51 e2e assertions on level-1 headings keep working and a screen reader still lands on one heading per page. Story 12.2 decides whether « Bonjour » takes the dashboard's `h1`. The contrast helper measures on the hover row because it is the palest light surface and the lightest dark one a pill sits on; a pill that passes there passes on every row.

## Verification

**Commands:**
- `pnpm test` -- expected: pass, including the three new specs.
- `pnpm test:e2e` -- expected: pass.

**Manual checks (if no CLI):**
- Light and dark screenshots of `/`, `/transactions` and `/settings/categories` next to `mockups/key-linear-classic-dark.html`: base behind the sidebar, bordered panel, no page shadow.
