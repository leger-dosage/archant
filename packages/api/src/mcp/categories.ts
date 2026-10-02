import { z } from "zod";

import { CATEGORY_KINDS } from "@archant/data/category-presets";

import { noToolInput } from "../schemas/assistants.ts";
import { listCategories } from "../services/categories.ts";
import { READ_ONLY, defineTool } from "./tool.ts";

const category = z.object({
	id: z.string(),
	name: z.string(),
	kind: z.enum(CATEGORY_KINDS),
	parentId: z.string().nullable().describe("The parent category's id; null for a top-level one."),
	transactionCount: z.number().int(),
});

export const getCategories = defineTool({
	name: "get_categories",
	title: "Categories",
	description:
		"Every category, with its kind (income or expense), its parent and how many transactions it holds. Ids returned here are the ones other tools take.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: noToolInput,
	output: z.object({ categories: z.array(category) }),
	run: async (deps) => {
		const categories = await listCategories(deps);

		return {
			result: {
				categories: categories.map(({ id, name, kind, parentId, transactionCount }) => ({
					id,
					name,
					kind,
					parentId,
					transactionCount,
				})),
			},
			changedRows: 0,
		};
	},
});
