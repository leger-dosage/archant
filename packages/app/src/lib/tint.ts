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

import { CATEGORY_ICON_COMPONENTS } from "@/lib/category-icons";
import { TRANSFER_COLOR } from "@/lib/transfers";

/** What a tinted tile shows: an icon, or a merchant's letter, in one colour. */
export type IconTint = { color: string; icon: LucideIcon };
export type LetterTint = { color: string; letter: string };
export type Tint = IconTint | LetterTint;

/**
 * Sure's icon per account type; the colours are the `type-*` tokens of
 * styles.css, so the stylesheet stays their single source.
 */
const ACCOUNT_TYPE_TINTS = {
	depository: { color: "var(--type-depository)", icon: LandmarkIcon },
	investment: { color: "var(--type-investment)", icon: ChartLineIcon },
	property: { color: "var(--type-property)", icon: HouseIcon },
	vehicle: { color: "var(--type-vehicle)", icon: CarIcon },
	credit_card: { color: "var(--type-credit-card)", icon: CreditCardIcon },
	loan: { color: "var(--type-loan)", icon: HandCoinsIcon },
} satisfies Record<AccountType, IconTint>;

export function accountTypeTint(type: AccountType): IconTint {
	return ACCOUNT_TYPE_TINTS[type];
}

export function categoryTint(category: { color: string; icon: CategoryIcon }): IconTint {
	return { color: category.color, icon: CATEGORY_ICON_COMPONENTS[category.icon] };
}

export const TRANSFER_TINT: IconTint = { color: TRANSFER_COLOR, icon: ArrowLeftRightIcon };

const UNCATEGORISED_COLOR = "var(--uncategorised)";

export const UNCATEGORISED_TINT: IconTint = { color: UNCATEGORISED_COLOR, icon: CircleDashedIcon };

/** A merchant without a category: its first letter, as Sure shows it. */
export function merchantTint(name: string): LetterTint {
	// `Array.from` splits by code point, so an emoji or an astral letter stays whole.
	const [first = ""] = Array.from(name.trim());

	return { color: UNCATEGORISED_COLOR, letter: first.toLocaleUpperCase("fr") };
}
