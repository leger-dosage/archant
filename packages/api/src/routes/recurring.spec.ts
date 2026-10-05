import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
	buildApp,
	errorBody,
	listItem,
	ownDatabase,
	ownRecurringAccount,
	recurringRows,
	useSignedInApp,
	valid,
} from "../testing/app.ts";

useSignedInApp();

describe("POST /api/recurring/detect", () => {
	it("detects hand-entered transactions and answers how many patterns it found", async () => {
		const { app, db, account } = await ownRecurringAccount();
		const netflix = (date: string) =>
			app.request(`/api/accounts/${account.id}/transactions`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ date, label: "Netflix", amount: "-13,99" }),
			});
		await netflix("2026-07-05");
		await netflix("2026-08-05");
		await netflix("2026-09-05");

		const response = await testClient(app).api.recurring.detect.$post();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ data: { detected: 1 } });
		await expect(recurringRows(db)).resolves.toEqual([
			expect.objectContaining({ labelKey: "netflix", amount: -1399, day: 5, count: 3 }),
		]);
	});

	it("answers zero on an empty database", async () => {
		const own = await ownDatabase();

		const response = await testClient(buildApp(own.db)).api.recurring.detect.$post();

		expect(await response.json()).toEqual({ data: { detected: 0 } });
	});
});

async function monthlyNetflix() {
	const { app, db, account } = await ownRecurringAccount();
	const add = async (date: string) => {
		const response = await app.request(`/api/accounts/${account.id}/transactions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ date, label: "Netflix", amount: "-13,99" }),
		});

		return z.object({ data: z.object({ id: z.string() }) }).parse(await response.json()).data.id;
	};
	const ids = [await add("2026-07-05"), await add("2026-08-05"), await add("2026-09-05")];

	return { app, db, account, ids };
}

describe("/api/recurring", () => {
	it("lists the detected patterns with their account", async () => {
		const { app, account } = await monthlyNetflix();
		await testClient(app).api.recurring.detect.$post();

		const response = await testClient(app).api.recurring.$get();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: [
				expect.objectContaining({
					accountId: account.id,
					accountName: valid.name,
					accountType: valid.type,
					merchantName: null,
					label: "Netflix",
					amount: -1399,
					currency: "EUR",
					expectedAmountMin: -1399,
					expectedAmountMax: -1399,
					expectedDayOfMonth: 5,
					status: "suggested",
					manual: false,
				}),
			],
		});
	});

	it("adds a pattern from a transaction", async () => {
		const { app, ids } = await monthlyNetflix();

		const response = await testClient(app).api.recurring.$post({ json: { entryId: ids[2]! } });

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			data: { label: "Netflix", occurrenceCount: 1, status: "active", manual: true },
		});
	});

	it("answers NOT_FOUND for an unknown transaction, VALIDATION_ERROR for a missing one", async () => {
		const own = await ownDatabase();
		const client = testClient(buildApp(own.db)).api.recurring;

		const unknown = await client.$post({ json: { entryId: "nope" } });

		expect(unknown.status).toBe(404);
		expect(errorBody.parse(await unknown.json()).error.code).toBe("NOT_FOUND");

		const missing = await buildApp(own.db).request("/api/recurring", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});

		expect(missing.status).toBe(400);
		expect(errorBody.parse(await missing.json()).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "entryId" }],
		});
	});

	it("activates a suggestion, and refuses a move its status cannot make", async () => {
		const { app } = await monthlyNetflix();
		const client = testClient(app).api.recurring;
		await client.detect.$post();
		const { data } = await (await client.$get()).json();
		const id = data[0]!.id;

		const deactivated = await client[":id"].$patch({
			param: { id },
			json: { status: "inactive" },
		});

		expect(deactivated.status).toBe(400);
		expect(errorBody.parse(await deactivated.json()).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "status", code: "invalid_value" }],
		});

		const activated = await client[":id"].$patch({ param: { id }, json: { status: "active" } });

		expect(activated.status).toBe(200);
		expect(await activated.json()).toMatchObject({ data: { id, status: "active" } });
	});

	it("marks the rows of a series recurring in both lists, until it is deleted", async () => {
		const { app, account, ids } = await monthlyNetflix();
		const other = await app.request(`/api/accounts/${account.id}/transactions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ date: "2026-09-06", label: "Boulangerie", amount: "-4,20" }),
		});
		const otherId = z.object({ data: z.object({ id: z.string() }) }).parse(await other.json())
			.data.id;
		const flags = async (path: string) => {
			const response = await app.request(path);
			const { data } = z
				.object({ data: z.object({ items: z.array(listItem) }) })
				.parse(await response.json());

			return new Map(data.items.map((item) => [item.id, item.recurring]));
		};
		const added = await testClient(app).api.recurring.$post({ json: { entryId: ids[2]! } });
		const { data: series } = z
			.object({ data: z.object({ id: z.string() }) })
			.parse(await added.json());

		const lists = await Promise.all(
			["/api/transactions", `/api/accounts/${account.id}/transactions`].map(flags),
		);

		for (const flagged of lists) {
			expect(ids.map((id) => flagged.get(id))).toEqual([true, true, true]);
			expect(flagged.get(otherId)).toBe(false);
		}

		await testClient(app).api.recurring[":id"].$delete({ param: { id: series.id } });

		expect([...(await flags("/api/transactions")).values()]).toEqual([false, false, false, false]);
	});

	it("answers the series of a transaction, null without one, NOT_FOUND for an unknown entry", async () => {
		const { app, ids } = await monthlyNetflix();
		const client = testClient(app).api.recurring["by-entry"][":entryId"];

		const before = await client.$get({ param: { entryId: ids[2]! } });

		expect(before.status).toBe(200);
		expect(await before.json()).toEqual({ data: null });

		await testClient(app).api.recurring.detect.$post();
		const found = await client.$get({ param: { entryId: ids[2]! } });

		expect(found.status).toBe(200);
		expect(await found.json()).toMatchObject({
			data: { label: "Netflix", amount: -1399, status: "suggested" },
		});

		const unknown = await client.$get({ param: { entryId: "nope" } });

		expect(unknown.status).toBe(404);
		expect(errorBody.parse(await unknown.json()).error.code).toBe("NOT_FOUND");
	});

	it("refuses an unknown status, and answers NOT_FOUND for an unknown id", async () => {
		const own = await ownDatabase();
		const app = buildApp(own.db);

		const unknownStatus = await app.request("/api/recurring/nope", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ status: "paused" }),
		});

		expect(unknownStatus.status).toBe(400);
		expect(errorBody.parse(await unknownStatus.json()).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "status" }],
		});

		const unknownId = await testClient(app).api.recurring[":id"].$patch({
			param: { id: "nope" },
			json: { status: "active" },
		});

		expect(unknownId.status).toBe(404);
		expect(errorBody.parse(await unknownId.json()).error.code).toBe("NOT_FOUND");

		const unknownDelete = await testClient(app).api.recurring[":id"].$delete({
			param: { id: "nope" },
		});

		expect(unknownDelete.status).toBe(404);
	});

	it("ends a detected series on DELETE, which « Ajouter aux récurrences » brings back", async () => {
		const { app, ids } = await monthlyNetflix();
		const client = testClient(app).api.recurring;
		await client.detect.$post();
		const { data } = await (await client.$get()).json();
		const detected = data[0]!.id;

		const ended = await client[":id"].$delete({ param: { id: detected } });

		expect(ended.status).toBe(200);
		expect(await ended.json()).toEqual({ data: { id: detected } });
		expect((await (await client.$get()).json()).data).toEqual([]);

		await client.detect.$post();

		expect((await (await client.$get()).json()).data).toEqual([]);

		const added = await client.$post({ json: { entryId: ids[2]! } });

		expect(await added.json()).toMatchObject({ data: { id: detected, status: "active" } });
	});

	it("deletes a manual series on DELETE", async () => {
		const { app, db, ids } = await monthlyNetflix();
		const client = testClient(app).api.recurring;
		const added = await client.$post({ json: { entryId: ids[2]! } });
		const { id } = z.object({ data: z.object({ id: z.string() }) }).parse(await added.json()).data;

		const deleted = await client[":id"].$delete({ param: { id } });

		expect(deleted.status).toBe(200);
		await expect(recurringRows(db)).resolves.toEqual([]);
	});
});

const water = (accountId: string) => ({
	kind: "bill",
	name: "Eau",
	amount: "84,20",
	accountId,
	firstDueOn: "2026-10-10",
	frequency: { preset: "quarterly" },
	paymentUrl: "eau.example/payer",
});

describe("POST /api/recurring/declare", () => {
	it("creates an active manual bill, negative, and answers 409 for the same one twice", async () => {
		const { app, account } = await ownRecurringAccount();
		const client = testClient(app).api.recurring.declare;

		const created = await client.$post({ json: water(account.id) });

		expect(created.status).toBe(201);
		expect(await created.json()).toMatchObject({
			data: {
				name: "Eau",
				amount: -8420,
				status: "active",
				manual: true,
				billType: "bill",
				paymentUrl: "https://eau.example/payer",
				nextExpectedDate: "2026-10-10",
				frequency: { key: "quarterly", dayOfMonth: 10 },
			},
		});

		const again = await client.$post({ json: water(account.id) });

		expect(again.status).toBe(409);
		expect(errorBody.parse(await again.json()).error.code).toBe("RECURRING_ALREADY_EXISTS");
	});

	it("creates an income positive", async () => {
		const { app, account } = await ownRecurringAccount();

		const created = await testClient(app).api.recurring.declare.$post({
			json: { ...water(account.id), kind: "income", name: "Salaire", amount: "2 500,00" },
		});

		expect(await created.json()).toMatchObject({ data: { amount: 250_000, billType: "income" } });
	});

	it("refuses a link that is not http or https, and a body it cannot read", async () => {
		const { app, account } = await ownRecurringAccount();

		const ftp = await testClient(app).api.recurring.declare.$post({
			json: { ...water(account.id), paymentUrl: "ftp://x" },
		});

		expect(ftp.status).toBe(400);
		expect(errorBody.parse(await ftp.json()).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "paymentUrl", code: "invalid_url" }],
		});

		const empty = await app.request("/api/recurring/declare", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});

		expect(empty.status).toBe(400);
	});
});

describe("PATCH /api/recurring/:id with the edit fields", () => {
	it("edits a series, and moves its status when given one", async () => {
		const { app, ids } = await monthlyNetflix();
		const client = testClient(app).api.recurring;
		const added = await client.$post({ json: { entryId: ids[2]! } });
		const { id } = z.object({ data: z.object({ id: z.string() }) }).parse(await added.json()).data;

		const edited = await client[":id"].$patch({
			param: { id },
			json: {
				name: "Netflix Premium",
				amount: "17,99",
				billType: "subscription",
				frequency: { preset: "monthly", dayOfMonth: "5" },
				autopay: true,
				paymentUrl: "netflix.com/account",
			},
		});

		expect(edited.status).toBe(200);
		expect(await edited.json()).toMatchObject({
			data: {
				name: "Netflix Premium",
				amount: -1799,
				billType: "subscription",
				autopay: true,
				paymentUrl: "https://netflix.com/account",
			},
		});

		const paused = await client[":id"].$patch({ param: { id }, json: { status: "inactive" } });

		expect(await paused.json()).toMatchObject({
			data: { status: "inactive", name: "Netflix Premium" },
		});

		const refused = await client[":id"].$patch({ param: { id }, json: { paymentUrl: "ftp://x" } });

		expect(refused.status).toBe(400);
		expect(errorBody.parse(await refused.json()).error.fields).toEqual([
			{ path: "paymentUrl", code: "invalid_url" },
		]);
	});
});

describe("PATCH /api/recurring/:id with nothing, or a status beside edits", () => {
	it("answers VALIDATION_ERROR and changes nothing", async () => {
		const { app, ids } = await monthlyNetflix();
		const client = testClient(app).api.recurring;
		const added = await client.$post({ json: { entryId: ids[2]! } });
		const { id } = z.object({ data: z.object({ id: z.string() }) }).parse(await added.json()).data;
		const patch = (body: unknown) =>
			app.request(`/api/recurring/${id}`, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});

		const empty = await patch({});

		expect(empty.status).toBe(400);
		expect(errorBody.parse(await empty.json()).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "", code: "invalid_value" }],
		});

		const mixed = await patch({ status: "inactive", name: "Netflix Premium" });

		expect(mixed.status).toBe(400);
		expect(errorBody.parse(await mixed.json()).error).toMatchObject({
			code: "VALIDATION_ERROR",
			fields: [{ path: "status", code: "invalid_value" }],
		});
		expect((await (await client.$get()).json()).data).toEqual([
			expect.objectContaining({ id, status: "active", name: null }),
		]);
	});
});

describe("GET /api/recurring/candidates", () => {
	it("offers bills or incomes by kind, and refuses another kind", async () => {
		const { app, ids } = await monthlyNetflix();
		const client = testClient(app).api.recurring.candidates;

		const bills = await client.$get({ query: { kind: "bill" } });

		expect(bills.status).toBe(200);
		expect(await bills.json()).toEqual({
			data: [
				expect.objectContaining({
					entryId: ids[2],
					name: "Netflix",
					amount: 1399,
					occurrenceCount: 3,
					lastOccurrenceDate: "2026-09-05",
				}),
			],
		});
		expect(await (await client.$get({ query: { kind: "income" } })).json()).toEqual({ data: [] });

		const other = await app.request("/api/recurring/candidates?kind=transfer");

		expect(other.status).toBe(400);
	});
});

describe("POST /api/recurring/cleanup", () => {
	it("answers how many series became inactive", async () => {
		const own = await ownDatabase();

		const response = await testClient(buildApp(own.db)).api.recurring.cleanup.$post();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ data: { inactive: 0 } });
	});
});
