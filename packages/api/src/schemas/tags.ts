import { z } from "zod";

import { TAG_NAME_MAX_LENGTH } from "@archant/data/schema/tags";

// NFC: a pasted « Été » may arrive decomposed, and would otherwise sit beside
// the composed one as a second tag of the same name.
const tagName = z
	.string()
	.trim()
	.transform((value) => value.normalize("NFC"))
	.pipe(z.string().min(1).max(TAG_NAME_MAX_LENGTH));

/** Creating and renaming take the same body, so a name one accepts the other does too. */
export const tagSchema = z.object({ name: tagName });

export type TagInput = z.input<typeof tagSchema>;
export type TagRequest = z.output<typeof tagSchema>;
