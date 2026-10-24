import { z } from "zod";

import { CATEGORY_ICONS, CATEGORY_NAME_MAX_LENGTH } from "@archant/data/category-presets";

import { createCategorySchema } from "../categories.ts";
import { present, requiredSureName, sureName } from "./fields.ts";

const categoryField = createCategorySchema.shape;

const categoryColor = categoryField.color.describe(
	'A hex colour such as "#e99537"; a subcategory takes its parent\'s whatever it is given.',
);

const categoryIcon = categoryField.icon.describe(
	`A Lucide icon name, one of: ${CATEGORY_ICONS.join(", ")}.`,
);

/** `create_category`: Sure's fields; a subcategory takes its parent's colour. */
export const createCategoryInput = z.strictObject({
	name: requiredSureName(CATEGORY_NAME_MAX_LENGTH).describe(
		"Category name, which no other category holds, case aside.",
	),
	color: present(categoryColor).describe(
		'Hex color code such as "#e99537", a palette color at random by default. Ignored for subcategories, which take their parent\'s.',
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
 * Its parent stays, as Sure's function moves no category.
 */
export const updateCategoryInput = z.strictObject({
	id: z.string().describe("ID of the category to update; use get_categories to find it."),
	name: sureName(CATEGORY_NAME_MAX_LENGTH)
		.optional()
		.describe("New name for the category, which no other category holds, case aside."),
	color: present(categoryColor),
	icon: present(categoryIcon),
});
