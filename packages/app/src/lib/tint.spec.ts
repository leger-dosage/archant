import {
	ArrowLeftRightIcon,
	CarIcon,
	ChartLineIcon,
	CircleDashedIcon,
	CreditCardIcon,
	DogIcon,
	HandCoinsIcon,
	HouseIcon,
	LandmarkIcon,
} from "lucide-react";
import { describe, expect, it } from "vitest";

import { ACCOUNT_TYPES } from "@archant/data/account-types";

import styles from "../styles.css?raw";
import { contrastRatio } from "./contrast.ts";
import { ACCOUNT_TYPE_TINTS, HOVER_ROW, resolveTint } from "./tint.ts";
import { TRANSFER_COLOR } from "./transfers.ts";

const MODES = ["light", "dark"] as const;

describe.each(MODES)("in %s mode", (mode) => {
	const share = mode === "light" ? "10%" : "17%";
	const textTarget = mode === "light" ? 4.6 : 6.5;

	it.each([
		["depository", LandmarkIcon, "#9d6fe8"],
		["investment", ChartLineIcon, "#4ea7fc"],
		["property", HouseIcon, "#00b8cc"],
		["vehicle", CarIcon, "#e2609c"],
		["credit_card", CreditCardIcon, "#eb5757"],
		["loan", HandCoinsIcon, "#c95fd8"],
	] as const)("an account of type %s draws its icon in its type colour", (type, icon, color) => {
		const tint = resolveTint({ kind: "account", type }, mode);

		expect(tint.glyph).toEqual({ icon });
		expect(tint.fill).toBe(`color-mix(in oklab, ${color} ${share}, transparent)`);
		expect(contrastRatio(tint.icon, HOVER_ROW[mode])).toBeGreaterThanOrEqual(3);
		expect(contrastRatio(tint.text, HOVER_ROW[mode])).toBeGreaterThanOrEqual(textTarget);
	});

	it("draws a transfer as arrows in the transfer indigo", () => {
		const tint = resolveTint({ kind: "transfer" }, mode);

		expect(tint.glyph).toEqual({ icon: ArrowLeftRightIcon });
		expect(tint.fill).toBe(`color-mix(in oklab, ${TRANSFER_COLOR} ${share}, transparent)`);
		expect(contrastRatio(tint.text, HOVER_ROW[mode])).toBeGreaterThanOrEqual(textTarget);
	});

	it("draws an uncategorised row as a dashed circle in the muted text colour", () => {
		expect(resolveTint({ kind: "uncategorised" }, mode)).toEqual({
			glyph: { icon: CircleDashedIcon },
			fill: `color-mix(in oklab, var(--muted-foreground) ${share}, transparent)`,
			icon: "var(--muted-foreground)",
			text: "var(--muted-foreground)",
		});
	});

	it("draws a merchant without a category as its first letter, muted", () => {
		const tint = resolveTint({ kind: "merchant", name: " éole" }, mode);

		expect(tint.glyph).toEqual({ letter: "É" });
		expect(tint.icon).toBe("var(--muted-foreground)");
	});

	it("keeps the accent of a decomposed name, and one letter for « ß »", () => {
		expect(resolveTint({ kind: "merchant", name: "E\u0301ole" }, mode).glyph).toEqual({
			letter: "É",
		});
		expect(resolveTint({ kind: "merchant", name: "ßeta" }, mode).glyph).toEqual({ letter: "S" });
	});

	it("falls back to the dashed circle for a merchant with a blank name", () => {
		expect(resolveTint({ kind: "merchant", name: " " }, mode).glyph).toEqual({
			icon: CircleDashedIcon,
		});
	});

	it("draws a category with its own icon and colour, adjusted for contrast", () => {
		const tint = resolveTint({ kind: "category", color: "#f0bf00", icon: "dog" }, mode);

		expect(tint.glyph).toEqual({ icon: DogIcon });
		expect(tint.fill).toBe(`color-mix(in oklab, #f0bf00 ${share}, transparent)`);
		expect(contrastRatio(tint.icon, HOVER_ROW[mode])).toBeGreaterThanOrEqual(3);
		expect(contrastRatio(tint.text, HOVER_ROW[mode])).toBeGreaterThanOrEqual(textTarget);
	});
});

it("gives each mode its own adjusted colours", () => {
	const subject = { kind: "category", color: "#5e6ad2", icon: "tag" } as const;

	expect(resolveTint(subject, "light").text).not.toBe(resolveTint(subject, "dark").text);
});

it("covers every account type, with the hex of its `--type-*` token", () => {
	expect(Object.keys(ACCOUNT_TYPE_TINTS).toSorted()).toEqual(Object.keys(ACCOUNT_TYPES).toSorted());

	for (const [type, { color }] of Object.entries(ACCOUNT_TYPE_TINTS)) {
		expect(styles).toContain(`--type-${type.replace("_", "-")}: ${color};`);
	}

	expect(styles).toContain(`--transfer: ${TRANSFER_COLOR};`);
	// The hover row is `--accent` in both modes.
	expect(styles).toContain(`--accent: ${HOVER_ROW.light};`);
	expect(styles).toContain(`--accent: ${HOVER_ROW.dark};`);
});
