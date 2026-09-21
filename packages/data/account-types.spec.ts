import { describe, expect, it } from "vitest";

import {
	ACCOUNT_SUBTYPES,
	ACCOUNT_TYPE_IDS,
	classificationOf,
	isSubtypeOf,
} from "./account-types.ts";

describe("account types", () => {
	it("classifies a depository as an asset and a credit card as a liability", () => {
		expect(classificationOf("depository")).toBe("asset");
		expect(classificationOf("credit_card")).toBe("liability");
	});

	it("lists every type and subtype once", () => {
		expect(ACCOUNT_TYPE_IDS).toEqual(["depository", "credit_card"]);
		expect(ACCOUNT_SUBTYPES).toEqual(["checking", "savings"]);
	});

	it("requires a subtype where the type has some, and none where it has none", () => {
		expect(isSubtypeOf("depository", "savings")).toBe(true);
		expect(isSubtypeOf("depository", null)).toBe(false);
		expect(isSubtypeOf("depository", "brokerage")).toBe(false);
		expect(isSubtypeOf("credit_card", null)).toBe(true);
		expect(isSubtypeOf("credit_card", "checking")).toBe(false);
	});
});
