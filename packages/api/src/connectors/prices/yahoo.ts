import type { IsoDate } from "../../domain/dates.ts";
import type {
	DailyPrices,
	PriceProvider,
	PriceProviderConfig,
	PriceRequest,
	SecurityMatch,
} from "./price-provider.ts";

import { randomInt } from "node:crypto";
import { z } from "zod";

import type { Micros } from "@archant/data/micros";
import { divideHalfEven, parseMicros, toMicros } from "@archant/data/micros";
import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode } from "@archant/data/money";

import { AppError } from "../../lib/errors.ts";
import { priceUnavailable } from "./price-provider.ts";

// Sure's `Provider::YahooFinance`, its chart and search endpoints only: no
// cookie, no crumb, which only `quoteSummary` needs, and no retry, since a
// price that fails today is fetched again tomorrow.

/** Sure's 10-second `timeout`: a request stuck longer is not coming back. */
const TIMEOUT_MS = 10_000;

/** Sure's `quotesCount`. */
const QUOTES_COUNT = 25;

/**
 * Sure's `USER_AGENTS`, rotated as Sure does: Yahoo blocks a client that
 * does not look like a browser.
 */
const USER_AGENTS = [
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0",
] as const;

/**
 * Sure's `EXCHANGE_CONFIG`: the suffix Yahoo puts after a venue's tickers,
 * and the venue's usual currency. A MIC missing here is sent bare, which for
 * any listing outside the United States is a 404.
 */
const EXCHANGES: Record<string, { suffix: string; currency: CurrencyCode }> = {
	XNSE: { suffix: ".NS", currency: "INR" },
	XBOM: { suffix: ".BO", currency: "INR" },
	XBOG: { suffix: ".CL", currency: "COP" },
	XIDX: { suffix: ".JK", currency: "IDR" },
	XETR: { suffix: ".DE", currency: "EUR" },
	XFRA: { suffix: ".F", currency: "EUR" },
	XMUN: { suffix: ".MU", currency: "EUR" },
	XSTU: { suffix: ".SG", currency: "EUR" },
	XLON: { suffix: ".L", currency: "GBP" },
	XPAR: { suffix: ".PA", currency: "EUR" },
	XAMS: { suffix: ".AS", currency: "EUR" },
	XBRU: { suffix: ".BR", currency: "EUR" },
	XLIS: { suffix: ".LS", currency: "EUR" },
	XMAD: { suffix: ".MC", currency: "EUR" },
	XMIL: { suffix: ".MI", currency: "EUR" },
	XSWX: { suffix: ".SW", currency: "CHF" },
	XSTO: { suffix: ".ST", currency: "SEK" },
	XCSE: { suffix: ".CO", currency: "DKK" },
	XHEL: { suffix: ".HE", currency: "EUR" },
	XOSL: { suffix: ".OL", currency: "NOK" },
	XWBO: { suffix: ".VI", currency: "EUR" },
};

/**
 * Sure's `map_exchange_mic`: Yahoo's exchange codes and their MIC. Sure
 * keeps an unknown code as it is; here the symbol's suffix decides instead,
 * since a Yahoo code such as `MIL` is no MIC.
 */
const EXCHANGE_MICS: Record<string, string> = {
	NMS: "XNAS",
	NGM: "XNAS",
	NCM: "XNAS",
	NYQ: "XNYS",
	PCX: "ARCX",
	PSX: "ARCX",
	ASE: "XASE",
	AMX: "XASE",
	YHD: "XNAS",
	TSE: "XTSE",
	TOR: "XTSE",
	CVE: "XTSX",
	LSE: "XLON",
	LON: "XLON",
	FRA: "XFRA",
	PAR: "XPAR",
	AMS: "XAMS",
	BRU: "XBRU",
	SWX: "XSWX",
	HKG: "XHKG",
	TYO: "XJPX",
	ASX: "XASX",
	NSE: "XNSE",
	NSI: "XNSE",
	BSE: "XBOM",
	BOM: "XBOM",
	BVC: "XBOG",
	JKT: "XIDX",
};

/**
 * Sure's `MINOR_CURRENCY_CONVERSIONS`: London quotes in pence and
 * Johannesburg in cents, which are a hundredth of the ISO currency.
 */
const MINOR_CURRENCIES: Record<string, CurrencyCode> = { GBp: "GBP", ZAc: "ZAR" };

// Every answer is parsed, as any input crossing a boundary. Objects drop the
// keys they do not name, so nothing unread travels further than this file.

const searchSchema = z.object({ quotes: z.array(z.unknown()).nullish() });

const quoteSchema = z.object({
	symbol: z.string().trim().min(1),
	longname: z.string().nullish(),
	shortname: z.string().nullish(),
	exchange: z.string().nullable().default(null),
});

const chartSchema = z.object({
	chart: z.object({
		result: z
			.array(
				z.object({
					meta: z.object({
						currency: z.string().nullish(),
						/**
						 * Seconds the venue's clock runs ahead of UTC. Absent, the day is
						 * read in UTC, as Sure reads every bar.
						 */
						gmtoffset: z.number().int().default(0),
						/** How many decimals the venue quotes, which Yahoo's floats blur. */
						priceHint: z.number().int().nullish(),
					}),
					timestamp: z.array(z.number().int()).nullish(),
					indicators: z.object({
						quote: z.array(z.object({ close: z.array(z.number().nullable()).nullish() })),
					}),
				}),
			)
			.nullish(),
		// Yahoo sends `null` when there is none; absent reads the same.
		error: z.unknown().default(null),
	}),
});

const providerError = () =>
	new AppError("PRICE_PROVIDER_ERROR", "The price provider request failed.");

/**
 * Sure's `decimal(19,4)` prices: four decimals when Yahoo gives no
 * `priceHint`, never more than the six millionths hold.
 */
const DEFAULT_DECIMALS = 4;

/** Yahoo's demand for a cookie and a crumb, sent with a 200: Yahoo's state, not the listing's. */
const unauthorizedSchema = z.object({ code: z.literal("Unauthorized") });

/** Sure's `normalize_symbol`: the ticker with its venue's suffix, unless it already ends with it. */
export function yahooSymbol(ticker: string, mic: string | null): string {
	const suffix = mic === null ? undefined : EXCHANGES[mic]?.suffix;

	// Case aside, as the unique index compares tickers.
	return suffix === undefined || ticker.toUpperCase().endsWith(suffix)
		? ticker
		: `${ticker}${suffix}`;
}

/** The MIC of a search result: from Yahoo's exchange code, else from the symbol's suffix. */
export function micOf(exchange: string | null, symbol: string): string | null {
	const mapped = exchange === null ? undefined : EXCHANGE_MICS[exchange.trim().toUpperCase()];

	return (
		mapped ??
		Object.entries(EXCHANGES).find(([, { suffix }]) => symbol.endsWith(suffix))?.[0] ??
		null
	);
}

/** A bar's calendar day: its timestamp on the venue's clock, as Yahoo dates it. */
export function priceDate(timestamp: number, gmtoffset: number): IsoDate {
	return new Date((timestamp + gmtoffset) * 1000).toISOString().slice(0, 10);
}

/**
 * A close as millionths, rounded half to even to the venue's `decimals`, so
 * Yahoo's float noise (612.4000244140625) is not stored; a close in pence or
 * cents is then divided by 100. `null` when it is missing, not a plain
 * decimal, or not positive.
 */
function closeOf(
	close: number | null | undefined,
	decimals: number,
	minor: boolean,
): Micros | null {
	const parsed = typeof close === "number" ? parseMicros(String(close)) : null;

	if (parsed === null) {
		return null;
	}

	const step = 10n ** BigInt(6 - decimals);
	const rounded = divideHalfEven(BigInt(parsed), step) * step;
	const price = toMicros(Number(minor ? divideHalfEven(rounded, 100n) : rounded));

	return price > 0 ? price : null;
}

/** Epoch seconds of `date` at `time` UTC, as Sure's `period1` and `period2`. */
const epochSeconds = (date: IsoDate, time: string) => Date.parse(`${date}T${time}Z`) / 1000;

/** The URL without its trailing slashes; a loop, as the bank client's, never a backtracking regex. */
function withoutTrailingSlashes(url: string): string {
	let end = url.length;

	while (url[end - 1] === "/") {
		end -= 1;
	}

	return url.slice(0, end);
}

/** Sure's `toMatch`: Yahoo's long name, else its short name, else the symbol. */
function nameOf(quote: z.output<typeof quoteSchema>): string {
	return (
		[quote.longname, quote.shortname].find(
			(name): name is string => typeof name === "string" && name.trim() !== "",
		) ?? quote.symbol
	);
}

/** Yahoo Finance behind the price port, after Sure's `Provider::YahooFinance`. */
export function createYahooProvider(config: PriceProviderConfig): PriceProvider {
	const base = withoutTrailingSlashes(config.apiUrl);

	/** One GET with Sure's headers; a request that never answers is a provider error. */
	async function get(path: string, query: Record<string, string>) {
		let response: Response;

		try {
			response = await fetch(`${base}${path}?${new URLSearchParams(query).toString()}`, {
				headers: {
					"user-agent": USER_AGENTS[randomInt(USER_AGENTS.length)]!,
					accept: "application/json",
					"accept-language": "en-US,en;q=0.9",
					"cache-control": "no-cache",
					pragma: "no-cache",
				},
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		} catch {
			throw providerError();
		}

		// A body that is not JSON reads as `null`, which no schema accepts.
		const body: unknown = await response.json().catch(() => null);

		return { status: response.status, ok: response.ok, body };
	}

	async function searchSecurities(query: string): Promise<SecurityMatch[]> {
		const { ok, body } = await get("/v1/finance/search", {
			q: query.trim().toUpperCase(),
			quotesCount: String(QUOTES_COUNT),
		});
		const parsed = searchSchema.safeParse(body);

		if (!ok || !parsed.success) {
			throw providerError();
		}

		// One odd quote costs that quote, not the search.
		return (parsed.data.quotes ?? []).flatMap((item) => {
			const quote = quoteSchema.safeParse(item);

			if (!quote.success) {
				return [];
			}

			const mic = micOf(quote.data.exchange, quote.data.symbol);

			return [
				{
					ticker: quote.data.symbol,
					name: nameOf(quote.data),
					mic,
					currency: mic === null ? null : (EXCHANGES[mic]?.currency ?? null),
					provider: "yahoo",
				},
			];
		});
	}

	async function dailyPrices({ ticker, mic, from, to }: PriceRequest): Promise<DailyPrices> {
		const { status, ok, body } = await get(
			`/v8/finance/chart/${encodeURIComponent(yahooSymbol(ticker, mic))}`,
			{
				period1: String(epochSeconds(from, "00:00:00")),
				period2: String(epochSeconds(to, "23:59:59")),
				interval: "1d",
			},
		);

		const parsed = chartSchema.safeParse(body);

		// Yahoo's answers about the listing itself: a symbol it does not know
		// (404), or one with no data over the range (400, « Data doesn't
		// exist »), both with a `chart.error`. The next listing may still answer.
		if (parsed.success && unauthorizedSchema.safeParse(parsed.data.chart.error).success) {
			throw providerError();
		}

		if (status === 404 || (status === 400 && parsed.success && parsed.data.chart.error !== null)) {
			throw priceUnavailable();
		}

		if (!ok || !parsed.success) {
			throw providerError();
		}

		const { result, error } = parsed.data.chart;
		const series = result?.[0];

		if (error !== null || series === undefined) {
			throw priceUnavailable();
		}

		// Sure's `default_currency_for_exchange` when Yahoo names none.
		const quoted =
			series.meta.currency ?? (mic === null ? undefined : EXCHANGES[mic]?.currency) ?? "";
		const minor = MINOR_CURRENCIES[quoted];
		const currency = minor ?? quoted;

		if (!isCurrencyCode(currency)) {
			throw priceUnavailable();
		}

		const closes = series.indicators.quote[0]?.close ?? [];
		const decimals = Math.min(Math.max(series.meta.priceHint ?? DEFAULT_DECIMALS, 0), 6);
		// A day seen twice keeps its last bar, as the latest one of a session is.
		const byDate = new Map<IsoDate, Micros>();

		for (const [index, timestamp] of (series.timestamp ?? []).entries()) {
			const price = closeOf(closes[index], decimals, minor !== undefined);

			if (price !== null) {
				byDate.set(priceDate(timestamp, series.meta.gmtoffset), price);
			}
		}

		if (byDate.size === 0) {
			throw priceUnavailable();
		}

		const prices = [...byDate]
			.map(([date, price]) => ({ date, price }))
			.toSorted((a, b) => a.date.localeCompare(b.date));

		return { currency, prices };
	}

	return { id: "yahoo", searchSecurities, dailyPrices };
}
