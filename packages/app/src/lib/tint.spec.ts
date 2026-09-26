import {
	ArrowLeftRightIcon,
	CarIcon,
	ChartLineIcon,
	CircleDashedIcon,
	CreditCardIcon,
	HandCoinsIcon,
	HouseIcon,
	LandmarkIcon,
	UtensilsIcon,
} from "lucide-react";
import { describe, expect, it } from "vitest";

import {
	TRANSFER_TINT,
	UNCATEGORISED_TINT,
	accountTypeTint,
	categoryTint,
	merchantTint,
} from "./tint.ts";

describe("accountTypeTint", () => {
	it("gives each account type Sure's icon and its type colour", () => {
		expect(accountTypeTint("depository")).toEqual({
			color: "var(--type-depository)",
			icon: LandmarkIcon,
		});
		expect(accountTypeTint("investment")).toEqual({
			color: "var(--type-investment)",
			icon: ChartLineIcon,
		});
		expect(accountTypeTint("property")).toEqual({
			color: "var(--type-property)",
			icon: HouseIcon,
		});
		expect(accountTypeTint("vehicle")).toEqual({ color: "var(--type-vehicle)", icon: CarIcon });
		expect(accountTypeTint("credit_card")).toEqual({
			color: "var(--type-credit-card)",
			icon: CreditCardIcon,
		});
		expect(accountTypeTint("loan")).toEqual({ color: "var(--type-loan)", icon: HandCoinsIcon });
	});
});

describe("categoryTint", () => {
	it("uses the category's own colour and icon", () => {
		expect(categoryTint({ color: "#f97316", icon: "utensils" })).toEqual({
			color: "#f97316",
			icon: UtensilsIcon,
		});
	});
});

describe("fixed tints", () => {
	it("draws a transfer and an uncategorised row from their tokens", () => {
		expect(TRANSFER_TINT).toEqual({ color: "var(--transfer)", icon: ArrowLeftRightIcon });
		expect(UNCATEGORISED_TINT).toEqual({ color: "var(--uncategorised)", icon: CircleDashedIcon });
	});
});

describe("merchantTint", () => {
	it("shows the first letter, uppercased, in the uncategorised colour", () => {
		expect(merchantTint("boulangerie")).toEqual({ color: "var(--uncategorised)", letter: "B" });
	});

	it("uppercases an accented letter", () => {
		expect(merchantTint("éco")).toEqual({ color: "var(--uncategorised)", letter: "É" });
	});

	it("skips leading spaces", () => {
		expect(merchantTint("  amazon").letter).toBe("A");
	});
});
