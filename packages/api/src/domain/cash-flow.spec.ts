import type { CashFlowTransaction } from "./cash-flow.ts";

import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { direction } from "./cash-flow.ts";

const tx = (
	amount: number,
	transfer: CashFlowTransaction["transfer"] = null,
): CashFlowTransaction => ({ amount: toMinorUnits(amount), transfer });

describe("direction", () => {
	it("follows the sign of a standard transaction, zero being an expense", () => {
		expect(direction(tx(-2000))).toBe("expense");
		expect(direction(tx(3000))).toBe("income");
		expect(direction(tx(0))).toBe("expense");
	});

	it("makes both sides of an internal move and of a card payment transfers", () => {
		expect(direction(tx(-50000, { kind: "internal_move" }))).toBe("transfer");
		expect(direction(tx(50000, { kind: "internal_move" }))).toBe("transfer");
		expect(direction(tx(-30000, { kind: "credit_card_payment" }))).toBe("transfer");
		expect(direction(tx(30000, { kind: "credit_card_payment" }))).toBe("transfer");
	});

	it("keeps the outflow of a loan payment or an investment contribution an expense", () => {
		expect(direction(tx(-40000, { kind: "loan_payment" }))).toBe("expense");
		expect(direction(tx(-40000, { kind: "investment_contribution" }))).toBe("expense");
		expect(direction(tx(40000, { kind: "loan_payment" }))).toBe("transfer");
		expect(direction(tx(40000, { kind: "investment_contribution" }))).toBe("transfer");
	});

	it("ignores exclusion and account settings", () => {
		const excluded = { ...tx(-2000), excluded: true, accountExcludedFromReports: true };

		expect(direction(excluded)).toBe("expense");
	});
});
