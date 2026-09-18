# Lessons from the abandoned scaffolding

The full monorepo scaffolding was built, reviewed and then set aside: it answered questions no feature had asked yet. The code lives on branch `t3code/run-bmad-build-workflow`, commit `bb0b0ca`, as reference only. Nothing there is a contract; take what a feature actually needs.

Each point below cost a failed run or a review finding to learn.

## Toolchain

- Node 24 runs `@archant/api` and `@archant/data` straight from TypeScript through type stripping. Relative imports then carry their `.ts` extension, and each package's `tsconfig.json` needs `allowImportingTsExtensions`.
- A package `tsconfig.json` with `"include": ["*.ts"]` does not recurse. A type error in a subdirectory passed `pnpm typecheck` silently. Use `**/*.ts`.
- pnpm 10 skips install scripts by default, which leaves drizzle-kit without its esbuild binary. `onlyBuiltDependencies: [esbuild]` in `pnpm-workspace.yaml` fixes it.
- `pnpm -r typecheck` and `pnpm -r test` exit 0 when no package matches. Oxlint does not by default; `--no-error-on-unmatched-pattern` in `lint:code` lets the gate pass on an empty workspace.

## Database

- drizzle-kit is only needed to generate migrations. `drizzle-orm/libsql/migrator` applies them with the runtime driver, so a production image does not carry drizzle-kit, and it accepts an empty `drizzle/meta/_journal.json`.
- A relative `DATABASE_URL` resolves against the working directory, which is the package directory for every `pnpm <package>` script. `file:../../local.db` is the only local path both `pnpm data` and `pnpm api` agree on. In production, use an absolute path.
- Every libSQL connection to `:memory:` opens its own empty database. A test that migrates and then inspects needs a temporary file.

## Interface and API

- The typed client `hc<AppType>()` only stays typed if route mounts are chained, `AppType` is exported from the assembly point, handlers use `async/await`, errors go through `c.json(..., 404)` rather than `c.notFound()`, and both packages use the same Hono version. Renaming a route did break `pnpm typecheck` in the interface, with a real type.
- In development the interface (port 5173) and the API (port 8787) are cross-origin, so the API needs CORS from a configured origin. Strip a trailing slash from that origin: a browser `Origin` header never has one, and the mismatch blocks every request silently.
- Vite inlines `VITE_*` variables at build time. With `envDir` pointing at the repository root, a production build made on a machine with a development `.env` ships a bundle calling `http://localhost:8787`.
- Serving the interface from the API with a catch-all `app.get("*")` preempts `app.notFound`, so an unknown API route answers `200` with the page instead of the `NOT_FOUND` JSON. Settle the URL namespace, for instance an `/api` prefix, before the API serves the interface.

## Container

- `exec` in the start command is not enough for a clean stop. Node as PID 1 installs no signal handler, so the kernel drops SIGTERM and Docker kills the process ten seconds later, mid-write. `init: true` in `docker-compose.yml` fixed it: the container then exited with 143 in 150 ms.

## Tests

- Playwright's `reuseExistingServer` silently reuses a stale local server, which once made a CORS failure look like a hanging request. Set `forbidOnly` in CI so a forgotten `test.only` cannot pass the pipeline.
