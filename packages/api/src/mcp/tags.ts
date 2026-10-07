import { z } from "zod";

import { createTagInput, noToolInput, updateTagInput } from "../schemas/assistants.ts";
import { createTag, listTags, renameTag } from "../services/tags.ts";
import { CREATES, READ_ONLY, REPLACES, defineTool } from "./tool.ts";

const tag = z.object({ id: z.string(), name: z.string(), transaction_count: z.number().int() });

export const getTags = defineTool({
	name: "get_tags",
	title: "Tags",
	description: "Every tag, with how many transactions carry it.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: noToolInput,
	output: z.object({ tags: z.array(tag) }),
	run: async (deps) => ({
		result: {
			tags: (await listTags(deps)).map(({ id, name, transactionCount }) => ({
				id,
				name,
				transaction_count: transactionCount,
			})),
		},
		changedRows: 0,
	}),
});

export const createTagTool = defineTool({
	name: "create_tag",
	title: "Create a tag",
	description:
		"Creates a tag as Archant's tag picker does and returns its id for a rule's action or condition. A name already taken answers VALIDATION_ERROR with name_taken: use that tag's id from get_tags instead.",
	scope: "archant:write",
	annotations: CREATES,
	input: createTagInput,
	output: z.object({ tag: z.object({ id: z.string(), name: z.string() }) }),
	run: async (deps, input) => {
		const { id, name } = await createTag(deps, input);

		return { result: { tag: { id, name } }, changedRows: 1 };
	},
});

export const updateTagTool = defineTool({
	name: "update_tag",
	title: "Rename a tag",
	description:
		"Renames a tag as « Réglages » does, as Sure's update_tag, the tag named by its id from get_tags where Sure takes its current name; every transaction carrying it shows the new name. A name another tag holds, case aside, answers VALIDATION_ERROR on new_name with name_taken.",
	scope: "archant:write",
	annotations: REPLACES,
	fieldPaths: { name: "new_name" },
	input: updateTagInput,
	output: z.object({ tag: z.object({ id: z.string(), name: z.string() }) }),
	run: async (deps, { id: tagId, new_name: name }) => {
		const { id, name: renamed } = await renameTag(deps, tagId, { name });

		return { result: { tag: { id, name: renamed } }, changedRows: 1 };
	},
});
