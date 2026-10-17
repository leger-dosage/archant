import type { IsoDate } from "../domain/dates.ts";
import type { BankConnectionDeps } from "./bank-connections.ts";
import type { BankSyncSettings } from "./bank-settings.ts";

import { addDays, instantAt, today } from "../domain/dates.ts";
import { AppError } from "../lib/errors.ts";
import { clearEndedPsuAddresses, codeOf } from "./bank-connections.ts";
import { bankSyncSettings } from "./bank-settings.ts";
import { syncAll } from "./sync.ts";

/**
 * The longest the timer sleeps: a single long timer drifts by however long
 * the host slept, so it is re-armed at most a minute ahead, which also
 * picks up a time changed in « Réglages » within the minute.
 */
const MAX_SLEEP_MS = 60_000;

/**
 * How late a wake may still run the day's sync. Later, as after the host
 * slept through it, the day is skipped, as sidekiq-cron skips a missed run:
 * the first visit of the day syncs anyway, and a PSD2 consent allows only
 * four unattended reads a day.
 */
const GRACE_MS = 5 * 60_000;

/** The schedule's timer, stopped by `stop`; nothing else holds the process open. */
export type SyncSchedule = { stop: () => void };

/** `HH:MM` as numbers; the settings service only answers valid times. */
function clockOf(time: string): { hours: number; minutes: number } {
	const [hours = 0, minutes = 0] = time.split(":").map(Number);

	return { hours, minutes };
}

/**
 * Sure's `AutoSyncScheduler` in process: a timer that wakes at least once a
 * minute and at the chosen time. On a wake, when « Activer la
 * synchronisation automatique » is on and « Heure de synchronisation »,
 * read in `APP_TIMEZONE`, fell after the previous wake and less than five
 * minutes ago, it runs `syncAll`. At start and at the first wake of each
 * day, it clears the browser's address of every connection whose consent
 * has ended, as Sure's `DataCleanerJob`. Without bank credentials nothing
 * runs and nothing is logged; a failure is logged by its code, and the
 * timer keeps going.
 */
export function startSyncSchedule(deps: BankConnectionDeps): SyncSchedule {
	let previousWake = Date.now();
	let cleanedOn: IsoDate | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;

	const clean = async (now: number) => {
		const day = today(deps.timeZone, new Date(now));

		if (cleanedOn === day) {
			return;
		}

		try {
			const cleared = await clearEndedPsuAddresses(deps, now);

			// Only once it worked: a failed clean is tried again at the next wake.
			cleanedOn = day;

			if (cleared > 0) {
				deps.logger.info({ connections: cleared }, "bank PSU addresses cleared");
			}
		} catch (error) {
			deps.logger.error({ code: codeOf(error) }, "bank PSU address clean failed");
		}
	};

	/**
	 * The chosen time yesterday, today and tomorrow: a wake just past
	 * midnight still sees 23:59, and the next wake may fall tomorrow.
	 */
	const dueTimes = (time: string, now: number) => {
		const { hours, minutes } = clockOf(time);
		const day = today(deps.timeZone, new Date(now));

		return [addDays(day, -1), day, addDays(day, 1)].map((date) =>
			instantAt(deps.timeZone, date, hours, minutes),
		);
	};

	const run = async () => {
		// No key, no connector: an install without a bank stays silent.
		if (deps.encryptionKey === null) {
			return;
		}

		try {
			const results = await syncAll(deps, "schedule");

			deps.logger.info({ connections: results.length }, "scheduled bank sync ran");
		} catch (error) {
			if (error instanceof AppError && error.code === "BANK_CONNECTOR_UNAVAILABLE") {
				return;
			}

			deps.logger.error({ code: codeOf(error) }, "scheduled bank sync failed");
		}
	};

	const wake = async () => {
		const now = Date.now();
		const since = previousWake;
		let next = now + MAX_SLEEP_MS;

		previousWake = now;

		try {
			await clean(now);

			let settings: BankSyncSettings;

			try {
				settings = await bankSyncSettings(deps);
			} catch (error) {
				deps.logger.error({ code: codeOf(error) }, "scheduled bank sync settings unreadable");

				return;
			}

			if (settings.autoSyncEnabled) {
				const due = dueTimes(settings.autoSyncTime, now);

				if (due.some((instant) => instant > since && instant <= now && now - instant < GRACE_MS)) {
					await run();
				}

				const upcoming = due.find((instant) => instant > Date.now());

				if (upcoming !== undefined) {
					next = Math.min(next, upcoming);
				}
			}
		} catch (error) {
			deps.logger.error({ code: codeOf(error) }, "scheduled bank sync wake failed");
		} finally {
			// Whatever threw above, the schedule goes on.
			arm(next);
		}
	};

	const arm = (at: number) => {
		if (stopped) {
			return;
		}

		const now = Date.now();

		timer = setTimeout(() => void wake(), Math.max(0, Math.min(at, now + MAX_SLEEP_MS) - now));
		// The server's socket keeps the process alive; the schedule must not.
		timer.unref();
	};

	// At once: the first wake cleans the addresses and arms the next one.
	arm(previousWake);

	return {
		stop: () => {
			stopped = true;
			clearTimeout(timer);
		},
	};
}
