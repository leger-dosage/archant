import { z } from "zod";

import { noToolInput } from "../schemas/assistants.ts";
import { listTags } from "../services/tags.ts";
import { READ_ONLY, defineTool } from "./tool.ts";

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
