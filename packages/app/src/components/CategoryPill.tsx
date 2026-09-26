import { useTranslation } from "react-i18next";

import type { CategoryIcon } from "@archant/data/category-presets";

import { useResolvedTheme } from "@/lib/theme";
import { resolveTint } from "@/lib/tint";
import { cn } from "@/lib/utils";

type PillCategory = { name: string; color: string; icon: CategoryIcon };

/**
 * DESIGN.md's category pill: the category's icon and name on its tint, the
 * text adjusted to stay readable on any row. Without a category, a muted
 * « Sans catégorie ».
 */
export function CategoryPill({
	category,
	className,
}: {
	category: PillCategory | null;
	className?: string;
}) {
	const { t } = useTranslation();
	const mode = useResolvedTheme();
	const tint = resolveTint(
		category === null
			? { kind: "uncategorised" }
			: { kind: "category", color: category.color, icon: category.icon },
		mode,
	);

	return (
		<span
			data-slot="category-pill"
			className={cn(
				"inline-flex h-5 max-w-full min-w-0 items-center gap-1.5 rounded-full pr-2 pl-1.5 text-xs",
				className,
			)}
			style={{ backgroundColor: tint.fill, color: tint.text }}
		>
			{"icon" in tint.glyph && (
				<tint.glyph.icon
					aria-hidden="true"
					className="size-3 shrink-0"
					style={{ color: tint.icon }}
				/>
			)}
			<span className="truncate">{category?.name ?? t("transactions.category.none")}</span>
		</span>
	);
}
