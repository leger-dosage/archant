import { describe, expect, it } from "vitest";

import { DEFAULT_CATEGORIES } from "../services/default-categories.ts";
import { createCategorySchema } from "./categories.ts";

describe("createCategorySchema", () => {
	// Editing a default sends its colour back, and 13 of the 15 are not swatches.
	it.each(DEFAULT_CATEGORIES)("accepts the default $name as it is seeded", (category) => {
		expect(createCategorySchema.safeParse({ ...category, parentId: null }).success).toBe(true);
	});
});
