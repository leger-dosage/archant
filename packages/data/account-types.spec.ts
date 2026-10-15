import { describe, expect, it } from "vitest";

import {
	ACCOUNT_SUBTYPES,
	ACCOUNT_TYPE_IDS,
	BANK_ACCOUNT_TARGETS,
	classificationOf,
	creditCardDetailsOf,
	isAccountSubtype,
	isBankAccountTarget,
	isSubtypeOf,
	isTaxAdvantaged,
	loanDetailsOf,
} from "./account-types.ts";
import { toMinorUnits } from "./money.ts";

describe("account types", () => {
	it("classifies a depository, an investment, a property and a vehicle as assets, and a credit card and a loan as liabilities", () => {
		expect(classificationOf("depository")).toBe("asset");
		expect(classificationOf("investment")).toBe("asset");
		expect(classificationOf("property")).toBe("asset");
		expect(classificationOf("vehicle")).toBe("asset");
		expect(classificationOf("credit_card")).toBe("liability");
		expect(classificationOf("loan")).toBe("liability");
	});

	it("lists every type and subtype once", () => {
		expect(ACCOUNT_TYPE_IDS).toEqual([
			"depository",
			"credit_card",
			"loan",
			"investment",
			"property",
			"vehicle",
		]);
		expect(ACCOUNT_SUBTYPES).toEqual([
			"cash",
			"checking",
			"savings",
			"cd",
			"money_market",
			"mortgage",
			"student",
			"auto",
			"home_equity",
			"line_of_credit",
			"business",
			"other",
			"assurance_vie",
			"pea",
			"pillar_3a",
			"riester",
			"pension",
			"retirement",
			"mutual_fund",
			"gold",
			"angel",
			"trust",
			"brokerage",
			"single_family_home",
			"apartment",
			"second_home",
			"investment_property",
			"plot",
			"commercial",
		]);
	});

	it("requires a subtype where the type has some, none where it has none, and admits none for a depository or an investment", () => {
		expect(isSubtypeOf("depository", "savings")).toBe(true);
		expect(isSubtypeOf("depository", "cash")).toBe(true);
		expect(isSubtypeOf("depository", "cd")).toBe(true);
		expect(isSubtypeOf("depository", "money_market")).toBe(true);
		expect(isSubtypeOf("depository", null)).toBe(true);
		expect(isSubtypeOf("depository", "hsa")).toBe(false);
		expect(isSubtypeOf("depository", "brokerage")).toBe(false);
		expect(isSubtypeOf("credit_card", null)).toBe(true);
		expect(isSubtypeOf("credit_card", "checking")).toBe(false);
		expect(isSubtypeOf("loan", "mortgage")).toBe(true);
		expect(isSubtypeOf("loan", null)).toBe(false);
		expect(isSubtypeOf("loan", "savings")).toBe(false);
		expect(isSubtypeOf("loan", "consumer")).toBe(false);
		expect(isSubtypeOf("investment", "pea")).toBe(true);
		expect(isSubtypeOf("investment", "other")).toBe(true);
		expect(isSubtypeOf("investment", "pillar_3a")).toBe(true);
		expect(isSubtypeOf("investment", "riester")).toBe(true);
		expect(isSubtypeOf("investment", "mutual_fund")).toBe(true);
		expect(isSubtypeOf("investment", "trust")).toBe(true);
		expect(isSubtypeOf("investment", null)).toBe(true);
		expect(isSubtypeOf("investment", "401k")).toBe(false);
		expect(isSubtypeOf("investment", "isa")).toBe(false);
		expect(isSubtypeOf("loan", "pension")).toBe(false);
		expect(isSubtypeOf("investment", "savings")).toBe(false);
		expect(isSubtypeOf("property", "single_family_home")).toBe(true);
		expect(isSubtypeOf("property", "commercial")).toBe(true);
		expect(isSubtypeOf("property", null)).toBe(false);
		expect(isSubtypeOf("property", "pea")).toBe(false);
		expect(isSubtypeOf("vehicle", null)).toBe(true);
		expect(isSubtypeOf("vehicle", "car")).toBe(false);
		expect(isSubtypeOf("vehicle", "apartment")).toBe(false);
	});

	it("recognises a subtype of any type, and nothing else", () => {
		expect(isAccountSubtype("checking")).toBe(true);
		expect(isAccountSubtype("single_family_home")).toBe(true);
		expect(isAccountSubtype("car")).toBe(false);
		expect(isAccountSubtype(null)).toBe(false);
	});
});

describe("bank account targets", () => {
	it("are valid type and subtype pairs", () => {
		for (const target of BANK_ACCOUNT_TARGETS) {
			expect(isSubtypeOf(target.type, target.subtype)).toBe(true);
		}
	});

	it("hold a bank's cash, never an investment or a student loan", () => {
		expect(isBankAccountTarget("depository", "savings")).toBe(true);
		expect(isBankAccountTarget("credit_card", null)).toBe(true);
		expect(isBankAccountTarget("loan", "student")).toBe(false);
		expect(isBankAccountTarget("investment", "pea")).toBe(false);
	});
});

describe("tax-advantaged accounts", () => {
	it("are Sure's tax-advantaged and tax-deferred subtypes, never a taxable one or none", () => {
		for (const subtype of [
			"pea",
			"assurance_vie",
			"pillar_3a",
			"riester",
			"pension",
			"retirement",
		]) {
			expect(isTaxAdvantaged(subtype)).toBe(true);
		}
		for (const subtype of ["brokerage", "mutual_fund", "gold", "angel", "trust", "other"]) {
			expect(isTaxAdvantaged(subtype)).toBe(false);
		}
		expect(isTaxAdvantaged(null)).toBe(false);
	});
});

describe("account details", () => {
	const loan = {
		originalAmount: null,
		downPayment: null,
		startDate: null,
		termMonths: 300,
		rateType: null,
		interestRate: null,
		insuranceRate: null,
		insuranceRateType: null,
		rateChanges: [],
		endDate: null,
	};
	const card = {
		availableCredit: toMinorUnits(300000),
		minimumPayment: null,
		apr: 159900,
		expirationDate: null,
		annualFee: null,
	};

	it("reads a loan's details on a loan only", () => {
		expect(loanDetailsOf({ type: "loan", details: loan })).toBe(loan);
		expect(loanDetailsOf({ type: "loan", details: card })).toBeNull();
		expect(loanDetailsOf({ type: "credit_card", details: loan })).toBeNull();
		expect(loanDetailsOf({ type: "loan", details: null })).toBeNull();
	});

	it("reads a card's details on a credit card only", () => {
		expect(creditCardDetailsOf({ type: "credit_card", details: card })).toBe(card);
		expect(creditCardDetailsOf({ type: "credit_card", details: loan })).toBeNull();
		expect(creditCardDetailsOf({ type: "loan", details: card })).toBeNull();
		expect(creditCardDetailsOf({ type: "credit_card", details: null })).toBeNull();
	});
});
