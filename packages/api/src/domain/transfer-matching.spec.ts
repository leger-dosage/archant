import type { TransferSide } from "./transfer-matching.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { TRANSFER_WINDOW_DAYS, isTransferCandidate, transferKindOf } from "./transfer-matching.ts";

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
		expect(transferKindOf("credit_card")).toBe("credit_card_payment");
	});

	it("makes any other move an internal move", () => {
		expect(transferKindOf("depository")).toBe("internal_move");
	});
});
