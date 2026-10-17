import type { TempDatabase } from "../testing/temp-database.ts";
import type { BankConnectionDeps } from "./bank-connections.ts";
import type { SyncSchedule } from "./sync-schedule.ts";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { bankConnections } from "@archant/data/schema/bank-connections";

import { validateEnv } from "../env.ts";
import { AppError } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import {
	TEST_APPLICATION_ID,
	TEST_ENCRYPTION_KEY_BASE64,
	TEST_PKCS8_BASE64,
} from "../testing/bank.ts";
import { createTempDatabase } from "../testing/temp-database.ts";
import * as connectionsService from "./bank-connections.ts";
import { bankDepsFromEnv } from "./bank-connections.ts";
import * as settingsService from "./bank-settings.ts";
import { saveBankSyncSettings } from "./bank-settings.ts";
import { startSyncSchedule } from "./sync-schedule.ts";
import * as syncService from "./sync.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** 02:20 in Paris, two minutes before Sure's default time. */
const BEFORE_DEFAULT = Date.parse("2026-09-24T00:20:00Z");

/**
 * Moves the clock to `instant`, then lets `then` pass: the pending wake, at
 * most a minute away, fires at once. Advancing a day minute by minute reads
 * the settings 1,440 times, which CI's coverage run takes over 5 s for.
 */
async function jumpTo(instant: number, then = MINUTE) {
	vi.setSystemTime(instant);
	await vi.advanceTimersByTimeAsync(then);
}

const ENV = {
	DATABASE_URL: "file:x.db",
	BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
	BETTER_AUTH_URL: "http://localhost:5173",
	ENABLE_BANKING_APPLICATION_ID: TEST_APPLICATION_ID,
	ENABLE_BANKING_PRIVATE_KEY: TEST_PKCS8_BASE64,
	ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64,
};

const logLine = z.object({ msg: z.string().optional(), code: z.string().optional() });

let temp: TempDatabase;
let logLines: string[];
let schedule: SyncSchedule | undefined;

function deps(overrides: Partial<BankConnectionDeps> = {}): BankConnectionDeps {
	logLines = [];

	return {
		db: temp.db,
		timeZone: "Europe/Paris",
		logger: createLogger("info", { write: (line: string) => logLines.push(line) }),
		...bankDepsFromEnv(validateEnv(ENV)),
		...overrides,
	};
}

async function settle(autoSyncEnabled: boolean, autoSyncTime = "02:22"): Promise<void> {
	await saveBankSyncSettings(deps(), { includePending: true, autoSyncEnabled, autoSyncTime });
}

function start(scheduleDeps: BankConnectionDeps = deps()) {
	schedule = startSyncSchedule(scheduleDeps);
}

function spySync() {
	return vi.spyOn(syncService, "syncAll").mockResolvedValue([]);
}

const insertEnding = (id: string, consentExpiresAt: number) =>
	temp.db.insert(bankConnections).values({
		id,
		connector: "enable-banking",
		institutionName: "Banque Test",
		country: "FR",
		status: "active",
		psuIpAddress: "203.0.113.7",
		consentExpiresAt,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	});
const addresses = async () =>
	(
		await temp.db
			.select({ id: bankConnections.id, address: bankConnections.psuIpAddress })
			.from(bankConnections)
			.orderBy(bankConnections.id)
	).map(({ id, address }) => `${id}:${address ?? "-"}`);

beforeAll(async () => {
	temp = await createTempDatabase();
});

afterAll(async () => {
	await temp.dispose();
});

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
	vi.setSystemTime(BEFORE_DEFAULT);
	await temp.db.delete(bankConnections);
	await settle(true);
});

afterEach(() => {
	schedule?.stop();
	schedule = undefined;
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("startSyncSchedule", () => {
	it("runs every connection's sync once at the chosen time in the app's zone", async () => {
		const sync = spySync();
		start();

		await vi.advanceTimersByTimeAsync(MINUTE);
		expect(sync).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(MINUTE);
		expect(sync).toHaveBeenCalledTimes(1);
		expect(sync).toHaveBeenCalledWith(expect.anything(), "schedule");
		// 02:22:00 in Paris to the millisecond: it wakes at the time, not a minute later.
		expect(Date.now()).toBe(Date.parse("2026-09-24T00:22:00Z"));

		await jumpTo(Date.parse("2026-09-24T02:22:00Z"));
		expect(sync).toHaveBeenCalledTimes(1);

		// And again the next day.
		await jumpTo(BEFORE_DEFAULT + DAY, 5 * MINUTE);
		expect(sync).toHaveBeenCalledTimes(2);
	});

	it("runs nothing while auto sync is off", async () => {
		await settle(false);
		const sync = spySync();
		start();

		await vi.advanceTimersByTimeAsync(HOUR);

		expect(sync).not.toHaveBeenCalled();
	});

	it("runs at a time moved after that day's run, within the minute it was saved", async () => {
		// 03:00 in Paris, 02:22 gone by.
		vi.setSystemTime(Date.parse("2026-09-24T01:00:00Z"));
		const sync = spySync();
		start();

		await vi.advanceTimersByTimeAsync(MINUTE);
		await settle(true, "7:00");
		await vi.advanceTimersByTimeAsync(4 * HOUR - 2 * MINUTE);
		expect(sync).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(2 * MINUTE);
		expect(sync).toHaveBeenCalledTimes(1);
	});

	it("skips the day's run when the host slept through it, as sidekiq-cron skips a missed run", async () => {
		// 01:00 in Paris.
		vi.setSystemTime(Date.parse("2026-09-23T23:00:00Z"));
		const sync = spySync();
		start();
		await vi.advanceTimersByTimeAsync(0);

		// Asleep until 08:00: the clock jumps, the pending timer fires late.
		vi.setSystemTime(Date.parse("2026-09-24T06:00:00Z"));
		await vi.advanceTimersByTimeAsync(2 * MINUTE);

		expect(sync).not.toHaveBeenCalled();
	});

	it("still runs on a wake a few minutes late", async () => {
		const sync = spySync();
		start();
		await vi.advanceTimersByTimeAsync(0);

		// The timer meant for 02:21 fires at 02:24.
		vi.setSystemTime(Date.parse("2026-09-24T00:23:00Z"));
		await vi.advanceTimersByTimeAsync(MINUTE);

		expect(sync).toHaveBeenCalledTimes(1);
	});

	it("runs a time just before midnight on a wake just after it, once", async () => {
		await settle(true, "23:58");
		// 23:50 in Paris.
		vi.setSystemTime(Date.parse("2026-09-24T21:50:00Z"));
		const sync = spySync();
		start();
		await vi.advanceTimersByTimeAsync(0);

		// The timer meant for 23:58 fires at 00:01, the next day in Paris.
		vi.setSystemTime(Date.parse("2026-09-24T22:01:00Z"));
		await vi.advanceTimersByTimeAsync(MINUTE);
		await vi.advanceTimersByTimeAsync(10 * MINUTE);

		expect(sync).toHaveBeenCalledTimes(1);
	});

	it("runs nothing and logs nothing without a bank connector", async () => {
		const sync = vi.spyOn(syncService, "syncAll");
		start(deps({ encryptionKey: null }));
		await vi.advanceTimersByTimeAsync(5 * MINUTE);

		expect(sync).not.toHaveBeenCalled();

		// A key but no credentials: `syncAll` refuses, and the schedule says nothing.
		schedule?.stop();
		vi.setSystemTime(BEFORE_DEFAULT + DAY);
		const unconfigured = deps({ bankCredentials: null });
		start(unconfigured);
		await vi.advanceTimersByTimeAsync(5 * MINUTE);

		expect(sync).toHaveBeenCalledTimes(1);
		expect(logLines.filter((line) => line.includes("bank sync"))).toEqual([]);
	});

	it("logs a failure by its code and keeps the timer going", async () => {
		const sync = vi
			.spyOn(syncService, "syncAll")
			.mockRejectedValueOnce(new Error("amount 4290 refused"))
			.mockRejectedValueOnce(new AppError("SYNC_IN_PROGRESS", "busy"))
			.mockResolvedValue([]);
		start();

		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		await jumpTo(BEFORE_DEFAULT + DAY, 5 * MINUTE);
		await jumpTo(BEFORE_DEFAULT + 2 * DAY, 5 * MINUTE);

		expect(sync).toHaveBeenCalledTimes(3);
		const failures = logLines
			.map((line) => logLine.parse(JSON.parse(line)))
			.filter((line) => line.msg === "scheduled bank sync failed")
			.map((line) => line.code);
		expect(failures).toEqual(["INTERNAL_ERROR", "SYNC_IN_PROGRESS"]);
		expect(logLines.join("\n")).not.toContain("4290");
	});

	it("clears an ended consent's address at start, then once a day, never logging it", async () => {
		spySync();
		await insertEnding("a-ended", BEFORE_DEFAULT - MINUTE);
		await insertEnding("b-running", BEFORE_DEFAULT + HOUR);
		start();

		await vi.advanceTimersByTimeAsync(0);
		await expect(addresses()).resolves.toEqual(["a-ended:-", "b-running:203.0.113.7"]);

		// Ended an hour later: kept until the first wake of the next day.
		await jumpTo(BEFORE_DEFAULT + 2 * HOUR);
		await expect(addresses()).resolves.toEqual(["a-ended:-", "b-running:203.0.113.7"]);

		// 00:00 in Paris on the 25th.
		await jumpTo(Date.parse("2026-09-24T21:59:30Z"));
		await expect(addresses()).resolves.toEqual(["a-ended:-", "b-running:-"]);
		expect(logLines.join("\n")).not.toContain("203.0.113.7");
	});

	it("tries a failed address clean again at the next wake", async () => {
		spySync();
		const clean = vi
			.spyOn(connectionsService, "clearEndedPsuAddresses")
			.mockRejectedValueOnce(new Error("disk full"))
			.mockResolvedValue(0);
		start();

		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(MINUTE);
		await vi.advanceTimersByTimeAsync(10 * MINUTE);

		expect(clean).toHaveBeenCalledTimes(2);
		expect(logLines.some((line) => line.includes("bank PSU address clean failed"))).toBe(true);
	});

	it("logs unreadable settings apart from a failed sync, and keeps waking", async () => {
		const sync = spySync();
		vi.spyOn(settingsService, "bankSyncSettings").mockRejectedValueOnce(new Error("locked"));
		start();

		await vi.advanceTimersByTimeAsync(5 * MINUTE);

		const messages = logLines.map((line) => logLine.parse(JSON.parse(line)).msg);
		expect(messages).toContain("scheduled bank sync settings unreadable");
		expect(messages).not.toContain("scheduled bank sync failed");
		expect(sync).toHaveBeenCalledTimes(1);
	});

	it("stops waking once stopped", async () => {
		const sync = spySync();
		start();
		schedule?.stop();

		await vi.advanceTimersByTimeAsync(HOUR);

		expect(sync).not.toHaveBeenCalled();
	});
});
