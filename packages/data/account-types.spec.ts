import { describe, expect, it } from "vitest";

import {
	ACCOUNT_SUBTYPES,
	ACCOUNT_TYPE_IDS,
	BANK_ACCOUNT_TARGETS,
	classificationOf,
	isAccountSubtype,
	isBankAccountTarget,
	isSubtypeOf,
} from "./account-types.ts";

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
			"checking",
			"savings",
			"mortgage",
			"consumer",
			"other",
			"pea",
			"assurance_vie",
			"brokerage",
			"single_family_home",
			"apartment",
			"second_home",
			"investment_property",
			"plot",
			"commercial",
		]);
	});

	it("requires a subtype where the type has some, and none where it has none", () => {
		expect(isSubtypeOf("depository", "savings")).toBe(true);
		expect(isSubtypeOf("depository", null)).toBe(false);
		expect(isSubtypeOf("depository", "brokerage")).toBe(false);
		expect(isSubtypeOf("credit_card", null)).toBe(true);
		expect(isSubtypeOf("credit_card", "checking")).toBe(false);
		expect(isSubtypeOf("loan", "mortgage")).toBe(true);
		expect(isSubtypeOf("loan", null)).toBe(false);
		expect(isSubtypeOf("loan", "savings")).toBe(false);
		expect(isSubtypeOf("investment", "pea")).toBe(true);
		expect(isSubtypeOf("investment", "other")).toBe(true);
		expect(isSubtypeOf("investment", null)).toBe(false);
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

	it("hold a bank's cash, never an investment or a consumer loan", () => {
		expect(isBankAccountTarget("depository", "savings")).toBe(true);
		expect(isBankAccountTarget("credit_card", null)).toBe(true);
		expect(isBankAccountTarget("loan", "consumer")).toBe(false);
		expect(isBankAccountTarget("investment", "pea")).toBe(false);
	});
});
