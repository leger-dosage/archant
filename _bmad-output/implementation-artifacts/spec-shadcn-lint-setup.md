---
title: 'Set up @shadcn/lint'
type: 'chore'
created: '2026-09-22'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/tech-stack.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant's root Oxlint configuration cannot load the design-system checks supplied by `@shadcn/lint`.

**Approach:** Install `@shadcn/lint` at the workspace root and register its JavaScript plugin in the existing Oxlint configuration. Preserve every existing lint rule and command, and leave all `shadcn/*` rules disabled until a later policy change.

</frozen-after-approval>

## Implementation Notes

- Baseline `pnpm lint:code` before editing.
- Add `@shadcn/lint@^0.1.5` to root `devDependencies` and update `pnpm-lock.yaml` without installing its optional ESLint peers.
- Add `jsPlugins: ["@shadcn/lint"]` to `.oxlintrc.json`. Keep the existing `plugins`, type-aware options, rules, overrides, ignores, and `lint:code` script unchanged.
- Keep `packages/web/components.json` as the source for component and Tailwind theme discovery. Do not add `settings.shadcn`.
- Record the plugin and its disabled-by-default policy in `docs/tech-stack.md`.
- Verify registration with `pnpm exec oxlint -D shadcn/no-restyle packages/web/src/lib/dates.ts`, then run the complete gate from `AGENTS.md` without editing tracked files afterwards.
- Baseline result: `pnpm lint:code` exited with status 0 before the dependency and configuration changed.
- Implemented in root `package.json`, `pnpm-lock.yaml`, `.oxlintrc.json`, and `docs/tech-stack.md`. pnpm installed six packages and did not install the optional ESLint peers.
- Registration check: Oxlint accepted `shadcn/no-restyle` when enabled from the command line on `packages/web/src/lib/dates.ts`; the normal lint command stayed green with every `shadcn/*` rule disabled.
- Full gate passed on 22 September 2026: frozen install, formatting, code lint, format lint, type checking, 411 unit and integration tests, and 62 end-to-end tests.

## Review Triage Log

- `medium`, patched: `oxlint --rules` did not list disabled JavaScript-plugin rules, so the registration check now asks Oxlint to enable `shadcn/no-restyle` on a non-UI file.
- `low`, rejected: removing `jsPlugins` would not fail a dedicated persistent smoke test, but adding another root script for a disabled rule would expand this setup-only scope and duplicate direct configuration review.
- `low`, patched: `docs/tech-stack.md` now says future rules belong in `.oxlintrc.json` instead of implying rules already exist there.
- `low`, patched: the inventory verification date now records 22 September 2026.
- `false`: `status: in-progress` is required until implementation, review, and the full gate finish; completion is recorded only after those steps.
- `false`: BMad `sources` contains absorbed project file paths, not external URLs; the pinned upstream references remain in `implementation-plan.md`.
- `low`, patched: upstream documentation links now pin commit `093ae9db214772afe0de40299d224c7b5e24bdeb`, the `@shadcn/lint` 0.1.5 tag.
- `low`, patched: `docs/tech-stack.md` now links the pinned rule reference and configuration guide.
- `false`: the dependency is not speculative; this approved setup is the current work that needs it, so it satisfies the dependency rule in `docs/tech-stack.md`.
- `low`, patched: `.oxlintrc.json` now explains why the plugin is registered before any design-system rule is enabled.
