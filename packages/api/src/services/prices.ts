import type { PriceProvider } from "../connectors/prices/price-provider.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { StoredRange } from "../domain/prices.ts";
import type { ErrorCode } from "../lib/errors.ts";
import type { TypedPriceInput } from "../schemas/prices.ts";
import type { ServiceDeps } from "./deps.ts";
import type { PriceDeps } from "./securities.ts";

import { and, asc, desc, eq, gte, inArray, isNotNull, lt, max, min, ne, sql } from "drizzle-orm";

import type { Micros } from "@archant/data/micros";
import { formatMicros } from "@archant/data/micros";
import { securities, securityPrices } from "@archant/data/schema/securities";
import { settings } from "@archant/data/schema/settings";
import type { Security } from "@archant/data/types";

import { priceUnavailable } from "../connectors/prices/price-provider.ts";
import { startOfDay, today } from "../domain/dates.ts";
import { fillPrices, priceWindow } from "../domain/prices.ts";
import { AppError } from "../lib/errors.ts";
import { validationError } from "../lib/zod-error.ts";
import { typedPriceSchema } from "../schemas/prices.ts";
import { LEASE_MS, codeOf } from "./bank-connections.ts";
import { revalueHoldings } from "./ledger/holdings.ts";
import { PRICE_PROVIDER_SETTING, enabledProvider, heldSecurities } from "./securities.ts";

// A run's state, one `settings` row each, as epoch milliseconds or a code.
const STARTED = "prices_started_at";
const FINISHED = "prices_finished_at";
const UPDATED = "prices_updated_at";
const LAST_ERROR = "prices_last_error";

/** Sure's `MAX_CONSECUTIVE_FAILURES`: the failure that sets a security offline. */
const MAX_FAILURES = 5;

/** Rows per insert: ten years of days in a few statements, far below SQLite's variable limit. */
const BATCH = 500;

/** What « Réglages › Placements » shows. */
export type PriceStatus = {
	enabled: boolean;
	/** The host a fetch reaches, which the page names before it is turned on. */
	host: string;
	/** Epoch milliseconds of the last run the provider answered. */
	lastUpdatedAt: number | null;
	/** The last run's error code, `null` after a clean one. */
	lastError: string | null;
	/** A run holds the lease: the page shows it and polls until it ends. */
	updating: boolean;
};

type RunState = {
	provider: string | null;
	startedAt: number | null;
	finishedAt: number | null;
	updatedAt: number | null;
	lastError: string | null;
};

type Db = Pick<PriceDeps, "db">;

async function runState(deps: Db): Promise<RunState> {
	const rows = await deps.db
		.select({ key: settings.key, value: settings.value })
		.from(settings)
		.where(inArray(settings.key, [PRICE_PROVIDER_SETTING, STARTED, FINISHED, UPDATED, LAST_ERROR]));
	const value = (key: string) => rows.find((row) => row.key === key)?.value ?? null;
	const time = (key: string) => {
		const text = value(key);

		return text === null ? null : Number(text);
	};

	return {
		provider: value(PRICE_PROVIDER_SETTING),
		startedAt: time(STARTED),
		finishedAt: time(FINISHED),
		updatedAt: time(UPDATED),
		lastError: value(LAST_ERROR),
	};
}

/** A run holds the lease: it started after the last one finished, less than ten minutes ago. */
function isHeld({ startedAt, finishedAt }: RunState, now: number): boolean {
	return (
		startedAt !== null &&
		(finishedAt === null || startedAt > finishedAt) &&
		startedAt >= now - LEASE_MS
	);
}

/** The day's run has started, in `APP_TIMEZONE`. */
function startedToday(
	deps: Pick<PriceDeps, "timeZone">,
	{ startedAt }: RunState,
	now: number,
): boolean {
	return startedAt !== null && startedAt >= startOfDay(deps.timeZone, now);
}

/** Writes `values` into their `settings` rows, creating any missing. */
async function writeSettings(deps: Db, values: Record<string, string>, now: number) {
	await deps.db
		.insert(settings)
		.values(Object.entries(values).map(([key, value]) => ({ key, value, updatedAt: now })))
		.onConflictDoUpdate({
			target: settings.key,
			set: { value: sql`excluded.${sql.identifier(settings.value.name)}`, updatedAt: now },
		});
}

export async function priceStatus(deps: PriceDeps): Promise<PriceStatus> {
	const state = await runState(deps);

	return {
		enabled: (await enabledProvider(deps)) !== null,
		host: new URL(deps.priceApiUrl).host,
		lastUpdatedAt: state.updatedAt,
		lastError: state.lastError,
		updating: isHeld(state, Date.now()),
	};
}

/**
 * Turns price fetching on or off (AD-22). Off deletes the row, the default
 * state; the prices fetched so far stay, as every price the owner typed.
 */
export async function setPricesEnabled(deps: PriceDeps, enabled: boolean): Promise<PriceStatus> {
	if (enabled) {
		await writeSettings(deps, { [PRICE_PROVIDER_SETTING]: "yahoo" }, Date.now());
	} else {
		await deps.db.delete(settings).where(eq(settings.key, PRICE_PROVIDER_SETTING));
	}

	deps.logger.info({ enabled }, "price fetching changed");

	return priceStatus(deps);
}

/**
 * The lease taken, or why not: fetching is off, a run holds it, or the
 * day's run has started.
 */
type Lease = "taken" | "disabled" | "held" | "done";

/**
 * Takes the run's lease in one immediate transaction, so of two requests
 * racing here only one runs. The day's run takes it once a day, the button
 * whenever no run holds it.
 */
async function takeLease(deps: PriceDeps, now: number, daily: boolean): Promise<Lease> {
	return deps.db.transaction(
		async (tx) => {
			const state = await runState({ db: tx });

			if (state.provider === null) {
				return "disabled";
			}

			if (isHeld(state, now)) {
				return "held";
			}

			if (daily && startedToday(deps, state, now)) {
				return "done";
			}

			await writeSettings({ db: tx }, { [STARTED]: String(now) }, now);

			return "taken";
		},
		{ behavior: "immediate" },
	);
}

/**
 * What the next fetch of a security starts from, `null` when the provider
 * gave it no price yet. Typed prices are left out: a fetch resumed after one
 * would skip the provider's days before it.
 */
async function storedRange(deps: Db, securityId: string): Promise<StoredRange | null> {
	const fetched = and(
		eq(securityPrices.securityId, securityId),
		eq(securityPrices.source, "provider"),
	);
	const [range] = await deps.db
		.select({ first: min(securityPrices.date), last: max(securityPrices.date) })
		.from(securityPrices)
		.where(fetched);
	const [provisional] = await deps.db
		.select({ earliest: min(securityPrices.date) })
		.from(securityPrices)
		.where(and(fetched, eq(securityPrices.provisional, true)));

	const first = range?.first ?? null;
	const last = range?.last ?? null;

	return first === null || last === null
		? null
		: { first, last, earliestProvisional: provisional?.earliest ?? null };
}

/**
 * Fetches one security's window and writes it with the security's reset
 * count, in one transaction that also revalues its holders from the earliest
 * day written (AD-22): prices and the values derived from them commit
 * together. Returns how many days it wrote.
 */
async function priceSecurity(
	deps: PriceDeps,
	provider: PriceProvider,
	security: Pick<Security, "id" | "ticker" | "mic" | "currency" | "firstPriceOn">,
	from: IsoDate,
	day: IsoDate,
): Promise<number> {
	const window = priceWindow({
		from,
		firstPriceOn: security.firstPriceOn,
		stored: await storedRange(deps, security.id),
		today: day,
	});

	if (window === null || security.ticker === null) {
		return 0;
	}

	const { currency, prices } = await provider.dailyPrices({
		ticker: security.ticker,
		mic: security.mic,
		from: window.requestFrom,
		to: day,
	});

	// A listing priced in another currency is another listing.
	if (currency !== security.currency) {
		throw priceUnavailable();
	}

	const [before] = await deps.db
		.select({ price: securityPrices.price })
		.from(securityPrices)
		.where(and(eq(securityPrices.securityId, security.id), lt(securityPrices.date, window.start)))
		.orderBy(desc(securityPrices.date))
		.limit(1);
	const typed = await deps.db
		.select({ date: securityPrices.date, price: securityPrices.price })
		.from(securityPrices)
		.where(
			and(
				eq(securityPrices.securityId, security.id),
				eq(securityPrices.source, "manual"),
				gte(securityPrices.date, window.start),
			),
		);
	const { rows, firstPriceOn } = fillPrices({
		start: window.start,
		today: day,
		closes: prices,
		storedBefore: before?.price ?? null,
		manual: new Map<IsoDate, Micros>(typed.map(({ date, price }) => [date, price])),
	});
	const now = Date.now();

	await deps.db.transaction(
		async (tx) => {
			const batches = Array.from({ length: Math.ceil(rows.length / BATCH) }, (_, index) =>
				rows.slice(index * BATCH, (index + 1) * BATCH),
			);

			// In turn, as every write of one transaction goes.
			await batches.reduce<Promise<void>>(async (previous, batch) => {
				await previous;
				await tx
					.insert(securityPrices)
					.values(
						batch.map(({ date, price, provisional }) => ({
							securityId: security.id,
							date,
							price,
							currency: security.currency,
							provisional,
							source: "provider" as const,
						})),
					)
					.onConflictDoUpdate({
						target: [securityPrices.securityId, securityPrices.date],
						set: {
							price: sql`excluded.${sql.identifier(securityPrices.price.name)}`,
							currency: sql`excluded.${sql.identifier(securityPrices.currency.name)}`,
							provisional: sql`excluded.${sql.identifier(securityPrices.provisional.name)}`,
							source: sql`excluded.${sql.identifier(securityPrices.source.name)}`,
						},
						// A price typed while this run fetched is still the owner's.
						setWhere: ne(securityPrices.source, "manual"),
					});
			}, Promise.resolve());

			await tx
				.update(securities)
				.set({
					failedFetchCount: 0,
					offline: false,
					firstPriceOn: security.firstPriceOn ?? firstPriceOn,
					updatedAt: now,
				})
				.where(eq(securities.id, security.id));

			const [earliest] = rows;

			if (earliest !== undefined) {
				await revalueHoldings(tx, security.id, earliest.date, deps.timeZone, {
					origin: "provider",
				});
			}
		},
		{ behavior: "immediate" },
	);

	return rows.length;
}

/**
 * Counts a security's failure; the fifth in a row sets it offline, which the
 * daily run skips, as Sure's health check. Its prices stay: the typed and the
 * carried ones still serve.
 */
async function countFailure(deps: PriceDeps, securityId: string): Promise<void> {
	await deps.db
		.update(securities)
		.set({
			failedFetchCount: sql`${securities.failedFetchCount} + 1`,
			offline: sql`${securities.failedFetchCount} + 1 >= ${MAX_FAILURES}`,
			updatedAt: Date.now(),
		})
		.where(eq(securities.id, securityId));
}

/**
 * One run over the held securities with a provider and a ticker, oldest
 * first, the offline ones only when `withOffline`. `PRICE_UNAVAILABLE`
 * counts against its security and the run goes on; `PRICE_PROVIDER_ERROR`
 * stops it, counting against none, and leaves `prices_updated_at` as it was,
 * as any other failure does. Turning fetching off stops it quietly.
 * Never rejects: every failure ends up in `prices_last_error` and the log,
 * which holds ids, counts, durations and codes only (AD-14).
 */
async function run(
	deps: PriceDeps,
	provider: PriceProvider,
	withOffline: boolean,
	startedAt: number,
): Promise<void> {
	const day = today(deps.timeZone, new Date(startedAt));
	let code: ErrorCode | null = null;
	let written = 0;
	let failed = 0;
	let fetched = 0;
	let turnedOff = false;

	try {
		const held = await heldSecurities(deps);
		const fromOf = new Map(held.map(({ securityId, from }) => [securityId, from]));
		const rows = await deps.db
			.select({
				id: securities.id,
				ticker: securities.ticker,
				mic: securities.mic,
				currency: securities.currency,
				firstPriceOn: securities.firstPriceOn,
			})
			.from(securities)
			.where(
				and(
					inArray(securities.id, [...fromOf.keys()]),
					eq(securities.provider, provider.id),
					isNotNull(securities.ticker),
					withOffline ? undefined : eq(securities.offline, false),
				),
			)
			.orderBy(asc(securities.createdAt), asc(securities.id));

		// One at a time, as `syncAll` runs: a provider throttles a burst. Once
		// the provider has failed, the rest wait for the next run; once the
		// owner has turned fetching off, they are never asked for.
		await rows.reduce<Promise<void>>(async (previous, security) => {
			await previous;

			if (code === "PRICE_PROVIDER_ERROR" || turnedOff) {
				return;
			}

			if ((await enabledProvider(deps)) === null) {
				turnedOff = true;
				return;
			}

			try {
				written += await priceSecurity(deps, provider, security, fromOf.get(security.id)!, day);
				fetched += 1;
			} catch (error) {
				const failure = codeOf(error);
				failed += 1;
				deps.logger.warn({ securityId: security.id, code: failure }, "security price fetch failed");

				if (failure === "PRICE_UNAVAILABLE") {
					await countFailure(deps, security.id);
				}

				code = failure === "PRICE_PROVIDER_ERROR" ? failure : (code ?? failure);
			}
		}, Promise.resolve());
	} catch (error) {
		code = codeOf(error);
	}

	await finish(deps, { code, startedAt, written, fetched, failed });
}

/** Writes the run's end, and logs it. A failure here is logged: the lease then frees itself. */
async function finish(
	deps: PriceDeps,
	{
		code,
		startedAt,
		written,
		fetched,
		failed,
	}: {
		code: ErrorCode | null;
		startedAt: number;
		written: number;
		fetched: number;
		failed: number;
	},
): Promise<void> {
	const now = Date.now();

	try {
		await deps.db.transaction(
			async (tx) => {
				await writeSettings(
					{ db: tx },
					{
						[FINISHED]: String(now),
						// The provider answered for every security it was asked about.
						...(code === null || code === "PRICE_UNAVAILABLE" ? { [UPDATED]: String(now) } : {}),
						...(code === null ? {} : { [LAST_ERROR]: code }),
					},
					now,
				);

				if (code === null) {
					await tx.delete(settings).where(eq(settings.key, LAST_ERROR));
				}
			},
			{ behavior: "immediate" },
		);
	} catch (error) {
		deps.logger.error({ code: codeOf(error) }, "price update failed to finish");
	}

	deps.logger.info(
		{ fetched, failed, written, durationMs: now - startedAt, code },
		"security prices updated",
	);
}

/**
 * « Mettre à jour les cours »: a run now, offline securities included, which
 * the button retries; it answers once the run is over. `PRICES_DISABLED`
 * while fetching is off, `PRICE_UPDATE_IN_PROGRESS` while a run holds the
 * lease.
 */
export async function updatePrices(deps: PriceDeps): Promise<PriceStatus> {
	const provider = await enabledProvider(deps);
	const now = Date.now();
	const lease = provider === null ? "disabled" : await takeLease(deps, now, false);

	if (provider === null || lease === "disabled") {
		throw new AppError("PRICES_DISABLED", "Price fetching is off.");
	}

	if (lease !== "taken") {
		throw new AppError("PRICE_UPDATE_IN_PROGRESS", "Prices are already being updated.");
	}

	await run(deps, provider, true, now);

	return priceStatus(deps);
}

/** The first visit's run, once its lease is taken; never rejects. */
export type DailyPriceRun = { run: () => Promise<void> };

/**
 * The first signed-in request of the day, in `APP_TIMEZONE`, fetches the
 * day's prices beside it, as the bank sync (AD-18): only the lease is
 * awaited, a local write, and `run` reads the provider once the request has
 * answered. `null` while fetching is off, when a run holds the lease, or
 * once the day's run has started. Offline securities wait for the button.
 */
export async function startDailyPrices(deps: PriceDeps): Promise<DailyPriceRun | null> {
	const provider = await enabledProvider(deps);

	if (provider === null) {
		return null;
	}

	const now = Date.now();
	const state = await runState(deps);

	// Every page load comes here: a plain read settles it once the day's run
	// has started, and only a due run opens the write transaction.
	if (isHeld(state, now) || startedToday(deps, state, now)) {
		return null;
	}

	return (await takeLease(deps, now, true)) === "taken"
		? { run: () => run(deps, provider, false, now) }
		: null;
}

/** A price typed by hand, as « Saisir un cours » answers it. */
export type TypedPrice = {
	securityId: string;
	date: IsoDate;
	/** Per unit, in the security's currency. */
	price: string;
	currency: string;
	source: "manual";
};

/**
 * « Saisir un cours », as Sure's holding drawer: a day's price for a security
 * no provider prices, with none or offline, on the user's behalf. One
 * immediate transaction writes it, replacing any price of that day, and
 * revalues its holders from that day, as a fetch does (AD-22); no fetch
 * overwrites it. A security its provider prices is refused with
 * `PRICE_FROM_PROVIDER`.
 */
export async function typePrice(
	deps: ServiceDeps,
	securityId: string,
	input: TypedPriceInput,
): Promise<TypedPrice> {
	const parsed = typedPriceSchema(today(deps.timeZone)).safeParse(input);

	if (!parsed.success) {
		throw validationError(parsed.error);
	}

	const { date, price } = parsed.data;
	// Read in the transaction that writes: a fetch that just set the security
	// back online would otherwise see its price shadowed by this one.
	const currency = await deps.db.transaction(
		async (tx) => {
			const security = await tx
				.select({
					currency: securities.currency,
					provider: securities.provider,
					offline: securities.offline,
				})
				.from(securities)
				.where(eq(securities.id, securityId))
				.get();

			if (security === undefined) {
				throw new AppError("NOT_FOUND", "No security has this id.");
			}

			if (security.provider !== null && !security.offline) {
				throw new AppError("PRICE_FROM_PROVIDER", "This security's prices come from its provider.");
			}

			await tx
				.insert(securityPrices)
				.values({
					securityId,
					date,
					price,
					currency: security.currency,
					provisional: false,
					source: "manual",
				})
				.onConflictDoUpdate({
					target: [securityPrices.securityId, securityPrices.date],
					set: { price, currency: security.currency, provisional: false, source: "manual" },
				});
			await revalueHoldings(tx, securityId, date, deps.timeZone, { origin: "user" });

			return security.currency;
		},
		{ behavior: "immediate" },
	);

	return {
		securityId,
		date,
		price: formatMicros(price),
		currency,
		source: "manual",
	};
}
