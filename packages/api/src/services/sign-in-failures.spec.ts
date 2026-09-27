import type { TempDatabase } from "../testing/temp-database.ts";
import type { SignInCeilingOptions } from "./sign-in-failures.ts";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@archant/data/client";
import { signInFailures } from "@archant/data/schema/auth";

import { createTempDatabase } from "../testing/temp-database.ts";
import { SIGN_IN_CEILING, releaseAttempt, reserveAttempt } from "./sign-in-failures.ts";

let temp: TempDatabase;
let time: number;

const options: SignInCeilingOptions = { max: 3, windowMs: 60_000, now: () => time };

beforeEach(async () => {
	temp = await createTempDatabase();
	time = Date.UTC(2026, 8, 27, 10);
});

afterEach(async () => {
	await temp.dispose();
});

/** Reserves `times` slots at once, as a burst from many addresses would. */
async function reserve(times: number) {
	return Promise.all(Array.from({ length: times }, () => reserveAttempt(temp, options)));
}

const stored = async () => temp.db.select().from(signInFailures);

describe("the sign-in ceiling", () => {
	it("defaults to 20 attempts per 10 minutes", () => {
		expect(SIGN_IN_CEILING).toMatchObject({ max: 20, windowMs: 600_000 });
	});

	it("opens a window at the first attempt", async () => {
		await expect(reserveAttempt(temp, options)).resolves.toEqual({ windowStartedAt: time });
		await expect(stored()).resolves.toEqual([{ id: "all", count: 1, windowStartedAt: time }]);
	});

	it("grants exactly `max` slots of a burst and refuses the rest, the count left at `max`", async () => {
		const reservations = await reserve(10);

		expect(reservations.filter((reservation) => reservation !== null)).toHaveLength(3);
		await expect(stored()).resolves.toEqual([{ id: "all", count: 3, windowStartedAt: time }]);
	});

	it("refuses until the window is over, then opens a new one at 1", async () => {
		const opened = time;
		await reserve(3);

		time = opened + 59_999;
		await expect(reserveAttempt(temp, options)).resolves.toBeNull();

		time = opened + 60_000;
		await expect(reserveAttempt(temp, options)).resolves.toEqual({ windowStartedAt: time });
		await expect(stored()).resolves.toEqual([{ id: "all", count: 1, windowStartedAt: time }]);
	});

	it("does not slide the window: an attempt late in it does not extend it", async () => {
		const opened = time;
		await reserve(2);

		time = opened + 59_000;
		await reserve(1);
		await expect(reserveAttempt(temp, options)).resolves.toBeNull();

		time = opened + 60_000;
		await expect(reserveAttempt(temp, options)).resolves.not.toBeNull();
	});

	it("takes a released slot again", async () => {
		const [first] = await reserve(3);
		await expect(reserveAttempt(temp, options)).resolves.toBeNull();

		await releaseAttempt(temp, first ?? { windowStartedAt: time });

		await expect(stored()).resolves.toMatchObject([{ count: 2 }]);
		await expect(reserveAttempt(temp, options)).resolves.not.toBeNull();
	});

	it("gives nothing back to a window that replaced the slot's own", async () => {
		const opened = time;
		const [old] = await reserve(1);

		time = opened + 60_000;
		await reserve(1);
		await releaseAttempt(temp, old ?? { windowStartedAt: opened });

		await expect(stored()).resolves.toEqual([{ id: "all", count: 1, windowStartedAt: time }]);
	});

	it("never counts below zero", async () => {
		const [only] = await reserve(1);

		await releaseAttempt(temp, only ?? { windowStartedAt: time });
		await releaseAttempt(temp, only ?? { windowStartedAt: time });

		await expect(stored()).resolves.toMatchObject([{ count: 0 }]);
	});

	it("survives a restart: a new connection to the same file still refuses", async () => {
		await reserve(3);
		temp.db.$client.close();

		const reopened = await createDb(`file:${temp.file}`);

		try {
			await expect(reserveAttempt({ db: reopened }, options)).resolves.toBeNull();
		} finally {
			reopened.$client.close();
		}
	});
});
