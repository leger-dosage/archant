import { asc, sql } from "drizzle-orm";
import { testClient } from "hono/testing";
import { describe, expect, it, vi } from "vitest";

import { recurringOccurrences } from "@archant/data/schema/recurring-occurrences";

import { createLogger } from "../../lib/logger.ts";
import * as occurrences from "../../services/recurring/occurrences.ts";
import { ownRecurringAccount, template, useSignedInApp } from "../../testing/app.ts";
import { buildTestApp, withSession } from "../../testing/auth.ts";

useSignedInApp();

const dueDates = async (db: Awaited<ReturnType<typeof ownRecurringAccount>>["db"]) =>
	(
		await db
			.select({ dueOn: recurringOccurrences.dueOn })
			.from(recurringOccurrences)
			.orderBy(asc(recurringOccurrences.dueOn))
	).map((row) => row.dueOn);

describe("the first read of the day", () => {
	it("generates the occurrences the day brings within reach, once", async () => {
		const { app, db, account } = await ownRecurringAccount();
		await testClient(app).api.recurring.declare.$post({
			json: {
				kind: "bill",
				name: "Eau",
				amount: "84,20",
				accountId: account.id,
				firstDueOn: "2026-10-10",
				frequency: { preset: "monthly" },
			},
		});
		await expect(dueDates(db)).resolves.toEqual(["2026-10-10", "2026-11-10", "2026-12-10"]);
		vi.setSystemTime(new Date("2026-10-20T10:00:00Z"));
		const start = vi.spyOn(occurrences, "startDailyOccurrences");

		const response = await testClient(app).api.accounts.$get();

		expect(response.status).toBe(200);
		await vi.waitFor(async () => expect(await dueDates(db)).toContain("2027-01-10"));
		await expect(start.mock.results[0]?.value).resolves.not.toBeNull();

		await testClient(app).api.accounts.$get();
		await expect(start.mock.results[1]?.value).resolves.toBeNull();
	});

	it("leaves a write alone", async () => {
		const { app } = await ownRecurringAccount();
		const start = vi.spyOn(occurrences, "startDailyOccurrences");

		await testClient(app).api.recurring.cleanup.$post();

		expect(start).not.toHaveBeenCalled();
	});

	it("answers the request when the day's run cannot start or fails, and logs the code only", async () => {
		const { db } = await ownRecurringAccount();
		const lines: string[] = [];
		const app = withSession(
			buildTestApp(db, createLogger("info", { write: (text: string) => lines.push(text) })),
			template.cookie,
		);
		await db.run(sql`alter table settings rename to settings_gone`);

		try {
			const response = await app.request("/api/accounts");

			expect(response.status).toBe(200);
			expect(lines.join("\n")).toContain("daily occurrences failed to start");
		} finally {
			await db.run(sql`alter table settings_gone rename to settings`);
		}

		vi.spyOn(occurrences, "startDailyOccurrences").mockResolvedValue({
			run: () => Promise.reject(new Error("amount 8420 refused")),
		});

		await app.request("/api/accounts");

		await vi.waitFor(() => expect(lines.join("\n")).toContain("daily occurrences failed"));
		expect(lines.join("\n")).not.toContain("8420");
	});
});
