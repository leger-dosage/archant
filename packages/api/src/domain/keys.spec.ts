import type { PairCandidate } from "./keys.ts";

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { lineKeys as keyLines, pairLines as pairWithLines, previewDigest } from "./keys.ts";

const lineKeys = (lines: Parameters<typeof keyLines>[0]) => keyLines(lines).map(({ keys }) => keys);

const pairLines = (lines: { date: string; amount: number }[], candidates: PairCandidate[]) =>
	pairWithLines(
		lines.map((item) => ({ ...item, amount: toMinorUnits(item.amount) })),
		candidates,
	).map(({ pairing }) => pairing);

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const line = (
	date: string,
	amount: number,
	label = "Boulangerie",
	externalId: string | null = null,
) => ({
	date,
	amount: toMinorUnits(amount),
	label,
	externalId,
});

describe("lineKeys", () => {
	it("fingerprints date, amount, normalised label and occurrence, and prefixes the external id", () => {
		expect(lineKeys([line("2026-09-12", -4290, "  CB Café ", "A1")])).toEqual([
			{ fingerprint: `fp:${sha256("2026-09-12|-4290|cb cafe|0")}`, external: "ext:A1" },
		]);
	});

	it("gives twin lines their own occurrence index, in statement order", () => {
		const keys = lineKeys([
			line("2026-09-12", -1000, "Péage"),
			line("2026-09-12", -1000, "Boulangerie"),
			line("2026-09-12", -1000, "PEAGE"),
		]);

		expect(keys.map((key) => key.fingerprint)).toEqual([
			`fp:${sha256("2026-09-12|-1000|peage|0")}`,
			`fp:${sha256("2026-09-12|-1000|boulangerie|0")}`,
			`fp:${sha256("2026-09-12|-1000|peage|1")}`,
		]);
		expect(keys.map((key) => key.external)).toEqual([null, null, null]);
	});

	it("hands back each line with its keys", () => {
		const lines = [line("2026-09-12", -1)];

		expect(keyLines(lines)[0]?.line).toBe(lines[0]);
	});

	it("keys the same line the same way whatever its FITID", () => {
		const [first] = lineKeys([line("2026-09-12", -4290, "Boulangerie", "OLD")]);
		const [second] = lineKeys([line("2026-09-12", -4290, "BOULANGERIE", "NEW")]);

		expect(second?.fingerprint).toBe(first?.fingerprint);
		expect(second?.external).not.toBe(first?.external);
	});
});

const candidate = (id: string, date: string, amount: number) => ({
	id,
	date,
	amount: toMinorUnits(amount),
});

describe("pairLines", () => {
	it("pairs a line with the candidate of the same amount within 3 days", () => {
		expect(
			pairLines(
				[{ date: "2026-09-05", amount: -4290 }],
				[candidate("manual", "2026-09-03", -4290)],
			),
		).toEqual([{ kind: "matched", candidateId: "manual" }]);
	});

	it("gives a candidate to the line nearest to it, not to the earliest line", () => {
		expect(
			pairLines(
				[
					{ date: "2026-09-01", amount: -4290 },
					{ date: "2026-09-03", amount: -4290 },
				],
				[candidate("manual", "2026-09-03", -4290)],
			),
		).toEqual([{ kind: "none" }, { kind: "matched", candidateId: "manual" }]);
	});

	it("ignores a candidate 4 days away or of another amount", () => {
		expect(
			pairLines(
				[{ date: "2026-09-05", amount: -4290 }],
				[candidate("far", "2026-09-01", -4290), candidate("other", "2026-09-05", -4291)],
			),
		).toEqual([{ kind: "none" }]);
	});

	it("takes the nearest date, before or after", () => {
		expect(
			pairLines(
				[{ date: "2026-09-05", amount: -1000 }],
				[candidate("two-before", "2026-09-03", -1000), candidate("one-after", "2026-09-06", -1000)],
			),
		).toEqual([{ kind: "matched", candidateId: "one-after" }]);
	});

	it("reports a tie when two candidates are equally near, and uses neither", () => {
		expect(
			pairLines(
				[{ date: "2026-09-05", amount: -1000 }],
				[candidate("before", "2026-09-04", -1000), candidate("after", "2026-09-06", -1000)],
			),
		).toEqual([{ kind: "tie" }]);
	});

	it("lets an exact date choose first, so a neighbour's tie resolves", () => {
		expect(
			pairLines(
				[
					{ date: "2026-09-05", amount: -1000 },
					{ date: "2026-09-06", amount: -1000 },
				],
				[candidate("before", "2026-09-04", -1000), candidate("after", "2026-09-06", -1000)],
			),
		).toEqual([
			{ kind: "matched", candidateId: "before" },
			{ kind: "matched", candidateId: "after" },
		]);
	});

	it("pairs one to one, nearest first, whatever the statement order", () => {
		expect(
			pairLines(
				[
					{ date: "2026-09-07", amount: -500 },
					{ date: "2026-09-05", amount: -500 },
					{ date: "2026-09-06", amount: -500 },
				],
				[candidate("a", "2026-09-05", -500), candidate("b", "2026-09-07", -500)],
			),
		).toEqual([
			{ kind: "matched", candidateId: "b" },
			{ kind: "matched", candidateId: "a" },
			{ kind: "none" },
		]);
	});

	it("hands back each line with its pairing, in the order given", () => {
		const lines = [
			{ date: "2026-09-06", amount: toMinorUnits(-500), ref: "a" },
			{ date: "2026-09-05", amount: toMinorUnits(-500), ref: "b" },
		];

		expect(pairWithLines(lines, [candidate("c", "2026-09-05", -500)])).toEqual([
			{ line: lines[0], pairing: { kind: "none" } },
			{ line: lines[1], pairing: { kind: "matched", candidateId: "c" } },
		]);
	});

	it("returns nothing for no line", () => {
		expect(pairLines([], [candidate("a", "2026-09-05", -500)])).toEqual([]);
	});
});

describe("previewDigest", () => {
	it("ignores the order of the triples", () => {
		const a = { group: "created", ref: "0", entryId: null };
		const b = { group: "matched", ref: "1", entryId: "e1" };

		expect(previewDigest([a, b])).toBe(previewDigest([b, a]));
		expect(previewDigest([a, b])).toMatch(/^[0-9a-f]{64}$/u);
	});

	it("changes when a line moves group or pairs with another entry", () => {
		const base = previewDigest([{ group: "created", ref: "0", entryId: null }]);

		expect(previewDigest([{ group: "matched", ref: "0", entryId: "e1" }])).not.toBe(base);
		expect(previewDigest([{ group: "matched", ref: "0", entryId: "e2" }])).not.toBe(
			previewDigest([{ group: "matched", ref: "0", entryId: "e1" }]),
		);
	});
});
