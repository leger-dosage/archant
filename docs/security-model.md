# Security model

What Archant protects, with which secret, what leaves the server, and what it trusts. It describes the current code; a vulnerability is reported privately, as [SECURITY.md](../SECURITY.md) says.

## Secrets at rest

The database is a plain SQLite file. Anyone who can read it reads the transactions, amounts and labels in it: protect the volume, and the backups, as you would the bank statements themselves. [Backups](deployment.md#backups) and [hosting.md](hosting.md) cover where they go.

The server creates a missing database file readable by its owner only, mode `0600`, and SQLite gives its `-wal` and `-shm` files the same mode. The `backups/` directory beside it is `0700`, each copy `0600`; a `backups/` made by an older version loses its group and other access at the next copy. A database file that already exists keeps its mode: for one an earlier version created, run `chmod 600` once on the file and its `-wal` and `-shm`.

Two values in it are encrypted with AES-256-GCM under `ENCRYPTION_KEY`, 32 random bytes, with a random nonce per value:

- the Enable Banking session id of each bank connection, which is what lets the server read that bank's accounts until the consent ends;
- the Enable Banking private key saved from « Réglages » › « Banques ». A key pinned with `ENABLE_BANKING_PRIVATE_KEY` is read from the environment and never written to the database.

The Enable Banking application ID is stored as is: it identifies the application and grants nothing without the private key.

`BETTER_AUTH_SECRET` signs the session cookies and the device cookies, and encrypts the two-factor secret and its backup codes. Rotating it signs everyone out, forgets every device and makes the two-factor secrets unreadable, as `.env.example` says.

Passwords are hashed by Better Auth, and never stored or logged in clear.

Losing or changing `ENCRYPTION_KEY` means saving the Enable Banking credentials and reconnecting every bank again.

Neither secret lives in the database, so a copy of the file alone does not open the encrypted values. [Keep two secrets off the machine](hosting.md#keep-two-secrets-off-the-machine) says why to keep a copy of both.

## What leaves the server

With a local SQLite file, the default, the server calls one host: Enable Banking, at `ENABLE_BANKING_API_URL`, `https://api.enablebanking.com` by default, and only once a bank connector is configured. Each request carries a JSON Web Token signed with the application's private key. The calls, all in `packages/api/src/connectors/enable-banking/client.ts`, are:

| Request                            | When                                 | What it sends                                                                                                |
| ---------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `GET /application`                 | Credentials are saved                | Nothing but the token: it checks the pair and reads the registered redirect URLs                             |
| `GET /aspsps?country=`             | The bank list opens                  | The country picked                                                                                           |
| `POST /auth`                       | A bank is connected or renewed       | The bank's name and country, a random `state`, the callback URL, the consent's end date, `personal` and `fr` |
| `POST /sessions`                   | The browser comes back from the bank | The one-time code the bank returned                                                                          |
| `GET /accounts/{uid}/balances`     | A sync                               | The account's Enable Banking id                                                                              |
| `GET /accounts/{uid}/transactions` | A sync                               | The account's Enable Banking id, the first date to read, and the page's continuation key                     |
| `DELETE /sessions/{id}`            | A bank is disconnected               | The session id                                                                                               |

When an assistant identifies itself with a Client ID Metadata Document, its `client_id` is an HTTPS address, and the server fetches that document, and again once its copy is an hour old, with `@better-auth/cimd`'s Node transport: the name is resolved once, every non-public address is refused, and no redirect is followed. The request carries nothing of yours. An assistant that registers itself instead sends its name and redirect address, and nothing is fetched.

A `DATABASE_URL` naming a remote libSQL database, such as Turso, sends every query there: the whole database then lives with that provider, behind `DATABASE_AUTH_TOKEN`.

Nothing Archant computes, no category, rule, note or other account, is sent. Every answer is parsed by a schema before it is used, and none is logged or kept whole.

The browser loads the bank logos of the bank list from the addresses Enable Banking returns for them, on `https://enablebanking.com` today, which therefore sees your address and that the list opened. Every other request of the interface goes to Archant's own origin. The Content-Security-Policy says so: scripts, styles, API calls and everything else from Archant's own origin alone, images from it, from `data:` URLs, from `https://enablebanking.com` and always from the origin of `ENABLE_BANKING_API_URL`, which is Enable Banking's API in production and the fake's in the end-to-end suite, no frame, and no form posted anywhere else. Styles may be inline, because the interface's libraries inject them at runtime; scripts never are, but for the theme script the policy names by its hash.

`ENABLE_BANKING_API_URL` must be HTTPS. Plain HTTP is accepted for `localhost`, `127.0.0.0/8` and `[::1]` only, for a local fake such as the end-to-end suite's; any other `http://` address stops the server at startup, naming the variable.

## Assistants

An assistant connected through « Réglages » › « Assistants IA » acts as the owner, with the scopes the consent page granted. With `archant:read` it reads accounts and their balance history, net worth, a month's income and expenses by category, a month's budget and the eleven before it, recurring payments with their next date and amount, categories, merchants, tags, transactions with their labels, notes, tags, transfer and source, rules and their past runs, and previews what rules would change. `archant:write` lets it create, edit, switch, delete and apply rules, create and rename categories, merchants and tags, set the category, merchant, tags, notes, label and exclusion of transactions, one at a time or in bulk, and set a month's planned spending, expected income and category amounts, in one write that a refusal leaves undone. It never deletes or merges a transaction, a category, a merchant or a tag, never creates a transaction, and never changes a transaction's date or amount, so a label written to mislead it cannot move money. A misleading label can still lead an assistant with write access to exclude transactions from reports, rewrite a label, which then locks against rules, or change a month's budget amounts; the owner's agreement before a write, and read-only consent, are the defences. A transaction field it sets is locked against rules, as an edit of the owner's is, since the owner asked for it. A bulk update by filter takes the count the assistant read before it and writes nothing when the filter matches another count at that moment; as for rules, only the count is compared. A rule it applies writes as a rule applied from the interface does, so a field the owner set by hand stays as it is, and `apply_rules` writes nothing when the count of rows to change differs from the one its preview gave; only the count is compared, so the same count on different rows is not detected. A write tool called with a read-only token is refused with `403 insufficient_scope` before any tool runs, and recorded. A tool calls the same service function as the interface, and the access token is checked on every call: signature, issuer, audience `/api/mcp`, expiry, then that the assistant still holds the owner's consent. A token issued for anything else, such as the interface's session, is refused there, and a session cookie alone is never accepted. A request whose `Origin` is not `BETTER_AUTH_URL`'s is refused, against DNS rebinding.

Access tokens are JSON Web Tokens signed with a key pair the server generates and stores, its private half encrypted with `BETTER_AUTH_SECRET`. Refresh tokens are stored hashed. Disconnecting an assistant deletes its consent and every token it holds in one transaction. Rotating `BETTER_AUTH_SECRET` leaves that stored key unreadable: every token request then fails with a server error, and no assistant can connect or refresh. Delete the key so the server generates a new one at the next sign-in, then connect each assistant again. The image carries no `sqlite3`, so Node's built-in `node:sqlite` runs it, as for [backups](deployment.md#backups):

```bash
docker compose exec archant node -e "new (require('node:sqlite').DatabaseSync)('/data/archant.db').exec('DELETE FROM jwks')"
```

Labels, notes and merchant names are written by banks and by whoever sends money, and an assistant reads them before it acts. The server tells every assistant that they are data, never instructions, but an assistant may still follow a sentence hidden in a label. Grant read only unless you want the assistant to change things, and watch its last call on the settings page. Each call is recorded with the assistant, the tool, the time, its outcome and the rows it changed, never its arguments or its answer, and kept 90 days.

## Export

« Réglages » › « Données » and `GET /api/export` hand a signed-in session every account, transaction, balance, category, merchant, tag, recurring payment, transfer, budget and rule, with their amounts, labels and notes in clear, as [Exporting your data](deployment.md#exporting-your-data) describes. Whoever holds a session can therefore take the whole history in one request: sign out on a shared computer, and treat a downloaded archive as a bank statement. The response is marked `Cache-Control: no-store`, so neither the browser's cache nor a proxy keeps a copy.

Each table is read through a list of the columns it exports, `EXPORTED_COLUMNS` in `packages/api/src/services/ledger/export.ts`, never as whole rows; every other column and table is in its `LEFT_OUT` list with a reason, and a test fails when a column is in neither. Nothing that grants access leaves in the archive: no password hash, session, two-factor secret, assistant token or signing key, no Enable Banking session, private key or application setting, no bank account's provider id or identification hash, no deduplication key, and no imported file. The archive is built in the request and never written to disk. Its log line carries a duration and a count per type of row, and a failure logs the error's name only. In the CSV files, a text cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`, so a label a bank or a sender wrote as a formula stays text when a spreadsheet opens the file; `all.ndjson` keeps every text exact.

## Account identification hash

For each account, Enable Banking returns an `identification_hash`. Its [reference](https://enablebanking.com/docs/api/reference/) calls it a hash « based on the account number », usable « for matching accounts between multiple sessions (even in case the sessions are authorized by different PSUs) », and says nothing of a salt. Archant stores it as Enable Banking sends it, as Sure does, and compares it only when a bank connection is renewed, to find each account again. It is never shown, logged or returned by an endpoint.

Whether it can be reversed to the account number is not established. Hashing it again with a key would protect little: the same database holds names, amounts and labels in clear, and a change of that key would stop renewals from finding their accounts.

## Scheduled synchronisation

`SYNC_SECRET` is the bearer token of `POST /api/sync`. Whoever holds it can start a synchronisation of every bank, nothing more: the route answers with each connection's id and outcome, never an account, a balance or a transaction. Unset, the route refuses every call.

## No telemetry

Archant sends no usage data, crash report or update check anywhere. Better Auth ships its own telemetry; `packages/api/src/services/auth.ts` switches it off.

## Logs

Log lines carry ids, counts, durations and error codes, never an amount, a label, an account number or a provider payload. The `authorization` and `cookie` headers are redacted. Better Auth's messages are logged without their arguments, which can hold an email or a raw database error.

The one secret a log prints is the setup token, while no user exists: it only lets someone create the administrator, a restart replaces it, and it is worthless once setup is done. Whoever reads the logs before then can take the instance, so do not ship them anywhere before setup.

## Patterns in rules

The rule action « Remplacer dans le libellé » takes a pattern written by the administrator and runs it on the label of every new transaction, text the bank sends and which whoever pays you partly chooses. A pattern runs in RE2, through `re2js` in `packages/api/src/domain/rules/label-pattern.ts`, never in the built-in `RegExp`: RE2 reads a label in time linear in its length, where a backtracking engine can need exponential time on a pattern such as `(a+)+$` and, on Node's single thread, hold every request and the day's first synchronisation. A pattern RE2 refuses, back references and lookaheads included, is refused when the rule is saved.

## Sign-in limits

Better Auth refuses a fourth sign-in from one client address within ten seconds. Above it, the server refuses every sign-in once 20 have failed across all addresses in the same ten minutes, before Better Auth reads the password: a guesser with many addresses cannot try in parallel. Those counts live in the database, so a restart resets nothing.

That ceiling would also refuse the right password, so anyone reaching the sign-in page could keep the owner out. A device cookie lets a known browser through, after OWASP's device cookies. Each sign-in that creates a session, after the password or after the second factor when two-factor is on, sets `archant.device`: the user's id, a random 128-bit nonce and an expiry a year away, signed with an HMAC-SHA256 under `BETTER_AUTH_SECRET`. It is `HttpOnly`, `SameSite=Strict`, sent to `/api/auth` only, and `Secure` when `BETTER_AUTH_URL` is HTTPS. The password step of a two-factor sign-in sets none, since it proves the password only.

Once the ceiling is full, a sign-in carrying a cookie that verifies, has not expired and names the user of the email typed goes through, as long as that device has failed fewer than five times in the window. It still needs the password and the second factor, and Better Auth's per-address limit still applies. A cookie copied from the browser gives five guesses per ten minutes, counted on its own nonce: the owner's other devices keep theirs. Signing out or changing the password does not clear it; rotating `BETTER_AUTH_SECRET` voids every one.

## Trusted proxies

The sign-in limits count failures per client address. By default that address is the TCP peer, which no visitor can fake. `TRUSTED_PROXIES` names the addresses whose `X-Forwarded-For` header is believed instead.

When it names the Docker network's gateway, as [Behind a reverse proxy](deployment.md#behind-a-reverse-proxy) and [hosting.md](hosting.md) set it, every process on the host reaches the container through that gateway, so any of them can write `X-Forwarded-For` and pick the address the limits count. The host is trusted: run nothing on it you would not give the database to. The loopback port that `docker-compose.yml` publishes keeps every other machine out.
