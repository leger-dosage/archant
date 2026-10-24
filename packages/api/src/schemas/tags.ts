import { z } from "zod";

import { TAG_NAME_MAX_LENGTH } from "@archant/data/name-limits";

import { categoryColor } from "./categories.ts";

// NFC: a pasted « Été » may arrive decomposed, and would otherwise sit beside
// the composed one as a second tag of the same name.
const tagName = z
	.string()
	.trim()
	.transform((value) => value.normalize("NFC"))
	.pipe(z.string().min(1).max(TAG_NAME_MAX_LENGTH));

/**
 * Creating and editing take the same body, so a name one accepts the other
 * does too. Without a colour, a new tag draws one of Sure's ten and an edited
 * one keeps its own.
 */
export const tagSchema = z.object({ name: tagName, color: categoryColor.optional() });

export type TagInput = z.input<typeof tagSchema>;
export type TagRequest = z.output<typeof tagSchema>;

/** Sure's `replace_and_destroy!`: the tag that takes a deleted one's place; absent removes it. */
export const deleteTagQuerySchema = z.object({ replacementId: z.string().min(1).optional() });
