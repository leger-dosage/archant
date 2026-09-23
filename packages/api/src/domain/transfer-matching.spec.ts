import type { TransferSide } from "./transfer-matching.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import {
	TRANSFER_WINDOW_DAYS,
	isTransferCandidate,
	mutualMatches,
	transferKindOf,
} from "./transfer-matching.ts";

const side = (overrides: Partial<TransferSide> = {}): TransferSide => ({
	kind: "transaction",
	accountId: "checking",
	date: "2026-09-10",
	amount: toMinorUnits(-50000),
	currency: "EUR",
	inTransfer: false,
	...overrides,
});

const outflow = side();
const inflow = side({ accountId: "livret", amount: toMinorUnits(50000) });

describe("isTransferCandidate", () => {
	it("pairs opposite amounts in two accounts of one currency, either way round", () => {
		expect(isTransferCandidate(outflow, inflow)).toBe(true);
		expect(isTransferCandidate(inflow, outflow)).toBe(true);
	});

	it("keeps the window inclusive: 4 days in, 5 out, before or after", () => {
		expect(TRANSFER_WINDOW_DAYS).toBe(4);
		expect(isTransferCandidate(outflow, { ...inflow, date: "2026-09-14" })).toBe(true);
		expect(isTransferCandidate(outflow, { ...inflow, date: "2026-09-06" })).toBe(true);
		expect(isTransferCandidate(outflow, { ...inflow, date: "2026-09-15" })).toBe(false);
		expect(isTransferCandidate(outflow, { ...inflow, date: "2026-09-05" })).toBe(false);
	});

	it("refuses a valuation on either side", () => {
		expect(isTransferCandidate(outflow, { ...inflow, kind: "valuation" })).toBe(false);
		expect(isTransferCandidate({ ...outflow, kind: "valuation" }, inflow)).toBe(false);
	});

	it("refuses amounts that do not sum to zero, and two zeros", () => {
		expect(isTransferCandidate(outflow, { ...inflow, amount: toMinorUnits(49900) })).toBe(false);
		expect(isTransferCandidate(outflow, { ...inflow, amount: toMinorUnits(-50000) })).toBe(false);
		expect(
			isTransferCandidate(
				{ ...outflow, amount: toMinorUnits(0) },
				{ ...inflow, amount: toMinorUnits(0) },
			),
		).toBe(false);
	});

	it("refuses the same account", () => {
		expect(isTransferCandidate(outflow, { ...inflow, accountId: "checking" })).toBe(false);
	});

	it("refuses another currency", () => {
		expect(isTransferCandidate(outflow, { ...inflow, currency: "USD" })).toBe(false);
	});

	it("refuses a side already in a transfer", () => {
		expect(isTransferCandidate(outflow, { ...inflow, inTransfer: true })).toBe(false);
		expect(isTransferCandidate({ ...outflow, inTransfer: true }, inflow)).toBe(false);
	});
});

describe("transferKindOf", () => {
	it("makes a payment into a credit card a card payment", () => {
		expect(transferKindOf("credit_card", "depository")).toBe("credit_card_payment");
		expect(transferKindOf("credit_card", "investment")).toBe("credit_card_payment");
	});

	it("makes a payment into a loan a loan payment, whatever pays it", () => {
		expect(transferKindOf("loan", "depository")).toBe("loan_payment");
		expect(transferKindOf("loan", "credit_card")).toBe("loan_payment");
		expect(transferKindOf("loan", "investment")).toBe("loan_payment");
	});

	it("makes money landing on an investment from a non-investment account a contribution", () => {
		expect(transferKindOf("investment", "depository")).toBe("investment_contribution");
		expect(transferKindOf("investment", "credit_card")).toBe("investment_contribution");
		expect(transferKindOf("investment", "loan")).toBe("investment_contribution");
	});

	it("makes a move between two investments an internal move", () => {
		expect(transferKindOf("investment", "investment")).toBe("internal_move");
	});

	it("makes a withdrawal from an investment an internal move", () => {
		expect(transferKindOf("depository", "investment")).toBe("internal_move");
	});

	it("makes any other move an internal move", () => {
		expect(transferKindOf("depository", "depository")).toBe("internal_move");
	});
});

const candidates = (entries: Record<string, string[]>) => new Map(Object.entries(entries));

describe("mutualMatches", () => {
	it("pairs a new row with its only candidate when that candidate has only it", () => {
		expect(mutualMatches(["n"], candidates({ n: ["c"], c: ["n"] }))).toEqual([["n", "c"]]);
	});

	it("links nothing for a row without candidates, known or not", () => {
		expect(mutualMatches(["n"], candidates({ n: [] }))).toEqual([]);
		expect(mutualMatches(["n"], candidates({}))).toEqual([]);
	});

	it("links nothing when the new row has two candidates", () => {
		expect(mutualMatches(["n"], candidates({ n: ["c1", "c2"], c1: ["n"], c2: ["n"] }))).toEqual([]);
	});

	it("links nothing when the candidate has another candidate too", () => {
		expect(mutualMatches(["n"], candidates({ n: ["c"], c: ["n", "o"] }))).toEqual([]);
	});

	it("links nothing when the candidate's only candidate is another row", () => {
		expect(mutualMatches(["n"], candidates({ n: ["c"], c: ["o"] }))).toEqual([]);
	});

	it("links nothing when the candidate's candidates are unknown", () => {
		expect(mutualMatches(["n"], candidates({ n: ["c"] }))).toEqual([]);
	});

	it("returns two new rows that pick each other once, whatever their order", () => {
		const both = candidates({ a: ["b"], b: ["a"] });

		expect(mutualMatches(["a", "b"], both)).toEqual([["a", "b"]]);
		expect(mutualMatches(["b", "a"], both)).toEqual([["b", "a"]]);
	});

	it("keeps each independent pair, in the order of the new rows", () => {
		expect(
			mutualMatches(
				["n1", "n2", "n3"],
				candidates({ n1: ["c1"], c1: ["n1"], n2: ["c1", "c2"], n3: ["c3"], c3: ["n3"] }),
			),
		).toEqual([
			["n1", "c1"],
			["n3", "c3"],
		]);
	});
});
