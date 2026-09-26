import { CircleDashedIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CategoryIcon } from "@archant/data/category-presets";

import { CATEGORY_ICON_COMPONENTS } from "@/lib/category-icons";
import { CARD_COLORS, pillTextColor, tintFill } from "@/lib/pill-text-color";
import { useResolvedTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const PILL =
	"inline-flex h-[22px] max-w-full items-center gap-1 rounded-full border px-2 text-xs leading-none [&_svg]:size-3 [&_svg]:shrink-0";

// A list renders the same few colours on every row; the search is not free.
const textColors = new Map<string, string>();

function textColorOf(color: string, card: string): string {
	const key = `${color}|${card}`;
	let text = textColors.get(key);
	if (text === undefined) {
		text = pillTextColor(color, card);
		textColors.set(key, text);
	}

	return text;
}

type CategoryPillProps = {
	category: { name: string; color: string; icon: CategoryIcon } | null;
	className?: string;
};

/** A category's icon and name on its tint; « Sans catégorie » without one. */
export function CategoryPill({ category, className }: CategoryPillProps) {
	const { t } = useTranslation();
	const theme = useResolvedTheme();

	if (category === null) {
		return (
			<span className={cn(PILL, "border-border text-muted-foreground", className)}>
				<CircleDashedIcon />
				<span className="truncate">{t("transactions.category.none")}</span>
			</span>
		);
	}

	const Icon = CATEGORY_ICON_COMPONENTS[category.icon];

	return (
		<span
			className={cn(PILL, className)}
			style={{
				backgroundColor: tintFill(category.color),
				borderColor: `color-mix(in oklab, ${category.color} 25%, transparent)`,
				color: textColorOf(category.color, CARD_COLORS[theme]),
			}}
		>
			<Icon />
			<span className="truncate">{category.name}</span>
		</span>
	);
}
