import { jwtVerify } from "jose";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "../../../vitest.setup.ts";
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
} from "../../testing/enable-banking.ts";
import { BankProviderError } from "../bank-connector.ts";
import { createBankConnector } from "../registry.ts";
import { consentValidUntil, toBankAccount } from "./client.ts";
import { sessionAccountSchema } from "./schemas.ts";

const NOW = Date.parse("2026-09-24T10:00:00Z");
const DAY = 86_400_000;

// A trailing slash on the URL must not double the one of each path.
const connector = createBankConnector("enable-banking", {
	applicationId: TEST_APPLICATION_ID,
	privateKey: TEST_PRIVATE_KEY,
	apiUrl: `${TEST_PROVIDER_URL}/`,
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

describe("consentValidUntil", () => {
	it("caps the bank's maximum at 90 days", () => {
		expect(consentValidUntil(NOW, 180 * 86_400).getTime()).toBe(NOW + 90 * DAY);
	});

	it("keeps a shorter maximum", () => {
		expect(consentValidUntil(NOW, 30 * 86_400).getTime()).toBe(NOW + 30 * DAY);
	});

	it("asks for 90 days when the bank says nothing", () => {
		expect(consentValidUntil(NOW, null).getTime()).toBe(NOW + 90 * DAY);
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
					access: { valid_until: new Date(NOW + 90 * DAY).toISOString() },
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
			access: { valid_until: new Date(NOW + 30 * DAY).toISOString() },
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
				},
				{
					uid: FIXTURE_CARD_UID,
					identificationHash: "anonymised-hash-card",
					name: "Carte Visa Premier",
					ibanLast4: null,
					currency: "EUR",
					cashAccountType: "CARD",
				},
			],
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

	it("drops an account it cannot read and keeps the others", async () => {
		mockProvider({
			sessions: () =>
				HttpResponse.json({
					session_id: "s",
					access: { valid_until: "2026-12-20T10:00:00Z" },
					accounts: [
						{ uid: "u1", currency: "XXX", name: "Compte en devise inconnue" },
						{ currency: "EUR", name: "Compte sans uid" },
						{ uid: "u2", currency: "EUR", name: "Compte lisible" },
					],
				}),
		});

		const session = await connector.completeAuthorization("the-code");

		expect(session.accounts).toMatchObject([{ uid: "u2", name: "Compte lisible" }]);
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

	it("falls through a label longer than an account name to the next choice", () => {
		expect(account({ details: "x".repeat(101), product: "Livret A" }).name).toBe("Livret A");
		expect(account({ details: "x".repeat(100) }).name).toBe("x".repeat(100));
	});

	it("refuses an unknown currency", () => {
		expect(sessionAccountSchema.safeParse({ uid: "u1", currency: "XXX" }).success).toBe(false);
	});
});

const balances = (...items: Record<string, unknown>[]) =>
	mockProvider({ balances: () => HttpResponse.json({ balances: items }) });

const balance = (type: string, amount: string, extra: Record<string, unknown> = {}) => ({
	balance_amount: { amount, currency: "EUR" },
	balance_type: type,
	...extra,
});

describe("fetchBalance", () => {
	it("reads the interim booked balance before the closing one, as minor units", async () => {
		const requests = mockProvider();

		await expect(connector.fetchBalance(FIXTURE_CHECKING_UID)).resolves.toEqual({
			amount: 123456,
			currency: "EUR",
		});
		expect(requests).toEqual([
			expect.objectContaining({
				method: "GET",
				path: `/accounts/${FIXTURE_CHECKING_UID}/balances`,
			}),
		]);
	});

	it("falls back to the closing booked balance", async () => {
		balances(balance("XPCD", "5.00"), balance("CLBD", "-300.00"));

		await expect(connector.fetchBalance(FIXTURE_CARD_UID)).resolves.toEqual({
			amount: -30000,
			currency: "EUR",
		});
	});

	it("gives nothing when the bank has no booked balance", async () => {
		balances(balance("XPCD", "5.00"));

		await expect(connector.fetchBalance(FIXTURE_CARD_UID)).resolves.toBeNull();
	});

	it("makes a debit balance negative, and leaves a credit one as it is", async () => {
		balances(balance("ITBD", "300.00", { credit_debit_indicator: "DBIT" }));
		await expect(connector.fetchBalance(FIXTURE_CARD_UID)).resolves.toMatchObject({
			amount: -30000,
		});

		balances(balance("ITBD", "300.00", { credit_debit_indicator: "CRDT" }));
		await expect(connector.fetchBalance(FIXTURE_CARD_UID)).resolves.toMatchObject({
			amount: 30000,
		});
	});

	it("refuses an amount with more decimals than its currency, or not a number", async () => {
		balances(balance("ITBD", "12.345"));
		await expect(connector.fetchBalance(FIXTURE_CARD_UID)).rejects.toMatchObject({
			code: "BANK_PROVIDER_ERROR",
		});

		balances(balance("ITBD", "1e3"));
		await expect(connector.fetchBalance(FIXTURE_CARD_UID)).rejects.toMatchObject({
			code: "BANK_PROVIDER_ERROR",
		});
	});

	it("passes a provider failure on", async () => {
		mockProvider({ balances: () => HttpResponse.json(fixtures.unauthorized, { status: 401 }) });

		const error = await rejection(connector.fetchBalance(FIXTURE_CARD_UID));

		expect(error.failure).toEqual({ status: 401, providerCode: "UNAUTHORIZED" });
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
