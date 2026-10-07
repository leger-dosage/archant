import { z } from "zod";

import { createTagInput, listPageInput, updateTagInput } from "../schemas/assistants.ts";
import { tagIdNamed } from "../services/names.ts";
import { createTag, listTags, renameTag } from "../services/tags.ts";
import { CREATES, READ_ONLY, REPLACES, defineTool, pageOf, pageOutput } from "./tool.ts";

const tag = z.object({ id: z.string(), name: z.string() });

export const getTags = defineTool({
	name: "get_tags",
	title: "Tags",
	description:
		"The tags, sorted by name, a page at a time as Sure's get_tags, each with how many transactions carry it. Use it before referencing a tag in create_tag or update_tag.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: listPageInput,
	output: z.object({
		tags: z.array(tag.extend({ transaction_count: z.number().int() })),
		...pageOutput,
	}),
	run: async (deps, { page, page_size: pageSize }) => {
		const { items, ...fields } = pageOf(await listTags(deps), page, pageSize);

		return {
			result: {
				tags: items.map(({ id, name, transactionCount }) => ({
					id,
					name,
					transaction_count: transactionCount,
				})),
				...fields,
			},
			changedRows: 0,
		};
	},
});

export const createTagTool = defineTool({
	name: "create_tag",
	title: "Create a tag",
	description:
		"Creates a tag as Archant's tag picker does and returns its id for a rule's action or condition. A name already taken answers VALIDATION_ERROR with name_taken: use that tag's id from get_tags instead.",
	scope: "archant:write",
	annotations: CREATES,
	input: createTagInput,
	output: z.object({ tag }),
	run: async (deps, input) => {
		const { id, name } = await createTag(deps, input);

		return { result: { tag: { id, name } }, changedRows: 1 };
	},
});

export const updateTagTool = defineTool({
	name: "update_tag",
	title: "Rename a tag",
	description:
		"Renames a tag as « Réglages » does, the tag named by its current name, exactly as get_tags gives it, as Sure's update_tag finds it; every transaction carrying it shows the new name. A name no tag holds answers NOT_FOUND; a name another tag holds, case aside, answers VALIDATION_ERROR on new_name with name_taken.",
	scope: "archant:write",
	annotations: REPLACES,
	fieldPaths: { name: "new_name" },
	input: updateTagInput,
	output: z.object({ tag }),
	run: async (deps, { name: current, new_name: name }) => {
		const { id, name: renamed } = await renameTag(deps, await tagIdNamed(deps, current), { name });

		return { result: { tag: { id, name: renamed } }, changedRows: 1 };
	},
});
