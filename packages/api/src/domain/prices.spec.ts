import { describe, expect, it } from "vitest";

import type { Micros } from "@archant/data/micros";
import { toMicros } from "@archant/data/micros";

import { fillPrices, priceWindow } from "./prices.ts";

const close = (date: string, price: number) => ({ date, price: toMicros(price) });

describe("priceWindow", () => {
	const today = "2026-09-21";

	it("starts on the day the security is held from when nothing is stored", () => {
		expect(priceWindow({ from: "2026-09-14", firstPriceOn: null, stored: null, today })).toEqual({
			start: "2026-09-14",
			requestFrom: "2026-09-07",
		});
	});

	it("never starts before the provider's first day", () => {
		expect(
			priceWindow({ from: "2026-09-01", firstPriceOn: "2026-09-16", stored: null, today }),
		).toEqual({ start: "2026-09-16", requestFrom: "2026-09-09" });
		expect(
			priceWindow({ from: "2026-09-18", firstPriceOn: "2026-09-16", stored: null, today }),
		).toEqual({ start: "2026-09-18", requestFrom: "2026-09-11" });
	});

	it("starts again from the day held from when it comes before the first stored price", () => {
		expect(
			priceWindow({
				from: "2026-09-01",
				firstPriceOn: null,
				stored: { first: "2026-09-14", last: "2026-09-21", earliestProvisional: "2026-09-14" },
				today,
			}),
		).toEqual({ start: "2026-09-01", requestFrom: "2026-08-25" });
	});

	it("starts at the earliest provisional row, which it writes again", () => {
		expect(
			priceWindow({
				from: "2026-09-14",
				firstPriceOn: null,
				stored: { first: "2026-09-14", last: "2026-09-21", earliestProvisional: "2026-09-14" },
				today: "2026-09-22",
			}),
		).toEqual({ start: "2026-09-14", requestFrom: "2026-09-07" });
	});

	it("starts the day after the last row when none is provisional", () => {
		expect(
			priceWindow({
				from: "2026-08-01",
				firstPriceOn: "2026-08-03",
				stored: { first: "2026-08-03", last: "2026-09-10", earliestProvisional: null },
				today,
			}),
		).toEqual({ start: "2026-09-11", requestFrom: "2026-09-04" });
	});

	it("asks for nothing once today is stored for good", () => {
		expect(
			priceWindow({
				from: "2026-09-14",
				firstPriceOn: null,
				stored: { first: "2026-09-14", last: today, earliestProvisional: null },
				today,
			}),
		).toBeNull();
	});

	it("reaches ten years back at most", () => {
		expect(priceWindow({ from: "2001-03-12", firstPriceOn: null, stored: null, today })).toEqual({
			start: "2016-09-21",
			requestFrom: "2016-09-21",
		});
		expect(priceWindow({ from: "2016-09-25", firstPriceOn: null, stored: null, today })).toEqual({
			start: "2016-09-25",
			requestFrom: "2016-09-21",
		});
	});
});

describe("fillPrices", () => {
	const none = new Map<string, Micros>();

	it("writes every day from the start, carrying the weekend, the last seven provisional", () => {
		// The matrix's first fetch: held from Monday 14, today Monday 21.
		const closes = [
			close("2026-09-11", 609_799_988),
			close("2026-09-14", 604_500_000),
			close("2026-09-15", 611_099_976),
			close("2026-09-18", 625_000_000),
			close("2026-09-21", 628_100_037),
		];

		expect(
			fillPrices({
				start: "2026-09-14",
				today: "2026-09-21",
				closes,
				storedBefore: null,
				manual: none,
			}),
		).toEqual({
			rows: [
				{ date: "2026-09-14", price: 604_500_000, provisional: true },
				{ date: "2026-09-15", price: 611_099_976, provisional: true },
				// A holiday and a weekend carry the last close.
				{ date: "2026-09-16", price: 611_099_976, provisional: true },
				{ date: "2026-09-17", price: 611_099_976, provisional: true },
				{ date: "2026-09-18", price: 625_000_000, provisional: true },
				{ date: "2026-09-19", price: 625_000_000, provisional: true },
				{ date: "2026-09-20", price: 625_000_000, provisional: true },
				{ date: "2026-09-21", price: 628_100_037, provisional: true },
			],
			firstPriceOn: null,
		});
	});

	it("leaves out the provisional flag before the last seven days", () => {
		const { rows } = fillPrices({
			start: "2026-09-12",
			today: "2026-09-21",
			closes: [close("2026-09-11", 100)],
			storedBefore: null,
			manual: none,
		});

		expect(rows.map(({ date, provisional }) => `${date} ${String(provisional)}`)).toEqual([
			"2026-09-12 false",
			"2026-09-13 false",
			"2026-09-14 true",
			"2026-09-15 true",
			"2026-09-16 true",
			"2026-09-17 true",
			"2026-09-18 true",
			"2026-09-19 true",
			"2026-09-20 true",
			"2026-09-21 true",
		]);
	});

	it("carries the last stored row when the provider has nothing before the start", () => {
		expect(
			fillPrices({
				start: "2026-09-19",
				today: "2026-09-21",
				closes: [close("2026-09-21", 300)],
				storedBefore: toMicros(200),
				manual: none,
			}),
		).toEqual({
			rows: [
				{ date: "2026-09-19", price: 200, provisional: true },
				{ date: "2026-09-20", price: 200, provisional: true },
				{ date: "2026-09-21", price: 300, provisional: true },
			],
			firstPriceOn: null,
		});
	});

	it("skips the days before any known price, recording the provider's first day", () => {
		expect(
			fillPrices({
				start: "2026-09-14",
				today: "2026-09-18",
				closes: [close("2026-09-16", 100), close("2026-09-17", 110)],
				storedBefore: null,
				manual: none,
			}),
		).toEqual({
			rows: [
				{ date: "2026-09-16", price: 100, provisional: true },
				{ date: "2026-09-17", price: 110, provisional: true },
				{ date: "2026-09-18", price: 110, provisional: true },
			],
			firstPriceOn: "2026-09-16",
		});
	});

	it("writes nothing and records nothing when no price is known at all", () => {
		expect(
			fillPrices({
				start: "2026-09-14",
				today: "2026-09-15",
				closes: [],
				storedBefore: null,
				manual: none,
			}),
		).toEqual({ rows: [], firstPriceOn: null });
	});

	it("never writes over a typed price, and carries it", () => {
		expect(
			fillPrices({
				start: "2026-09-17",
				today: "2026-09-20",
				closes: [close("2026-09-16", 100), close("2026-09-17", 105), close("2026-09-18", 110)],
				storedBefore: null,
				manual: new Map([
					["2026-09-18", toMicros(999)],
					["2026-09-17", toMicros(950)],
				]),
			}),
		).toEqual({
			rows: [
				{ date: "2026-09-19", price: 999, provisional: true },
				{ date: "2026-09-20", price: 999, provisional: true },
			],
			firstPriceOn: null,
		});
	});
});
