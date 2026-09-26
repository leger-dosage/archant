import type { TempDatabase } from "../testing/temp-database.ts";
import type { BankCredentialDeps } from "./bank-credentials.ts";

import { decodeProtectedHeader } from "jose";
import { http, HttpResponse } from "msw";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bankConnections } from "@archant/data/schema/bank-connections";
import { settings } from "@archant/data/schema/settings";

import { server } from "../../vitest.setup.ts";
import { createLogger } from "../lib/logger.ts";
import {
	TEST_APPLICATION_ID,
	TEST_ENCRYPTION_KEY_BASE64,
	TEST_PRIVATE_KEY,
	TEST_PROVIDER_URL,
	TEST_PUBLIC_KEY,
} from "../testing/bank.ts";
import { fixtures, mockProvider } from "../testing/enable-banking.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import {
	APPLICATION_ID_SETTING,
	PRIVATE_KEY_SETTING,
	bankSetup,
	resolveBankConnector,
	saveBankCredentials,
} from "./bank-credentials.ts";
import { decrypt, encrypt } from "./crypto.ts";

const ENCRYPTION_KEY = Buffer.from(TEST_ENCRYPTION_KEY_BASE64, "base64");
const REDIRECT_URL = "http://localhost:5173/settings/banks/callback";
const PKCS1 = TEST_PRIVATE_KEY.export({ type: "pkcs1", format: "pem" }).toString();
const PKCS8 = TEST_PRIVATE_KEY.export({ type: "pkcs8", format: "pem" }).toString();
const ENVIRONMENT_ID = "environment-application";

let temp: TempDatabase;
let logLines: string[];

/** The interface's case: no `ENABLE_BANKING_*` variable, `ENCRYPTION_KEY` set. */
function deps(overrides: Partial<BankCredentialDeps> = {}): BankCredentialDeps {
	logLines = [];

	return {
		db: temp.db,
		timeZone: "Europe/Paris",
		logger: createLogger("info", { write: (line: string) => logLines.push(line) }),
		bankCredentials: null,
		encryptionKey: ENCRYPTION_KEY,
		bankApiUrl: TEST_PROVIDER_URL,
		redirectUrl: REDIRECT_URL,
		...overrides,
	};
}

const fromEnvironment = () =>
	deps({ bankCredentials: { applicationId: ENVIRONMENT_ID, privateKey: TEST_PRIVATE_KEY } });

const stored = () => temp.db.select().from(settings).orderBy(settings.key);

async function store(applicationId: string, privateKey: string) {
	await temp.db.insert(settings).values([
		{ key: APPLICATION_ID_SETTING, value: applicationId, updatedAt: 1 },
		{ key: PRIVATE_KEY_SETTING, value: privateKey, updatedAt: 1 },
	]);
}

async function connection(status: "pending" | "active") {
	await temp.db.insert(bankConnections).values({
		id: randomUUID(),
		connector: "enable-banking",
		institutionName: "Banque Test",
		country: "FR",
		status,
		createdAt: 1,
		updatedAt: 1,
	});
}

/** The application a connector's request was signed for. */
function signedFor(requests: ReturnType<typeof mockProvider>): unknown {
	const token = requests[0]?.authorization?.replace(/^Bearer /u, "") ?? "";

	return decodeProtectedHeader(token).kid;
}

const logged = () => logLines.map((line): unknown => JSON.parse(line));

/** Every log line, which must never hold a key, whatever its encoding. */
function expectNoKeyLogged() {
	const text = logLines.join("");

	expect(text).not.toContain("PRIVATE KEY");
	expect(text).not.toContain(PKCS8.split("\n")[1]);
	expect(text).not.toContain(PKCS1.split("\n")[1]);
}

beforeAll(async () => {
	temp = await createTempDatabase();
});

afterAll(async () => {
	await temp.dispose();
});

beforeEach(async () => {
	await temp.db.delete(settings);
	await temp.db.delete(bankConnections);
});

describe("resolveBankConnector", () => {
	it("signs with the environment's pair, over a stored one", async () => {
		await store("stored-application", encrypt(ENCRYPTION_KEY, PKCS8));
		const requests = mockProvider();

		const { connector, encryptionKey } = await resolveBankConnector(fromEnvironment());
		await connector.listInstitutions("FR");

		expect(encryptionKey).toBe(ENCRYPTION_KEY);
		expect(signedFor(requests)).toBe(ENVIRONMENT_ID);
	});

	it("signs with the stored pair when the environment has none", async () => {
		await store(TEST_APPLICATION_ID, encrypt(ENCRYPTION_KEY, PKCS8));
		const requests = mockProvider();

		const { connector } = await resolveBankConnector(deps());
		await connector.listInstitutions("FR");

		expect(signedFor(requests)).toBe(TEST_APPLICATION_ID);
	});

	it("reads what is stored at each call, never a value captured before", async () => {
		const service = deps();

		await expect(resolveBankConnector(service)).rejects.toMatchObject({
			code: "BANK_CONNECTOR_UNAVAILABLE",
		});
		await store(TEST_APPLICATION_ID, encrypt(ENCRYPTION_KEY, PKCS8));
		await expect(resolveBankConnector(service)).resolves.toMatchObject({
			connector: { id: "enable-banking" },
		});
	});

	it.each([
		["ENCRYPTION_KEY is unset", () => deps({ encryptionKey: null })],
		[
			"ENCRYPTION_KEY is unset, even with the environment's pair",
			() => ({
				...fromEnvironment(),
				encryptionKey: null,
			}),
		],
		["nothing is stored", () => deps()],
	])("answers BANK_CONNECTOR_UNAVAILABLE when %s", async (_, service) => {
		await expect(resolveBankConnector(service())).rejects.toMatchObject({
			code: "BANK_CONNECTOR_UNAVAILABLE",
			status: 503,
		});
	});

	it.each([
		["under another ENCRYPTION_KEY", () => encrypt(randomBytes(32), PKCS8)],
		["as something other than a key", () => encrypt(ENCRYPTION_KEY, "not a key")],
	])("reads a key stored %s as unconfigured, logging the code alone", async (_, value) => {
		await store(TEST_APPLICATION_ID, value());

		await expect(resolveBankConnector(deps())).rejects.toMatchObject({
			code: "BANK_CONNECTOR_UNAVAILABLE",
		});
		expect(logged()).toEqual([
			expect.objectContaining({
				code: "BANK_CREDENTIALS_UNREADABLE",
				msg: "stored bank credentials ignored",
			}),
		]);
		expect(logLines.join("")).not.toContain(TEST_APPLICATION_ID);
	});

	it("reads an application ID without its key as unconfigured", async () => {
		await temp.db
			.insert(settings)
			.values({ key: APPLICATION_ID_SETTING, value: TEST_APPLICATION_ID, updatedAt: 1 });

		await expect(resolveBankConnector(deps())).rejects.toMatchObject({
			code: "BANK_CONNECTOR_UNAVAILABLE",
		});
	});
});

describe("bankSetup", () => {
	it("names the environment's application, never the key", async () => {
		const setup = await bankSetup(fromEnvironment());

		expect(setup).toEqual({
			available: true,
			source: "environment",
			applicationId: ENVIRONMENT_ID,
			redirectUrl: REDIRECT_URL,
			locked: false,
			missing: [],
		});
	});

	it("names the stored application", async () => {
		await store(TEST_APPLICATION_ID, encrypt(ENCRYPTION_KEY, PKCS8));

		await expect(bankSetup(deps())).resolves.toMatchObject({
			available: true,
			source: "interface",
			applicationId: TEST_APPLICATION_ID,
		});
	});

	it("says nothing is set up on a fresh install", async () => {
		await expect(bankSetup(deps())).resolves.toEqual({
			available: false,
			source: null,
			applicationId: null,
			redirectUrl: REDIRECT_URL,
			locked: false,
			missing: [],
		});
	});

	it("names ENCRYPTION_KEY alone when it is missing, and ignores what is stored", async () => {
		await store(TEST_APPLICATION_ID, encrypt(ENCRYPTION_KEY, PKCS8));

		await expect(bankSetup(deps({ encryptionKey: null }))).resolves.toMatchObject({
			available: false,
			source: null,
			missing: ["ENCRYPTION_KEY"],
		});
	});

	it("locks on an active connection, not on a consent in flight", async () => {
		await connection("pending");
		await expect(bankSetup(deps())).resolves.toMatchObject({ locked: false });

		await connection("active");
		await expect(bankSetup(deps())).resolves.toMatchObject({ locked: true });
	});
});

describe("saveBankCredentials", () => {
	it("checks the pair, then stores the ID plain and the key as encrypted PKCS#8", async () => {
		const requests = mockProvider();

		await expect(
			saveBankCredentials(deps(), { applicationId: TEST_APPLICATION_ID, privateKey: PKCS1 }),
		).resolves.toMatchObject({ available: true, source: "interface", locked: false });

		expect(requests.map(({ method, path }) => ({ method, path }))).toEqual([
			{ method: "GET", path: "/application" },
		]);
		expect(signedFor(requests)).toBe(TEST_APPLICATION_ID);
		const [applicationId, privateKey] = await stored();
		expect(applicationId).toMatchObject({
			key: APPLICATION_ID_SETTING,
			value: TEST_APPLICATION_ID,
		});
		expect(privateKey?.key).toBe(PRIVATE_KEY_SETTING);
		expect(privateKey?.value).toMatch(/^v1:/u);
		expect(decrypt(ENCRYPTION_KEY, privateKey?.value ?? "")).toBe(PKCS8);
		expect(logged()).toContainEqual(expect.objectContaining({ msg: "bank credentials saved" }));
		expectNoKeyLogged();
	});

	it("accepts a key bundled after its certificate", async () => {
		mockProvider();
		const certificate = [
			"-----BEGIN CERTIFICATE-----",
			...(randomBytes(300)
				.toString("base64")
				.match(/.{1,64}/gu) ?? []),
			"-----END CERTIFICATE-----",
			"",
		].join("\n");

		await saveBankCredentials(deps(), {
			applicationId: TEST_APPLICATION_ID,
			privateKey: certificate + PKCS8,
		});

		const [, privateKey] = await stored();
		expect(decrypt(ENCRYPTION_KEY, privateKey?.value ?? "")).toBe(PKCS8);
	});

	it("replaces a stored pair", async () => {
		await store("old-application", encrypt(ENCRYPTION_KEY, PKCS8));
		mockProvider();

		await saveBankCredentials(deps(), { applicationId: TEST_APPLICATION_ID, privateKey: PKCS8 });

		await expect(stored()).resolves.toEqual([
			expect.objectContaining({ value: TEST_APPLICATION_ID }),
			expect.objectContaining({ key: PRIVATE_KEY_SETTING }),
		]);
	});

	it.each([401, 403])(
		"answers BANK_CREDENTIALS_REFUSED to a %i, storing nothing and logging no key",
		async (status) => {
			mockProvider({ application: () => HttpResponse.json(fixtures.unauthorized, { status }) });

			await expect(
				saveBankCredentials(deps(), { applicationId: TEST_APPLICATION_ID, privateKey: PKCS8 }),
			).rejects.toMatchObject({ code: "BANK_CREDENTIALS_REFUSED", status: 400 });
			await expect(stored()).resolves.toEqual([]);
			expect(logged()).toEqual([
				expect.objectContaining({
					msg: "bank credentials check failed",
					code: "BANK_PROVIDER_ERROR",
					status,
				}),
			]);
			expectNoKeyLogged();
		},
	);

	it("passes another provider failure on, storing nothing", async () => {
		mockProvider({
			application: () => HttpResponse.json({ error: "ASPSP_ERROR" }, { status: 500 }),
		});

		await expect(
			saveBankCredentials(deps(), { applicationId: TEST_APPLICATION_ID, privateKey: PKCS8 }),
		).rejects.toMatchObject({ code: "BANK_PROVIDER_ERROR", status: 502 });
		await expect(stored()).resolves.toEqual([]);
	});

	it("names the redirect address the application does not list, storing nothing", async () => {
		mockProvider({
			application: () =>
				HttpResponse.json({ redirect_urls: ["not a url", "https://elsewhere.example/callback"] }),
		});

		const error: unknown = await saveBankCredentials(deps(), {
			applicationId: TEST_APPLICATION_ID,
			privateKey: PKCS8,
		}).catch((reason: unknown) => reason);

		expect(error).toMatchObject({
			code: "BANK_REDIRECT_NOT_ALLOWED",
			params: { url: REDIRECT_URL },
		});
		await expect(stored()).resolves.toEqual([]);
	});

	it("matches the address as a URL, not as a string", async () => {
		mockProvider({
			application: () =>
				HttpResponse.json({ redirect_urls: ["HTTP://LOCALHOST:5173/settings/banks/callback"] }),
		});

		await expect(
			saveBankCredentials(deps(), { applicationId: TEST_APPLICATION_ID, privateKey: PKCS8 }),
		).resolves.toMatchObject({ source: "interface" });
	});

	it.each([
		["text", "hello"],
		["a public key", TEST_PUBLIC_KEY.export({ type: "spki", format: "pem" }).toString()],
		[
			"an EC key",
			generateKeyPairSync("ec", { namedCurve: "P-256" })
				.privateKey.export({ type: "pkcs8", format: "pem" })
				.toString(),
		],
	])("refuses %s on privateKey, before asking the provider", async (_, privateKey) => {
		const requests = mockProvider();

		await expect(
			saveBankCredentials(deps(), { applicationId: TEST_APPLICATION_ID, privateKey }),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "privateKey", code: "invalid_private_key" }],
		});
		expect(requests).toEqual([]);
		await expect(stored()).resolves.toEqual([]);
	});

	it("refuses while the environment sets the pair", async () => {
		const requests = mockProvider();

		await expect(
			saveBankCredentials(fromEnvironment(), {
				applicationId: TEST_APPLICATION_ID,
				privateKey: PKCS8,
			}),
		).rejects.toMatchObject({ code: "BANK_CREDENTIALS_FROM_ENVIRONMENT", status: 409 });
		expect(requests).toEqual([]);
		await expect(stored()).resolves.toEqual([]);
	});

	it("refuses without ENCRYPTION_KEY", async () => {
		await expect(
			saveBankCredentials(deps({ encryptionKey: null }), {
				applicationId: TEST_APPLICATION_ID,
				privateKey: PKCS8,
			}),
		).rejects.toMatchObject({ code: "BANK_CONNECTOR_UNAVAILABLE", status: 503 });
		await expect(stored()).resolves.toEqual([]);
	});

	it("refuses while a bank is connected, before asking the provider", async () => {
		await connection("active");
		const requests = mockProvider();

		await expect(
			saveBankCredentials(deps(), { applicationId: TEST_APPLICATION_ID, privateKey: PKCS8 }),
		).rejects.toMatchObject({ code: "BANK_CREDENTIALS_LOCKED", status: 409 });
		expect(requests).toEqual([]);
		await expect(stored()).resolves.toEqual([]);
	});

	it("saves while a consent is only in flight", async () => {
		await connection("pending");
		mockProvider();

		await expect(
			saveBankCredentials(deps(), { applicationId: TEST_APPLICATION_ID, privateKey: PKCS8 }),
		).resolves.toMatchObject({ source: "interface" });
	});

	it("refuses a bank connected while the provider was checking the pair", async () => {
		server.use(
			http.get(`${TEST_PROVIDER_URL}/application`, async () => {
				await connection("active");

				return HttpResponse.json(fixtures.application);
			}),
		);

		await expect(
			saveBankCredentials(deps(), { applicationId: TEST_APPLICATION_ID, privateKey: PKCS8 }),
		).rejects.toMatchObject({ code: "BANK_CREDENTIALS_LOCKED" });
		await expect(stored()).resolves.toEqual([]);
	});
});
