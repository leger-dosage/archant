import type { PendingCandidate } from "./pending.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { absorbPending } from "./pending.ts";

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
