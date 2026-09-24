import type { TempDatabase } from "../testing/temp-database.ts";
import type { BankConnectionDeps } from "./bank-connections.ts";

import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { bankConnections } from "@archant/data/schema/bank-connections";

import { server } from "../../vitest.setup.ts";
import { validateEnv } from "../env.ts";
import { createLogger } from "../lib/logger.ts";
import {
	TEST_APPLICATION_ID,
	TEST_ENCRYPTION_KEY_BASE64,
	TEST_PKCS8_BASE64,
	TEST_PROVIDER_URL,
} from "../testing/bank.ts";
import {
	FIXTURE_AUTH_URL,
	FIXTURE_CONSENT_END,
	FIXTURE_SESSION_ID,
	fixtures,
	mockProvider,
} from "../testing/enable-banking.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import {
	bankDepsFromEnv,
	bankSetup,
	completeConnection,
	listConnections,
	listInstitutions,
	startConnection,
} from "./bank-connections.ts";
import { decrypt } from "./crypto.ts";

const NOW = Date.parse("2026-09-24T10:00:00Z");
const DAY = 86_400_000;
const MINUTE = 60_000;

const BASE_ENV = {
	DATABASE_URL: "file:x.db",
	BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
	BETTER_AUTH_URL: "http://localhost:5173",
};

const FULL_ENV = {
	...BASE_ENV,
	ENABLE_BANKING_APPLICATION_ID: TEST_APPLICATION_ID,
	ENABLE_BANKING_PRIVATE_KEY: TEST_PKCS8_BASE64,
	ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64,
};

let temp: TempDatabase;
let logLines: string[];

function deps(): BankConnectionDeps {
	logLines = [];

	return {
		db: temp.db,
		timeZone: "Europe/Paris",
		logger: createLogger("info", { write: (line: string) => logLines.push(line) }),
		...bankDepsFromEnv(validateEnv(FULL_ENV)),
	};
}

beforeAll(async () => {
	temp = await createTempDatabase();
});

afterAll(async () => {
	vi.useRealTimers();
	await temp.dispose();
});

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	await temp.db.delete(bankConnections);
});

const rows = () => temp.db.select().from(bankConnections);

/** The `state` the API sent to the provider on its latest `/auth`. */
function sentState(requests: ReturnType<typeof mockProvider>): string {
	const auth = requests.findLast((request) => request.path === "/auth");
	const body = auth?.body;

	if (typeof body !== "object" || body === null || !("state" in body)) {
		throw new Error("No /auth request was sent.");
	}

	return String(body.state);
}

describe("bankDepsFromEnv", () => {
	it("is available with the three variables, and redirects to the return page", () => {
		const bank = bankDepsFromEnv(validateEnv(FULL_ENV));

		expect(bankSetup(bank)).toEqual({ available: true, missing: [] });
		expect(bank.bankConnector?.id).toBe("enable-banking");
		expect(bank.redirectUrl).toBe("http://localhost:5173/reglages/banques/retour");
	});

	it("names ENCRYPTION_KEY alone when it is the one missing", () => {
		const bank = bankDepsFromEnv(validateEnv({ ...FULL_ENV, ENCRYPTION_KEY: "" }));

		expect(bankSetup(bank)).toEqual({ available: false, missing: ["ENCRYPTION_KEY"] });
		expect(bank.bankConnector).toBeNull();
	});

	it("names every missing variable, never a value", () => {
		const bank = bankDepsFromEnv(validateEnv(BASE_ENV));

		expect(bankSetup(bank)).toEqual({
			available: false,
			missing: ["ENABLE_BANKING_APPLICATION_ID", "ENABLE_BANKING_PRIVATE_KEY", "ENCRYPTION_KEY"],
		});
	});
});

describe("when unavailable", () => {
	it("refuses every operation with BANK_CONNECTOR_UNAVAILABLE", async () => {
		const unavailable = {
			...deps(),
			...bankDepsFromEnv(validateEnv({ ...FULL_ENV, ENCRYPTION_KEY: "" })),
		};
		const refused = { code: "BANK_CONNECTOR_UNAVAILABLE", status: 503 };

		await expect(listInstitutions(unavailable, "FR")).rejects.toMatchObject(refused);
		await expect(
			startConnection(unavailable, { country: "FR", institution: "Banque Test" }),
		).rejects.toMatchObject(refused);
		await expect(completeConnection(unavailable, { code: "c", state: "s" })).rejects.toMatchObject(
			refused,
		);
		await expect(listConnections(unavailable)).rejects.toMatchObject(refused);
	});
});

describe("listInstitutions", () => {
	it("lists a country's banks by name, without their consent length", async () => {
		mockProvider();

		await expect(listInstitutions(deps(), "FR")).resolves.toEqual([
			{
				name: "Banque Test",
				country: "FR",
				logo: "https://enablebanking.com/brands/FR/Banque%20Test/",
				bic: "BTSTFRPP",
			},
			{ name: "Caisse Sans Limite", country: "FR", logo: null, bic: null },
			{ name: "Crédit Exemple", country: "FR", logo: null, bic: null },
		]);
	});

	it("logs a provider failure with its status and code only", async () => {
		mockProvider({ aspsps: () => HttpResponse.json(fixtures.unauthorized, { status: 401 }) });
		const service = deps();

		await expect(listInstitutions(service, "FR")).rejects.toMatchObject({
			code: "BANK_PROVIDER_ERROR",
		});
		expect(logLines.join("")).toContain('"providerCode":"UNAUTHORIZED"');
		expect(logLines.join("")).not.toContain("Invalid token");
	});
});

describe("startConnection", () => {
	it("asks for 90 days of a 180-day bank and stores a pending row keyed by the state", async () => {
		const requests = mockProvider();

		await expect(
			startConnection(deps(), { country: "FR", institution: "Banque Test" }),
		).resolves.toEqual({ url: FIXTURE_AUTH_URL });

		const auth = requests.find((request) => request.path === "/auth");
		expect(auth?.body).toMatchObject({
			access: { valid_until: new Date(NOW + 90 * DAY).toISOString() },
			aspsp: { name: "Banque Test", country: "FR" },
			redirect_url: "http://localhost:5173/reglages/banques/retour",
		});
		await expect(rows()).resolves.toEqual([
			expect.objectContaining({
				connector: "enable-banking",
				institutionName: "Banque Test",
				country: "FR",
				status: "pending",
				authorizationState: sentState(requests),
				sessionId: null,
				consentExpiresAt: null,
				createdAt: NOW,
			}),
		]);
	});

	it("asks for 30 days of a 30-day bank", async () => {
		const requests = mockProvider();

		await startConnection(deps(), { country: "FR", institution: "Crédit Exemple" });

		expect(requests.find((request) => request.path === "/auth")?.body).toMatchObject({
			access: { valid_until: new Date(NOW + 30 * DAY).toISOString() },
		});
	});

	it("refuses a bank the provider does not list, and writes nothing", async () => {
		const requests = mockProvider();

		await expect(
			startConnection(deps(), { country: "FR", institution: "Banque Inconnue" }),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "institution", code: "invalid_value" }],
		});
		expect(requests.map((request) => request.path)).toEqual(["/aspsps"]);
		await expect(rows()).resolves.toEqual([]);
	});

	it("removes the pending row and names the URL when the redirect is not registered", async () => {
		mockProvider({ auth: () => HttpResponse.json(fixtures.redirectNotAllowed, { status: 400 }) });
		const service = deps();

		await expect(
			startConnection(service, { country: "FR", institution: "Banque Test" }),
		).rejects.toMatchObject({
			code: "BANK_REDIRECT_NOT_ALLOWED",
			status: 502,
			params: { url: "http://localhost:5173/reglages/banques/retour" },
		});
		await expect(rows()).resolves.toEqual([]);
		expect(logLines.join("")).toContain('"providerCode":"REDIRECT_URI_NOT_ALLOWED"');
		expect(logLines.join("")).toContain('"status":400');
		expect(logLines.join("")).toContain('"connectionId":"');
	});

	it("writes nothing when the bank list cannot be read", async () => {
		mockProvider({ aspsps: () => new HttpResponse(null, { status: 503 }) });

		await expect(
			startConnection(deps(), { country: "FR", institution: "Banque Test" }),
		).rejects.toMatchObject({ code: "BANK_PROVIDER_ERROR" });
		await expect(rows()).resolves.toEqual([]);
	});

	it("deletes pending attempts older than 30 minutes, and keeps recent ones", async () => {
		mockProvider();
		await startConnection(deps(), { country: "FR", institution: "Banque Test" });
		vi.setSystemTime(NOW + 20 * MINUTE);
		await startConnection(deps(), { country: "FR", institution: "Banque Test" });
		vi.setSystemTime(NOW + 31 * MINUTE);

		await startConnection(deps(), { country: "FR", institution: "Banque Test" });

		const kept = await rows();
		expect(kept.map((row) => row.createdAt).toSorted((left, right) => left - right)).toEqual([
			NOW + 20 * MINUTE,
			NOW + 31 * MINUTE,
		]);
	});
});

describe("completeConnection", () => {
	async function started() {
		const requests = mockProvider();
		await startConnection(deps(), { country: "FR", institution: "Banque Test" });

		return sentState(requests);
	}

	it("stores an active connection with its session encrypted and its consent end", async () => {
		const state = await started();
		const service = deps();

		const connection = await completeConnection(service, { code: "the-code", state });

		expect(connection).toMatchObject({
			connector: "enable-banking",
			institutionName: "Banque Test",
			country: "FR",
			status: "active",
			consentExpiresAt: FIXTURE_CONSENT_END,
			createdAt: NOW,
		});
		const [row] = await rows();
		expect(row?.status).toBe("active");
		expect(row?.authorizationState).toBeNull();
		expect(row?.sessionId).toMatch(/^v1:/u);
		expect(row?.sessionId).not.toContain(FIXTURE_SESSION_ID);
		expect(decrypt(Buffer.from(TEST_ENCRYPTION_KEY_BASE64, "base64"), row?.sessionId ?? "")).toBe(
			FIXTURE_SESSION_ID,
		);
		expect(logLines.join("")).toContain(`"connectionId":"${connection.id}"`);
		expect(logLines.join("")).not.toContain(FIXTURE_SESSION_ID);
	});

	it("refuses an unknown state and writes nothing", async () => {
		await started();
		const before = await rows();

		await expect(
			completeConnection(deps(), { code: "the-code", state: crypto.randomUUID() }),
		).rejects.toMatchObject({ code: "BANK_AUTHORIZATION_INVALID", status: 400 });
		await expect(rows()).resolves.toEqual(before);
	});

	it("refuses a replayed state, leaving the first connection as it was", async () => {
		const state = await started();
		await completeConnection(deps(), { code: "the-code", state });
		const before = await rows();

		await expect(completeConnection(deps(), { code: "the-code", state })).rejects.toMatchObject({
			code: "BANK_AUTHORIZATION_INVALID",
		});
		await expect(rows()).resolves.toEqual(before);
	});

	it("refuses a state 31 minutes old and writes nothing", async () => {
		const state = await started();
		const before = await rows();
		vi.setSystemTime(NOW + 31 * MINUTE);

		await expect(completeConnection(deps(), { code: "the-code", state })).rejects.toMatchObject({
			code: "BANK_AUTHORIZATION_INVALID",
		});
		await expect(rows()).resolves.toEqual(before);
	});

	it("keeps a row claimed at minute 29 while a start at minute 31 cleans up", async () => {
		const state = await started();
		vi.setSystemTime(NOW + 29 * MINUTE);
		// Another tab starts a connection while the provider opens the session.
		server.use(
			http.post(`${TEST_PROVIDER_URL}/sessions`, async () => {
				vi.setSystemTime(NOW + 31 * MINUTE);
				await startConnection(deps(), { country: "FR", institution: "Crédit Exemple" });

				return HttpResponse.json(fixtures.session);
			}),
		);

		await expect(completeConnection(deps(), { code: "the-code", state })).resolves.toMatchObject({
			institutionName: "Banque Test",
			status: "active",
		});
		await expect(rows()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ institutionName: "Banque Test", status: "active" }),
			]),
		);
	});

	it("accepts a state 29 minutes old", async () => {
		const state = await started();
		vi.setSystemTime(NOW + 29 * MINUTE);

		await expect(completeConnection(deps(), { code: "the-code", state })).resolves.toMatchObject({
			status: "active",
		});
	});

	it("stores nothing from a session without an id, and logs none of it", async () => {
		const state = await started();
		mockProvider({
			sessions: () =>
				HttpResponse.json({
					accounts: [{ account_id: { iban: "FR7612345" } }],
					access: { valid_until: "2026-12-20T10:00:00Z" },
				}),
		});
		const service = deps();

		await expect(completeConnection(service, { code: "the-code", state })).rejects.toMatchObject({
			code: "BANK_PROVIDER_ERROR",
			status: 502,
		});
		await expect(rows()).resolves.toEqual([]);
		expect(logLines.join("")).toContain('"status":200');
		expect(logLines.join("")).not.toContain("FR7612345");
	});
});

describe("listConnections", () => {
	it("lists active connections without any secret, pending ones left out", async () => {
		const requests = mockProvider();
		await startConnection(deps(), { country: "FR", institution: "Banque Test" });
		const state = sentState(requests);
		await completeConnection(deps(), { code: "the-code", state });
		await startConnection(deps(), { country: "FR", institution: "Crédit Exemple" });

		const list = await listConnections(deps());

		expect(list).toHaveLength(1);
		expect(list).toMatchObject([
			{
				connector: "enable-banking",
				institutionName: "Banque Test",
				country: "FR",
				status: "active",
				consentExpiresAt: FIXTURE_CONSENT_END,
				createdAt: NOW,
			},
		]);
		expect(JSON.stringify(list)).not.toMatch(/v1:|sessionId|authorizationState/u);
	});
});
