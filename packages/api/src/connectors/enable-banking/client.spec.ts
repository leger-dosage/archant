import type * as jwt from "./jwt.ts";

import { jwtVerify } from "jose";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { server } from "../../../vitest.setup.ts";
import { addDays } from "../../domain/dates.ts";
import {
	TEST_APPLICATION_ID,
	TEST_PRIVATE_KEY,
	TEST_PROVIDER_URL,
	TEST_PUBLIC_KEY,
} from "../../testing/bank.ts";
import {
	FIXTURE_AUTH_URL,
	FIXTURE_CARD_UID,
	FIXTURE_CHECKING_UID,
	FIXTURE_CONSENT_END,
	FIXTURE_IBAN_HEAD,
	FIXTURE_SESSION_ID,
	fixtures,
	mockProvider,
	transactionsPage,
} from "../../testing/enable-banking.ts";
import { BankProviderError } from "../bank-connector.ts";
import { createBankConnector } from "../registry.ts";
import {
	MAX_PAGES,
	consentLadder,
	nextStart,
	toBankAccount,
	toTransaction,
	withoutRepeats,
	withoutSettledPending,
} from "./client.ts";
import { signJwt } from "./jwt.ts";
import { sessionAccountSchema } from "./schemas.ts";

// A spy that signs for real, so one test can make a single signature fail.
vi.mock("./jwt.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof jwt>();

	return { ...actual, signJwt: vi.fn(actual.signJwt) };
});

const NOW = Date.parse("2026-09-24T10:00:00Z");
const TODAY = "2026-09-24";
const DAY = 86_400_000;
/** The minute a consent is asked short of its maximum. */
const MARGIN = 60_000;

// A trailing slash on the URL must not double the one of each path.
const connector = createBankConnector("enable-banking", {
	applicationId: TEST_APPLICATION_ID,
	privateKey: TEST_PRIVATE_KEY,
	apiUrl: `${TEST_PROVIDER_URL}/`,
	consentDays: 180,
});

const institution = {
	name: "Banque Test",
	country: "FR",
	logo: null,
	bic: null,
	maximumConsentValidity: 180 * 86_400,
};

const request = {
	institution,
	state: "0f8fad5b-d9cb-469f-a165-70867728950e",
	redirectUrl: "http://localhost:5173/settings/banks/callback",
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

const inDays = (days: number) => new Date(NOW + days * DAY - MARGIN).toISOString();

/** The `valid_until` of each `/auth` sent, in order. */
const validUntils = (requests: ReturnType<typeof mockProvider>) =>
	requests
		.filter((sent) => sent.path === "/auth")
		.map((sent) => z.object({ access: z.object({ valid_until: z.string() }) }).parse(sent.body))
		.map((body) => body.access.valid_until);

async function rejection(promise: Promise<unknown>): Promise<BankProviderError> {
	const error: unknown = await promise.then(
		() => null,
		(reason: unknown) => reason,
	);

	if (!(error instanceof BankProviderError)) {
		throw new Error(`Expected a BankProviderError, got ${String(error)}`);
	}

	return error;
}

const SECONDS_A_DAY = 86_400;

describe("consentLadder", () => {
	it("caps the bank's maximum at the configured days, less a minute", () => {
		expect(consentLadder(400 * SECONDS_A_DAY, 180)).toEqual([
			180 * SECONDS_A_DAY - 60,
			90 * SECONDS_A_DAY - 60,
			45 * SECONDS_A_DAY - 60,
			30 * SECONDS_A_DAY - 60,
		]);
	});

	it("starts from a shorter maximum, then only shorter rungs", () => {
		expect(consentLadder(60 * SECONDS_A_DAY, 180)).toEqual([
			60 * SECONDS_A_DAY - 60,
			45 * SECONDS_A_DAY - 60,
			30 * SECONDS_A_DAY - 60,
		]);
	});

	it("starts from the cap when the bank says nothing", () => {
		expect(consentLadder(null, 180)[0]).toBe(180 * SECONDS_A_DAY - 60);
	});

	it("starts from an overridden cap below the bank's maximum", () => {
		expect(consentLadder(180 * SECONDS_A_DAY, 90)).toEqual([
			90 * SECONDS_A_DAY - 60,
			45 * SECONDS_A_DAY - 60,
			30 * SECONDS_A_DAY - 60,
		]);
	});

	it("never repeats a rung equal to the first", () => {
		expect(consentLadder(90 * SECONDS_A_DAY, 180)).toEqual([
			90 * SECONDS_A_DAY - 60,
			45 * SECONDS_A_DAY - 60,
			30 * SECONDS_A_DAY - 60,
		]);
		expect(consentLadder(30 * SECONDS_A_DAY, 180)).toEqual([30 * SECONDS_A_DAY - 60]);
	});

	it("steps down through 180 days when the cap is longer", () => {
		const ladder = [365, 180, 90, 45, 30].map((days) => days * SECONDS_A_DAY - 60);

		expect(consentLadder(null, 365)).toEqual(ladder);
		expect(consentLadder(400 * SECONDS_A_DAY, 365)).toEqual(ladder);
	});

	it("never shaves a consent shorter than a minute to nothing", () => {
		expect(consentLadder(30, 180)).toEqual([1]);
	});
});

describe("describeApplication", () => {
	it("reads the registered redirect addresses and nothing else", async () => {
		const requests = mockProvider();

		await expect(connector.describeApplication()).resolves.toEqual({
			redirectUrls: [
				"https://archant.example.com/settings/banks/callback",
				"http://localhost:5173/settings/banks/callback",
			],
		});
		expect(requests).toEqual([
			expect.objectContaining({ method: "GET", path: "/application", search: "" }),
		]);
		expect(requests[0]?.authorization).toMatch(/^Bearer /u);
	});

	it("throws with the status of a refused pair", async () => {
		mockProvider({ application: () => HttpResponse.json(fixtures.unauthorized, { status: 401 }) });

		const error = await rejection(connector.describeApplication());

		expect(error.code).toBe("BANK_PROVIDER_ERROR");
		expect(error.failure).toEqual({ status: 401, providerCode: "UNAUTHORIZED" });
	});

	it("refuses an answer without its list of addresses", async () => {
		mockProvider({ application: () => HttpResponse.json({ name: "Archant" }) });

		const error = await rejection(connector.describeApplication());

		expect(error.failure).toEqual({ status: 200, providerCode: null });
	});
});

describe("listInstitutions", () => {
	it("lists a country's banks, keeping only the fields it reads", async () => {
		const requests = mockProvider();

		await expect(connector.listInstitutions("FR")).resolves.toEqual([
			{
				name: "Banque Test",
				country: "FR",
				logo: "https://enablebanking.com/brands/FR/Banque%20Test/",
				bic: "BTSTFRPP",
				maximumConsentValidity: 180 * 86_400,
			},
			{
				name: "Crédit Exemple",
				country: "FR",
				logo: null,
				bic: null,
				maximumConsentValidity: 30 * 86_400,
			},
			// An unreadable logo and an empty BIC become null rather than
			// dropping the bank.
			{
				name: "Caisse Sans Limite",
				country: "FR",
				logo: null,
				bic: null,
				maximumConsentValidity: null,
			},
		]);
		expect(requests).toEqual([
			expect.objectContaining({ method: "GET", path: "/aspsps", search: "?country=FR" }),
		]);
	});

	it("signs every request with a fresh RS256 token for the application", async () => {
		const requests = mockProvider();

		await connector.listInstitutions("FR");
		const token = requests[0]?.authorization?.replace(/^Bearer /u, "") ?? "";
		const { payload, protectedHeader } = await jwtVerify(token, TEST_PUBLIC_KEY, {
			issuer: "enablebanking.com",
			audience: "api.enablebanking.com",
			currentDate: new Date(NOW),
		});

		expect(protectedHeader.kid).toBe(TEST_APPLICATION_ID);
		expect(payload.exp).toBe(NOW / 1000 + 3600);
	});
});

describe("startAuthorization", () => {
	it("asks for a personal consent in French until the capped date", async () => {
		const requests = mockProvider();

		await expect(connector.startAuthorization(request)).resolves.toEqual({
			url: FIXTURE_AUTH_URL,
		});
		expect(requests).toEqual([
			expect.objectContaining({
				method: "POST",
				path: "/auth",
				body: {
					access: { valid_until: new Date(NOW + 180 * DAY - MARGIN).toISOString() },
					aspsp: { name: "Banque Test", country: "FR" },
					state: request.state,
					redirect_url: request.redirectUrl,
					psu_type: "personal",
					language: "fr",
				},
			}),
		]);
	});

	it("asks for the bank's own maximum when it is shorter", async () => {
		const requests = mockProvider();

		await connector.startAuthorization({
			...request,
			institution: { ...institution, maximumConsentValidity: 30 * 86_400 },
		});

		expect(requests[0]?.body).toMatchObject({
			access: { valid_until: new Date(NOW + 30 * DAY - MARGIN).toISOString() },
		});
	});

	it("names the URL to register when the provider refuses the redirect", async () => {
		mockProvider({ auth: () => HttpResponse.json(fixtures.redirectNotAllowed, { status: 400 }) });

		const error = await rejection(connector.startAuthorization(request));

		expect(error.code).toBe("BANK_REDIRECT_NOT_ALLOWED");
		expect(error.status).toBe(502);
		expect(error.params).toEqual({ url: request.redirectUrl });
		expect(error.failure).toEqual({ status: 400, providerCode: "REDIRECT_URI_NOT_ALLOWED" });
	});

	it("passes any other refusal on as a provider error", async () => {
		mockProvider({ auth: () => HttpResponse.json(fixtures.unauthorized, { status: 401 }) });

		const error = await rejection(connector.startAuthorization(request));

		expect(error.code).toBe("BANK_PROVIDER_ERROR");
		expect(error.failure).toEqual({ status: 401, providerCode: "UNAUTHORIZED" });
		// The provider's message names the application; nothing of it is kept.
		expect(JSON.stringify(error.toJSON())).not.toContain(TEST_APPLICATION_ID);
	});

	it("steps down to a shorter consent while the bank refuses its length", async () => {
		let calls = 0;
		const requests = mockProvider({
			auth: () => {
				calls += 1;

				return calls === 1
					? HttpResponse.json(fixtures.wrongConsentValidity, { status: 422 })
					: HttpResponse.json(fixtures.auth);
			},
		});

		await expect(
			connector.startAuthorization({
				...request,
				institution: { ...institution, maximumConsentValidity: 90 * 86_400 },
			}),
		).resolves.toEqual({ url: FIXTURE_AUTH_URL });
		expect(validUntils(requests)).toEqual([
			new Date(NOW + 90 * DAY - MARGIN).toISOString(),
			new Date(NOW + 45 * DAY - MARGIN).toISOString(),
		]);
	});

	it("dates each attempt from the clock at that attempt", async () => {
		let calls = 0;
		const requests = mockProvider({
			auth: () => {
				calls += 1;
				vi.setSystemTime(NOW + calls * 1000);

				return calls === 1
					? HttpResponse.json(fixtures.wrongConsentValidity, { status: 422 })
					: HttpResponse.json(fixtures.auth);
			},
		});

		await connector.startAuthorization(request);

		expect(validUntils(requests)).toEqual([
			new Date(NOW + 180 * DAY - MARGIN).toISOString(),
			new Date(NOW + 1000 + 90 * DAY - MARGIN).toISOString(),
		]);
	});

	it("throws the last refusal once every length is refused, keeping no message", async () => {
		const requests = mockProvider({
			auth: () => HttpResponse.json(fixtures.wrongConsentValidity, { status: 422 }),
		});

		const error = await rejection(
			connector.startAuthorization({
				...request,
				institution: { ...institution, maximumConsentValidity: 90 * 86_400 },
			}),
		);

		expect(validUntils(requests)).toEqual([90, 45, 30].map(inDays));
		expect(error.code).toBe("BANK_PROVIDER_ERROR");
		expect(error.failure).toEqual({ status: 422, providerCode: "WRONG_REQUEST_PARAMETERS" });
		expect(JSON.stringify(error.toJSON())).not.toMatch(/consent validity|7776000/u);
		expect(error.message).not.toMatch(/consent validity/u);
	});

	it.each([
		["another message", 422, { error: "WRONG_REQUEST_PARAMETERS", message: "Wrong ASPSP name" }],
		["no message", 422, { error: "WRONG_REQUEST_PARAMETERS" }],
		["a message that is not text", 422, { error: "WRONG_REQUEST_PARAMETERS", message: 7 }],
		["another code", 422, { error: "ASPSP_ERROR", message: "consent validity too long" }],
		["another status", 400, fixtures.wrongConsentValidity],
	])("fails at once on a refusal with %s", async (_, status, body) => {
		const requests = mockProvider({ auth: () => HttpResponse.json(body, { status }) });

		const error = await rejection(connector.startAuthorization(request));

		expect(requests).toHaveLength(1);
		expect(error.failure.status).toBe(status);
	});

	it("names the URL to register when the redirect is refused after a shorter consent", async () => {
		let calls = 0;
		const requests = mockProvider({
			auth: () => {
				calls += 1;

				return calls === 1
					? HttpResponse.json(fixtures.wrongConsentValidity, { status: 422 })
					: HttpResponse.json(fixtures.redirectNotAllowed, { status: 400 });
			},
		});

		const error = await rejection(connector.startAuthorization(request));

		expect(requests).toHaveLength(2);
		expect(error.code).toBe("BANK_REDIRECT_NOT_ALLOWED");
	});

	it("refuses a consent URL that is not http", async () => {
		mockProvider({ auth: () => HttpResponse.json({ url: "javascript:alert(1)" }) });

		const error = await rejection(connector.startAuthorization(request));

		expect(error.code).toBe("BANK_PROVIDER_ERROR");
		expect(error.failure).toEqual({ status: 200, providerCode: null });
	});
});

describe("completeAuthorization", () => {
	it("opens a session and reads when the consent ends and which accounts it shares", async () => {
		const requests = mockProvider();

		const session = await connector.completeAuthorization("the-code");

		expect(session).toEqual({
			sessionId: FIXTURE_SESSION_ID,
			consentExpiresAt: FIXTURE_CONSENT_END,
			accounts: [
				{
					uid: FIXTURE_CHECKING_UID,
					identificationHash: "anonymised-hash-checking",
					name: "Compte courant",
					ibanLast4: "0185",
					currency: "EUR",
					cashAccountType: "CACC",
					creditLimit: null,
				},
				{
					uid: FIXTURE_CARD_UID,
					identificationHash: "anonymised-hash-card",
					name: "Carte Visa Premier",
					ibanLast4: null,
					currency: "EUR",
					cashAccountType: "CARD",
					creditLimit: { amount: 300000, currency: "EUR" },
				},
			],
			dropped: { count: 0, fields: [] },
		});
		// Neither the holder's name nor the full IBAN goes further.
		expect(JSON.stringify(session)).not.toContain(FIXTURE_IBAN_HEAD);
		expect(JSON.stringify(session)).not.toContain("Jean Exemple");
		expect(requests).toEqual([
			expect.objectContaining({ method: "POST", path: "/sessions", body: { code: "the-code" } }),
		]);
	});

	it("refuses a session without an id, keeping none of the payload", async () => {
		mockProvider({
			sessions: () => HttpResponse.json({ access: { valid_until: "2026-12-20T10:00:00Z" } }),
		});

		const error = await rejection(connector.completeAuthorization("the-code"));

		expect(error.code).toBe("BANK_PROVIDER_ERROR");
		expect(error.failure).toEqual({ status: 200, providerCode: null });
		expect(error.toJSON()).toEqual({
			error: { code: "BANK_PROVIDER_ERROR", message: "The bank provider request failed." },
		});
	});

	it("keeps an account whose currency it cannot read, with none, and drops one without a uid", async () => {
		mockProvider({
			sessions: () =>
				HttpResponse.json({
					session_id: "s",
					access: { valid_until: "2026-12-20T10:00:00Z" },
					accounts: [
						{ uid: "u1", currency: "XXX", name: "Compte en devise inconnue" },
						{ currency: "EUR", name: "Compte sans uid" },
						{ uid: "u2", currency: "EUR", name: "Compte lisible" },
						{ uid: "u3", name: "Compte sans devise" },
						{ uid: "u4", currency: null, name: "Devise nulle" },
						{ uid: "u5", currency: 42, name: "Devise nombre" },
						{ uid: "u6", currency: "ZZZ", name: "Devise inconnue" },
					],
				}),
		});

		const session = await connector.completeAuthorization("the-code");

		expect(session.accounts).toMatchObject([
			{ uid: "u1", name: "Compte en devise inconnue", currency: null },
			{ uid: "u2", name: "Compte lisible", currency: "EUR" },
			{ uid: "u3", currency: null },
			{ uid: "u4", currency: null },
			{ uid: "u5", currency: null },
			{ uid: "u6", currency: null },
		]);
		expect(session.dropped).toEqual({ count: 1, fields: ["uid"] });
		expect(JSON.stringify(session.dropped)).not.toContain("Compte sans uid");
	});

	it("replays a session whose accounts all carry XXX, keeping every one", async () => {
		mockProvider({ sessions: () => HttpResponse.json(fixtures.sessionNoCurrency) });

		const session = await connector.completeAuthorization("the-code");

		expect(session.accounts).toEqual([
			{
				uid: "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e",
				identificationHash: "anonymised-hash-boursorama-checking",
				name: "BoursoBank Compte",
				ibanLast4: "5678",
				currency: null,
				cashAccountType: "CACC",
				creditLimit: null,
			},
			{
				uid: "c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f",
				identificationHash: "anonymised-hash-boursorama-savings",
				name: "Livret Bourso+",
				ibanLast4: "5432",
				currency: null,
				cashAccountType: "SVGS",
				creditLimit: null,
			},
		]);
		expect(session.dropped).toEqual({ count: 0, fields: [] });
	});

	it("reports the failing field paths of every dropped account, never a value", async () => {
		mockProvider({
			sessions: () =>
				HttpResponse.json({
					session_id: "s",
					access: { valid_until: "2026-12-20T10:00:00Z" },
					accounts: [
						"FR7630001007941234567890185",
						null,
						{ uid: "", name: "Uid vide" },
						{ name: "Sans uid" },
						{ uid: "u1", currency: "EUR" },
					],
				}),
		});

		const session = await connector.completeAuthorization("the-code");

		expect(session.accounts).toMatchObject([{ uid: "u1" }]);
		expect(session.dropped).toEqual({ count: 4, fields: ["(account)", "uid"] });
		expect(JSON.stringify(session.dropped)).not.toContain("FR76");
	});

	it("refuses a consent end that is a bare date", async () => {
		mockProvider({
			sessions: () => HttpResponse.json({ session_id: "s", access: { valid_until: "2026-12-20" } }),
		});

		await expect(connector.completeAuthorization("the-code")).rejects.toMatchObject({
			code: "BANK_PROVIDER_ERROR",
		});
	});
});

const account = (fields: Record<string, unknown>) =>
	toBankAccount(sessionAccountSchema.parse({ uid: "u1", currency: "EUR", ...fields }));

describe("revokeAuthorization", () => {
	it("deletes the session, signed like every other request", async () => {
		const requests = mockProvider();

		await expect(connector.revokeAuthorization(FIXTURE_SESSION_ID)).resolves.toBeUndefined();

		expect(requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
			{ method: "DELETE", path: `/sessions/${FIXTURE_SESSION_ID}`, body: undefined },
		]);
		expect(requests[0]?.authorization).toMatch(/^Bearer /u);
	});

	it("takes an empty answer as a success", async () => {
		mockProvider({ revoke: () => new HttpResponse(null, { status: 204 }) });

		await expect(connector.revokeAuthorization(FIXTURE_SESSION_ID)).resolves.toBeUndefined();
	});

	it("throws a sanitised provider error, never naming the session", async () => {
		mockProvider({ revoke: () => HttpResponse.json(fixtures.unauthorized, { status: 401 }) });

		const error = await rejection(connector.revokeAuthorization(FIXTURE_SESSION_ID));

		expect(error.code).toBe("BANK_PROVIDER_ERROR");
		expect(error.failure.status).toBe(401);
		expect(JSON.stringify(error.toJSON())).not.toContain(FIXTURE_SESSION_ID);
		expect(error.message).not.toContain(FIXTURE_SESSION_ID);
	});
});

describe("toBankAccount", () => {
	it("names the account from its details first, then its product, then its name", () => {
		expect(account({ details: "Livret A", product: "Épargne", name: "M. X" }).name).toBe(
			"Livret A",
		);
		expect(account({ details: "  ", product: "Épargne", name: "M. X" }).name).toBe("Épargne");
		expect(account({ name: "Compte joint" }).name).toBe("Compte joint");
	});

	it("falls back to the IBAN's last four characters, spaces dropped, or to a bare name", () => {
		expect(account({ account_id: { iban: "FR76 3000 1007 9412 3456 7890 185" } })).toMatchObject({
			name: "Compte •••• 0185",
			ibanLast4: "0185",
		});
		expect(account({ account_id: { other: { identification: "123" } } })).toMatchObject({
			name: "Compte",
			ibanLast4: null,
		});
	});

	it("uses the uid as identity when the bank sends no hash, and upper-cases the type", () => {
		expect(account({ cash_account_type: "svgs" })).toMatchObject({
			identificationHash: "u1",
			cashAccountType: "SVGS",
		});
		expect(account({ identification_hash: 42 })).toMatchObject({
			identificationHash: "u1",
			cashAccountType: null,
		});
	});

	it("reads a card's limit in the currency it names, and an unreadable one as none", () => {
		expect(account({ credit_limit: { amount: "1000.00", currency: "EUR" } }).creditLimit).toEqual({
			amount: 100000,
			currency: "EUR",
		});
		expect(account({ credit_limit: { amount: "1000", currency: "USD" } }).creditLimit).toEqual({
			amount: 100000,
			currency: "USD",
		});
		expect(account({ credit_limit: { amount: "mille", currency: "EUR" } }).creditLimit).toBeNull();
		expect(account({ credit_limit: { amount: "1000", currency: "XXX" } }).creditLimit).toBeNull();
		expect(account({ credit_limit: "1000" }).creditLimit).toBeNull();
		expect(account({}).creditLimit).toBeNull();
	});

	it("falls through a label longer than an account name to the next choice", () => {
		expect(account({ details: "x".repeat(101), product: "Livret A" }).name).toBe("Livret A");
		expect(account({ details: "x".repeat(100) }).name).toBe("x".repeat(100));
	});

	it("reads an unknown currency as none", () => {
		expect(account({ currency: "XXX" }).currency).toBeNull();
		expect(account({ currency: undefined }).currency).toBeNull();
		expect(account({ currency: "usd" }).currency).toBeNull();
		expect(account({ currency: "USD" }).currency).toBe("USD");
	});
});

describe("readSession", () => {
	it("reads the session's consent end, signed like every other request", async () => {
		const requests = mockProvider();

		await expect(connector.readSession(FIXTURE_SESSION_ID)).resolves.toEqual({
			consentExpiresAt: FIXTURE_CONSENT_END,
		});
		expect(requests.map(({ method, path }) => ({ method, path }))).toEqual([
			{ method: "GET", path: `/sessions/${FIXTURE_SESSION_ID}` },
		]);
		expect(requests[0]?.authorization).toMatch(/^Bearer /u);
	});

	it.each([401, 404])("throws a %i with its status, never naming the session", async (status) => {
		mockProvider({ session: () => HttpResponse.json(fixtures.unauthorized, { status }) });

		const error = await rejection(connector.readSession(FIXTURE_SESSION_ID));

		expect(error.code).toBe("BANK_PROVIDER_ERROR");
		expect(error.failure).toEqual({ status, providerCode: "UNAUTHORIZED" });
		expect(JSON.stringify(error.toJSON())).not.toContain(FIXTURE_SESSION_ID);
		expect(error.message).not.toContain(FIXTURE_SESSION_ID);
	});

	it.each([
		{},
		{ access: {} },
		{ access: { valid_until: "" } },
		{ access: { valid_until: "demain" } },
	])("answers no consent end when the session says none it can read: %j", async (body) => {
		mockProvider({ session: () => HttpResponse.json({ status: "AUTHORIZED", ...body }) });

		await expect(connector.readSession(FIXTURE_SESSION_ID)).resolves.toEqual({
			consentExpiresAt: null,
		});
	});
});

const balances = (...items: Record<string, unknown>[]) =>
	mockProvider({ balances: () => HttpResponse.json({ balances: items }) });

const balance = (
	type: string,
	amount: string,
	extra: Record<string, unknown> = {},
	currency = "EUR",
) => ({
	balance_amount: { amount, currency },
	balance_type: type,
	...extra,
});

/** The balance chosen among `items`, for an account in `currency`. */
async function chosen(items: Record<string, unknown>[], currency: "EUR" | "USD" | null = "EUR") {
	balances(...items);

	return connector.fetchBalance(FIXTURE_CARD_UID, currency);
}

/** Sure's `BALANCE_TYPE_PRIORITY`, ISO codes only: booked, then expected, then available. */
const SURE_ORDER = ["CLBD", "ITBD", "OPBD", "PRCD", "XPCD", "CLAV", "ITAV"];

describe("fetchBalance", () => {
	it("reads the closing booked balance before the interim one, as minor units", async () => {
		const requests = mockProvider();

		await expect(connector.fetchBalance(FIXTURE_CHECKING_UID, "EUR")).resolves.toEqual({
			amount: 123456,
			currency: "EUR",
			otherCurrencies: 0,
		});
		expect(requests).toEqual([
			expect.objectContaining({
				method: "GET",
				path: `/accounts/${FIXTURE_CHECKING_UID}/balances`,
			}),
		]);
	});

	it("takes the closing booked balance whatever the order", async () => {
		// The day it describes stays out: the ledger dates the balance today.
		await expect(
			chosen([balance("ITBD", "1.00"), balance("CLBD", "2.00", { reference_date: "2026-09-23" })]),
		).resolves.toEqual({ amount: 200, currency: "EUR", otherCurrencies: 0 });
		await expect(chosen([balance("CLBD", "2.00"), balance("ITBD", "1.00")])).resolves.toMatchObject(
			{ amount: 200 },
		);
	});

	it.each(SURE_ORDER.map((type, index) => [type, SURE_ORDER.slice(index + 1)] as const))(
		"takes %s before %j, wherever it is listed",
		async (type, later) => {
			const others = later.map((other) => balance(other, "1.00"));

			await expect(chosen([balance(type, "2.00"), ...others])).resolves.toMatchObject({
				amount: 200,
			});
			await expect(chosen([...others, balance(type, "2.00")])).resolves.toMatchObject({
				amount: 200,
			});
		},
	);

	it("reads Enable Banking's long names, whatever their case, underscores or dashes", async () => {
		await expect(chosen([balance("closingBooked", "3.00")])).resolves.toMatchObject({
			amount: 300,
		});
		await expect(
			chosen([balance("interim_available", "1.00"), balance("OPENING-BOOKED", "2.00")]),
		).resolves.toMatchObject({ amount: 200 });
		await expect(
			chosen([balance("ITAV", "1.00"), balance("previously_closed_booked", "4.00")]),
		).resolves.toMatchObject({ amount: 400 });
	});

	it("takes the last balance listed of a type, and an ISO code before its long name", async () => {
		await expect(chosen([balance("CLBD", "1.00"), balance("clbd", "2.00")])).resolves.toMatchObject(
			{ amount: 200 },
		);
		await expect(
			chosen([balance("CLBD", "1.00"), balance("closingBooked", "2.00")]),
		).resolves.toMatchObject({ amount: 100 });
	});

	it("reads an opening booked balance alone", async () => {
		await expect(chosen([balance("OPBD", "100.00")])).resolves.toMatchObject({ amount: 10000 });
	});

	it("prefers the freshest available balance strictly newer than an opening or closed one", async () => {
		await expect(
			chosen([
				balance("OPBD", "1.00", { reference_date: "2026-10-10" }),
				balance("ITAV", "2.00", { reference_date: "2026-10-11" }),
				balance("XPCD", "3.00", { reference_date: "2026-10-12" }),
			]),
		).resolves.toEqual({ amount: 300, currency: "EUR", otherCurrencies: 0 });
		await expect(
			chosen([
				balance("previouslyClosedBooked", "1.00", { reference_date: "2026-10-10" }),
				balance("closing_available", "2.00", { reference_date: "2026-10-11" }),
			]),
		).resolves.toMatchObject({ amount: 200 });
	});

	it("keeps the opening balance against a same-day or undated available one", async () => {
		await expect(
			chosen([
				balance("OPBD", "1.00", { reference_date: "2026-10-11" }),
				balance("ITAV", "2.00", { reference_date: "2026-10-11" }),
			]),
		).resolves.toMatchObject({ amount: 100 });
		await expect(
			chosen([
				balance("OPBD", "1.00", { reference_date: "2026-10-10" }),
				balance("ITAV", "2.00"),
				balance("CLAV", "3.00", { reference_date: "11/10/2026" }),
			]),
		).resolves.toMatchObject({ amount: 100 });
	});

	it("skips the freshness check when the opening balance's own date is missing or unreadable", async () => {
		await expect(
			chosen([balance("OPBD", "1.00"), balance("ITAV", "2.00", { reference_date: "2026-10-11" })]),
		).resolves.toMatchObject({ amount: 100 });
		await expect(
			chosen([
				balance("PRCD", "1.00", { reference_date: "hier" }),
				balance("ITAV", "2.00", { reference_date: "2026-10-11" }),
			]),
		).resolves.toMatchObject({ amount: 100 });
	});

	it("never lets an unranked type or a booked balance yield to a fresher one", async () => {
		await expect(
			chosen([
				balance("OPBD", "1.00", { reference_date: "2026-10-10" }),
				balance("FWAV", "2.00", { reference_date: "2026-10-12" }),
				balance("INFO", "3.00", { reference_date: "2026-10-12" }),
			]),
		).resolves.toMatchObject({ amount: 100 });
		await expect(
			chosen([
				balance("ITBD", "1.00", { reference_date: "2026-10-10" }),
				balance("XPCD", "2.00", { reference_date: "2026-10-12" }),
			]),
		).resolves.toMatchObject({ amount: 100 });
	});

	it("falls back to the first balance listed when no type ranks", async () => {
		await expect(chosen([balance("INFO", "5.00"), balance("OTHR", "6.00")])).resolves.toMatchObject(
			{ amount: 500 },
		);
	});

	it("gives nothing when the bank lists no balance", async () => {
		await expect(chosen([])).resolves.toBeNull();
	});

	it("keeps the balances in the account's currency, counting the funded ones left out", async () => {
		await expect(
			chosen([
				balance("CLBD", "12.00", {}, "USD"),
				balance("CLBD", "50.00"),
				balance("ITBD", "0.00", {}, "GBP"),
			]),
		).resolves.toEqual({ amount: 5000, currency: "EUR", otherCurrencies: 1 });
	});

	it("keeps the first currency listed when the account's is not among them", async () => {
		await expect(
			chosen([balance("ITBD", "12.00", {}, "USD"), balance("CLBD", "50.00", {}, "GBP")], null),
		).resolves.toMatchObject({ amount: 1200, currency: "USD", otherCurrencies: 1 });
		await expect(
			chosen([balance("CLBD", "50.00", {}, "GBP"), balance("CLBD", "12.00", {}, "USD")], "EUR"),
		).resolves.toMatchObject({ amount: 5000, currency: "GBP", otherCurrencies: 1 });
	});

	it("keeps a single currency whatever the account's, leaving nothing out", async () => {
		await expect(chosen([balance("CLBD", "12.00", {}, "USD")], "EUR")).resolves.toMatchObject({
			currency: "USD",
			otherCurrencies: 0,
		});
	});

	it("reads a balance whose day it cannot read", async () => {
		await expect(
			chosen([balance("ITBD", "1.00", { reference_date: "23/09/2026" })]),
		).resolves.toMatchObject({ amount: 100 });
		await expect(
			chosen([balance("ITBD", "1.00", { reference_date: 20_260_923 })]),
		).resolves.toMatchObject({ amount: 100 });
	});

	it("makes a debit balance negative, and leaves a credit one as it is", async () => {
		await expect(
			chosen([balance("CLBD", "300.00", { credit_debit_indicator: "DBIT" })]),
		).resolves.toMatchObject({ amount: -30000 });
		await expect(
			chosen([balance("OPBD", "300.00", { credit_debit_indicator: "CRDT" })]),
		).resolves.toMatchObject({ amount: 30000 });
	});

	it("refuses an amount with more decimals than its currency, or not a number", async () => {
		await expect(chosen([balance("ITBD", "12.345")])).rejects.toMatchObject({
			code: "BANK_PROVIDER_ERROR",
		});
		await expect(chosen([balance("ITBD", "1e3")])).rejects.toMatchObject({
			code: "BANK_PROVIDER_ERROR",
		});
	});

	it("counts a left-out balance that does not read as holding nothing", async () => {
		await expect(
			chosen([balance("CLBD", "50.00"), balance("CLBD", "1e3", {}, "USD")]),
		).resolves.toMatchObject({ amount: 5000, otherCurrencies: 0 });
	});

	it("passes a provider failure on", async () => {
		mockProvider({ balances: () => HttpResponse.json(fixtures.unauthorized, { status: 401 }) });

		const error = await rejection(connector.fetchBalance(FIXTURE_CARD_UID, "EUR"));

		expect(error.failure).toEqual({ status: 401, providerCode: "UNAUTHORIZED" });
	});
});

const SINCE = "2026-06-26";

/** A booked debit with every field the mapping reads, `extra` on top. */
const line = (extra: Record<string, unknown> = {}) => ({
	entry_reference: "ref-1",
	transaction_amount: { amount: "10.00", currency: "EUR" },
	credit_debit_indicator: "DBIT",
	status: "BOOK",
	booking_date: "2026-09-20",
	creditor: { name: "Boulangerie" },
	debtor: { name: "M. Jean Exemple" },
	bank_transaction_code: { description: "Paiement carte" },
	remittance_information: ["CB BOULANGERIE", "20/09"],
	...extra,
});

describe("toTransaction", () => {
	it("maps a booked debit, keyed on the entry reference, never on the transaction id", () => {
		expect(toTransaction(line({ transaction_id: "tx-1" }), SINCE, [])).toEqual({
			externalId: "ref-1",
			date: "2026-09-20",
			amount: -1000,
			currency: "EUR",
			label: "Boulangerie",
			keyLabel: "Boulangerie",
			reference: null,
			notes: "CB BOULANGERIE\n20/09",
			pending: false,
			merchant: "Boulangerie",
		});
	});

	it("names a card placeholder's line and merchant from its cleaned remittance", () => {
		const mapped = toTransaction(
			line({
				creditor: { name: "CARD-1234" },
				remittance_information: ["Apple Pay: SUMUP *CAFE DU COIN"],
			}),
			SINCE,
			[],
		);

		expect(mapped).toMatchObject({
			label: "CAFE DU COIN",
			merchant: "CAFE DU COIN",
			// Sure's notes keep the wallet; the key keeps the label read before.
			notes: "Apple Pay: SUMUP *CAFE DU COIN",
			keyLabel: "CARD-1234",
		});
	});

	it("names a line from a known merchant, and creates none from an unknown remittance", () => {
		const bare = { creditor: null, bank_transaction_code: null };

		expect(
			toTransaction(line({ ...bare, remittance_information: ["BILLA DANKT 0007114"] }), SINCE, [
				"Billa",
			]),
		).toMatchObject({ label: "Billa", merchant: "Billa", keyLabel: "BILLA DANKT 0007114" });
		expect(
			toTransaction(line({ ...bare, remittance_information: ["SUMUP *GLACIER"] }), SINCE, [
				"Billa",
			]),
		).toMatchObject({ label: "GLACIER", merchant: null, keyLabel: "SUMUP *GLACIER" });
	});

	it("keeps a pending line as pending", () => {
		expect(toTransaction(line({ status: "PDNG" }), SINCE, [])).toMatchObject({
			externalId: "ref-1",
			amount: -1000,
			pending: true,
		});
	});

	it("keeps a credit positive and names its debtor", () => {
		expect(toTransaction(line({ credit_debit_indicator: "CRDT" }), SINCE, [])).toMatchObject({
			amount: 1000,
			label: "M. Jean Exemple",
		});
	});

	it("reads a negative amount by its direction alone", () => {
		expect(
			toTransaction(line({ transaction_amount: { amount: "-10.00", currency: "EUR" } }), SINCE, []),
		).toMatchObject({ amount: -1000 });
		expect(
			toTransaction(
				line({
					credit_debit_indicator: "CRDT",
					transaction_amount: { amount: "-10.00", currency: "EUR" },
				}),
				SINCE,
				[],
			),
		).toMatchObject({ amount: 1000 });
	});

	it("names a line from the bank's code, then the first remittance line, then its direction", () => {
		const bare = { creditor: null, debtor: { name: "  " } };

		expect(toTransaction(line(bare), SINCE, [])).toMatchObject({ label: "Paiement carte" });
		expect(
			toTransaction(line({ ...bare, bank_transaction_code: { description: 3 } }), SINCE, []),
		).toMatchObject({ label: "CB BOULANGERIE" });
		expect(
			toTransaction(
				line({ ...bare, bank_transaction_code: null, remittance_information: [7, " "] }),
				SINCE,
				[],
			),
		).toMatchObject({ label: "Virement sortant", notes: null });
		expect(
			toTransaction(
				line({
					...bare,
					credit_debit_indicator: "CRDT",
					bank_transaction_code: "PMNT",
					remittance_information: "text",
				}),
				SINCE,
				[],
			),
		).toMatchObject({ label: "Virement entrant", notes: null });
	});

	it("caps the label and the notes by code points", () => {
		const mapped = toTransaction(
			line({ creditor: { name: "é".repeat(300) }, remittance_information: ["x".repeat(3000)] }),
			SINCE,
			[],
		);

		expect(mapped).toMatchObject({ label: "é".repeat(200), notes: "x".repeat(2000) });
	});

	it("keeps no key without an entry reference", () => {
		expect(toTransaction(line({ entry_reference: undefined }), SINCE, [])).toMatchObject({
			externalId: null,
		});
		expect(toTransaction(line({ entry_reference: " " }), SINCE, [])).toMatchObject({
			externalId: null,
		});
	});

	it("dates a line by booking, then value, then transaction date", () => {
		expect(
			toTransaction(line({ booking_date: null, value_date: "2026-09-19" }), SINCE, []),
		).toMatchObject({ date: "2026-09-19" });
		expect(
			toTransaction(
				line({ booking_date: undefined, transaction_date: "2026-09-18T23:30:00+02:00" }),
				SINCE,
				[],
			),
		).toMatchObject({ date: "2026-09-18" });
	});

	it("drops every line neither booked nor pending, and those before the window", () => {
		for (const status of ["INFO", "CNCL", "HOLD", "OTHR", null]) {
			expect(toTransaction(line({ status }), SINCE, [])).toBeNull();
		}

		expect(toTransaction(line({ booking_date: "2026-06-25" }), SINCE, [])).toBeNull();
		expect(toTransaction(line({ booking_date: SINCE }), SINCE, [])).not.toBeNull();
	});

	it("reads a line without CRDT as money out, its creditor its counterparty, as Sure", () => {
		const boulangerie = {
			amount: -1000,
			label: "Boulangerie",
			keyLabel: "Boulangerie",
			merchant: "Boulangerie",
		};

		for (const credit_debit_indicator of [undefined, null, "OTHR", "crdt", "", 3]) {
			expect(toTransaction(line({ credit_debit_indicator }), SINCE, [])).toMatchObject(boulangerie);
		}

		expect(
			toTransaction(
				line({
					credit_debit_indicator: undefined,
					transaction_amount: { amount: "-10.00", currency: "EUR" },
				}),
				SINCE,
				[],
			),
		).toMatchObject({ amount: -1000 });
	});

	it("never names a line without direction by its debtor, and falls back to « Virement sortant »", () => {
		const bare = { credit_debit_indicator: undefined, creditor: null };

		expect(
			toTransaction(line({ ...bare, debtor: { name: "Employeur" } }), SINCE, []),
		).toMatchObject({ label: "Paiement carte", keyLabel: "Paiement carte", merchant: null });
		expect(
			toTransaction(
				line({
					...bare,
					debtor: { name: "Employeur" },
					bank_transaction_code: null,
					remittance_information: [],
				}),
				SINCE,
				[],
			),
		).toMatchObject({ label: "Virement sortant", keyLabel: "Virement sortant", merchant: null });
		expect(
			toTransaction(
				line({ ...bare, debtor: null, bank_transaction_code: null, remittance_information: [] }),
				SINCE,
				[],
			),
		).toMatchObject({
			amount: -1000,
			label: "Virement sortant",
			keyLabel: "Virement sortant",
			merchant: null,
		});
	});

	it("refuses a line without a readable date or amount", () => {
		expect(toTransaction(line({ booking_date: null }), SINCE, [])).toBe("INVALID_DATE");
		expect(toTransaction(line({ booking_date: "2026-02-30" }), SINCE, [])).toBe("INVALID_DATE");
		expect(toTransaction(line({ transaction_amount: null }), SINCE, [])).toBe("INVALID_AMOUNT");
		expect(
			toTransaction(line({ transaction_amount: { amount: "douze", currency: "EUR" } }), SINCE, []),
		).toBe("INVALID_AMOUNT");
		expect(
			toTransaction(line({ transaction_amount: { amount: "1.00", currency: "XXX" } }), SINCE, []),
		).toBe("INVALID_AMOUNT");
		expect(
			toTransaction(
				line({
					credit_debit_indicator: undefined,
					transaction_amount: { amount: "douze", currency: "EUR" },
				}),
				SINCE,
				[],
			),
		).toBe("INVALID_AMOUNT");
		expect(toTransaction("not a line", SINCE, [])).toBe("INVALID_AMOUNT");
	});
});

const pages = (...items: Record<string, unknown>[]) =>
	mockProvider({
		transactions: (url) => {
			const key = url.searchParams.get("continuation_key");

			return HttpResponse.json(items[key === null ? 0 : Number(key)]);
		},
	});

describe("fetchStatement", () => {
	it("names lines from the merchant names it is given", async () => {
		pages({
			transactions: [
				line({
					creditor: null,
					bank_transaction_code: null,
					remittance_information: ["POS 45,13 AT D6 31.07. 10:27", "BILLA DANKT 0007114"],
				}),
			],
			continuation_key: null,
		});

		const statement = await connector.fetchStatement(
			FIXTURE_CHECKING_UID,
			SINCE,
			TODAY,
			["Billa"],
			true,
		);

		expect(statement.transactions).toEqual([
			expect.objectContaining({ label: "Billa", merchant: "Billa" }),
		]);
	});

	it("reads every page from the window start, and never the balance", async () => {
		const requests = mockProvider();

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(
			statement.transactions.map(({ label, amount, date, externalId, pending }) => ({
				label,
				amount,
				date,
				externalId,
				pending,
			})),
		).toEqual([
			{
				label: "Carrefour Market",
				amount: -4290,
				date: "2026-09-20",
				externalId: "20260920-0001",
				pending: false,
			},
			{
				label: "Employeur Test",
				amount: 250000,
				date: "2026-09-15",
				externalId: "20260915-0002",
				pending: false,
			},
			{
				label: "Boulangerie Test",
				amount: -1200,
				date: "2026-09-23",
				externalId: "20260923-0003",
				pending: true,
			},
			{ label: "Prélèvement", amount: -6000, date: "2026-09-18", externalId: null, pending: false },
			{
				label: "NETFLIX.COM",
				amount: -999,
				date: "2026-09-21",
				externalId: "20260921-0005",
				pending: false,
			},
			{
				label: "Virement entrant",
				amount: 1500,
				date: "2026-09-22",
				externalId: "20260922-0007",
				pending: false,
			},
		]);
		expect(statement.rejected).toEqual([]);
		expect(statement).toMatchObject({ from: SINCE, cutShort: null });
		expect(statement).not.toHaveProperty("balance");
		expect(requests.map(({ path, search }) => `${path}${search}`)).toEqual([
			`/accounts/${FIXTURE_CHECKING_UID}/transactions?date_from=2026-06-26`,
			`/accounts/${FIXTURE_CHECKING_UID}/transactions?date_from=2026-06-26&continuation_key=page-2`,
		]);
	});

	it("asks every page for booked lines only without pending ones, and drops those the bank returns all the same, as Sure", async () => {
		const requests = mockProvider();

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], false);

		expect(statement.transactions.map(({ externalId }) => externalId)).not.toContain(
			"20260923-0003",
		);
		expect(statement.transactions.some(({ pending }) => pending)).toBe(false);
		expect(statement.transactions).toHaveLength(5);
		expect(statement.rejected).toEqual([]);
		expect(requests.map(({ path, search }) => `${path}${search}`)).toEqual([
			`/accounts/${FIXTURE_CHECKING_UID}/transactions?date_from=2026-06-26&transaction_status=BOOK`,
			`/accounts/${FIXTURE_CHECKING_UID}/transactions?date_from=2026-06-26&transaction_status=BOOK&continuation_key=page-2`,
		]);
	});

	it("refuses an unreadable line by its position across pages, and keeps the others", async () => {
		pages(
			{ transactions: [line(), line({ booking_date: "soon" })], continuation_key: "1" },
			{
				transactions: [line({ status: "INFO" }), 42, line({ transaction_id: "tx-2" })],
				continuation_key: null,
			},
		);

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(statement.transactions).toHaveLength(2);
		expect(statement.rejected).toEqual([
			{ ref: "1", reason: "INVALID_DATE" },
			{ ref: "3", reason: "INVALID_AMOUNT" },
		]);
	});

	it("lists a line without direction as money out, never refused", async () => {
		pages({
			transactions: [
				line({ entry_reference: "missing", credit_debit_indicator: undefined }),
				line({ entry_reference: "unknown", credit_debit_indicator: "OTHR" }),
			],
			continuation_key: null,
		});

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(statement.rejected).toEqual([]);
		expect(statement.transactions).toEqual([
			expect.objectContaining({ externalId: "missing", amount: -1000, label: "Boulangerie" }),
			expect.objectContaining({ externalId: "unknown", amount: -1000, label: "Boulangerie" }),
		]);
	});

	it("stops on a key it has already followed", async () => {
		const requests = pages(
			{ transactions: [line()], continuation_key: "1" },
			{ transactions: [line({ transaction_id: "tx-2" })], continuation_key: "1" },
		);

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(statement.transactions).toHaveLength(2);
		expect(requests.filter(({ path }) => path.endsWith("/transactions"))).toHaveLength(2);
	});

	it("stops after a hundred pages", async () => {
		const requests = mockProvider({
			transactions: (url) =>
				HttpResponse.json({
					transactions: [line({ transaction_id: url.searchParams.get("continuation_key") })],
					continuation_key: String(Number(url.searchParams.get("continuation_key") ?? 0) + 1),
				}),
		});

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(statement.transactions).toHaveLength(MAX_PAGES);
		expect(requests.filter(({ path }) => path.endsWith("/transactions"))).toHaveLength(MAX_PAGES);
	});

	it("takes a page with an odd key as the last one, and refuses one without lines", async () => {
		pages({ transactions: [line()], continuation_key: 7 });
		await expect(
			connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true),
		).resolves.toMatchObject({
			transactions: [expect.objectContaining({ externalId: "ref-1" })],
		});

		pages({ continuation_key: null });
		await expect(
			connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true),
		).rejects.toMatchObject({
			code: "BANK_PROVIDER_ERROR",
		});
	});

	it("throws a provider failure on the first page, asking for no other period", async () => {
		const requests = mockProvider({
			transactions: () => HttpResponse.json(fixtures.unauthorized, { status: 401 }),
		});

		const error = await rejection(
			connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true),
		);

		expect(error.failure).toEqual({ status: 401, providerCode: "UNAUTHORIZED" });
		expect(requests).toHaveLength(1);
	});

	it.each([400, 422])(
		"keeps the pages read before a %i after page one, and names it",
		async (status) => {
			const requests = mockProvider({
				transactions: (url) =>
					url.searchParams.get("continuation_key") === "page-2"
						? HttpResponse.json({ error: "WRONG_REQUEST_PARAMETERS" }, { status })
						: transactionsPage(url),
			});

			const statement = await connector.fetchStatement(
				FIXTURE_CHECKING_UID,
				SINCE,
				TODAY,
				[],
				true,
			);

			expect(statement.transactions.map(({ externalId }) => externalId)).toEqual([
				"20260920-0001",
				"20260915-0002",
				"20260923-0003",
				null,
			]);
			expect(statement.from).toBe(SINCE);
			expect(statement.cutShort).toEqual({ status, providerCode: "WRONG_REQUEST_PARAMETERS" });
			expect(requests).toHaveLength(2);
		},
	);

	it("throws a 500 after page one, keeping nothing", async () => {
		const requests = mockProvider({
			transactions: (url) =>
				url.searchParams.get("continuation_key") === "page-2"
					? HttpResponse.json({ error: "ASPSP_ERROR" }, { status: 500 })
					: transactionsPage(url),
		});

		const error = await rejection(
			connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true),
		);

		expect(error.failure).toEqual({ status: 500, providerCode: "ASPSP_ERROR" });
		expect(requests).toHaveLength(2);
	});

	it("throws a 400 on page one, which no page read can stand for", async () => {
		mockProvider({
			transactions: () => HttpResponse.json({ error: "WRONG_REQUEST_PARAMETERS" }, { status: 400 }),
		});

		const error = await rejection(
			connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true),
		);

		expect(error.failure).toEqual({ status: 400, providerCode: "WRONG_REQUEST_PARAMETERS" });
	});

	it("throws what is not a provider failure, even after the first page", async () => {
		mockProvider();
		vi.mocked(signJwt)
			.mockImplementationOnce(async (...args) => {
				const actual = await vi.importActual<typeof jwt>("./jwt.ts");

				return actual.signJwt(...args);
			})
			.mockRejectedValueOnce(new Error("key unreadable"));

		await expect(
			connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true),
		).rejects.toThrow("key unreadable");
	});

	it("throws what is not a provider failure on the first page, asking for no other period", async () => {
		const requests = mockProvider();
		vi.mocked(signJwt).mockRejectedValueOnce(new Error("key unreadable"));

		await expect(
			connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true),
		).rejects.toThrow("key unreadable");
		expect(requests).toEqual([]);
	});
});

const refused = (detail?: unknown, status = 422) =>
	HttpResponse.json(
		{ error: "WRONG_TRANSACTIONS_PERIOD", message: "The period is too long", detail },
		{ status },
	);

/**
 * Refuses every `date_from` earlier than `accepted`, `null` refusing them
 * all, with `detail` in the refusal.
 */
function acceptingFrom(accepted: string | null, detail?: unknown) {
	return mockProvider({
		transactions: (url) => {
			const from = url.searchParams.get("date_from") ?? "";

			return accepted === null || from < accepted
				? refused(detail)
				: HttpResponse.json({
						transactions: [
							line({ entry_reference: "old", booking_date: "2026-07-01" }),
							line({ entry_reference: "recent", booking_date: "2026-09-20" }),
						],
						continuation_key: null,
					});
		},
	});
}

const dateFroms = (requests: ReturnType<typeof mockProvider>) =>
	requests.map(({ search }) => new URLSearchParams(search).get("date_from"));

describe("nextStart", () => {
	it("takes the bank's suggested start on the first retry, when it is later", () => {
		expect(nextStart(SINCE, "2026-07-10", 0, TODAY)).toBe("2026-07-10");
	});

	it("takes the first shorter window later than the refused start otherwise", () => {
		expect(nextStart(SINCE, null, 0, TODAY)).toBe("2026-06-27");
		expect(nextStart(SINCE, SINCE, 0, TODAY)).toBe("2026-06-27");
		expect(nextStart(SINCE, "2026-06-01", 0, TODAY)).toBe("2026-06-27");
		expect(nextStart("2026-07-10", "2026-08-01", 1, TODAY)).toBe("2026-07-26");
		expect(nextStart("2026-07-26", null, 2, TODAY)).toBe("2026-08-25");
	});

	it("gives up once no window is later, or after four retries", () => {
		expect(nextStart("2026-08-25", null, 3, TODAY)).toBeNull();
		expect(nextStart("2026-09-17", "2026-09-20", 1, TODAY)).toBeNull();
		expect(nextStart("2026-06-01", null, 4, TODAY)).toBeNull();
	});
});

describe("a refused period", () => {
	it("asks again for 89 days, and reads from the start the bank accepted", async () => {
		const requests = acceptingFrom("2026-06-27");

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(dateFroms(requests)).toEqual(["2026-06-26", "2026-06-27"]);
		expect(statement.from).toBe("2026-06-27");
		expect(statement.cutShort).toBeNull();
		expect(statement.transactions).toHaveLength(2);
	});

	it("keeps asking for booked lines only on a retried page, pending lines turned off", async () => {
		const requests = acceptingFrom("2026-06-27");

		await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], false);

		expect(dateFroms(requests)).toEqual(["2026-06-26", "2026-06-27"]);
		expect(
			requests.map(({ search }) => new URLSearchParams(search).get("transaction_status")),
		).toEqual(["BOOK", "BOOK"]);
	});

	it("goes down to 60 then 30 days, keeping the lines from the start asked for", async () => {
		const requests = acceptingFrom("2026-08-25");

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(dateFroms(requests)).toEqual(["2026-06-26", "2026-06-27", "2026-07-26", "2026-08-25"]);
		expect(statement.from).toBe("2026-08-25");
		expect(statement.transactions.map(({ externalId }) => externalId)).toEqual(["old", "recent"]);
	});

	it("retries from the bank's suggested start when it is later", async () => {
		const requests = acceptingFrom("2026-07-10", { date_from: "2026-07-10" });

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(dateFroms(requests)).toEqual(["2026-06-26", "2026-07-10"]);
		expect(statement.from).toBe("2026-07-10");
	});

	it("takes 89 days when the suggested start is not later", async () => {
		const requests = acceptingFrom("2026-06-27", { date_from: "2026-06-01" });

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(dateFroms(requests)).toEqual(["2026-06-26", "2026-06-27"]);
		expect(statement.from).toBe("2026-06-27");
	});

	it("takes the first window later than a suggested start refused too", async () => {
		const requests = acceptingFrom("2026-07-26", { date_from: "2026-07-10" });

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(dateFroms(requests)).toEqual(["2026-06-26", "2026-07-10", "2026-07-26"]);
		expect(statement.from).toBe("2026-07-26");
	});

	it("ignores a suggested start that does not read as a date", async () => {
		const requests = acceptingFrom("2026-06-27", { date_from: "soon" });

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(dateFroms(requests)).toEqual(["2026-06-26", "2026-06-27"]);
		expect(statement.from).toBe("2026-06-27");
	});

	it("reads a suggested start in ISO 8601's basic form, as `Date.iso8601`", async () => {
		const requests = acceptingFrom("2026-07-10", { date_from: "20260710" });

		await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(dateFroms(requests)).toEqual(["2026-06-26", "2026-07-10"]);
	});

	it("follows the suggested start on the first retry of a page only", async () => {
		const requests = mockProvider({
			transactions: (url) => {
				const from = url.searchParams.get("date_from") ?? "";

				return from < "2026-08-25"
					? refused({ date_from: addDays(from, 1) })
					: HttpResponse.json({ transactions: [line()], continuation_key: null });
			},
		});

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(dateFroms(requests)).toEqual(["2026-06-26", "2026-06-27", "2026-07-26", "2026-08-25"]);
		expect(statement.from).toBe("2026-08-25");
	});

	it.each([401, 403, 404, 408, 429])(
		"takes a refused period under a %i as that failure, as Sure reads no body there",
		async (status) => {
			const requests = mockProvider({
				transactions: () => HttpResponse.json({ error: "WRONG_TRANSACTIONS_PERIOD" }, { status }),
			});

			const error = await rejection(
				connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true),
			);

			expect(error.failure).toEqual({ status, providerCode: "WRONG_TRANSACTIONS_PERIOD" });
			expect(requests).toHaveLength(1);
		},
	);

	it("retries a refused period under a 500 too", async () => {
		const requests = mockProvider({
			transactions: (url) =>
				(url.searchParams.get("date_from") ?? "") < "2026-06-27"
					? HttpResponse.json({ error: "WRONG_TRANSACTIONS_PERIOD" }, { status: 500 })
					: HttpResponse.json({ transactions: [line()], continuation_key: null }),
		});

		await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(dateFroms(requests)).toEqual(["2026-06-26", "2026-06-27"]);
	});

	it("reads N26's PERIOD_INVALID as a refusal without a date", async () => {
		const requests = mockProvider({
			transactions: (url) =>
				(url.searchParams.get("date_from") ?? "") < "2026-06-27"
					? HttpResponse.json(
							{ code: "PERIOD_INVALID", detail: "dateFrom=2026-06-26,dateTo=2026-09-24" },
							{ status: 400 },
						)
					: HttpResponse.json({ transactions: [line()], continuation_key: null }),
		});

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(dateFroms(requests)).toEqual(["2026-06-26", "2026-06-27"]);
		expect(statement.from).toBe("2026-06-27");
	});

	it("names N26's PERIOD_INVALID when every start is refused", async () => {
		mockProvider({
			transactions: () =>
				HttpResponse.json({ code: "PERIOD_INVALID", detail: "dateFrom=..." }, { status: 400 }),
		});

		const error = await rejection(
			connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true),
		);

		expect(error.failure).toEqual({ status: 400, providerCode: "PERIOD_INVALID" });
	});

	it("reads PERIOD_INVALID only as N26 sends it, under `code`", async () => {
		const requests = mockProvider({
			transactions: () => HttpResponse.json({ error: "PERIOD_INVALID" }, { status: 400 }),
		});

		const error = await rejection(
			connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true),
		);

		expect(error.failure).toEqual({ status: 400, providerCode: "PERIOD_INVALID" });
		expect(requests).toHaveLength(1);
	});

	it("retries a later page with its key, and asks the next from the start asked for", async () => {
		const requests = mockProvider({
			transactions: (url) => {
				const key = url.searchParams.get("continuation_key");
				const from = url.searchParams.get("date_from") ?? "";

				if (key === "2" && from < "2026-07-26") {
					return refused({ date_from: "2026-07-26" });
				}

				return HttpResponse.json({
					transactions: [
						line({
							entry_reference: `ref-${key ?? "1"}`,
							transaction_id: `tx-${key ?? "1"}`,
							booking_date: "2026-07-01",
						}),
					],
					continuation_key: key === null ? "2" : key === "2" ? "3" : null,
				});
			},
		});

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(requests.map(({ search }) => search)).toEqual([
			"?date_from=2026-06-26",
			"?date_from=2026-06-26&continuation_key=2",
			"?date_from=2026-07-26&continuation_key=2",
			"?date_from=2026-06-26&continuation_key=3",
		]);
		expect(statement.from).toBe("2026-07-26");
		expect(statement.cutShort).toBeNull();
		expect(statement.transactions.map(({ externalId }) => externalId)).toEqual([
			"ref-1",
			"ref-2",
			"ref-3",
		]);
	});

	it("throws a later page refused for every start with a 400, never cut short", async () => {
		const requests = mockProvider({
			transactions: (url) =>
				url.searchParams.get("continuation_key") === null
					? HttpResponse.json({ transactions: [line()], continuation_key: "2" })
					: refused(undefined, 400),
		});

		const error = await rejection(
			connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true),
		);

		expect(error.failure).toEqual({ status: 400, providerCode: "WRONG_TRANSACTIONS_PERIOD" });
		expect(dateFroms(requests)).toEqual([
			"2026-06-26",
			"2026-06-26",
			"2026-06-27",
			"2026-07-26",
			"2026-08-25",
		]);
	});

	it("fails once the 30-day window is refused too, after four retries at most", async () => {
		const requests = acceptingFrom(null, { date_from: "2026-06-26" });

		const error = await rejection(
			connector.fetchStatement(FIXTURE_CHECKING_UID, "2026-06-01", TODAY, [], true),
		);

		expect(error.code).toBe("BANK_PROVIDER_ERROR");
		expect(error.failure).toEqual({ status: 422, providerCode: "WRONG_TRANSACTIONS_PERIOD" });
		expect(dateFroms(requests)).toEqual([
			"2026-06-01",
			"2026-06-26",
			"2026-06-27",
			"2026-07-26",
			"2026-08-25",
		]);
	});

	it("asks for no longer window than a short one the bank refused", async () => {
		const requests = acceptingFrom(null);

		await expect(
			connector.fetchStatement(FIXTURE_CHECKING_UID, "2026-09-17", TODAY, [], true),
		).rejects.toMatchObject({ code: "BANK_PROVIDER_ERROR" });
		expect(dateFroms(requests)).toEqual(["2026-09-17"]);
	});

	it("skips a fallback that starts no later than the refused window", async () => {
		const requests = acceptingFrom(null);

		await expect(
			connector.fetchStatement(FIXTURE_CHECKING_UID, "2026-07-26", TODAY, [], true),
		).rejects.toMatchObject({ code: "BANK_PROVIDER_ERROR" });
		expect(dateFroms(requests)).toEqual(["2026-07-26", "2026-08-25"]);
	});
});

describe("a line listed twice", () => {
	it("keeps one copy of lines alike in every field but their reference", async () => {
		pages({
			transactions: [
				line({ entry_reference: "ref-1" }),
				line({ entry_reference: "ref-2" }),
				line({ entry_reference: "ref-3", transaction_id: "tx-3" }),
			],
			continuation_key: null,
		});

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(statement.transactions.map(({ externalId }) => externalId)).toEqual(["ref-1", "ref-3"]);
	});

	it("keeps the booked copy of a line also listed as pending", async () => {
		pages({
			transactions: [
				line({ entry_reference: "pending", status: "PDNG" }),
				line({ entry_reference: "booked", status: "BOOK" }),
				line({ entry_reference: "pending-again", status: "PDNG" }),
			],
			continuation_key: null,
		});

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(statement.transactions).toEqual([
			expect.objectContaining({ externalId: "booked", pending: false }),
		]);
	});

	it("tells lines apart by date, amount, currency, both sides, remittance, id and direction", () => {
		const variants = [
			line(),
			line({ booking_date: "2026-09-21" }),
			line({ booking_date: null, value_date: "2026-09-19" }),
			line({ booking_date: null, transaction_date: "2026-09-18" }),
			line({ transaction_amount: { amount: "11.00", currency: "EUR" } }),
			line({ transaction_amount: { amount: "10.00", currency: "USD" } }),
			line({ creditor: { name: "Autre" } }),
			line({ debtor: null }),
			line({ remittance_information: ["CB BOULANGERIE"] }),
			line({ transaction_id: "tx-1" }),
			line({ credit_debit_indicator: "CRDT" }),
			line({ credit_debit_indicator: "OTHR" }),
			line({ credit_debit_indicator: undefined }),
		];

		expect(withoutRepeats(variants).size).toBe(variants.length);
		expect(withoutRepeats([line(), line({ entry_reference: "other" })])).toEqual(new Set([0]));
	});

	it("leaves unreadable, cancelled and informational lines to the mapping", () => {
		expect(
			withoutRepeats([
				42,
				42,
				line({ status: "INFO" }),
				line({ status: "INFO" }),
				line({ status: null }),
				line({ status: null }),
			]),
		).toEqual(new Set([0, 1, 2, 3, 4, 5]));
	});
});

const pending = (extra: Record<string, unknown> = {}) =>
	line({ status: "PDNG", booking_date: null, transaction_date: "2026-09-18", ...extra });

describe("withoutSettledPending", () => {
	it("drops a pending line whose booked version shares its entry reference", () => {
		expect(
			withoutSettledPending([
				line({ entry_reference: "r1", transaction_id: "t2" }),
				pending({ entry_reference: "r1", transaction_id: "t1" }),
			]),
		).toEqual(new Set([0]));
	});

	it("drops a pending line whose booked version shares its transaction id", () => {
		expect(
			withoutSettledPending([
				pending({ entry_reference: "r1", transaction_id: "t1" }),
				line({ entry_reference: "r2", transaction_id: "t1" }),
			]),
		).toEqual(new Set([1]));
	});

	it("drops a pending line with no id equal in content to a booked one", () => {
		const alike = { entry_reference: null, booking_date: "2026-09-20" };

		expect(withoutSettledPending([line(alike), pending(alike)])).toEqual(new Set([0]));
	});

	it("keeps a pending line the booked one shares nothing with", () => {
		expect(
			withoutSettledPending([
				line({ entry_reference: "r2" }),
				pending({ entry_reference: "r1" }),
				pending({ entry_reference: null }),
				line({ entry_reference: null, creditor: { name: "Autre" } }),
			]),
		).toEqual(new Set([0, 1, 2, 3]));
	});

	it("never drops a booked line, nor one it cannot read or of another status", () => {
		expect(
			withoutSettledPending([
				line({ entry_reference: "r1" }),
				line({ entry_reference: "r1" }),
				42,
				line({ entry_reference: "r1", status: "INFO" }),
			]),
		).toEqual(new Set([0, 1, 2, 3]));
	});

	it("keeps only the booked version when the bank lists both", async () => {
		pages({
			transactions: [
				pending({ entry_reference: "r1" }),
				line({ entry_reference: "r1", creditor: { name: "SUPERMARCHE" } }),
			],
			continuation_key: null,
		});

		const statement = await connector.fetchStatement(FIXTURE_CHECKING_UID, SINCE, TODAY, [], true);

		expect(statement.transactions).toEqual([
			expect.objectContaining({ externalId: "r1", pending: false, label: "SUPERMARCHE" }),
		]);
		expect(statement.rejected).toEqual([]);
	});
});

describe("provider failures", () => {
	it("keeps no code from an error body that is not JSON", async () => {
		mockProvider({ aspsps: () => new HttpResponse("<html>Bad gateway</html>", { status: 502 }) });

		const error = await rejection(connector.listInstitutions("FR"));

		expect(error.failure).toEqual({ status: 502, providerCode: null });
	});

	it("keeps no code that does not look like one", async () => {
		mockProvider({
			aspsps: () => HttpResponse.json({ error: "IBAN FR76 0000 refused" }, { status: 422 }),
		});

		const error = await rejection(connector.listInstitutions("FR"));

		expect(error.failure).toEqual({ status: 422, providerCode: null });
	});

	it("reports a request that never got an answer", async () => {
		server.use(http.get(`${TEST_PROVIDER_URL}/aspsps`, () => HttpResponse.error()));

		const error = await rejection(connector.listInstitutions("FR"));

		expect(error.code).toBe("BANK_PROVIDER_ERROR");
		expect(error.failure).toEqual({ status: null, providerCode: null });
	});
});
