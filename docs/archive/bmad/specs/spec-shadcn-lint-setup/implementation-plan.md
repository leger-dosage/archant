# Implementation plan

The upstream references for this plan are the [`@shadcn/lint` setup guide](https://github.com/shadcn-ui/lint/blob/093ae9db214772afe0de40299d224c7b5e24bdeb/SETUP.md) and [Oxlint configuration for version 0.1.5](https://github.com/shadcn-ui/lint/blob/093ae9db214772afe0de40299d224c7b5e24bdeb/README.md#oxlint).

## Current contract

- Root `package.json` owns `pnpm lint:code` and the Oxlint development dependencies.
- Root `.oxlintrc.json` checks all packages with type-aware Oxlint and fails on warnings.
- `packages/web/components.json` points to `src/components/ui`, the `@/` alias, and `src/styles.css`. The plugin can discover the web design system from that file.
- `.github/workflows/ci.yml` runs `pnpm lint:code` on Node.js 24 after `pnpm install --frozen-lockfile`.

## Ordered work

1. Run `pnpm lint:code` before edits and retain its result as the baseline. A pre-existing failure stops the change until it is distinguished from plugin setup.
2. Run `pnpm add --save-dev --workspace-root @shadcn/lint@^0.1.5`. This updates root `package.json` and `pnpm-lock.yaml`; do not add the optional ESLint peers.
3. Add `"jsPlugins": ["@shadcn/lint"]` to root `.oxlintrc.json`. Keep `plugins`, `options`, `categories`, `rules`, `overrides`, and `ignorePatterns` unchanged. Add no `shadcn/*` rule and no `settings.shadcn` block.
4. Update `docs/tech-stack.md` to record `@shadcn/lint` 0.1.x as an Oxlint JavaScript plugin whose rules are configured in `.oxlintrc.json` but remain disabled in this scope.
5. Run `pnpm exec oxlint -D shadcn/no-restyle packages/web/src/lib/dates.ts` and confirm that Oxlint accepts the plugin rule. Then run `pnpm lint:code` and compare the result with the baseline.
6. Run the repository gate in its documented order: `pnpm install --frozen-lockfile`, `pnpm format`, `pnpm lint:code`, `pnpm lint:format`, `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e`. Do not edit tracked files after this sequence.

## Expected file changes

| File | Change |
| --- | --- |
| `package.json` | Add the root development dependency `@shadcn/lint` at `^0.1.5`. |
| `pnpm-lock.yaml` | Lock the plugin and its non-optional dependencies. |
| `.oxlintrc.json` | Register the JavaScript plugin through `jsPlugins`. |
| `docs/tech-stack.md` | Record the installed extension and where future rules belong. |

No production source file or test file changes in this setup-only scope.
