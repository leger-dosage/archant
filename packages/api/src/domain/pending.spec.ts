import type { GroupCandidate, PendingCandidate, SuggestionCandidate } from "./pending.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { absorbPending, assignIdentical, labelWords, suggestPostedMatch } from "./pending.ts";

const booked = (date: string, amount = -320) => ({ date, amount: toMinorUnits(amount) });

const pending = (id: string, date: string, amount = -320, createdAt = 0): PendingCandidate => ({
	id,
	date,
	amount: toMinorUnits(amount),
	createdAt,
});

const survivors = (lines: ReturnType<typeof booked>[], candidates: PendingCandidate[]) =>
	absorbPending(lines, candidates).map(({ survivorId }) => survivorId);

describe("absorbPending", () => {
	it("takes the pending entry of the same amount dated 0 to 8 days before, as Sure", () => {
		expect(survivors([booked("2026-09-12")], [pending("p1", "2026-09-12")])).toEqual(["p1"]);
		expect(survivors([booked("2026-09-12")], [pending("p1", "2026-09-04")])).toEqual(["p1"]);
		expect(survivors([booked("2026-09-12")], [pending("p1", "2026-09-03")])).toEqual([null]);
		expect(survivors([booked("2026-09-12")], [pending("p1", "2026-09-13")])).toEqual([null]);
		expect(survivors([booked("2026-09-20", -330)], [pending("p1", "2026-09-20")])).toEqual([null]);
	});

	it("takes the latest date first, then the oldest entry, then the smaller id", () => {
		expect(
			survivors([booked("2026-09-12")], [pending("p1", "2026-09-05"), pending("p2", "2026-09-10")]),
		).toEqual(["p2"]);
		expect(
			survivors(
				[booked("2026-09-22")],
				[pending("p1", "2026-09-21", -320, 2), pending("p2", "2026-09-21", -320, 1)],
			),
		).toEqual(["p2"]);
		expect(
			survivors([booked("2026-09-22")], [pending("p2", "2026-09-21"), pending("p1", "2026-09-21")]),
		).toEqual(["p1"]);
	});

	it("lets one pending entry absorb one line at most", () => {
		expect(
			survivors(
				[booked("2026-09-22"), booked("2026-09-22"), booked("2026-09-22")],
				[pending("p1", "2026-09-22"), pending("p2", "2026-09-20")],
			),
		).toEqual(["p1", "p2", null]);
	});
});

const candidate = (
	id: string,
	occurrence: number,
	createdAt = 0,
	referenced = false,
): GroupCandidate => ({ id, occurrence, createdAt, referenced });

/** `l1` is a line, `r1` one with a reference, `l1=e1` one whose fingerprint `e1` holds. */
const assigned = (lines: string[], candidates: GroupCandidate[]) =>
	assignIdentical(
		lines.map((spec) => {
			const [name = "", holder = null] = spec.split("=");

			return { name, referenced: name.startsWith("r"), holder };
		}),
		candidates,
	).map(({ line, entryId }) => [line.name, entryId]);

describe("assignIdentical", () => {
	it("gives the lines the last candidates when there are more candidates", () => {
		expect(assigned(["l1"], [candidate("e2", 1), candidate("e1", 0)])).toEqual([["l1", "e2"]]);
	});

	it("leaves the first lines over when there are more lines", () => {
		expect(assigned(["l1", "l2", "l3"], [candidate("e1", 0)])).toEqual([
			["l1", null],
			["l2", null],
			["l3", "e1"],
		]);
	});

	it("pairs each line with a candidate, in order, when they are as many", () => {
		expect(
			assigned(
				["l1", "l2", "l3"],
				[candidate("e3", 1, 5), candidate("e2", 1, 2), candidate("e1", 0, 9)],
			),
		).toEqual([
			["l1", "e1"],
			["l2", "e2"],
			["l3", "e3"],
		]);
		expect(assigned(["l1", "l2"], [candidate("b", 0, 1), candidate("a", 0, 1)])).toEqual([
			["l1", "a"],
			["l2", "b"],
		]);
	});

	it("never gives a line with a reference a candidate with one", () => {
		expect(assigned(["l1", "r2"], [candidate("e1", 0), candidate("e2", 1, 0, true)])).toEqual([
			["l1", "e2"],
			["r2", "e1"],
		]);
		expect(assigned(["r1"], [candidate("e1", 0, 0, true)])).toEqual([["r1", null]]);
	});

	it("gives a line the candidate holding its fingerprint when the group did not shrink", () => {
		expect(assigned(["l1=e1", "l2"], [candidate("e1", 0)])).toEqual([
			["l1", "e1"],
			["l2", null],
		]);
		expect(assigned(["l1", "l2=e2"], [candidate("e2", 1)])).toEqual([
			["l1", null],
			["l2", "e2"],
		]);
		expect(assigned(["l1=e1", "l2=e1"], [candidate("e1", 0), candidate("e2", 1)])).toEqual([
			["l1", "e1"],
			["l2", "e2"],
		]);
		expect(assigned(["r1=e1"], [candidate("e1", 0, 0, true)])).toEqual([["r1", null]]);
	});

	it("ignores the fingerprint's holder once the group shrank, since its index shifted", () => {
		expect(assigned(["l1=e1"], [candidate("e1", 0), candidate("e2", 1)])).toEqual([["l1", "e2"]]);
	});

	it("leaves every line over without a candidate, and needs no line", () => {
		expect(assigned(["l1"], [])).toEqual([["l1", null]]);
		expect(assigned([], [candidate("e1", 0)])).toEqual([]);
	});
});

const posted = (
	amount: number,
	merchantId: string | null = "m1",
	label = "Le Bistrot Paris 75",
) => ({
	date: "2026-09-12",
	amount: toMinorUnits(amount),
	merchantId,
	label,
});

const suggestible = (
	id: string,
	amount: number,
	{
		date = "2026-09-11",
		merchantId = "m1",
		label = "LE BISTROT PARIS 75 CB",
	}: { date?: string; merchantId?: string | null; label?: string } = {},
): SuggestionCandidate => ({ id, date, amount: toMinorUnits(amount), merchantId, label });

/** What a booked line of `postedAmount` suggests among one pending entry of `amount`, dated `date`. */
const pairOf = (postedAmount: number, amount: number, date?: string) =>
	suggestPostedMatch(posted(postedAmount), [
		suggestible("p1", amount, date === undefined ? {} : { date }),
	]);

describe("labelWords", () => {
	it("keeps the first three words, lower-cased, with only ASCII letters and digits, as Sure", () => {
		expect(labelWords("CB  Café-Bar\tN°12 Paris")).toBe("cb cafbar n12");
		expect(labelWords("  Uber   ")).toBe("uber");
		expect(labelWords("€ — ·")).toBe("");
		expect(labelWords("")).toBe("");
	});
});

describe("suggestPostedMatch", () => {
	it("suggests a tip's pending entry, with medium confidence, by merchant", () => {
		expect(suggestPostedMatch(posted(-2300), [suggestible("p1", -2000)])).toEqual({
			id: "p1",
			confidence: "medium",
		});
	});

	it("keeps to entries dated 0 to 3 days before the line", () => {
		expect(pairOf(-2300, -2000, "2026-09-12")).toEqual({ id: "p1", confidence: "medium" });
		expect(pairOf(-2300, -2000, "2026-09-09")).toEqual({ id: "p1", confidence: "medium" });
		expect(pairOf(-2300, -2000, "2026-09-08")).toBeNull();
		expect(pairOf(-2300, -2000, "2026-09-13")).toBeNull();
	});

	it("bounds the medium band at a line 30 % above the pending amount and at its own amount, sign aside", () => {
		expect(pairOf(-1300, -1000)).toEqual({ id: "p1", confidence: "medium" });
		expect(pairOf(-1300, 1000)).toEqual({ id: "p1", confidence: "medium" });
		expect(pairOf(-1300, -1300)).toEqual({ id: "p1", confidence: "medium" });
		expect(pairOf(-1300, -1301)).toBeNull();
		// A line more than 30 % above falls in the low band.
		expect(pairOf(-1300, -999)).toEqual({ id: "p1", confidence: "low" });
	});

	it("bounds the low band from a line about 30 % above the pending amount to double it", () => {
		expect(pairOf(-2000, -1200)).toEqual({ id: "p1", confidence: "low" });
		expect(pairOf(-2000, -1000)).toEqual({ id: "p1", confidence: "low" });
		expect(pairOf(-2000, -1540)).toEqual({ id: "p1", confidence: "medium" });
		expect(pairOf(-2000, -999)).toBeNull();
		expect(suggestPostedMatch(posted(-10000), [suggestible("p1", -7700)])).toEqual({
			id: "p1",
			confidence: "medium",
		});
		expect(suggestPostedMatch(posted(-100000), [suggestible("p1", -77001)])).toEqual({
			id: "p1",
			confidence: "medium",
		});
	});

	it("lets the label words decide between two entries of the merchant, else suggests none", () => {
		expect(
			suggestPostedMatch(posted(-2300), [
				suggestible("p1", -2000),
				suggestible("p2", -2100, { label: "Autre chose" }),
			]),
		).toEqual({ id: "p1", confidence: "medium" });
		expect(
			suggestPostedMatch(posted(-2300), [suggestible("p1", -2000), suggestible("p2", -2100)]),
		).toBeNull();
	});

	it("falls back on the label words without a merchant, or with another one", () => {
		expect(
			suggestPostedMatch(posted(-2300, null), [suggestible("p1", -2000, { merchantId: null })]),
		).toEqual({ id: "p1", confidence: "medium" });
		expect(
			suggestPostedMatch(posted(-2300), [suggestible("p1", -2000, { merchantId: "m2" })]),
		).toEqual({ id: "p1", confidence: "medium" });
		expect(
			suggestPostedMatch(posted(-2300, "m1", "Autre"), [
				suggestible("p1", -2000, { merchantId: "m2" }),
			]),
		).toBeNull();
		expect(
			suggestPostedMatch(posted(-2300, null, "€"), [suggestible("p1", -2000, { label: "€" })]),
		).toBeNull();
	});

	it("wants the merchant and the words for a low suggestion, and exactly one entry", () => {
		expect(suggestPostedMatch(posted(-2000), [suggestible("p1", -1200)])).toEqual({
			id: "p1",
			confidence: "low",
		});
		expect(
			suggestPostedMatch(posted(-2000), [suggestible("p1", -1200, { merchantId: "m2" })]),
		).toBeNull();
		expect(
			suggestPostedMatch(posted(-2000), [suggestible("p1", -1200, { label: "Autre" })]),
		).toBeNull();
		expect(
			suggestPostedMatch(posted(-2000, null), [suggestible("p1", -1200, { merchantId: null })]),
		).toBeNull();
		expect(
			suggestPostedMatch(posted(-2000, "m1", "€"), [suggestible("p1", -1200, { label: "€" })]),
		).toBeNull();
		expect(
			suggestPostedMatch(posted(-2000), [suggestible("p1", -1200), suggestible("p2", -1100)]),
		).toBeNull();
	});

	it("tries the low band only when the medium one finds none", () => {
		expect(
			suggestPostedMatch(posted(-2000), [
				suggestible("p1", -1200),
				suggestible("p2", -1800, { merchantId: "m2" }),
			]),
		).toEqual({ id: "p2", confidence: "medium" });
	});
});
