import { z } from "zod";

import { createTagInput, noToolInput } from "../schemas/assistants.ts";
import { createTag, listTags } from "../services/tags.ts";
import { CREATES, READ_ONLY, defineTool } from "./tool.ts";

const tag = z.object({ id: z.string(), name: z.string(), transactionCount: z.number().int() });

export const getTags = defineTool({
	name: "get_tags",
	title: "Tags",
	description: "Every tag, with how many transactions carry it.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: noToolInput,
	output: z.object({ tags: z.array(tag) }),
	run: async (deps) => ({ result: { tags: await listTags(deps) }, changedRows: 0 }),
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
