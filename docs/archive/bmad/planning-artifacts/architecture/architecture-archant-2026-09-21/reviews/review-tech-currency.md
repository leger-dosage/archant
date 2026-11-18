---
review: tech-currency
target: ../ARCHITECTURE-SPINE.md
date: '2026-09-21'
method: npm registry (`npm view`), unpacked tarballs, local probes on Node 24.19.0 and TypeScript 7.0.2, Enable Banking API reference
---

# Technology currency review — Archant architecture spine

## Verdict

Every package in the spine exists, and every stated version matches the npm `latest` tag on 2026-09-21. Nothing is abandoned. The problems are in how the spine uses some of these packages. Two decisions do not work as written: the Better Auth setup route (AD-13) and the pino redaction paths (AD-14). One Enable Banking field choice would corrupt deduplication (AD-3 and AD-7). `ofx-js` has two parser defects that fixtures must cover.

## Method

- `npm view <pkg> version dist-tags deprecated peerDependencies` for every row of the Stack table and of `docs/tech-stack.md`.
- Tarballs of `ofx-js`, `papaparse`, `better-auth`, `@better-auth/drizzle-adapter`, `auth` and `@better-auth/telemetry` unpacked and read.
- Probes run on Node 24.19.0: `ofx-js` against SGML, XML, empty-element and pathological input; `papaparse` against Windows-1252 bytes; `msw` against native `fetch`; `jose` against PKCS#1 and PKCS#8 keys; pino redaction paths.
- A consumer file importing `better-auth` (Drizzle adapter, `disableSignUp`, `additionalFields`, `admin` plugin), `drizzle-orm/libsql`, `ofx-js`, `papaparse`, `jose`, `msw` and `hono`, type-checked with the repository's `tsconfig.base.json` under TypeScript 7.0.2.
- Enable Banking API reference at `https://enablebanking.com/docs/api/reference/`, read in full for JWT, `Access`, `Transaction`, `AccountResource`, `BalanceResource`, `HalTransactions`.

## Version table

| Package | Spine | npm latest (2026-09-21) | Status |
| --- | --- | --- | --- |
| Node.js | 24.19 | 24.21.0 (2026-09-07) | Two minors behind, neither a security release. Pin `24.21` or `24` in CI. Node 26 becomes LTS in October 2026; not urgent. |
| better-auth | 1.7.5 | 1.7.5 | Current. Peer `drizzle-orm ^0.45.2`, `drizzle-kit >=0.31.4`: matches. |
| drizzle-orm | 0.45.3 | 0.45.3 | Current stable. 1.0 is at `rc` (1.0.0-rc.4); stay on 0.45 until 1.0 is `latest`, since drizzle-kit 1.0 changes the migration folder layout. |
| hono | 4.13.8 | 4.13.8 | Current. |
| @libsql/client | 0.18.0 | 0.18.0 | Current. |
| papaparse | 5.7.0 | 5.7.0 | Current, released 2026-08-24, 11M weekly downloads, repository pushed 2026-09-15. Ships no types: add `@types/papaparse` 5.5.2. |
| ofx-js | 1.1.1 | 1.1.1 | Current. Rewritten in May 2026 after years dormant; single maintainer, 19k weekly downloads, zero dependencies, ESM only. See finding 4. |
| jose | 6.2.12 | 6.2.12 | Current. Already a dependency of `better-auth`, so it adds nothing to the tree. |
| pino | 10.3.1 | 10.3.1 | Current. See finding 2. |
| msw | 2.15.0 | 2.15.0 | Current. Peer `typescript >= 4.8.x` accepts 7. |
| date-fns | 4.4.0 | 4.4.0 | Current. See finding 9. |
| tailwindcss | 4.3.3 | 4.3.3 | Current. Needs `@tailwindcss/vite` 4.3.3, peer `vite ^8` accepted. |
| shadcn (CLI) | 4.21.0 | 4.21.0 | Current. |
| lucide-react | 1.47.0 | 1.47.0 | Current. |
| recharts | 3.10.1 | 3.10.1 | Current. shadcn `chart` targets Recharts v3. Peer `react-is` must be installed explicitly. |
| @tanstack/react-table | 9.2.4 | 9.2.4 | Current and stable since 9.0.0 on 2026-08-04. shadcn's data table guide targets v9. |
| @tanstack/router-plugin | 1.168.x | 1.168.40 | Current. Peer `@tanstack/react-router ^1.170.38`, matches `docs/tech-stack.md`. |
| react-hook-form | 7.88.0 | 7.88.0 | Current. |
| @hookform/resolvers | 5.9.1 | 5.9.1 | Current. Peer `zod ^4` accepted. |
| i18next | 26.4.2 | 26.4.2 | Current. Peer `typescript ^5 \|\| ^6 \|\| ^7`. |
| react-i18next | 17.0.14 | 17.0.14 | Current. Peer `i18next >= 26.2.0`, `react >= 16.8`. |
| vite, react, typescript, vitest, zod | per `docs/tech-stack.md` | 8.3.0, 19.3.0, 7.0.2, 5.0.1, 4.6.5 | All current. |

## Findings

### 1. Better Auth: `/api/setup` cannot work as AD-13 describes — High

`emailAndPassword.disableSignUp: true` is enforced inside the `/sign-up/email` endpoint itself (`dist/api/routes/sign-up.mjs`, line 144), so `auth.api.signUpEmail()` throws `EMAIL_PASSWORD_SIGN_UP_DISABLED` even when called from the server. The setup route has no supported way to create the first user under this configuration.

The "transaction that finds zero users" also does not hold. Better Auth writes through its own adapter on the `db` it was given, not on a Drizzle `tx` opened by the service, and `drizzleAdapter` defaults to `transaction: false`. On a local libsql file, a service transaction holding the write lock while Better Auth writes on another connection ends in `SQLITE_BUSY`.

Separately, `additionalFields.role` without `input: false` is writable by the user through `POST /api/auth/update-user` (`dist/db/schema.mjs` only skips fields whose `input === false`). Any signed-in user could grant themselves `admin` the day a `viewer` role exists.

Fix:

- Use Better Auth's `admin` plugin instead of a hand-declared `role` field. It adds `role` with the right input rules, and `auth.api.createUser({ body: { email, password, name, role: "admin" } })` works server-side without headers (`dist/plugins/admin/routes.mjs`). `requireRole` reads `session.user.role` as planned.
- If the plugin is refused, declare `role: { type: "string", input: false, defaultValue: "admin" }` and create the user through `(await auth.$context).internalAdapter`.
- Replace the zero-user transaction with an atomic claim: insert a `settings` row `setup_claimed_at` under its unique key, create the user, delete the claim on failure. The process is single, so an in-process mutex around the route is enough as well.
- The CLI is now the `auth` package: `pnpm dlx auth@1.7.5 generate --config packages/api/src/auth.ts --output packages/data/schema/auth.ts`. `@better-auth/cli` is deprecated on npm and stuck at 1.4.21.
- Pass `usePlural: true` to `drizzleAdapter` so the generated tables are `users`, `sessions`, `accounts`, `verifications`, as the Consistency Conventions require. Without it the CLI emits singular names. Note the collision: Better Auth's `accounts` table holds credentials, while the domain also needs `accounts`. Rename one side through `user.modelName` or `account.modelName` in the Better Auth config, for example `account: { modelName: "auth_accounts" }`.
- Set `telemetry: { enabled: false }` explicitly. It is off by default (`@better-auth/telemetry`, `isEnabled`), but "data never leaves your infrastructure" deserves a visible line.
- Two exceptions to AD-15 must be written down: `/api/auth/*` responses do not use the `{ data }` envelope, and they are not part of `AppType`; the interface calls them through `better-auth/react`. `trustedOrigins` must contain `WEB_ORIGIN` for development.

### 2. pino redaction paths in AD-14 leak what they are meant to hide — High

pino's `redact` wildcard matches exactly one level. Probe with the spine's list `["authorization", "cookie", "*.token", "*.iban", "*.amount", "*.label"]` on pino 10.3.1:

```text
{"req":{"headers":{"authorization":"Bearer SECRET","cookie":"c=1"}}}   not redacted
{"sync":{"account":{"iban":"FR76XXX","tx":[{"amount":5,"label":"X"}]}}} not redacted
{"amount":99,"token":"t"}                                               not redacted
{"tx":{"amount":"[Redacted]","label":"[Redacted]"}}                     redacted
```

Fix: state the rule as "logs carry ids and counts, never a domain object", and keep redaction as the safety net with real paths: `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`, top-level `token`, `iban`, `amount`, `label`, plus `*.x` and `*.*.x` for each. Add one unit test that logs a nested sync payload and asserts no IBAN, amount or token reaches the output.

### 3. Enable Banking: `transaction_id` must never be a deduplication key — High

The spine's `externalId` comment says "FITID, bank transaction id". The Enable Banking reference says of `transaction_id`: "This value can not be used to uniquely identify transactions and may change if the list of transactions is retrieved again." The stable identifier is `entry_reference`, described as unique and immutable for accounts with the same identification hash, but not unique across accounts, and optional.

Other facts from the reference that the connector and AD-8 must honour:

| Topic | Reference |
| --- | --- |
| Application auth | JWT header `typ: "JWT"`, `alg: "RS256"` (the only one), `kid: <application_id>`. Claims `iss: "enablebanking.com"`, `aud: "api.enablebanking.com"`, `iat`, `exp`. Maximum TTL 86400 s. |
| Consent expiry | `access.valid_until` is required on `POST /auth`, RFC 3339 with offset, capped at now + the bank's `maximum_consent_validity` (seconds, from `GET /aspsps`). The session expires at exactly that value even if the bank keeps the consent longer. `POST /sessions` returns it in `access.valid_until`: that is `consentExpiresAt`. |
| Account identity | `uid` is valid only while the session is `AUTHORIZED`. `identification_hash` matches an account across sessions. Store the hash on `accounts` so a renewed consent relinks the same account instead of creating a new one. |
| Amount and sign | `transaction_amount.amount` is a string with a dot decimal separator; `credit_debit_indicator` is `CRDT` or `DBIT`. AD-5 sign = `DBIT` → negative. Parse with a dot-decimal parser, not `parseAmount(text, "fr")`. |
| Status | `status` is one of `BOOK`, `PDNG`, `CNCL`, `HOLD`, `OTHR`, `RJCT`, `SCHD`. `pending = status === "PDNG"`. Drop `CNCL` and `RJCT`; decide `HOLD` and `SCHD` explicitly rather than by default. |
| Dates | `booking_date`, `value_date`, `transaction_date` are all optional. Pending rows often lack `booking_date`; the fallback order must be fixed in the connector. |
| Pagination | `continuation_key` in the response, "only valid in current session". Loop until it is absent or null. `strategy` is `default` or `longest`. |
| Balances | `GET /accounts/{uid}/balances`, `balance_type` among `CLAV`, `CLBD`, `FWAV`, `INFO`, `ITAV`, `ITBD`, `OPAV`, `OPBD`, `OTHR`, `PRCD`, `VALU`, `XPCD`. Fix a preference order for the current anchor, for example `CLBD`, then `ITBD`, then `XPCD`. |

Fix: in AD-3, write `externalId` as "`FITID` for OFX, `entry_reference` for Enable Banking, never `transaction_id`". Pending rows without `entry_reference` fall back to the fingerprint key, which AD-7 already allows.

`jose` 6.2.12 fits the JWT need. One trap: `importPKCS8` rejects a PKCS#1 key (`-----BEGIN RSA PRIVATE KEY-----`, the `openssl genrsa` default on older OpenSSL) with `"pkcs8" must be PKCS#8 formatted string`. Build the key with `crypto.createPrivateKey(pem)` and pass the `KeyObject` to `SignJWT#sign`; this accepts both formats and was verified. Store `ENABLE_BANKING_PRIVATE_KEY` base64-encoded in `.env`, since multi-line PEM values break in many environment loaders.

### 4. ofx-js 1.1.1 parses both OFX generations but fails on empty elements and backtracks exponentially — Medium

What it does, verified on Node 24:

- It takes a string, not bytes. It parses OFX 2.x XML directly and falls back to a regex SGML-to-XML rewrite for OFX 1.x. Both worked on test files, including a Windows-1252 file decoded first.
- It returns `{ header, OFX }` where every leaf is a string. A single `STMTTRN` is an object, several are an array. For OFX 2.x, `header` is `{}` because the `<?OFX ...?>` processing instruction is not parsed. `parseStrict` adds types only; it validates nothing, so the Zod schema in AD-3 is still required.
- `TRNAMT` comes back as written. The OFX specification allows a comma decimal separator and French banks use it: `-12,34` came through verbatim. `parseAmount` must accept both separators for OFX.

Defects:

- An empty SGML leaf such as `<MEMO>` followed directly by the next tag throws `Missing closing tag for MEMO` and the whole file is rejected.
- `sgml2Xml` contains `/<([A-Z0-9_]*)+\.+([A-Z0-9_]*)>([^<]+)/g`, a nested quantifier. A 26-character tag took 1.3 s, a 28-character one 5.5 s, doubling per character. Real OFX tags are at most about 18 characters, so real files cost milliseconds, but one crafted upload blocks the only Node process, including `/api/sync`.

Fix: keep `ofx-js` behind the `FileSource`, with three guards in `connectors/ofx/`: a size cap on uploads (a few megabytes), decoding by the `CHARSET` header or XML `encoding` attribute before parsing, and a pre-pass that closes empty leaf elements (`NAME`, `MEMO`, `CHECKNUM`, `REFNUM`, `PAYEEID`) before calling `parseSync`. Commit fixtures from at least three French banks. If the guards grow beyond that, replace the library with an in-repo SGML tokenizer, as already done for QIF; `ofx-data-extractor` 1.5.0 is the only other maintained option and has a smaller user base.

### 5. papaparse in Node with Windows-1252 input: decode first, then parse a string — Low, confirms the plan

`Papa.parse(string)` works in Node. The `encoding` option only applies to browser `File` objects and Node streams, and stream mode is known to split multi-byte characters across chunks (issue #908). Import files are small, so parse whole strings:

```ts
let text: string;
try {
	text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
} catch {
	text = new TextDecoder("windows-1252").decode(bytes);
}
```

Verified on Node 24: a Windows-1252 file with `é` and `°` decodes correctly, and `TextDecoder` strips a UTF-8 byte order mark. papaparse detected `;` and tolerated unescaped quotes inside an unquoted field. Types come from `@types/papaparse` 5.5.2, which lags 5.7 by one option (`downloadTimeout`, unused here). `import Papa from "papaparse"` type-checks under TypeScript 7 with `esModuleInterop`.

### 6. msw 2.15 on Node 24 intercepts native fetch, but `"error"` can be swallowed — Low

`setupServer` from `msw/node` intercepted `fetch` to `https://api.enablebanking.com/application` on Node 24.19.0. An unhandled request logged the URL and rejected with `InternalError: [MSW] Cannot bypass a request when using the "error" strategy`.

The gap is that the rejection travels through application code. A connector that catches network errors and reports "bank unavailable" turns an unmocked call into a passing test. Fix: pass a callback, `onUnhandledRequest(request) { unhandled.push(request.url) }`, and fail in `afterEach` when the list is not empty. That makes the AGENTS.md promise, "an unmocked request fails the test that sent it, naming the URL", true regardless of error handling.

### 7. Tailwind 4, shadcn CLI 4 and Vite 8 fit together — Low

`@tailwindcss/vite` 4.3.3 declares `vite ^8`. shadcn's Vite installation uses `npx shadcn@latest init --template vite`. `@vitejs/plugin-react` requires `vite ^8`. Add `@tailwindcss/vite` and `@vitejs/plugin-react` to the interface table. `docs/tech-stack.md` still says "no CSS framework decision yet"; it must be updated when Tailwind is installed.

### 8. Recharts 3 and TanStack Table 9 match shadcn — Low

shadcn's `chart` docs say the component "now uses Recharts v3", and its own app pins `recharts` 3.8.0. Recharts declares `react-is` as a peer: add `react-is@19` so pnpm resolves it deliberately.

TanStack Table 9 is stable, but only seven weeks old. shadcn's data table guide says "This guide uses TanStack Table v9" and uses `tableFeatures()`, `useTable` and `<table.FlexRender />`. Most tutorials found online still show the v8 `useReactTable` API; point implementers at the shadcn guide and at TanStack's v9 docs. AD-15 paginates on the server, so tables need `manualPagination` with `rowCount` from `total`.

### 9. date-fns does not compute "today in `APP_TIMEZONE`" on its own — Low

date-fns 4 handles time zones only through `@date-fns/tz` (1.5.0). The Consistency Conventions need "today" in `Europe/Paris`. Either add `@date-fns/tz`, or compute it with `new Intl.DateTimeFormat("en-CA", { timeZone })`, which returns `YYYY-MM-DD` with no dependency. Recommendation: `Intl`, and keep date-fns only for calendar arithmetic on `YYYY-MM-DD` strings.

### 10. i18next 26 and react-i18next 17 on React 19 — no issue

Peers accept React 19 and TypeScript 7. The 26.0 breaking changes remove `initImmediate` (use `initAsync: false` for synchronous init from bundled `fr.json`), the legacy `interpolation.format` function and `simplifyPluralSuffix`. None affects a single-locale setup.

### 11. TypeScript 7 compatibility — no issue with `skipLibCheck`

The consumer file described in Method type-checks cleanly under TypeScript 7.0.2 with the repository's `tsconfig.base.json`, including `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. With `skipLibCheck: false`, 74 errors appear inside `drizzle-orm` and `better-auth` declaration files; TypeScript 6.0.3 reports the same 74, so they come from those packages, not from TypeScript 7. `skipLibCheck: true` must stay. None of the listed tools needs the TypeScript compiler API: the `auth` CLI loads the config through `jiti` and Babel, drizzle-kit through its own loader, and the TanStack router plugin generates files without `tsc`.

## Changes the spine should absorb

1. AD-13: `admin` plugin or `input: false` on `role`; setup through `auth.api.createUser` with an atomic claim instead of an enclosing transaction; `auth` CLI; `usePlural: true` and a renamed credentials table; `/api/auth/*` exempt from the envelope and from `AppType`.
2. AD-14: logging rule by ids and counts, corrected redaction paths, one redaction test.
3. AD-3: `externalId` is `FITID` or `entry_reference`, never `transaction_id`; store `identification_hash` on linked accounts; OFX amounts accept a comma separator.
4. AD-16: collect unhandled msw requests and fail in `afterEach`.
5. Stack table: Node `24.21`; add `@types/papaparse` 5.5.2, `@tailwindcss/vite` 4.3.3, `@vitejs/plugin-react`, `react-is` 19, `auth` 1.7.5 (dev); drop `date-fns` or add `@date-fns/tz` 1.5.0.
