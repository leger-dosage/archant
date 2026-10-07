import { sql } from "drizzle-orm";
import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createLogger } from "../lib/logger.ts";
import {
	attemptedToday,
	bankApp,
	configuredBank,
	errorBody,
	expense,
	logLines,
	own,
	ownDatabase,
	template,
	useSignedInApp,
} from "../testing/app.ts";
import { buildTestApp, withSession } from "../testing/auth.ts";
import {
	TEST_APPLICATION_ID,
	TEST_ENCRYPTION_KEY_BASE64,
	TEST_PRIVATE_KEY,
	TEST_PROVIDER_URL,
} from "../testing/bank.ts";
import {
	FIXTURE_AUTH_URL,
	FIXTURE_CHECKING_UID,
	FIXTURE_IBAN_HEAD,
	FIXTURE_SESSION_ID,
	fixtures,
	mockProvider,
} from "../testing/enable-banking.ts";

useSignedInApp();

async function connectedApp() {
	const requests = mockProvider();
	const app = await bankApp();
	const client = testClient(app).api["bank-connections"];
	await client.$post({ json: { country: "FR", institution: "Banque Test" } });
	const { state } = z
		.object({ state: z.string() })
		.parse(requests.find((sent) => sent.path === "/auth")?.body);
	const completed = await client.callback.$post({ json: { code: "the-code", state } });
	const connection = (await completed.json()).data;
	await attemptedToday(connection.id);

	return { app, client, connection };
}

describe("/api/bank-connections", () => {
	it("connects a bank: list, start, callback, then the list of connections", async () => {
		const requests = mockProvider();
		const client = testClient(await bankApp()).api["bank-connections"];

		const setup = await client.setup.$get();
		expect(await setup.json()).toEqual({
			data: {
				available: true,
				source: "environment",
				applicationId: TEST_APPLICATION_ID,
				redirectUrl: "http://localhost:5173/settings/banks/callback",
				locked: false,
				missing: [],
			},
		});

		const institutions = await client.institutions.$get({ query: { country: "FR" } });
		expect(institutions.status).toBe(200);
		const offered = (await institutions.json()).data;
		expect(offered.map((institution) => institution.name)).toEqual([
			"Banque Test",
			"Caisse Sans Limite",
			"Crédit Exemple",
		]);
		expect(offered[0]).toEqual({
			name: "Banque Test",
			country: "FR",
			logo: "https://enablebanking.com/brands/FR/Banque%20Test/",
			bic: "BTSTFRPP",
		});

		const started = await client.$post({
			json: { country: "FR", institution: "Banque Test" },
		});
		expect(started.status).toBe(200);
		expect(await started.json()).toEqual({ data: { url: FIXTURE_AUTH_URL } });

		const auth = requests.find((sent) => sent.path === "/auth");
		const { state } = z.object({ state: z.string() }).parse(auth?.body);
		const completed = await client.callback.$post({ json: { code: "the-code", state } });
		expect(completed.status).toBe(200);
		const connection = (await completed.json()).data;
		expect(connection).toMatchObject({ institutionName: "Banque Test", status: "active" });
		await attemptedToday(connection.id);

		const list = await client.$get();
		const body = await list.text();
		expect(JSON.parse(body)).toEqual({ data: [connection] });
		expect(body).not.toContain(FIXTURE_SESSION_ID);
		expect(logLines.join("")).not.toContain(FIXTURE_SESSION_ID);

		const stored = await own?.db.all<{ sessionId: string }>(
			sql`select session_id as sessionId from bank_connections`,
		);
		expect(stored?.[0]?.sessionId).toMatch(/^v1:/u);
	});

	it("answers a replayed callback with BANK_AUTHORIZATION_INVALID", async () => {
		const requests = mockProvider();
		const client = testClient(await bankApp()).api["bank-connections"];
		await client.$post({ json: { country: "FR", institution: "Banque Test" } });
		const { state } = z
			.object({ state: z.string() })
			.parse(requests.find((sent) => sent.path === "/auth")?.body);
		await client.callback.$post({ json: { code: "the-code", state } });

		const replayed = await client.callback.$post({ json: { code: "the-code", state } });

		expect(replayed.status).toBe(400);
		expect(errorBody.parse(await replayed.json()).error.code).toBe("BANK_AUTHORIZATION_INVALID");
	});

	it("answers a refused redirect with BANK_REDIRECT_NOT_ALLOWED and the URL to register", async () => {
		mockProvider({
			auth: () =>
				Response.json({ error: "REDIRECT_URI_NOT_ALLOWED", message: "nope" }, { status: 400 }),
		});
		const client = testClient(await bankApp()).api["bank-connections"];

		const response = await client.$post({
			json: { country: "FR", institution: "Banque Test" },
		});

		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({
			error: {
				code: "BANK_REDIRECT_NOT_ALLOWED",
				message: "Register the redirect URL in the Enable Banking control panel.",
				params: { url: "http://localhost:5173/settings/banks/callback" },
			},
		});
	});

	it("refuses a country Sure does not offer, an empty bank name and an empty code", async () => {
		const app = await bankApp();

		const country = await app.request("/api/bank-connections/institutions?country=US");
		expect(country.status).toBe(400);
		expect(errorBody.parse(await country.json()).error.fields).toEqual([
			{ path: "country", code: "invalid_value" },
		]);

		const blank = await testClient(app).api["bank-connections"].$post({
			json: { country: "FR", institution: "  " },
		});
		expect(blank.status).toBe(400);
		expect(errorBody.parse(await blank.json()).error.fields).toEqual([
			{ path: "institution", code: "too_small" },
		]);

		const noCode = await testClient(app).api["bank-connections"].callback.$post({
			json: { code: "", state: "s" },
		});
		expect(noCode.status).toBe(400);
		expect(errorBody.parse(await noCode.json()).error.fields).toEqual([
			{ path: "code", code: "too_small" },
		]);
	});

	it("saves credentials from the interface, then connects with them, never returning the key", async () => {
		const requests = mockProvider();
		const app = await bankApp({
			bankCredentials: null,
			encryptionKey: Buffer.from(TEST_ENCRYPTION_KEY_BASE64, "base64"),
			bankApiUrl: TEST_PROVIDER_URL,
		});
		const client = testClient(app).api["bank-connections"];
		const pem = TEST_PRIVATE_KEY.export({ type: "pkcs1", format: "pem" }).toString();

		const before = await client.setup.$get();
		expect((await before.json()).data).toMatchObject({ available: false, source: null });
		expect((await client.$get()).status).toBe(503);

		const saved = await client.credentials.$put({
			json: { applicationId: ` ${TEST_APPLICATION_ID} `, privateKey: pem },
		});
		expect(saved.status).toBe(200);
		const body = await saved.text();
		expect(JSON.parse(body)).toEqual({
			data: {
				available: true,
				source: "interface",
				applicationId: TEST_APPLICATION_ID,
				redirectUrl: "http://localhost:5173/settings/banks/callback",
				locked: false,
				missing: [],
			},
		});
		expect(body).not.toContain("PRIVATE KEY");
		expect(requests.map((sent) => sent.path)).toEqual(["/application"]);

		const institutions = await client.institutions.$get({ query: { country: "FR" } });
		expect(institutions.status).toBe(200);

		const stored = await own?.db.all<{ key: string; value: string }>(
			sql`select key, value from settings where key like 'enable_banking_%' order by key`,
		);
		expect(stored?.map((row) => row.key)).toEqual([
			"enable_banking_application_id",
			"enable_banking_private_key",
		]);
		expect(stored?.[0]?.value).toBe(TEST_APPLICATION_ID);
		expect(stored?.[1]?.value).toMatch(/^v1:/u);
		expect(logLines.join("")).not.toContain("PRIVATE KEY");
	});

	it("refuses to save credentials the server pins, a pair the provider refuses, or no key at all", async () => {
		const pem = TEST_PRIVATE_KEY.export({ type: "pkcs8", format: "pem" }).toString();
		const put = (app: Awaited<ReturnType<typeof bankApp>>, privateKey = pem) =>
			testClient(app).api["bank-connections"].credentials.$put({
				json: { applicationId: TEST_APPLICATION_ID, privateKey },
			});
		const interfaceBank = {
			bankCredentials: null,
			encryptionKey: Buffer.from(TEST_ENCRYPTION_KEY_BASE64, "base64"),
			bankApiUrl: TEST_PROVIDER_URL,
		};

		mockProvider();
		const fromEnvironment = await put(await bankApp());
		expect(fromEnvironment.status).toBe(409);
		expect(errorBody.parse(await fromEnvironment.json()).error.code).toBe(
			"BANK_CREDENTIALS_FROM_ENVIRONMENT",
		);

		const noEncryption = await put(await bankApp({ ...interfaceBank, encryptionKey: null }));
		expect(noEncryption.status).toBe(503);
		expect(errorBody.parse(await noEncryption.json()).error.code).toBe(
			"BANK_CONNECTOR_UNAVAILABLE",
		);

		const notAKey = await put(await bankApp(interfaceBank), "hello");
		expect(notAKey.status).toBe(400);
		expect(errorBody.parse(await notAKey.json()).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "privateKey", code: "invalid_private_key" }],
		});

		const blank = await testClient(await bankApp(interfaceBank)).api[
			"bank-connections"
		].credentials.$put({ json: { applicationId: " ", privateKey: pem } });
		expect(errorBody.parse(await blank.json()).error.fields).toEqual([
			{ path: "applicationId", code: "too_small" },
		]);

		mockProvider({
			application: () => Response.json(fixtures.unauthorized, { status: 401 }),
		});
		const refusedApp = await bankApp(interfaceBank);
		const refused = await put(refusedApp);
		expect(refused.status).toBe(400);
		expect(errorBody.parse(await refused.json()).error.code).toBe("BANK_CREDENTIALS_REFUSED");
		await expect(
			own?.db.all(sql`select key from settings where key like 'enable_banking_%'`),
		).resolves.toEqual([]);
	});

	it("names the missing variables and answers 503 elsewhere, while accounts still answer", async () => {
		const app = await bankApp({
			...configuredBank(),
			encryptionKey: null,
		});
		const client = testClient(app).api;

		const setup = await client["bank-connections"].setup.$get();
		expect(await setup.json()).toEqual({
			data: {
				available: false,
				source: "environment",
				applicationId: TEST_APPLICATION_ID,
				redirectUrl: "http://localhost:5173/settings/banks/callback",
				locked: false,
				missing: ["ENCRYPTION_KEY"],
			},
		});

		const refused = await Promise.all([
			app.request("/api/bank-connections"),
			// Refused before its query is read: no field error for an unknown country.
			app.request("/api/bank-connections/institutions?country=US"),
			app.request("/api/bank-connections", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ country: "FR", institution: "Banque Test" }),
			}),
			app.request("/api/bank-connections/callback", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code: "c", state: "s" }),
			}),
		]);

		expect(refused.map((response) => response.status)).toEqual([503, 503, 503, 503]);
		const codes = await Promise.all(
			refused.map(async (response) => errorBody.parse(await response.json()).error.code),
		);
		expect(new Set(codes)).toEqual(new Set(["BANK_CONNECTOR_UNAVAILABLE"]));

		const accounts = await client.accounts.$get();
		expect(accounts.status).toBe(200);
	});

	it("answers UNAUTHORIZED without a session, the callback included", async () => {
		const database = await ownDatabase();
		const app = buildTestApp(database.db, createLogger("silent"), undefined, {}, configuredBank());

		const responses = await Promise.all([
			app.request("/api/bank-connections/setup"),
			app.request("/api/bank-connections"),
			app.request("/api/bank-connections/callback", {
				method: "POST",
				headers: { "content-type": "application/json", origin: "http://localhost:5173" },
				body: JSON.stringify({ code: "c", state: "s" }),
			}),
			app.request("/api/bank-connections/c1/accounts"),
			app.request("/api/bank-connections/c1/accounts", {
				method: "POST",
				headers: { "content-type": "application/json", origin: "http://localhost:5173" },
				body: JSON.stringify({ links: [] }),
			}),
		]);

		expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
	});

	it("renews a connection's consent, then disconnects it", async () => {
		const { client, connection } = await connectedApp();
		const requests = mockProvider();

		const renewed = await client[":id"].renew.$post({ param: { id: connection.id } });

		expect(renewed.status).toBe(200);
		expect(await renewed.json()).toEqual({ data: { url: FIXTURE_AUTH_URL } });
		const renewing = (await (await client.$get()).json()).data;
		expect(renewing).toEqual([
			expect.objectContaining({ id: connection.id, status: "active", alert: null }),
		]);

		const removed = await client[":id"].$delete({ param: { id: connection.id } });

		expect(removed.status).toBe(200);
		expect(await removed.json()).toEqual({ data: { id: connection.id, accounts: 0 } });
		expect(requests.map(({ method, path }) => `${method} ${path}`)).toContain(
			`DELETE /sessions/${FIXTURE_SESSION_ID}`,
		);
		expect((await (await client.$get()).json()).data).toEqual([]);

		const again = await client[":id"].$delete({ param: { id: connection.id } });
		expect(again.status).toBe(404);
		expect(errorBody.parse(await again.json()).error.code).toBe("NOT_FOUND");
	});

	it("guards renewal and disconnection with the session and the origin check", async () => {
		const database = await ownDatabase();
		const app = buildTestApp(database.db, createLogger("silent"), undefined, {}, configuredBank());
		const foreign = withSession(
			buildTestApp(database.db, createLogger("silent"), undefined, {}, configuredBank()),
			template.cookie,
		);

		const responses = await Promise.all([
			app.request("/api/bank-connections/c1/renew", {
				method: "POST",
				headers: { origin: "http://localhost:5173" },
			}),
			app.request("/api/bank-connections/c1", {
				method: "DELETE",
				headers: { origin: "http://localhost:5173" },
			}),
			foreign.request("/api/bank-connections/c1/renew", {
				method: "POST",
				headers: { origin: "https://attacker.example" },
			}),
			foreign.request("/api/bank-connections/c1", {
				method: "DELETE",
				headers: { origin: "https://attacker.example" },
			}),
		]);

		expect(responses.map((response) => response.status)).toEqual([401, 401, 403, 403]);
		expect(errorBody.parse(await responses[3]?.json()).error.code).toBe("ORIGIN_MISMATCH");
	});

	it("lists a connection's bank accounts, then creates one from the bank", async () => {
		const { app, client, connection } = await connectedApp();

		const listResponse = await client[":id"].accounts.$get({ param: { id: connection.id } });
		expect(listResponse.status).toBe(200);
		const rows = (await listResponse.json()).data;
		expect(JSON.stringify(rows)).not.toContain(FIXTURE_CHECKING_UID);
		expect(JSON.stringify(rows)).not.toContain(FIXTURE_IBAN_HEAD);
		const checking = rows.find((row) => row.name === "Compte courant");
		expect(checking).toMatchObject({
			ibanLast4: "0185",
			currency: "EUR",
			suggestion: { type: "depository", subtype: "checking" },
			account: null,
			candidates: [],
		});

		const linked = await client[":id"].accounts.$post({
			param: { id: connection.id },
			json: {
				links: [
					{
						bankAccountId: checking?.id ?? "",
						action: "create",
						type: "depository",
						subtype: "checking",
					},
				],
			},
		});
		expect(linked.status).toBe(200);
		const after = (await linked.json()).data.find((row) => row.id === checking?.id);
		expect(after?.account).toMatchObject({ name: "Compte courant" });

		const account = await testClient(app).api.accounts[":id"].$get({
			param: { id: after?.account?.id ?? "" },
		});
		expect(await account.json()).toMatchObject({ data: { balance: 123456 } });
	});

	it("refuses a start date that is not a day, naming the field, and links nothing", async () => {
		const { client, connection } = await connectedApp();
		const rows = (
			await (await client[":id"].accounts.$get({ param: { id: connection.id } })).json()
		).data;
		const checking = rows.find((row) => row.name === "Compte courant");

		const response = await client[":id"].accounts.$post({
			param: { id: connection.id },
			json: {
				links: [
					{
						bankAccountId: checking?.id ?? "",
						action: "create",
						type: "depository",
						subtype: "checking",
					},
				],
				syncStartDate: "2025-02-30",
			},
		});

		expect(response.status).toBe(400);
		expect(errorBody.parse(await response.json()).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "syncStartDate", code: "invalid_format" }],
		});
		const after = (
			await (await client[":id"].accounts.$get({ param: { id: connection.id } })).json()
		).data;
		expect(after.find((row) => row.id === checking?.id)?.account).toBeNull();
	});

	it("names a linked account's connection, and refuses to delete it until disconnected", async () => {
		const { app, client, connection } = await connectedApp();
		const rows = (
			await (await client[":id"].accounts.$get({ param: { id: connection.id } })).json()
		).data;
		const checking = rows.find((row) => row.name === "Compte courant");
		const linked = await client[":id"].accounts.$post({
			param: { id: connection.id },
			json: {
				links: [
					{
						bankAccountId: checking?.id ?? "",
						action: "create",
						type: "depository",
						subtype: "checking",
					},
				],
			},
		});
		const accountId =
			(await linked.json()).data.find((row) => row.id === checking?.id)?.account?.id ?? "";
		const accounts = testClient(app).api.accounts[":id"];
		const total = async () =>
			(await (await accounts.transactions.$get({ param: { id: accountId }, query: {} })).json())
				.data.total;
		// Linking syncs nothing yet: one line typed by hand gives the delete something to lose.
		const added = await accounts.transactions.$post({ param: { id: accountId }, json: expense });
		expect(added.status).toBe(201);
		const totalBefore = await total();

		const detail = await accounts.$get({ param: { id: accountId } });
		expect((await detail.json()).data).toMatchObject({
			bankConnection: { id: connection.id, institutionName: "Banque Test" },
		});

		const refused = await accounts.$delete({ param: { id: accountId } });

		expect(refused.status).toBe(409);
		expect(errorBody.parse(await refused.json()).error.code).toBe("ACCOUNT_LINKED");
		const still = await accounts.$get({ param: { id: accountId } });
		expect(still.status).toBe(200);
		expect((await still.json()).data).toMatchObject({
			balance: 123456,
			bankConnection: { id: connection.id },
		});
		expect(totalBefore).toBeGreaterThan(0);
		await expect(total()).resolves.toBe(totalBefore);
		const after = (
			await (await client[":id"].accounts.$get({ param: { id: connection.id } })).json()
		).data.find((row) => row.id === checking?.id);
		expect(after?.account).toMatchObject({ id: accountId });

		mockProvider();
		await client[":id"].$delete({ param: { id: connection.id } });
		const unlinked = await accounts.$get({ param: { id: accountId } });
		expect((await unlinked.json()).data).toMatchObject({ bankConnection: null });

		const deleted = await accounts.$delete({ param: { id: accountId } });

		expect(deleted.status).toBe(200);
		expect(await deleted.json()).toEqual({ data: { id: accountId } });
	});

	it("refuses a type no bank account becomes, an empty list and an unknown connection", async () => {
		const { app, client, connection } = await connectedApp();

		const investment = await app.request(`/api/bank-connections/${connection.id}/accounts`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				links: [{ bankAccountId: "b1", action: "create", type: "investment", subtype: "pea" }],
			}),
		});
		expect(investment.status).toBe(400);
		expect(errorBody.parse(await investment.json()).error.fields).toEqual([
			{ path: "links.0.subtype", code: "invalid_subtype" },
		]);

		const empty = await client[":id"].accounts.$post({
			param: { id: connection.id },
			json: { links: [] },
		});
		expect(empty.status).toBe(400);

		const unknown = await client[":id"].accounts.$get({ param: { id: "nope" } });
		expect(unknown.status).toBe(404);
		expect(errorBody.parse(await unknown.json()).error.code).toBe("NOT_FOUND");
	});

	it("answers 503 on a connection's accounts while unconfigured", async () => {
		const app = await bankApp({
			...configuredBank(),
			encryptionKey: null,
		});

		const responses = await Promise.all([
			app.request("/api/bank-connections/c1/accounts"),
			app.request("/api/bank-connections/c1/accounts", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ links: [] }),
			}),
		]);

		expect(responses.map((response) => response.status)).toEqual([503, 503]);
	});

	it("answers BANK_PROVIDER_ERROR when the bank's balance cannot be read", async () => {
		const { client, connection } = await connectedApp();
		const rows = (
			await (await client[":id"].accounts.$get({ param: { id: connection.id } })).json()
		).data;
		mockProvider({ balances: () => Response.json({ error: "ASPSP_ERROR" }, { status: 500 }) });

		const response = await client[":id"].accounts.$post({
			param: { id: connection.id },
			json: {
				links: rows.map((row) => ({
					bankAccountId: row.id,
					action: "create" as const,
					type: "credit_card" as const,
					subtype: null,
				})),
			},
		});

		expect(response.status).toBe(502);
		expect(errorBody.parse(await response.json()).error.code).toBe("BANK_PROVIDER_ERROR");
	});
});
