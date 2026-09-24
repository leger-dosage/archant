import { describe, expect, it } from "vitest";

import { isLinkCandidate, suggestedTarget } from "./bank-accounts.ts";

describe("suggestedTarget", () => {
	it("maps each cash account type as Sure does", () => {
		for (const code of ["CACC", "TRAN", "SALA", "ODFT", "NREX", "TAXE", "TRAS", "CASH"]) {
			expect(suggestedTarget(code)).toEqual({ type: "depository", subtype: "checking" });
		}
		for (const code of ["SVGS", "MOMA", "ONDP"]) {
			expect(suggestedTarget(code)).toEqual({ type: "depository", subtype: "savings" });
		}
		expect(suggestedTarget("CARD")).toEqual({ type: "credit_card", subtype: null });
		expect(suggestedTarget("CRCD")).toEqual({ type: "credit_card", subtype: null });
		expect(suggestedTarget("LOAN")).toEqual({ type: "loan", subtype: "other" });
		expect(suggestedTarget("MORT")).toEqual({ type: "loan", subtype: "mortgage" });
	});

	it("suggests skipping an unknown or missing type", () => {
		expect(suggestedTarget("OTHR")).toBeNull();
		expect(suggestedTarget("toString")).toBeNull();
		expect(suggestedTarget(null)).toBeNull();
	});
});

describe("isLinkCandidate", () => {
	const checking = {
		type: "depository" as const,
		currency: "EUR",
		active: true,
		bankAccountId: null,
	};
	const bankChecking = { currency: "EUR", cashAccountType: "CACC" };

	it("accepts an active, unlinked account of the same currency and type", () => {
		expect(isLinkCandidate(checking, bankChecking)).toBe(true);
	});

	it("refuses an inactive, linked or other-currency account", () => {
		expect(isLinkCandidate({ ...checking, active: false }, bankChecking)).toBe(false);
		expect(isLinkCandidate({ ...checking, bankAccountId: "b1" }, bankChecking)).toBe(false);
		expect(isLinkCandidate({ ...checking, currency: "USD" }, bankChecking)).toBe(false);
	});

	it("refuses a type the bank's type rules out, or one that holds no cash", () => {
		expect(isLinkCandidate({ ...checking, type: "credit_card" }, bankChecking)).toBe(false);
		expect(isLinkCandidate({ ...checking, type: "investment" }, bankChecking)).toBe(false);
	});

	it("accepts any cash type when the bank's type is unknown", () => {
		const unknown = { currency: "EUR", cashAccountType: null };

		expect(isLinkCandidate({ ...checking, type: "loan" }, unknown)).toBe(true);
		expect(isLinkCandidate({ ...checking, type: "property" }, unknown)).toBe(false);
	});
});
