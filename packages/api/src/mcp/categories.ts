import { z } from "zod";

import { CATEGORY_KINDS, newCategory } from "@archant/data/category-presets";

import { createCategoryInput, noToolInput } from "../schemas/assistants.ts";
import { createCategory, listCategories } from "../services/categories.ts";
import { CREATES, READ_ONLY, defineTool } from "./tool.ts";

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

export const createCategoryTool = defineTool({
	name: "create_category",
	title: "Create a category",
	description:
		"Creates a category as Archant's category picker does, with its default colour and icon, which the owner may change later, and returns its id for a rule's action or condition. A child takes its parent's kind. A name already taken answers VALIDATION_ERROR with name_taken: use that category's id from get_categories instead.",
	scope: "archant:write",
	annotations: CREATES,
	input: createCategoryInput,
	output: z.object({ category: category.omit({ transactionCount: true }) }),
	run: async (deps, { name, kind, parentId }) => {
		const created = await createCategory(deps, {
			...newCategory(name),
			kind,
			parentId: parentId ?? null,
		});

		return {
			result: {
				category: {
					id: created.id,
					name: created.name,
					kind: created.kind,
					parentId: created.parentId,
				},
			},
			changedRows: 1,
		};
	},
});
