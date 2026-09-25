import type { GroupCandidate, PendingCandidate } from "./pending.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { absorbPending, assignIdentical } from "./pending.ts";

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
	it("takes the pending entry of the same amount within 5 days either side", () => {
		expect(survivors([booked("2026-09-23")], [pending("p1", "2026-09-18")])).toEqual(["p1"]);
		expect(survivors([booked("2026-09-13")], [pending("p1", "2026-09-18")])).toEqual(["p1"]);
		expect(survivors([booked("2026-09-24")], [pending("p1", "2026-09-18")])).toEqual([null]);
		expect(survivors([booked("2026-09-20")], [pending("p1", "2026-09-10")])).toEqual([null]);
		expect(survivors([booked("2026-09-20", -330)], [pending("p1", "2026-09-20")])).toEqual([null]);
	});

	it("takes the nearest date first, then the oldest entry, then the smaller id", () => {
		expect(
			survivors([booked("2026-09-22")], [pending("p1", "2026-09-20"), pending("p2", "2026-09-22")]),
		).toEqual(["p2"]);
		expect(
			survivors(
				[booked("2026-09-22")],
				[pending("p1", "2026-09-21", -320, 2), pending("p2", "2026-09-23", -320, 1)],
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

const assigned = (lines: string[], candidates: GroupCandidate[]) =>
	assignIdentical(
		lines.map((name) => ({ name, referenced: name.startsWith("r") })),
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

	it("leaves every line over without a candidate, and needs no line", () => {
		expect(assigned(["l1"], [])).toEqual([["l1", null]]);
		expect(assigned([], [candidate("e1", 0)])).toEqual([]);
	});
});
