---
title: 'Story 12.1: The brand foundation'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_commit: '2dc89e674cd1b1181ffc982837ef9eb7bd61a50c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The owner's manual QA (2026-09-25) found the interface austere next to Sure: a white page, a letter in a square for a logo, no favicon, no icon in the settings navigation, and nothing that colours a category or an account type. Stories 12.2 to 12.4 need shared surfaces and components before they restyle their screens.

**Approach:** Bring the theme to `DESIGN.md`, add a tinted icon, a category pill and the helper that makes pill text readable, then apply them where this story's acceptance criteria point: the sidebar, the settings navigation, the browser tab.

## Boundaries & Constraints

**Always:**
- Tokens in `packages/app/src/styles.css`, light and dark, exactly the values of `DESIGN.md`'s front matter: page `#F7F7F7`/`#0B0B0B`, card `#FFFFFF`/`#171717`, tray `#F0F0F0`/`#1F1F1F`, sidebar on the page grey, `muted-foreground-on-grey`, muted `#A3A3A3` in dark, the six `type-*` colours, `transfer`, `uncategorised`, `trend-up`/`trend-down`, `logo`, radii 6/8/10/12, and Sure's ring shadow as a `shadow-ring` utility (`0 0 0 1px rgba(255,255,255,.08)` in dark). Unlisted shadcn tokens keep the neutral base.
- `ui/card.tsx` takes the ring shadow and `rounded-xl` in place of its `ring-1`, since `DESIGN.md` names the card; no other shadcn file changes.
- Tinted icon: lucide icon at half the tile (22, 32, 36 px), full colour on `color-mix(in oklab, <colour> 10%, transparent)`. Account types map to `landmark`, `chart-line`, `house`, `car`, `credit-card`, `hand-coins`; transfer `arrow-left-right` in `transfer` (replaces `TRANSFER_COLOR` `#7A5AF8`); uncategorised `circle-dashed`; a merchant without a category shows its first letter, uppercased, in `uncategorised`.
- Category pill: 22 px, full radius, category icon at 12 px and name, fill 10 %, border 25 %, text from the helper. No category is a neutral « Sans catégorie » pill with `circle-dashed`.
- Pill helper: takes the category hex and the card colour of the resolved mode, composites the 10 % tint over the card in sRGB, and returns the hex unchanged if it already reaches 4.5:1; otherwise moves OKLCH lightness at constant hue, chroma mapped into sRGB, toward black in light mode and toward white in dark mode, until it reaches 4.5:1. `DESIGN.md` says "darkened"; darkening cannot pass on a dark card.
- Sidebar: `logo.svg`'s mark at 24 px in `logo` colour beside « Archant » (mark alone when collapsed); icons as today; the active entry, navigation or account, is a white `shadow-ring` tile on `rounded-md`, replacing the 2 px indigo bar; an eyebrow « Comptes » label above the groups; each account row shows its small tinted type icon, name, the kind label of `kindOf` as caption, and balance.
- Settings navigation: Sure's icons from `settings/_settings_nav.html.erb`: banks `banknote`, categories `shapes`, merchants `store`, tags `tags`, security `shield-check`; its active entry uses the same raised tile, since `bg-accent` vanishes on the grey page.
- Favicon: `public/favicon.svg` whose own `prefers-color-scheme` media query switches the fill between `#171717` and `#F7F7F7`, a 32 px PNG fallback and a 180 px `apple-touch-icon` on white, both generated once from the SVG and committed. The favicon follows the system, like the browser's tab strip, not Archant's theme menu.
- Icons stay decorative: every accessible name the e2e specs use today is unchanged, except account links gaining the caption.

**Never:** no restyle of pages, lists, charts, badges or empty states (12.2 to 12.4); no Réglages entry in the main navigation (`EXPERIENCE.md` keeps it in the footer menu); no colour on merchants in the schema; no change to seeded category colours; no « + » in the « Comptes » label; no new route or endpoint.

</frozen-after-approval>

## Code Map

- `packages/app/src/styles.css:15-167` -- `@theme inline` mapping, `:root`, `.dark`; radii at 57-63 are 4/6/8 today; comment at 9-14 already points at `DESIGN.md`.
- `packages/app/src/components/ui/card.tsx` -- `Card` uses `ring-1 ring-foreground/10`.
- `packages/app/src/components/AppSidebar.tsx` -- header letter square (122-129), `ACTIVE_INDICATOR` (35-36), `SidebarAccountGroup` (38-83) rows without icon or caption.
- `packages/app/src/routes/_authed.settings.tsx:8-33` -- `SECTIONS` and plain `Link`s with `activeProps` `bg-accent`.
- `packages/app/src/lib/category-icons.ts` -- `CATEGORY_ICON_COMPONENTS`, reuse for category tiles and pills.
- `packages/app/src/lib/account-kinds.ts` -- `kindOf`, label key `accounts.subtypes.<id>`.
- `packages/app/src/lib/transfers.ts:6` -- `TRANSFER_COLOR`.
- `packages/app/src/lib/theme.ts` -- `useResolvedTheme` for the pill helper's backdrop.
- `packages/app/index.html` -- no icon links today; `packages/app/public/` does not exist. Vite copies it into the build and `serveInterface` (`packages/api/src/app.ts:111-125`) serves any file at the root.
- `packages/data/category-presets.ts:10-21` and `packages/api/src/services/default-categories.ts:17-33` -- the colours the helper test must cover.
- `packages/app/src/locales/fr.json` -- `nav.*`, `settings.sections.*`, `accounts.subtypes.*`.
- e2e selectors to keep: `accounts.spec.ts:12` group toggle name starts with « Actifs »; `rules.spec.ts:58`, `recurring.spec.ts:231`, `manage-accounts.spec.ts:192` exact link names; `keyboard.spec.ts:100` tooltip « Comptes »; `bank-connections.spec.ts:295` account link contains the balance.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/lib/pill-text-color.spec.ts` -- first: every `CATEGORY_COLORS` and default category colour, plus `#FFFF00`, `#FFFFFF`, `#000000`, reach ≥ 4.5:1 on its composited tint in both modes; a colour that already passes comes back unchanged; hue is kept.
- [x] `packages/app/src/lib/pill-text-color.ts` -- the helper, on `culori` (`wcagContrast`, `oklch`, `toGamut`).
- [x] `packages/app/src/lib/tint.spec.ts` then `tint.ts` -- `accountTypeTint`, `categoryTint`, `TRANSFER_TINT`, `UNCATEGORISED_TINT`, `merchantTint`, each returning `{ color, icon }` or `{ color, letter }`; the letter test covers « éco » → « É » and a leading space.
- [x] `packages/app/src/lib/theme-tokens.spec.ts` -- reads `styles.css` and checks each `DESIGN.md` token value in `:root` and `.dark`.
- [x] `packages/app/src/styles.css`, `components/ui/card.tsx`, `lib/transfers.ts` -- tokens, `shadow-ring`, card, transfer colour.
- [x] `packages/app/src/components/TintedIcon.tsx`, `CategoryPill.tsx`, `Logo.tsx` -- thin components over `tint.ts` and the helper.
- [x] `packages/app/src/components/AppSidebar.tsx`, `routes/_authed.settings.tsx`, `locales/fr.json` -- sidebar and settings navigation.
- [x] `packages/app/public/favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`, `index.html` -- icon links.
- [x] `packages/app/e2e/brand.spec.ts` -- logo beside « Archant »; active entry computed background `rgb(255, 255, 255)` with a shadow; a checking account row shows « Courant » and a tile coloured `#875BF7`; each settings link holds its `lucide-<name>` icon; `link[rel=icon]` points at an SVG the server answers with `image/svg+xml`.

**Acceptance Criteria:**
- Given the finished story, when the verification gate of `AGENTS.md` runs, then it passes with no existing e2e selector rewritten except where an account link name gains its caption.

## Design Notes

`culori` is the new dependency: OKLCH gamut mapping and WCAG contrast are easy to get subtly wrong by hand, and it is the common choice (tree-shakable, maintained). The pull request states this reason. Pill and tint components stay thin so the logic is tested in Vitest's node environment; Playwright covers what the sidebar and settings show. Changing the page to grey leaves some existing muted text on grey below AA until 12.2 to 12.4 put it in cards; 12.4's contrast test closes that.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, tree unchanged afterwards.

**Manual checks:**
- `pnpm app start:dev`, light then dark: grey page, raised active entry, account icons, favicon in the tab.

## Implementation Notes

- The sidebar caption is the kind label of `kindOf`, as the frozen intent says, so a checking account reads « Compte courant », not the mock's « Courant ». `brand.spec.ts` asserts « Compte courant »; renaming `accounts.subtypes.checking` would break `accounts.spec.ts:51` and `:61`.
- Account type, transfer and uncategorised tints return `var(--type-*)`, `var(--transfer)` and `var(--uncategorised)`, so `styles.css` stays the single source of those colours; `TRANSFER_COLOR` is now `var(--transfer)`.
- `@archant/api` exports `./services/default-categories`, so the pill helper's test covers the seeded colours without copying them.
- `toGamut` runs without CSS's "roughly in gamut" shortcut (`delta` `null`): with it, clipping turned `#e99537`'s hue by about six degrees.
- The sidebar's dark `--sidebar-accent` is now the dark card, `#171717`: the old `#0B0B0B` equals the new page grey and hid hover and the active tile.
- No `fr.json` change was needed: the eyebrow reuses `nav.accounts` and the neutral pill `transactions.category.none`.

## Spec Change Log

- Review finding: `bg-background` became the page grey, so shadcn surfaces that sit on white cards (outline button, active tab, chart tooltip) and two app surfaces (balance chart sticky header, transaction row hover) turned grey. The frozen "no other shadcn file changes" contradicts `DESIGN.md` (`button-outline` background is `card`) and Sure (outline buttons on the container colour); DESIGN.md and Sure win, so those five places move to `bg-card`. Frozen text left as written; the deviation is reported to the owner. KEEP: every other shadcn file untouched; `ui/sidebar.tsx` inset stays on the page grey.
- Standards and spec review: the dark `--sidebar-accent`, an unlisted shadcn token, moves from `#0B0B0B` to the dark card `#171717`, because the old value now equals the page grey and hid the active tile; and the 10 % tint lives once, in `tintFill` beside `pillTint`, so the contrast search always measures the fill the components paint. The favicon follows the system scheme, as the frozen intent says, where the epic's AC reads "the current mode". KEEP: both.

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| Muted text (`#737373`) on the new grey page is below AA across existing pages (blind) | medium | `#737373` on `#F7F7F7` is about 4.4:1; the frozen intent excludes restyling pages, and Story 12.4's AC checks every text pair | defer (12.4) |
| `bg-background` surfaces on white cards turn grey (blind, edge) | medium | `ui/button.tsx:13` outline, `ui/tabs.tsx:58` active tab, `ui/chart.tsx:172`, `BalanceChart.tsx:186`, `TransactionList.tsx:93` | patch (see change log) |
| Tinted tile colour or merchant letter below contrast (blind) | false | Tiles are `aria-hidden` and always sit beside the name they illustrate; `DESIGN.md` specifies the full colour on a 10 % tint | reject |
| `CARD_COLORS` duplicates `--card` untested (blind, verification-gap) | low | A token change would leave the pill contrast computed on the old card | patch |
| Unused components lack render tests (blind) | low | Vitest runs in node; logic lives in tested `tint.ts` and the helper; 12.2–12.4 wire them | reject |
| Invalid colour throws in `CategoryPill` render (blind, edge) | false | Category colours are validated by `CATEGORY_COLOR_PATTERN`; the pill's prop is a category, transfers never reach it | reject |
| `@archant/api` exports a service for a test (blind) | low | `@archant/app` already depends on `@archant/api`; the module is data only | reject |
| Transfer colour changes and equals the accent (blind) | false | `DESIGN.md` sets `transfer` to `#444CE7`, Sure's indigo | reject |
| Dark mode untested in e2e; dark `muted-foreground-on-grey` unchecked (blind) | low | Token values are checked in `theme-tokens.spec.ts`; `#A3A3A3` is DESIGN's dark muted | reject |
| Hover and active entries differ only by the ring (blind, edge) | low | Same as Sure's sidebar; cosmetic | reject |
| Eyebrow not a group label, arbitrary values (blind) | low | Each group keeps its own labelled toggle button | reject |
| Empty or NFD merchant name (blind, edge) | false | `api/src/schemas/merchants.ts:7-11` trims, NFC-normalises and requires length 1 | reject |
| Favicon PNGs not requested in e2e (blind) | low | A wrong static fallback would answer HTML unnoticed; two requests close it | patch |
| Spec imports full `culori`, masking missing `registerMode` (verification-gap) | medium | Demonstrated `TypeError` with only `culori/fn` loaded | patch |
| `CategoryPill` imported nowhere (verification-gap) | false | Planned: 12.2–12.4 wire it | reject |
