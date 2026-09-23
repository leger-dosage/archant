import { z } from "zod";

import {
	CATEGORY_COLOR_PATTERN,
	CATEGORY_ICONS,
	CATEGORY_NAME_MAX_LENGTH,
} from "@archant/data/category-presets";
import { CATEGORY_KINDS } from "@archant/data/schema/categories";

// One rule for creating and renaming, so a name the one accepts the other does too.
// NFC: a pasted « Épargne » may arrive decomposed, and would otherwise sit
// beside the composed one as a second category of the same name.
const categoryName = z
	.string()
	.trim()
	.transform((value) => value.normalize("NFC"))
	.pipe(z.string().min(1).max(CATEGORY_NAME_MAX_LENGTH));

// A custom code rather than Zod's `invalid_format`, which the interface
// translates as a date.
const categoryColor = z
	.string()
	.transform((value) => value.toLowerCase())
	.refine((value) => CATEGORY_COLOR_PATTERN.test(value), "invalid_value");

const categoryId = z.string().min(1);

/**
 * A new category, shared with the interface's form resolver. With a parent,
 * `kind` and `color` are still required but replaced by the parent's: a
 * child always carries them, so the form can keep sending what it holds.
 */
export const createCategorySchema = z.object({
	name: categoryName,
	kind: z.enum(CATEGORY_KINDS),
	color: categoryColor,
	icon: z.enum(CATEGORY_ICONS),
	parentId: categoryId.nullable(),
});

export type CreateCategoryInput = z.input<typeof createCategorySchema>;
export type CreateCategoryRequest = z.output<typeof createCategorySchema>;

/** An edit of a category: any non-empty subset of the fields above. */
export const updateCategorySchema = z
	.object({
		name: categoryName.optional(),
		kind: z.enum(CATEGORY_KINDS).optional(),
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

export const mergeCategorySchema = z.object({ targetId: categoryId });
