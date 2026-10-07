import { z } from "zod";

import { CATEGORY_KINDS, newCategory } from "@archant/data/category-presets";

import { createCategoryInput, noToolInput, updateCategoryInput } from "../schemas/assistants.ts";
import { createCategory, listCategories, updateCategory } from "../services/categories.ts";
import { CREATES, READ_ONLY, REPLACES, defineTool } from "./tool.ts";

const category = z.object({
	id: z.string(),
	name: z.string(),
	kind: z.enum(CATEGORY_KINDS),
	parent_id: z.string().nullable().describe("The parent category's id; null for a top-level one."),
	transaction_count: z.number().int(),
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
					parent_id: parentId,
					transaction_count: transactionCount,
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
	output: z.object({ category: category.omit({ transaction_count: true }) }),
	run: async (deps, { name, kind, parent_id: parentId }) => {
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
					parent_id: created.parentId,
				},
			},
			changedRows: 1,
		};
	},
});

export const updateCategoryTool = defineTool({
	name: "update_category",
	title: "Rename a category",
	description:
		"Renames a category as « Réglages » does, as Sure's update_category; its kind, colour, icon and parent stay. A name another category holds, case aside, answers VALIDATION_ERROR with name_taken.",
	scope: "archant:write",
	annotations: REPLACES,
	input: updateCategoryInput,
	output: z.object({ category: category.omit({ transaction_count: true }) }),
	run: async (deps, { id, name }) => {
		const renamed = await updateCategory(deps, id, { name });

		return {
			result: {
				category: {
					id: renamed.id,
					name: renamed.name,
					kind: renamed.kind,
					parent_id: renamed.parentId,
				},
			},
			changedRows: 1,
		};
	},
});
