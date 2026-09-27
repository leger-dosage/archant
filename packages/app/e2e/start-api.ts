import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { startFakeEnableBanking } from "./fake-enable-banking.ts";
import {
	BANK_APPLICATION_ID,
	BANK_KEY_FILE,
	DATABASE_FILE,
	PORT,
	SETUP_TOKEN_FILE,
	TIME_ZONE,
	WEB_URL,
} from "./settings.ts";

// Started by playwright.config.ts once the interface is built. One fresh
// database per run, which the server migrates before it listens, in a file
// rather than `:memory:`: every libSQL connection to `:memory:` opens its own
// empty database, and the ledger's transactions borrow their own connection.
// A run killed before its cleanup leaves the file behind; it is removed here.
const directory = dirname(DATABASE_FILE);
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const databaseUrl = `file:${DATABASE_FILE}`;

// A key pair per run, never committed: the fake checks the API's tokens with
// the public half, and the private half goes where `setup` reads it.
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
await mkdir(dirname(BANK_KEY_FILE), { recursive: true });
// Removed first: `mode` applies only to a file `writeFile` creates.
await rm(BANK_KEY_FILE, { force: true });
await writeFile(BANK_KEY_FILE, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), {
	mode: 0o600,
});
const bank = await startFakeEnableBanking({
	publicKey,
	applicationId: BANK_APPLICATION_ID,
	redirectUrl: `${WEB_URL}/settings/banks/callback`,
});

// A token left by an earlier run would be refused: each start prints a new one.
await rm(SETUP_TOKEN_FILE, { force: true });

const entrypoint = fileURLToPath(new URL("../../api/src/index.ts", import.meta.url));
const api = spawn(process.execPath, [entrypoint], {
	// stdout piped, to read the setup token the server prints on its empty
	// database, as an owner reads it; every line is still passed through.
	stdio: ["inherit", "pipe", "inherit"],
	env: {
		...process.env,
		DATABASE_URL: databaseUrl,
		// A token exported in the shell for Turso must not reach a local file.
		DATABASE_AUTH_TOKEN: "",
		PORT: String(PORT),
		APP_TIMEZONE: TIME_ZONE,
		LOG_LEVEL: "warn",
		// Sessions die with the run's database, so a fixed secret costs nothing.
		BETTER_AUTH_SECRET: "archant-end-to-end-secret-of-32-characters",
		// The origin the browser sends: Better Auth and the upload origin check
		// refuse any other.
		BETTER_AUTH_URL: WEB_URL,
		// A release build, as the image runs: « Réglages » then links its notes.
		// version.spec.ts answers `/api/version` itself for a development build.
		APP_VERSION: "1.2.3",
		// The bundle that ships, served the way the container serves it.
		WEB_DIST: fileURLToPath(new URL("../dist", import.meta.url)),
		// Loopback stands in for a reverse proxy: the `clientAddress` fixture
		// gives each test's browser an `x-forwarded-for` of its own, so tests do
		// not share Better Auth's rate-limit buckets. Every request here comes
		// from loopback, so nothing outside the suite can use this trust.
		TRUSTED_PROXIES: "127.0.0.1,::1",
		// Bank connection against the local fake, so no request leaves loopback,
		// with the credentials `setup` saves from the interface: a pair exported
		// in the shell would win over them.
		ENABLE_BANKING_APPLICATION_ID: "",
		ENABLE_BANKING_PRIVATE_KEY: "",
		ENCRYPTION_KEY: randomBytes(32).toString("base64"),
		ENABLE_BANKING_API_URL: bank.url,
	},
});

createInterface({ input: api.stdout }).on("line", (line) => {
	process.stdout.write(`${line}\n`);
	const token = /enter the setup token (\S+)\./u.exec(line)?.[1];

	if (token !== undefined) {
		// Before the server listens, so before Playwright starts the setup project.
		void writeFile(SETUP_TOKEN_FILE, token, { mode: 0o600 });
	}
});

// Set once Playwright asks for a stop, so only that stop counts as clean.
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		stopping = true;
		api.kill(signal);
	});
}

api.on("exit", (code) => {
	bank.close();
	void rm(directory, { recursive: true, force: true }).finally(() => {
		// Stopped by Playwright is a clean end; the API crashing or being killed
		// on its own is not.
		process.exit(stopping ? 0 : code || 1);
	});
});
