import type { CategorySummary } from "../services/categories.ts";

import { z } from "zod";

import { newCategory } from "@archant/data/category-presets";

import { createCategoryInput, listPageInput, updateCategoryInput } from "../schemas/assistants.ts";
import { createCategory, listCategories, updateCategory } from "../services/categories.ts";
import { namesOf } from "../services/names.ts";
import {
	CREATES,
	READ_ONLY,
	REPLACES,
	defineTool,
	pageOf,
	pageOutput,
	refuse,
	validated,
} from "./tool.ts";

/** A category as Sure's `create_category` and `update_category` answer it. */
const category = z.object({
	id: z.string(),
	name: z.string(),
	name_with_parent: z.string().describe('Such as "Alimentation > Restaurants".'),
	color: z.string().describe('A hex colour such as "#e99537".'),
	icon: z.string().describe("A Lucide icon name."),
	parent_id: z.string().nullable().describe("The parent category's id; null for a top-level one."),
});

type Category = Pick<CategorySummary, "id" | "name" | "color" | "icon" | "parentId">;

/** A category with its parent's name, as Sure's `name_with_parent` writes it. */
function categoryOf(item: Category, parentName: string | undefined): z.output<typeof category> {
	return {
		id: item.id,
		name: item.name,
		name_with_parent: parentName === undefined ? item.name : `${parentName} > ${item.name}`,
		color: item.color,
		icon: item.icon,
		parent_id: item.parentId,
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
		'Returns the categories, ordered alphabetically by hierarchy, a page at a time as Sure\'s get_categories. Each entry includes id, name, color, icon, parent_id (null for top-level) and name_with_parent (such as "Alimentation > Restaurants"). Use this before creating subcategories or referencing a category by id in update_category.',
	scope: "archant:read",
	annotations: READ_ONLY,
	input: listPageInput,
	output: z.object({
		categories: z.array(category.extend({ is_subcategory: z.boolean() })),
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
				})),
				...fields,
			},
			changedRows: 0,
		};
	},
});

/** What a write answers: the category, named under its parent as get_categories names it. */
async function writtenOf(
	deps: Parameters<typeof namesOf>[0],
	written: Category,
	verb: "created" | "updated",
) {
	const parentId = written.parentId === null ? [] : [written.parentId];
	const { categories } = await namesOf(deps, { categories: parentId });
	const answered = categoryOf(
		written,
		written.parentId === null ? undefined : categories.get(written.parentId),
	);

	return {
		success: true as const,
		category: answered,
		message: `Category '${answered.name_with_parent}' ${verb}.`,
	};
}

/** Whether a category holds this id, through the names read rather than a second service call. */
async function categoryExists(deps: Parameters<typeof namesOf>[0], id: string) {
	return (await namesOf(deps, { categories: [id] })).categories.has(id);
}

const written = z.object({ success: z.literal(true), category, message: z.string() });

export const createCategoryTool = defineTool({
	name: "create_category",
	title: "Create a category",
	description:
		"Creates a category, as Sure's create_category. Two levels at most: parent_id (from get_categories) makes it a subcategory, which takes its parent's colour and kind; any other is an expense category. The colour defaults to the picker's first and the icon to \"tag\". Category names must be unique, case aside.",
	scope: "archant:write",
	annotations: CREATES,
	input: createCategoryInput,
	output: written,
	run: async (deps, { name, color, icon, parent_id: parentId }) => {
		if (name === "") {
			refuse("name_required", "Please provide a name for the category.");
		}

		// Sure's `present?`: a blank parent id is no parent.
		const parent = parentId === undefined || parentId.trim() === "" ? null : parentId;

		if (parent !== null && !(await categoryExists(deps, parent))) {
			refuse("parent_not_found", `Parent category with id '${parent}' not found.`);
		}

		const preset = newCategory(name);
		const created = await validated(async () =>
			createCategory(deps, {
				...preset,
				kind: "expense",
				color: color ?? preset.color,
				icon: icon ?? preset.icon,
				parentId: parent,
			}),
		);

		return { result: await writtenOf(deps, created, "created"), changedRows: 1 };
	},
});

export const updateCategoryTool = defineTool({
	name: "update_category",
	title: "Update a category",
	description:
		"Updates a category's name, colour or icon, as Sure's update_category: use get_categories first to find its id, and give at least one of name, color or icon. Its kind and parent stay. A parent's new colour passes to its subcategories, and a subcategory keeps its parent's whatever it is given.",
	scope: "archant:write",
	annotations: REPLACES,
	input: updateCategoryInput,
	output: written,
	run: async (deps, { id, name, color, icon }) => {
		if (!(await categoryExists(deps, id))) {
			refuse("not_found", `Category with id '${id}' not found.`);
		}

		// Sure's `present?`: a blank name changes nothing.
		const patch = {
			...(name === undefined || name === "" ? {} : { name }),
			...(color === undefined ? {} : { color }),
			...(icon === undefined ? {} : { icon }),
		};

		if (Object.keys(patch).length === 0) {
			refuse("no_changes", "Provide at least one of name, color, or icon to update.");
		}

		const updated = await validated(async () => updateCategory(deps, id, patch));

		return { result: await writtenOf(deps, updated, "updated"), changedRows: 1 };
	},
});
