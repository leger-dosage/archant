import type { UncategorisedLine } from "./categorise-groups.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { groupUncategorised } from "./categorise-groups.ts";

let next = 0;

const line = (
	label: string,
	amount: number,
	merchant: { id: string; name: string } | null = null,
): UncategorisedLine => ({
	id: `line-${(next += 1)}`,
	label,
	amount: toMinorUnits(amount),
	merchantId: merchant?.id ?? null,
	merchantName: merchant?.name ?? null,
});

const summary = (lines: UncategorisedLine[]) =>
	groupUncategorised(lines).map((group) => [group.name, group.type, group.ids.length]);

describe("groupUncategorised", () => {
	it("puts the largest group first, then sorts by name, each sign apart", () => {
		expect(
			summary([
				line("Spotify", -999),
				line("Netflix", -1599),
				line("Netflix", 1599),
				line("Netflix", -1599),
				line("Spotify", -999),
				line("Netflix", -1599),
			]),
		).toEqual([
			["Netflix", "expense", 3],
			["Spotify", "expense", 2],
			["Netflix", "income", 1],
		]);
	});

	it("groups by the merchant's name before the label, and keeps that merchant", () => {
		const amazon = { id: "amazon", name: "Amazon" };
		const groups = groupUncategorised([
			line("Amazon", -500),
			line("CB AMZN 1", -1000),
			line("CB AMZN 2", -2000, amazon),
			line("CB AMZN 3", -3000, { id: "amazon-twin", name: "Amazon" }),
		]);

		expect(groups.map((group) => [group.name, group.ids.length, group.merchantId])).toEqual([
			["Amazon", 3, "amazon"],
			["CB AMZN 1", 1, null],
		]);
	});

	it("compares names exactly, sorts ties in French order and reads zero as an expense", () => {
		expect(
			summary([line("Épicerie", -100), line("epicerie", -100), line("Zéro", 0), line("Banque", 1)]),
		).toEqual([
			["Banque", "income", 1],
			["epicerie", "expense", 1],
			["Épicerie", "expense", 1],
			["Zéro", "expense", 1],
		]);
	});

	it("puts a name's expenses before its income when both count the same", () => {
		expect(
			summary([
				line("Loyer", 80000),
				line("Loyer", -80000),
				line("Vinted", -500),
				line("Vinted", 500),
			]),
		).toEqual([
			["Loyer", "expense", 1],
			["Loyer", "income", 1],
			["Vinted", "expense", 1],
			["Vinted", "income", 1],
		]);
	});

	it("keeps the lines in the order given, most recent first", () => {
		const lines = [line("Loyer", -80000), line("Loyer", -80000)];

		expect(groupUncategorised(lines)[0]?.ids).toEqual(lines.map((item) => item.id));
	});
});
