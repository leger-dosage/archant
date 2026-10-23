import { z } from "zod";

import {
	CATEGORY_COLOR_PATTERN,
	CATEGORY_ICONS,
	CATEGORY_NAME_MAX_LENGTH,
} from "@archant/data/category-presets";

// One rule for creating and renaming, so a name the one accepts the other does too.
// NFC: a pasted « Épargne » may arrive decomposed, and would otherwise sit
// beside the composed one as a second category of the same name.
const categoryName = z
	.string()
	.trim()
	.transform((value) => value.normalize("NFC"))
	.pipe(z.string().min(1).max(CATEGORY_NAME_MAX_LENGTH));

/**
 * Any `#rrggbb`, a category's or a goal's, as Sure validates both by format.
 * A custom code rather than Zod's `invalid_format`, which the interface
 * translates as a date.
 */
export const categoryColor = z
	.string()
	.transform((value) => value.toLowerCase())
	.refine((value) => CATEGORY_COLOR_PATTERN.test(value), "invalid_value");

const categoryId = z.string().min(1);

/**
 * A new category, shared with the interface's form resolver. Without a
 * colour, it takes one of Sure's ten at random, as `COLORS.sample`; with a
 * parent, the parent's replaces it, as Sure's `inherit_color_from_parent`.
 * No kind, as Sure since #1160: an old client's `kind` is stripped.
 */
export const createCategorySchema = z.object({
	name: categoryName,
	color: categoryColor.optional(),
	icon: z.enum(CATEGORY_ICONS),
	parentId: categoryId.nullable(),
});

export type CreateCategoryInput = z.input<typeof createCategorySchema>;
export type CreateCategoryRequest = z.output<typeof createCategorySchema>;

/** An edit of a category: any non-empty subset of the fields above. */
export const updateCategorySchema = z
	.object({
		name: categoryName.optional(),
		color: categoryColor.optional(),
		icon: z.enum(CATEGORY_ICONS).optional(),
		parentId: categoryId.nullable().optional(),
	})
	.refine((value) => Object.values(value).some((field) => field !== undefined), "empty_patch");

export type UpdateCategoryInput = z.input<typeof updateCategorySchema>;
export type UpdateCategoryRequest = z.output<typeof updateCategorySchema>;

/** Where a deleted category's transactions go; absent leaves them uncategorised. */
export const deleteCategoryQuerySchema = z.object({
	replacementId: categoryId.optional(),
});

/** Sure's `perform_merge`: several sources into one target. */
export const mergeCategoriesSchema = z.object({
	targetId: categoryId,
	sourceIds: z.array(categoryId).min(1),
});
