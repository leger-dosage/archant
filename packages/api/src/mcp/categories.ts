import type { CategorySummary } from "../services/categories.ts";

import { z } from "zod";

import { CATEGORY_KINDS, newCategory } from "@archant/data/category-presets";

import { createCategoryInput, listPageInput, updateCategoryInput } from "../schemas/assistants.ts";
import { createCategory, listCategories, updateCategory } from "../services/categories.ts";
import { namesOf } from "../services/names.ts";
import { CREATES, READ_ONLY, REPLACES, defineTool, pageOf, pageOutput } from "./tool.ts";

/** A category as Sure's `create_category` and `update_category` answer it, with its kind. */
const category = z.object({
	id: z.string(),
	name: z.string(),
	name_with_parent: z.string().describe('Such as "Alimentation > Restaurants".'),
	color: z.string().describe('A hex colour such as "#e99537".'),
	icon: z.string().describe("A Lucide icon name."),
	parent_id: z.string().nullable().describe("The parent category's id; null for a top-level one."),
	kind: z.enum(CATEGORY_KINDS),
});

type Category = Pick<CategorySummary, "id" | "name" | "kind" | "color" | "icon" | "parentId">;

function categoryOf(summary: Category, parentName: string | undefined): z.input<typeof category> {
	return {
		id: summary.id,
		name: summary.name,
		name_with_parent: parentName === undefined ? summary.name : `${parentName} > ${summary.name}`,
		color: summary.color,
		icon: summary.icon,
		parent_id: summary.parentId,
		kind: summary.kind,
	};
}

/**
 * Sure's `alphabetically_by_hierarchy`: each top-level category by name,
 * followed by its subcategories by name. `listCategories` sorts by name.
 */
function byHierarchy(categories: readonly CategorySummary[]): CategorySummary[] {
	const known = new Set(categories.map((item) => item.id));
	const childrenOf = (id: string) => categories.filter((item) => item.parentId === id);

	return categories.flatMap((item) =>
		item.parentId === null || !known.has(item.parentId) ? [item, ...childrenOf(item.id)] : [],
	);
}

export const getCategories = defineTool({
	name: "get_categories",
	title: "Categories",
	description:
		"The categories by hierarchy, each top-level one followed by its subcategories, a page at a time as Sure's get_categories: each with its name, its name under its parent, its colour, icon, parent, kind (income or expense) and how many transactions it holds. Ids returned here are the ones other tools take.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: listPageInput,
	output: z.object({
		categories: z.array(
			category.extend({
				is_subcategory: z.boolean(),
				transaction_count: z.number().int(),
			}),
		),
		...pageOutput,
	}),
	run: async (deps, { page, page_size: pageSize }) => {
		const listed = await listCategories(deps);
		const names = new Map(listed.map((item) => [item.id, item.name]));
		const { items, ...fields } = pageOf(byHierarchy(listed), page, pageSize);

		return {
			result: {
				categories: items.map((item) => ({
					...categoryOf(item, item.parentId === null ? undefined : names.get(item.parentId)),
					is_subcategory: item.parentId !== null,
					transaction_count: item.transactionCount,
				})),
				...fields,
			},
			changedRows: 0,
		};
	},
});

/** A category a write answers, its parent named as get_categories names it. */
async function writtenOf(
	deps: Parameters<typeof namesOf>[0],
	written: Category,
): Promise<z.input<typeof category>> {
	const parentId = written.parentId === null ? [] : [written.parentId];
	const { categories } = await namesOf(deps, { categories: parentId });

	return categoryOf(
		written,
		written.parentId === null ? undefined : categories.get(written.parentId),
	);
}

export const createCategoryTool = defineTool({
	name: "create_category",
	title: "Create a category",
	description:
		"Creates a category as Archant's category picker does, as Sure's create_category, and returns its id for a rule's action or condition. Two levels at most: parent_id makes it a subcategory, which takes its parent's kind and colour. The colour defaults to the picker's first and the icon to \"tag\"; the owner may change them later. A name already taken answers VALIDATION_ERROR with name_taken: use that category's id from get_categories instead.",
	scope: "archant:write",
	annotations: CREATES,
	input: createCategoryInput,
	output: z.object({ category }),
	run: async (deps, { name, kind, color, icon, parent_id: parentId }) => {
		const preset = newCategory(name);
		const created = await createCategory(deps, {
			...preset,
			kind,
			color: color ?? preset.color,
			icon: icon ?? preset.icon,
			parentId: parentId ?? null,
		});

		return { result: { category: await writtenOf(deps, created) }, changedRows: 1 };
	},
});

export const updateCategoryTool = defineTool({
	name: "update_category",
	title: "Update a category",
	description:
		"Changes a category's name, colour or icon, at least one, as « Réglages » does, as Sure's update_category; its kind and parent stay. A parent's new colour passes to its subcategories, and a subcategory keeps its parent's whatever it is given. A name another category holds, case aside, answers VALIDATION_ERROR with name_taken.",
	scope: "archant:write",
	annotations: REPLACES,
	input: updateCategoryInput,
	output: z.object({ category }),
	run: async (deps, { id, ...patch }) => {
		const updated = await updateCategory(deps, id, patch);

		return { result: { category: await writtenOf(deps, updated) }, changedRows: 1 };
	},
});
