import { z } from "zod";

import { CATEGORY_ICONS, CATEGORY_NAME_MAX_LENGTH } from "@archant/data/category-presets";

import { createCategorySchema } from "../categories.ts";
import { requiredSureName, sureName } from "./fields.ts";

/** Sure's `presence`: a blank value reads as absent rather than refused. */
const present = <Schema extends z.ZodType>(schema: Schema) =>
	z.preprocess(
		(value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
		schema.optional(),
	);

const categoryField = createCategorySchema.shape;

const categoryColor = categoryField.color.describe(
	'A hex colour such as "#e99537"; a subcategory takes its parent\'s whatever it is given.',
);

const categoryIcon = categoryField.icon.describe(
	`A Lucide icon name, one of: ${CATEGORY_ICONS.join(", ")}.`,
);

/** `create_category`: Sure's fields; the category is an expense, or its parent's kind. */
export const createCategoryInput = z.strictObject({
	name: requiredSureName(CATEGORY_NAME_MAX_LENGTH).describe(
		"Category name, which no other category holds, case aside.",
	),
	color: present(categoryColor).describe(
		"Hex color code such as \"#e99537\", the picker's first one by default. Ignored for subcategories, which take their parent's.",
	),
	icon: present(categoryIcon).describe(
		`A Lucide icon name, "tag" by default, one of: ${CATEGORY_ICONS.join(", ")}.`,
	),
	parent_id: z
		.string()
		.optional()
		.describe(
			"ID of an existing top-level category to nest under, which makes this a subcategory. Use get_categories to find ids.",
		),
});

/**
 * `update_category`: Sure's name, colour and icon, through the edit
 * « Réglages » makes; `run` refuses none of them with Sure's `no_changes`.
 * Its kind and parent stay, as Sure's function moves no category.
 */
export const updateCategoryInput = z.strictObject({
	id: z.string().describe("ID of the category to update; use get_categories to find it."),
	name: sureName(CATEGORY_NAME_MAX_LENGTH)
		.optional()
		.describe("New name for the category, which no other category holds, case aside."),
	color: present(categoryColor),
	icon: present(categoryIcon),
});
