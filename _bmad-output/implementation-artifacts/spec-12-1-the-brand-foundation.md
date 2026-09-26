---
title: 'Story 12.1: The brand foundation'
type: 'feature'
created: '2026-09-26'
status: 'ready-for-dev'
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
- [ ] `packages/app/src/lib/pill-text-color.spec.ts` -- first: every `CATEGORY_COLORS` and default category colour, plus `#FFFF00`, `#FFFFFF`, `#000000`, reach ≥ 4.5:1 on its composited tint in both modes; a colour that already passes comes back unchanged; hue is kept.
- [ ] `packages/app/src/lib/pill-text-color.ts` -- the helper, on `culori` (`wcagContrast`, `oklch`, `toGamut`).
- [ ] `packages/app/src/lib/tint.spec.ts` then `tint.ts` -- `accountTypeTint`, `categoryTint`, `TRANSFER_TINT`, `UNCATEGORISED_TINT`, `merchantTint`, each returning `{ color, icon }` or `{ color, letter }`; the letter test covers « éco » → « É » and a leading space.
- [ ] `packages/app/src/lib/theme-tokens.spec.ts` -- reads `styles.css` and checks each `DESIGN.md` token value in `:root` and `.dark`.
- [ ] `packages/app/src/styles.css`, `components/ui/card.tsx`, `lib/transfers.ts` -- tokens, `shadow-ring`, card, transfer colour.
- [ ] `packages/app/src/components/TintedIcon.tsx`, `CategoryPill.tsx`, `Logo.tsx` -- thin components over `tint.ts` and the helper.
- [ ] `packages/app/src/components/AppSidebar.tsx`, `routes/_authed.settings.tsx`, `locales/fr.json` -- sidebar and settings navigation.
- [ ] `packages/app/public/favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`, `index.html` -- icon links.
- [ ] `packages/app/e2e/brand.spec.ts` -- logo beside « Archant »; active entry computed background `rgb(255, 255, 255)` with a shadow; a checking account row shows « Courant » and a tile coloured `#875BF7`; each settings link holds its `lucide-<name>` icon; `link[rel=icon]` points at an SVG the server answers with `image/svg+xml`.

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

## Spec Change Log

## Review Triage Log
