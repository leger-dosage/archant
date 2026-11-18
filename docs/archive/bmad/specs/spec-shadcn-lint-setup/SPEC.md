---
id: SPEC-shadcn-lint-setup
companions:
  - implementation-plan.md
  - ../../../AGENTS.md
  - ../../../docs/tech-stack.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability. Consult them only if you need rationale that this contract omits.

# Set up @shadcn/lint

## Why

Archant has a documented visual system and a growing set of shadcn/ui components, but Oxlint cannot yet load checks for that system. Installing and registering `@shadcn/lint` creates that extension point without choosing a rule policy prematurely. Contributors keep one lint command, and a later change can introduce design rules against the components and Tailwind theme that already live in `packages/web`.

## Capabilities

- **CAP-1**
	- **intent:** Contributors can load `@shadcn/lint` through the existing workspace lint command.
	- **success:** `pnpm exec oxlint -D shadcn/no-restyle packages/web/src/lib/dates.ts` accepts the plugin rule, and `pnpm lint:code` exits with status 0 under the existing warning policy.
- **CAP-2**
  - **intent:** A clean checkout installs the plugin through the normal frozen pnpm installation.
  - **success:** `pnpm install --frozen-lockfile` succeeds, and the root package resolves `@shadcn/lint` without installing ESLint.
- **CAP-3**
  - **intent:** Future work has one documented place to add design-system rules.
  - **success:** `docs/tech-stack.md` records `@shadcn/lint` under the root Oxlint toolchain and names `.oxlintrc.json` as its rule configuration.

## Constraints

- Oxlint remains the only code linter. The repository uses TypeScript 7, which its architecture record identifies as incompatible with the current ESLint path.
- `.oxlintrc.json` registers `@shadcn/lint` through `jsPlugins` and preserves every existing plugin, rule, override, and ignore pattern.
- `pnpm lint:code` keeps `--type-aware`, `--max-warnings 0`, and `--no-error-on-unmatched-pattern`, so local and continuous integration checks remain identical.
- No `shadcn/*` rule is enabled. The upstream setup contract separates plugin registration from design-policy selection.
- The setup must remain compatible with Node.js 24 in continuous integration, `@shadcn/lint`'s Node.js 20.19 minimum, and the existing Oxlint 1.83 dependency.
- `packages/web/components.json` remains the source for the component alias and Tailwind theme. This change adds no redundant workspace-wide `settings.shadcn` block.

## Non-goals

- Selecting or enabling `no-restyle`, `no-raw-colors`, `no-arbitrary-values`, `no-inline-styles`, `no-unknown-classes`, or `require-static-classes`.
- Fixing existing Tailwind classes, inline styles, or shadcn/ui component code.
- Adding ESLint, another lint script, or another continuous integration job.
- Changing Archant's design tokens, component variants, or approved styling exceptions.

## Success signal

A clean checkout installs dependencies, Oxlint accepts a `shadcn/*` rule when requested from the command line, and the complete repository verification gate remains green without any new design rule taking effect.

## Assumptions

- "Set up" follows the linked repository's `SETUP.md`: install and register the plugin now, then choose and adopt rules in separate work informed by measured findings.
