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
	linkedConnection,
	logLines,
	own,
	ownDatabase,
	template,
	useSignedInApp,
} from "../testing/app.ts";
import { addViewer, buildTestApp, createTestAuth, withSession } from "../testing/auth.ts";
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

const fieldsOf = async (response: Response) => errorBody.parse(await response.json()).error;

async function connectedApp() {
	const requests = mockProvider();
	const app = await bankApp();
	const client = testClient(app).api["bank-connections"];
	await client.$post({ json: { institution: "Banque Test" } });
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
				country: "FR",
				redirectUrl: "http://localhost:5173/settings/banks/callback",
				locked: false,
				missing: [],
			},
		});

		const institutions = await client.institutions.$get();
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
			json: { institution: "Banque Test" },
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
		await client.$post({ json: { institution: "Banque Test" } });
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
			json: { institution: "Banque Test" },
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

	it("refuses an empty bank name and an empty code", async () => {
		const app = await bankApp();

		const blank = await testClient(app).api["bank-connections"].$post({
			json: { institution: "  " },
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
		expect((await client.institutions.$get()).status).toBe(503);

		const saved = await client.credentials.$put({
			json: { country: "BE", applicationId: ` ${TEST_APPLICATION_ID} `, privateKey: pem },
		});
		expect(saved.status).toBe(200);
		const body = await saved.text();
		expect(JSON.parse(body)).toEqual({
			data: {
				available: true,
				source: "interface",
				applicationId: TEST_APPLICATION_ID,
				country: "BE",
				redirectUrl: "http://localhost:5173/settings/banks/callback",
				locked: false,
				missing: [],
			},
		});
		expect(body).not.toContain("PRIVATE KEY");
		expect(requests.map((sent) => sent.path)).toEqual(["/application"]);

		const institutions = await client.institutions.$get();
		expect(institutions.status).toBe(200);
		const started = await client.$post({ json: { institution: "Banque Test" } });
		expect(started.status).toBe(200);
		expect(requests.filter((sent) => sent.path === "/aspsps").map((sent) => sent.search)).toEqual([
			"?country=BE",
			"?country=BE",
		]);

		const stored = await own?.db.all<{ key: string; value: string }>(
			sql`select key, value from settings where key like 'enable_banking_%' order by key`,
		);
		expect(stored?.map((row) => row.key)).toEqual([
			"enable_banking_application_id",
			"enable_banking_country",
			"enable_banking_private_key",
		]);
		expect(stored?.[0]?.value).toBe(TEST_APPLICATION_ID);
		expect(stored?.[1]?.value).toBe("BE");
		expect(stored?.[2]?.value).toMatch(/^v1:/u);
		expect(logLines.join("")).not.toContain("PRIVATE KEY");
	});

	it("refuses to save credentials the server pins, a pair the provider refuses, or no key at all", async () => {
		const pem = TEST_PRIVATE_KEY.export({ type: "pkcs8", format: "pem" }).toString();
		const put = (app: Awaited<ReturnType<typeof bankApp>>, privateKey = pem) =>
			testClient(app).api["bank-connections"].credentials.$put({
				json: { country: "FR", applicationId: TEST_APPLICATION_ID, privateKey },
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
		].credentials.$put({ json: { country: "FR", applicationId: " ", privateKey: pem } });
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

	it("saves the country alone over saved credentials, a bank connected, and names what a partial pair lacks", async () => {
		const interfaceBank = {
			bankCredentials: null,
			encryptionKey: Buffer.from(TEST_ENCRYPTION_KEY_BASE64, "base64"),
			bankApiUrl: TEST_PROVIDER_URL,
		};
		const requests = mockProvider();
		const client = testClient(await bankApp(interfaceBank)).api["bank-connections"];
		const pem = TEST_PRIVATE_KEY.export({ type: "pkcs8", format: "pem" }).toString();

		const nothingSaved = await client.credentials.$put({ json: { country: "DE" } });
		expect(nothingSaved.status).toBe(400);
		expect(await fieldsOf(nothingSaved)).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [
				{ path: "applicationId", code: "too_small" },
				{ path: "privateKey", code: "too_small" },
			],
		});

		const idAlone = await client.credentials.$put({
			json: { country: "FR", applicationId: TEST_APPLICATION_ID },
		});
		expect((await fieldsOf(idAlone)).fields).toEqual([{ path: "privateKey", code: "too_small" }]);

		const keyAlone = await client.credentials.$put({ json: { country: "FR", privateKey: pem } });
		expect(keyAlone.status).toBe(400);
		expect((await fieldsOf(keyAlone)).fields).toEqual([
			{ path: "applicationId", code: "too_small" },
		]);

		const unknown = await client.credentials.$put({
			// @ts-expect-error -- a country Sure does not offer, as a hand-made request sends it.
			json: { country: "US", applicationId: TEST_APPLICATION_ID, privateKey: pem },
		});
		expect((await fieldsOf(unknown)).fields).toEqual([{ path: "country", code: "invalid_value" }]);
		await expect(
			own?.db.all(sql`select key from settings where key like 'enable_banking_%'`),
		).resolves.toEqual([]);

		await client.credentials.$put({
			json: { country: "FR", applicationId: TEST_APPLICATION_ID, privateKey: pem },
		});
		await client.$post({ json: { institution: "Banque Test" } });
		const { state } = z
			.object({ state: z.string() })
			.parse(requests.find((sent) => sent.path === "/auth")?.body);
		const connection = (await (await client.callback.$post({ json: { code: "c", state } })).json())
			.data;
		await attemptedToday(connection.id);

		const newPair = await client.credentials.$put({
			json: { country: "DE", applicationId: TEST_APPLICATION_ID, privateKey: pem },
		});
		expect(newPair.status).toBe(409);
		expect((await fieldsOf(newPair)).code).toBe("BANK_CREDENTIALS_LOCKED");

		const countryAlone = await client.credentials.$put({ json: { country: "DE" } });
		expect(countryAlone.status).toBe(200);
		expect((await countryAlone.json()).data).toMatchObject({
			applicationId: TEST_APPLICATION_ID,
			country: "DE",
			locked: true,
		});
		const list = (await (await client.$get()).json()).data;
		expect(list).toEqual([expect.objectContaining({ id: connection.id, country: "FR" })]);
		requests.length = 0;
		await client.institutions.$get();
		expect(requests.map((sent) => sent.path + sent.search)).toEqual(["/aspsps?country=DE"]);
	});

	it("removes the credentials: every bank disconnected, its accounts manual, attempts dropped", async () => {
		const interfaceBank = {
			bankCredentials: null,
			encryptionKey: Buffer.from(TEST_ENCRYPTION_KEY_BASE64, "base64"),
			bankApiUrl: TEST_PROVIDER_URL,
		};
		const app = await bankApp(interfaceBank);
		const client = testClient(app).api["bank-connections"];
		mockProvider();
		await client.credentials.$put({
			json: {
				country: "BE",
				applicationId: TEST_APPLICATION_ID,
				privateKey: TEST_PRIVATE_KEY.export({ type: "pkcs8", format: "pem" }).toString(),
			},
		});
		const { accountId } = await linkedConnection(app);
		const requests = mockProvider();
		await client.$post({ json: { institution: "Banque Test" } });
		const { state } = z
			.object({ state: z.string() })
			.parse(requests.find((sent) => sent.path === "/auth")?.body);
		const second = (await (await client.callback.$post({ json: { code: "c", state } })).json())
			.data;
		await attemptedToday(second.id);
		await client.$post({ json: { institution: "Banque Test" } });
		await expect(
			own?.db.all(sql`select status from bank_connections order by status`),
		).resolves.toEqual([{ status: "active" }, { status: "active" }, { status: "pending" }]);
		requests.length = 0;

		const removed = await client.credentials.$delete();

		expect(removed.status).toBe(200);
		expect((await removed.json()).data).toMatchObject({
			available: false,
			source: null,
			applicationId: null,
			country: null,
			locked: false,
		});
		expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
			`DELETE /sessions/${FIXTURE_SESSION_ID}`,
			`DELETE /sessions/${FIXTURE_SESSION_ID}`,
		]);
		await expect(own?.db.all(sql`select id from bank_connections`)).resolves.toEqual([]);
		await expect(
			own?.db.all(sql`select key from settings where key like 'enable_banking_%'`),
		).resolves.toEqual([]);
		const account = await testClient(app).api.accounts[":id"].$get({ param: { id: accountId } });
		expect((await account.json()).data).toMatchObject({ balance: 123456, bankConnection: null });
	});

	it("refuses a viewer's removal, and removes credentials without ENCRYPTION_KEY", async () => {
		const silent = createLogger("silent");
		const interfaceBank = {
			bankCredentials: null,
			encryptionKey: null,
			bankApiUrl: TEST_PROVIDER_URL,
		};
		await bankApp(interfaceBank);
		const database = own;

		if (database === undefined) {
			throw new Error("bankApp opens the test's own database.");
		}

		await database.db.run(
			sql`insert into settings (key, value, updated_at) values ('enable_banking_application_id', 'app', 1), ('enable_banking_private_key', 'v1:key', 1), ('enable_banking_country', 'FR', 1)`,
		);
		const stored = () =>
			database.db.all(sql`select key from settings where key like 'enable_banking_%'`);
		const auth = createTestAuth(database.db, silent);
		const viewerCookie = await addViewer(
			buildTestApp(database.db, silent, auth, {}, interfaceBank),
			auth,
		);
		const viewer = withSession(
			buildTestApp(database.db, silent, auth, {}, interfaceBank),
			viewerCookie,
		);

		const refused = await viewer.request("/api/bank-connections/credentials", {
			method: "DELETE",
		});
		expect(refused.status).toBe(403);
		expect(errorBody.parse(await refused.json()).error.code).toBe("FORBIDDEN");
		await expect(stored()).resolves.toHaveLength(3);

		const admin = withSession(
			buildTestApp(database.db, silent, auth, {}, interfaceBank),
			template.cookie,
		);
		const removed = await testClient(admin).api["bank-connections"].credentials.$delete();
		expect(removed.status).toBe(200);
		expect((await removed.json()).data).toMatchObject({
			source: null,
			missing: ["ENCRYPTION_KEY"],
		});
		await expect(stored()).resolves.toEqual([]);
	});

	it("keeps the credentials while a sync runs, and those the server pins", async () => {
		const pinned = await connectedApp();
		const fromEnvironment = await pinned.client.credentials.$delete();
		expect(fromEnvironment.status).toBe(409);
		expect(errorBody.parse(await fromEnvironment.json()).error.code).toBe(
			"BANK_CREDENTIALS_FROM_ENVIRONMENT",
		);
		await expect(own?.db.all(sql`select id from bank_connections`)).resolves.toHaveLength(1);

		const app = await bankApp({
			bankCredentials: null,
			encryptionKey: Buffer.from(TEST_ENCRYPTION_KEY_BASE64, "base64"),
			bankApiUrl: TEST_PROVIDER_URL,
		});
		const client = testClient(app).api["bank-connections"];
		mockProvider();
		await client.credentials.$put({
			json: {
				country: "FR",
				applicationId: TEST_APPLICATION_ID,
				privateKey: TEST_PRIVATE_KEY.export({ type: "pkcs8", format: "pem" }).toString(),
			},
		});
		const { connection } = await linkedConnection(app);
		await own?.db.run(
			sql`update bank_connections set sync_started_at = ${Date.now()} where id = ${connection.id}`,
		);
		const requests = mockProvider();

		const refused = await client.credentials.$delete();

		expect(refused.status).toBe(409);
		expect(errorBody.parse(await refused.json()).error.code).toBe("SYNC_IN_PROGRESS");
		expect(requests).toEqual([]);
		await expect(own?.db.all(sql`select id from bank_connections`)).resolves.toHaveLength(1);
		await expect(
			own?.db.all(sql`select key from settings where key like 'enable_banking_%'`),
		).resolves.toHaveLength(3);
	});

	it("names the missing variables, lists and disconnects, and answers 503 elsewhere, while accounts still answer", async () => {
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
				country: "FR",
				redirectUrl: "http://localhost:5173/settings/banks/callback",
				locked: false,
				missing: ["ENCRYPTION_KEY"],
			},
		});

		// A connection stays listed and can be disconnected without its connector.
		const list = await client["bank-connections"].$get();
		expect(list.status).toBe(200);
		expect(await list.json()).toEqual({ data: [] });
		const answered = await Promise.all([
			app.request("/api/bank-connections/c1/accounts"),
			app.request("/api/bank-connections/c1", { method: "DELETE" }),
		]);
		expect(answered.map((response) => response.status)).toEqual([404, 404]);

		const refused = await Promise.all([
			app.request("/api/bank-connections/c1/sync", { method: "POST" }),
			app.request("/api/bank-connections/c1/renew", { method: "POST" }),
			app.request("/api/bank-connections/institutions"),
			// Refused before its body is read: no field error for an empty name.
			app.request("/api/bank-connections", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ institution: "" }),
			}),
			app.request("/api/bank-connections/callback", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code: "c", state: "s" }),
			}),
		]);

		expect(refused.map((response) => response.status)).toEqual([503, 503, 503, 503, 503]);
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

	it("lists a connection's accounts while unconfigured, and refuses to link them", async () => {
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

		expect(responses.map((response) => response.status)).toEqual([404, 503]);
	});

	it("lists and disconnects a connection after ENCRYPTION_KEY is lost, revoking nothing", async () => {
		const { connection } = await connectedApp();
		const requests = mockProvider();
		const database = own;

		if (database === undefined) {
			throw new Error("connectedApp opens the test's own database.");
		}

		const client = testClient(
			withSession(
				buildTestApp(
					database.db,
					createLogger("silent"),
					undefined,
					{},
					{
						...configuredBank(),
						encryptionKey: null,
					},
				),
				template.cookie,
			),
		).api["bank-connections"];

		const list = await client.$get();
		expect(list.status).toBe(200);
		expect((await list.json()).data).toEqual([expect.objectContaining({ id: connection.id })]);
		const accounts = await client[":id"].accounts.$get({ param: { id: connection.id } });
		expect(accounts.status).toBe(200);
		expect((await accounts.json()).data).not.toEqual([]);
		const removed = await client[":id"].$delete({ param: { id: connection.id } });
		expect(removed.status).toBe(200);
		expect(await removed.json()).toEqual({ data: { id: connection.id, accounts: 0 } });
		expect(requests).toEqual([]);
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

const storedAddress = async () =>
	own?.db.all<{ address: string | null }>(
		sql`select psu_ip_address as address from bank_connections`,
	);

describe("the browser's address for the bank", () => {
	it("stores the TCP peer at the start, whatever the client claims, and never returns it", async () => {
		const requests = mockProvider();
		const app = await bankApp(configuredBank(), { peer: "203.0.113.7" });

		const started = await app.request("/api/bank-connections", {
			method: "POST",
			headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.1" },
			body: JSON.stringify({ institution: "Banque Test" }),
		});

		expect(started.status).toBe(200);
		await expect(storedAddress()).resolves.toEqual([{ address: "203.0.113.7" }]);

		const { state } = z
			.object({ state: z.string() })
			.parse(requests.find((sent) => sent.path === "/auth")?.body);
		const completed = await testClient(app).api["bank-connections"].callback.$post({
			json: { code: "the-code", state },
		});
		const listed = await testClient(app).api["bank-connections"].$get();

		expect(JSON.stringify(await completed.json())).not.toContain("203.0.113.7");
		expect(JSON.stringify(await listed.json())).not.toContain("203.0.113.7");
		expect(logLines.join("\n")).not.toContain("203.0.113.7");
		expect(requests.every(({ psuIpAddress }) => psuIpAddress === null)).toBe(true);
	});

	it("reads the client past a trusted proxy at the callback, an IPv6 address kept whole", async () => {
		const requests = mockProvider();
		const app = await bankApp(configuredBank(), {
			peer: "127.0.0.1",
			trustedProxies: ["127.0.0.1"],
		});
		const client = testClient(app).api["bank-connections"];
		await client.$post(
			{ json: { institution: "Banque Test" } },
			{ headers: { "x-forwarded-for": "203.0.113.7" } },
		);
		await expect(storedAddress()).resolves.toEqual([{ address: "203.0.113.7" }]);
		const { state } = z
			.object({ state: z.string() })
			.parse(requests.find((sent) => sent.path === "/auth")?.body);

		await client.callback.$post(
			{ json: { code: "the-code", state } },
			{ headers: { "x-forwarded-for": "2001:db8:1:2:3:4:5:6" } },
		);

		await expect(storedAddress()).resolves.toEqual([
			{ address: "2001:0db8:0001:0002:0003:0004:0005:0006" },
		]);
	});

	it("stores none from an in-process request", async () => {
		mockProvider();
		const client = testClient(await bankApp()).api["bank-connections"];

		await client.$post({ json: { institution: "Banque Test" } });

		await expect(storedAddress()).resolves.toEqual([{ address: null }]);
	});
});

describe("/api/bank-connections/settings", () => {
	it("reads Sure's defaults, then saves the three settings and reads them back", async () => {
		const client = testClient(await bankApp()).api["bank-connections"];

		const initial = await client.settings.$get();
		expect(initial.status).toBe(200);
		expect(await initial.json()).toEqual({
			data: { includePending: true, autoSyncEnabled: true, autoSyncTime: "02:22" },
		});

		const off = await client.settings.$put({
			json: { includePending: false, autoSyncEnabled: false, autoSyncTime: "7:05" },
		});
		expect(off.status).toBe(200);
		const saved = { includePending: false, autoSyncEnabled: false, autoSyncTime: "07:05" };
		expect(await off.json()).toEqual({ data: saved });
		expect(await (await client.settings.$get()).json()).toEqual({ data: saved });
		await expect(
			own?.db.all(
				sql`select key, value from settings where key in ('syncs_include_pending', 'auto_sync_enabled', 'auto_sync_time') order by key`,
			),
		).resolves.toEqual([
			{ key: "auto_sync_enabled", value: "false" },
			{ key: "auto_sync_time", value: "07:05" },
			{ key: "syncs_include_pending", value: "false" },
		]);

		const on = await client.settings.$put({
			json: { includePending: true, autoSyncEnabled: true, autoSyncTime: "23:59" },
		});
		expect(await on.json()).toEqual({
			data: { includePending: true, autoSyncEnabled: true, autoSyncTime: "23:59" },
		});
	});

	it("refuses a body that is no boolean, and a time Sure's format refuses", async () => {
		const app = await bankApp();
		const put = (body: unknown) =>
			app.request("/api/bank-connections/settings", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});

		const refused = await put({
			includePending: "no",
			autoSyncEnabled: true,
			autoSyncTime: "02:22",
		});

		expect(refused.status).toBe(400);
		expect(await fieldsOf(refused)).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "includePending", code: "invalid_type" }],
		});

		const times = await Promise.all(
			["24:00", "02:60", "2:5", "02h22", "", " 02:22"].map(async (autoSyncTime) => {
				const response = await put({ includePending: true, autoSyncEnabled: true, autoSyncTime });

				return { status: response.status, error: await fieldsOf(response) };
			}),
		);

		for (const time of times) {
			expect(time.status).toBe(400);
			expect(time.error).toMatchObject({
				code: "VALIDATION_ERROR",
				fields: [{ path: "autoSyncTime", code: "invalid_format" }],
			});
		}
		await expect(
			own?.db.all(sql`select value from settings where key = 'auto_sync_time'`),
		).resolves.toEqual([]);
	});

	it("refuses a viewer's read and write", async () => {
		const silent = createLogger("silent");
		await bankApp();
		const database = own;

		if (database === undefined) {
			throw new Error("bankApp opens the test's own database.");
		}

		const auth = createTestAuth(database.db, silent);
		const viewerCookie = await addViewer(buildTestApp(database.db, silent, auth), auth);
		const viewer = withSession(buildTestApp(database.db, silent, auth), viewerCookie);

		const read = await viewer.request("/api/bank-connections/settings");
		const write = await viewer.request("/api/bank-connections/settings", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				includePending: false,
				autoSyncEnabled: false,
				autoSyncTime: "02:22",
			}),
		});

		expect(read.status).toBe(403);
		expect(write.status).toBe(403);
		expect(errorBody.parse(await write.json()).error.code).toBe("FORBIDDEN");
		await expect(
			database.db.all(sql`select value from settings where key = 'syncs_include_pending'`),
		).resolves.toEqual([]);
	});
});
