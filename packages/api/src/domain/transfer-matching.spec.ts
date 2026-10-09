import type { ExpectingSide, TransferSide } from "./transfer-matching.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import {
	HAND_TRANSFER_WINDOW_DAYS,
	TRANSFER_WINDOW_DAYS,
	greedyMatches,
	isTransferCandidate,
	narrowToExpected,
	transferKindOf,
} from "./transfer-matching.ts";

const side = (overrides: Partial<TransferSide> = {}): TransferSide => ({
	kind: "transaction",
	accountId: "checking",
	date: "2026-09-10",
	amount: toMinorUnits(-50000),
	currency: "EUR",
	inTransfer: false,
	excluded: false,
	accountActive: true,
	splitChild: false,
	...overrides,
});

const outflow = side();
const inflow = side({ accountId: "livret", amount: toMinorUnits(50000) });

/** Whether a pair by hand may take the inflow dated `date`. */
const within = (date: string) =>
	isTransferCandidate(outflow, { ...inflow, date }, HAND_TRANSFER_WINDOW_DAYS);

describe("isTransferCandidate", () => {
	it("pairs opposite amounts in two accounts of one currency, either way round", () => {
		expect(isTransferCandidate(outflow, inflow, TRANSFER_WINDOW_DAYS)).toBe(true);
		expect(isTransferCandidate(inflow, outflow, TRANSFER_WINDOW_DAYS)).toBe(true);
	});

	it("keeps the window inclusive: 4 days in, 5 out, before or after", () => {
		expect(TRANSFER_WINDOW_DAYS).toBe(4);
		expect(
			isTransferCandidate(outflow, { ...inflow, date: "2026-09-14" }, TRANSFER_WINDOW_DAYS),
		).toBe(true);
		expect(
			isTransferCandidate(outflow, { ...inflow, date: "2026-09-06" }, TRANSFER_WINDOW_DAYS),
		).toBe(true);
		expect(
			isTransferCandidate(outflow, { ...inflow, date: "2026-09-15" }, TRANSFER_WINDOW_DAYS),
		).toBe(false);
		expect(
			isTransferCandidate(outflow, { ...inflow, date: "2026-09-05" }, TRANSFER_WINDOW_DAYS),
		).toBe(false);
	});

	it("lets a pair by hand span 30 days, as Sure's picker, and no more", () => {
		expect(HAND_TRANSFER_WINDOW_DAYS).toBe(30);
		expect(within("2026-09-30")).toBe(true);
		expect(within("2026-10-10")).toBe(true);
		expect(within("2026-08-11")).toBe(true);
		expect(within("2026-10-11")).toBe(false);
		expect(within("2026-08-10")).toBe(false);
	});

	it("refuses a valuation on either side", () => {
		expect(
			isTransferCandidate(outflow, { ...inflow, kind: "valuation" }, TRANSFER_WINDOW_DAYS),
		).toBe(false);
		expect(
			isTransferCandidate({ ...outflow, kind: "valuation" }, inflow, TRANSFER_WINDOW_DAYS),
		).toBe(false);
	});

	it("refuses amounts that do not sum to zero, and two zeros", () => {
		expect(
			isTransferCandidate(
				outflow,
				{ ...inflow, amount: toMinorUnits(49900) },
				TRANSFER_WINDOW_DAYS,
			),
		).toBe(false);
		expect(
			isTransferCandidate(
				outflow,
				{ ...inflow, amount: toMinorUnits(-50000) },
				TRANSFER_WINDOW_DAYS,
			),
		).toBe(false);
		expect(
			isTransferCandidate(
				{ ...outflow, amount: toMinorUnits(0) },
				{ ...inflow, amount: toMinorUnits(0) },
				TRANSFER_WINDOW_DAYS,
			),
		).toBe(false);
	});

	it("refuses the same account", () => {
		expect(
			isTransferCandidate(outflow, { ...inflow, accountId: "checking" }, TRANSFER_WINDOW_DAYS),
		).toBe(false);
	});

	it("refuses another currency", () => {
		expect(isTransferCandidate(outflow, { ...inflow, currency: "USD" }, TRANSFER_WINDOW_DAYS)).toBe(
			false,
		);
	});

	it("refuses a side already in a transfer", () => {
		expect(
			isTransferCandidate(outflow, { ...inflow, inTransfer: true }, TRANSFER_WINDOW_DAYS),
		).toBe(false);
		expect(
			isTransferCandidate({ ...outflow, inTransfer: true }, inflow, TRANSFER_WINDOW_DAYS),
		).toBe(false);
	});

	it("refuses an excluded side, whichever side", () => {
		expect(isTransferCandidate(outflow, { ...inflow, excluded: true }, TRANSFER_WINDOW_DAYS)).toBe(
			false,
		);
		expect(isTransferCandidate({ ...outflow, excluded: true }, inflow, TRANSFER_WINDOW_DAYS)).toBe(
			false,
		);
	});

	it("refuses a side on an inactive account, whichever side", () => {
		expect(
			isTransferCandidate(outflow, { ...inflow, accountActive: false }, TRANSFER_WINDOW_DAYS),
		).toBe(false);
		expect(
			isTransferCandidate({ ...outflow, accountActive: false }, inflow, TRANSFER_WINDOW_DAYS),
		).toBe(false);
	});

	it("refuses a split line, whichever side", () => {
		expect(
			isTransferCandidate(outflow, { ...inflow, splitChild: true }, TRANSFER_WINDOW_DAYS),
		).toBe(false);
		expect(
			isTransferCandidate({ ...outflow, splitChild: true }, inflow, TRANSFER_WINDOW_DAYS),
		).toBe(false);
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

	it("makes money landing on a property or a vehicle an internal move", () => {
		expect(transferKindOf("property", "depository")).toBe("internal_move");
		expect(transferKindOf("property", "investment")).toBe("internal_move");
		expect(transferKindOf("vehicle", "depository")).toBe("internal_move");
		expect(transferKindOf("vehicle", "credit_card")).toBe("internal_move");
	});

	it("makes any other move an internal move", () => {
		expect(transferKindOf("depository", "depository")).toBe("internal_move");
	});
});

const pair = (outflowId: string, inflowId: string, days: number) => ({ outflowId, inflowId, days });

describe("greedyMatches", () => {
	it("pairs an outflow with its closest candidate and leaves the other free", () => {
		// −100 on A day 10; +100 on B day 11 and on C day 13.
		expect(greedyMatches([pair("a", "c", 3), pair("a", "b", 1)])).toEqual([pair("a", "b", 1)]);
	});

	it("gives a shared candidate to the lower outflow id when both are as close", () => {
		// −50 on A day 1 and on C day 3; +50 on B day 2.
		expect(greedyMatches([pair("c", "b", 1), pair("a", "b", 1)])).toEqual([pair("a", "b", 1)]);
	});

	it("breaks a tie on one outflow by the lower inflow id", () => {
		expect(greedyMatches([pair("a", "d", 2), pair("a", "c", 2)])).toEqual([pair("a", "c", 2)]);
	});

	it("skips a pair whose side the closer pair took, and takes the next free one", () => {
		expect(
			greedyMatches([pair("a", "b", 0), pair("c", "b", 1), pair("c", "d", 2), pair("a", "d", 3)]),
		).toEqual([pair("a", "b", 0), pair("c", "d", 2)]);
	});

	it("gives the same pairs whatever order the candidates arrive in", () => {
		const pairs = [pair("a", "b", 2), pair("c", "b", 1), pair("c", "d", 1), pair("a", "d", 0)];

		expect(greedyMatches(pairs)).toEqual(greedyMatches(pairs.toReversed()));
		expect(greedyMatches(pairs)).toEqual([pair("a", "d", 0), pair("c", "b", 1)]);
	});

	it("links nothing without candidates", () => {
		expect(greedyMatches([])).toEqual([]);
	});
});

const on = (
	id: string,
	accountId: string,
	expectedAccountId: string | null = null,
): ExpectingSide => ({
	id,
	accountId,
	expectedAccountId,
});

describe("narrowToExpected", () => {
	it("keeps every candidate when no side expects an account", () => {
		expect(narrowToExpected(on("n", "joint"), [on("b", "livret"), on("c", "card")])).toEqual([
			"b",
			"c",
		]);
	});

	it("keeps only the candidates on the account the source expects", () => {
		const source = on("n", "joint", "livret");

		expect(narrowToExpected(source, [on("b", "livret"), on("c", "card")])).toEqual(["b"]);
		expect(
			narrowToExpected(source, [on("b1", "livret"), on("c", "card"), on("b2", "livret")]),
		).toEqual(["b1", "b2"]);
		expect(narrowToExpected(source, [on("c", "card")])).toEqual([]);
	});

	it("keeps only the candidates expecting the source's account, when one does", () => {
		expect(
			narrowToExpected(on("b", "livret"), [on("n", "joint", "livret"), on("o", "card")]),
		).toEqual(["n"]);
		expect(narrowToExpected(on("b", "livret"), [on("n", "joint", "pea"), on("o", "card")])).toEqual(
			["n", "o"],
		);
	});
});
