# Security model

What Archant protects, with which secret, what leaves the server, and what it trusts. It describes the current code; a vulnerability is reported privately, as [SECURITY.md](../SECURITY.md) says.

## Secrets at rest

The database is a plain SQLite file. Anyone who can read it reads the transactions, amounts and labels in it: protect the volume, and the backups, as you would the bank statements themselves. [Backups](deployment.md#backups) and [hosting.md](hosting.md) cover where they go.

Two values in it are encrypted with AES-256-GCM under `ENCRYPTION_KEY`, 32 random bytes, with a random nonce per value:

- the Enable Banking session id of each bank connection, which is what lets the server read that bank's accounts until the consent ends;
- the Enable Banking private key saved from « Réglages » › « Banques ». A key pinned with `ENABLE_BANKING_PRIVATE_KEY` is read from the environment and never written to the database.

The Enable Banking application ID is stored as is: it identifies the application and grants nothing without the private key.

`BETTER_AUTH_SECRET` signs the session cookies and encrypts the two-factor secret and its backup codes. Rotating it signs everyone out and makes those unreadable, as `.env.example` says.

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

A `DATABASE_URL` naming a remote libSQL database, such as Turso, sends every query there: the whole database then lives with that provider, behind `DATABASE_AUTH_TOKEN`.

Nothing Archant computes, no category, rule, note or other account, is sent. Every answer is parsed by a schema before it is used, and none is logged or kept whole.

The browser loads the bank logos of the bank list from the addresses Enable Banking returns for them, on its own host today, which therefore sees your address and that the list opened. Every other request of the interface goes to Archant's own origin: the Content-Security-Policy allows scripts and API calls from it alone.

## Scheduled synchronisation

`SYNC_SECRET` is the bearer token of `POST /api/sync`. Whoever holds it can start a synchronisation of every bank, nothing more: the route answers with each connection's id and outcome, never an account, a balance or a transaction. Unset, the route refuses every call.

## No telemetry

Archant sends no usage data, crash report or update check anywhere. Better Auth ships its own telemetry; `packages/api/src/services/auth.ts` switches it off.

## Logs

Log lines carry ids, counts, durations and error codes, never an amount, a label, an account number or a provider payload. The `authorization` and `cookie` headers are redacted. Better Auth's messages are logged without their arguments, which can hold an email or a raw database error.

The one secret a log prints is the setup token, while no user exists: it only lets someone create the administrator, a restart replaces it, and it is worthless once setup is done. Whoever reads the logs before then can take the instance, so do not ship them anywhere before setup.

## Trusted proxies

The sign-in limits count failures per client address. By default that address is the TCP peer, which no visitor can fake. `TRUSTED_PROXIES` names the addresses whose `X-Forwarded-For` header is believed instead.

When it names the Docker network's gateway, as [Behind a reverse proxy](deployment.md#behind-a-reverse-proxy) and [hosting.md](hosting.md) set it, every process on the host reaches the container through that gateway, so any of them can write `X-Forwarded-For` and pick the address the limits count. The host is trusted: run nothing on it you would not give the database to. The loopback port that `docker-compose.yml` publishes keeps every other machine out.
