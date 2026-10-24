import { z } from "zod";

import { TAG_NAME_MAX_LENGTH } from "@archant/data/name-limits";

import { categoryColor } from "../categories.ts";
import { present, requiredSureName, sureName } from "./fields.ts";

/** Sure's `strip` before its `format:` validation. */
const tagColor = z.string().trim().pipe(categoryColor);

/** `create_tag`: Sure's fields. */
export const createTagInput = z.strictObject({
	name: requiredSureName(TAG_NAME_MAX_LENGTH).describe(
		"Tag name, which no other tag holds, case aside.",
	),
	color: present(tagColor).describe(
		"Hex color code (e.g. #e99537). If omitted, one is chosen from the default palette.",
	),
});

/**
 * `update_tag`: the tag by its current name, as Sure's. Only the owner names
 * a tag, never a bank or a file, and no two tags share a name (AD-19). No
 * `enum` of the names, unlike Sure's: the schema would list every tag.
 */
export const updateTagInput = z.strictObject({
	name: z.string().describe("Current name of the tag to update, exactly as get_tags gives it."),
	new_name: sureName(TAG_NAME_MAX_LENGTH)
		.optional()
		.describe("New name for the tag, which no other tag holds, case aside."),
	color: present(tagColor).describe("New hex color code (optional)"),
});
