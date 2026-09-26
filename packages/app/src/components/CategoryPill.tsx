import type { TintSubject } from "@/lib/tint";

import { useTranslation } from "react-i18next";

import type { CategoryIcon } from "@archant/data/category-presets";

import { useResolvedTheme } from "@/lib/theme";
import { resolveTint } from "@/lib/tint";
import { cn } from "@/lib/utils";

type PillCategory = { name: string; color: string; icon: CategoryIcon };

function TintPill({
	subject,
	name,
	className,
}: {
	subject: TintSubject;
	name: string;
	className?: string | undefined;
}) {
	const mode = useResolvedTheme();
	const tint = resolveTint(subject, mode);

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
			<span className="truncate">{name}</span>
		</span>
	);
}

/**
 * DESIGN.md's category pill: the category's icon and name on its tint, the
 * text adjusted to stay readable on any row. Without a category, a muted
 * pill: « Sans catégorie », or `fallback` when the category is unknown.
 */
export function CategoryPill({
	category,
	fallback,
	className,
}: {
	category: PillCategory | null;
	fallback?: string;
	className?: string;
}) {
	const { t } = useTranslation();

	return category === null ? (
		<TintPill
			subject={{ kind: "uncategorised" }}
			name={fallback ?? t("transactions.category.none")}
			className={className}
		/>
	) : (
		<TintPill
			subject={{ kind: "category", color: category.color, icon: category.icon }}
			name={category.name}
			className={className}
		/>
	);
}

/** A transfer side's kind, in the transfer indigo, where a row shows its category. */
export function TransferPill({ name, className }: { name: string; className?: string }) {
	return <TintPill subject={{ kind: "transfer" }} name={name} className={className} />;
}
