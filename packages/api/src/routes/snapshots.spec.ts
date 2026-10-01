import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
	balanceOf,
	balanceOnDay,
	buildApp,
	errorBody,
	expense,
	openPinned,
	postTransaction,
	recorded,
	request,
	snapshotsOf,
	useSignedInApp,
} from "../testing/app.ts";

useSignedInApp();

describe("PATCH /api/snapshots/:id", () => {
	it("moves a snapshot earlier and recomputes from the new date", async () => {
		const account = await openPinned();
		const snapshot = await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		const response = await testClient(buildApp()).api.snapshots[":id"].$patch({
			param: { id: snapshot.id },
			json: { date: "2026-02-20" },
		});

		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({
			id: snapshot.id,
			date: "2026-02-20",
			balance: 200000,
			computed: 150000,
			gap: 50000,
		});
		await expect(balanceOnDay(account.id, "2026-02-20")).resolves.toBe(200000);
		await expect(balanceOnDay(account.id, "2026-03-05")).resolves.toBe(188000);
	});

	it("changes the balance", async () => {
		const account = await openPinned();
		const snapshot = await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		const { status, body } = await request("PATCH", `/api/snapshots/${snapshot.id}`, {
			balance: "-80,00",
		});

		expect(status).toBe(200);
		expect(body).toMatchObject({ data: { balance: -8000 } });
		await expect(balanceOf(account.id)).resolves.toBe(-8000);
	});

	it("refuses a date another snapshot holds and writes nothing", async () => {
		const account = await openPinned();
		await recorded(account.id, { date: "2026-02-20", balance: "1 900,00" });
		const snapshot = await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		const { status, body } = await request("PATCH", `/api/snapshots/${snapshot.id}`, {
			date: "2026-02-20",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "date", code: "snapshot_exists" }]);
		const list = await snapshotsOf(account.id);
		expect(list.total).toBe(2);
		expect(list.items[0]).toMatchObject({ id: snapshot.id, date: "2026-03-05" });
		await expect(balanceOf(account.id)).resolves.toBe(200000);
	});

	it("refuses an invalid balance", async () => {
		const account = await openPinned();
		const snapshot = await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		const { status, body } = await request("PATCH", `/api/snapshots/${snapshot.id}`, {
			balance: "abc",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([
			{ path: "balance", code: "invalid_amount" },
		]);
	});

	it("refuses a malformed date and writes nothing", async () => {
		const account = await openPinned();
		const snapshot = await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		const { status, body } = await request("PATCH", `/api/snapshots/${snapshot.id}`, {
			date: "2026-02-5",
		});

		expect(status).toBe(400);
		expect(errorBody.parse(body).error.fields).toEqual([{ path: "date", code: "invalid_format" }]);
		const { items } = await snapshotsOf(account.id);
		expect(items[0]).toMatchObject({ id: snapshot.id, date: "2026-03-05" });
	});

	it("answers NOT_FOUND for an unknown snapshot and for a transaction's id", async () => {
		const account = await openPinned();
		const created = await postTransaction(account.id, expense);
		const { data } = z.object({ data: z.object({ id: z.string() }) }).parse(created.body);

		const unknown = await request("PATCH", "/api/snapshots/nope", { balance: "1,00" });
		const transaction = await request("PATCH", `/api/snapshots/${data.id}`, { balance: "1,00" });

		expect(unknown.status).toBe(404);
		expect(transaction.status).toBe(404);
	});
});

describe("DELETE /api/snapshots/:id", () => {
	it("deletes the snapshot and the balances follow the transactions again", async () => {
		const account = await openPinned();
		const snapshot = await recorded(account.id, { date: "2026-03-05", balance: "2 000,00" });

		const response = await testClient(buildApp()).api.snapshots[":id"].$delete({
			param: { id: snapshot.id },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ data: { id: snapshot.id } });
		await expect(balanceOnDay(account.id, "2026-03-05")).resolves.toBe(138000);
		await expect(balanceOf(account.id)).resolves.toBe(138000);
		await expect(snapshotsOf(account.id)).resolves.toMatchObject({ total: 0 });
	});

	it("answers NOT_FOUND for an unknown snapshot", async () => {
		const { status, body } = await request("DELETE", "/api/snapshots/nope");

		expect(status).toBe(404);
		expect(errorBody.parse(body).error.code).toBe("NOT_FOUND");
	});
});
