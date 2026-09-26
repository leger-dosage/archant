import type { ResolvedTheme } from "@/lib/theme";
import type { LucideIcon } from "lucide-react";

import {
	ArrowLeftRightIcon,
	CarIcon,
	ChartLineIcon,
	CircleDashedIcon,
	CreditCardIcon,
	HandCoinsIcon,
	HouseIcon,
	LandmarkIcon,
} from "lucide-react";

import type { AccountType } from "@archant/data/account-types";
import type { CategoryIcon } from "@archant/data/category-presets";
import type { MinorUnits } from "@archant/data/money";
import type { TransferKind } from "@archant/data/transfer-kinds";

import { CATEGORY_ICON_COMPONENTS } from "@/lib/category-icons";
import { adjustToContrast } from "@/lib/contrast";
import { showsCategory, TRANSFER_COLOR } from "@/lib/transfers";

/** What a tinted icon or a pill stands for. */
export type TintSubject =
	| { kind: "account"; type: AccountType }
	/** The transfer indigo, on another icon where a screen needs one, such as the empty dashboard's bank. */
	| { kind: "transfer"; icon?: LucideIcon }
	| { kind: "uncategorised" }
	| { kind: "merchant"; name: string }
	| { kind: "category"; color: string; icon: CategoryIcon };

export type Tint = {
	/** A lucide icon, or a merchant's first letter. */
	glyph: { icon: LucideIcon } | { letter: string };
	/** The tile's or the pill's background. */
	fill: string;
	/** The icon's colour, and the letter's. */
	icon: string;
	/** The pill's text colour. */
	text: string;
};

/** DESIGN.md's `type-*` tokens, repeated here because contrast needs the hex. */
export const ACCOUNT_TYPE_TINTS = {
	depository: { color: "#9d6fe8", icon: LandmarkIcon },
	investment: { color: "#4ea7fc", icon: ChartLineIcon },
	property: { color: "#00b8cc", icon: HouseIcon },
	vehicle: { color: "#e2609c", icon: CarIcon },
	credit_card: { color: "#eb5757", icon: CreditCardIcon },
	loan: { color: "#c95fd8", icon: HandCoinsIcon },
} as const satisfies Record<AccountType, { color: string; icon: LucideIcon }>;

// Measured on the hover row, the palest light surface and the lightest dark
// one a pill sits on: a colour that passes there passes on every row.
export const HOVER_ROW = { light: "#f4f4f4", dark: "#2b2d30" } as const;
const TEXT_TARGET = { light: 4.6, dark: 6.5 } as const;
const ICON_TARGET = 3;
const FILL_SHARE = { light: 10, dark: 17 } as const;

const MUTED = "var(--muted-foreground)";

function tintFill(color: string, mode: ResolvedTheme): string {
	return `color-mix(in oklab, ${color} ${FILL_SHARE[mode]}%, transparent)`;
}

// A long list resolves the same few colours on every row and every render.
const adjusted = new Map<string, string>();

function adjust(color: string, mode: ResolvedTheme, target: number): string {
	const key = `${color}|${mode}|${target}`;
	let result = adjusted.get(key);

	if (result === undefined) {
		result = adjustToContrast(color, HOVER_ROW[mode], target);
		adjusted.set(key, result);
	}

	return result;
}

function colored(color: string, glyph: Tint["glyph"], mode: ResolvedTheme): Tint {
	return {
		glyph,
		fill: tintFill(color, mode),
		icon: adjust(color, mode, ICON_TARGET),
		text: adjust(color, mode, TEXT_TARGET[mode]),
	};
}

/** The muted text colour already meets AA everywhere; no adjustment needed. */
function muted(glyph: Tint["glyph"], mode: ResolvedTheme): Tint {
	return { glyph, fill: tintFill(MUTED, mode), icon: MUTED, text: MUTED };
}

/** What to draw, and in which colours, for a subject in the current mode. */
export function resolveTint(subject: TintSubject, mode: ResolvedTheme): Tint {
	switch (subject.kind) {
		case "account": {
			const { color, icon } = ACCOUNT_TYPE_TINTS[subject.type];

			return colored(color, { icon }, mode);
		}
		case "transfer":
			return colored(TRANSFER_COLOR, { icon: subject.icon ?? ArrowLeftRightIcon }, mode);
		case "uncategorised":
			return muted({ icon: CircleDashedIcon }, mode);
		case "merchant": {
			// NFC first, so a decomposed « É » is one code point; one code point after
			// uppercasing too, since « ß » uppercases to « SS ».
			const first = Array.from(subject.name.normalize("NFC").trim())[0];
			const letter = first === undefined ? undefined : Array.from(first.toLocaleUpperCase("fr"))[0];

			return letter === undefined
				? muted({ icon: CircleDashedIcon }, mode)
				: muted({ letter }, mode);
		}
	}

	return colored(subject.color, { icon: CATEGORY_ICON_COMPONENTS[subject.icon] }, mode);
}

/**
 * A transaction row's icon, first match: a transfer side that shows no
 * category, then its category, then its merchant's first letter, else
 * « Sans catégorie ». A spent loan payment shows its category, as its pill
 * does. `category` and `merchantName` are `null` when absent or not loaded.
 */
export function rowSubject(
	transaction: { amount: MinorUnits; transfer: { kind: TransferKind } | null },
	category: { color: string; icon: CategoryIcon } | null,
	merchantName: string | null,
): TintSubject {
	if (transaction.transfer !== null && !showsCategory(transaction.amount, transaction.transfer)) {
		return { kind: "transfer" };
	}

	if (category !== null) {
		return { kind: "category", color: category.color, icon: category.icon };
	}

	if (merchantName !== null) {
		return { kind: "merchant", name: merchantName };
	}

	return { kind: "uncategorised" };
}
