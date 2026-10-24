import { z } from "zod";

import { listPageInput } from "../schemas/assistants/fields.ts";
import { createTagInput, updateTagInput } from "../schemas/assistants/tags.ts";
import { tagIdNamed } from "../services/names.ts";
import { createTag, listTags, updateTag } from "../services/tags.ts";
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

/** A tag as Sure's tools give it. */
const tag = z.object({
	id: z.string(),
	name: z.string(),
	color: z.string().describe('A hex colour such as "#e99537".'),
});

const tagOf = ({ id, name, color }: { id: string; name: string; color: string }) => ({
	id,
	name,
	color,
});

const written = z.object({ success: z.literal(true), tag, message: z.string() });

export const getTags = defineTool({
	name: "get_tags",
	title: "Tags",
	description:
		"Returns the tags, sorted alphabetically, a page at a time as Sure's get_tags. Use this when the owner wants to see the tags, or before referencing a tag in create_tag or update_tag.",
	scope: "archant:read",
	annotations: READ_ONLY,
	input: listPageInput,
	output: z.object({ tags: z.array(tag), ...pageOutput }),
	run: async (deps, { page, page_size: pageSize }) => {
		const { items, ...fields } = pageOf(await listTags(deps), page, pageSize);

		return { result: { tags: items.map(tagOf), ...fields }, changedRows: 0 };
	},
});

export const createTagTool = defineTool({
	name: "create_tag",
	title: "Create a tag",
	description:
		"Creates a tag, as Sure's create_tag, and returns its id for a rule's action or condition. Tag names must be unique, case aside. If color is omitted, one is chosen automatically from the default palette.",
	scope: "archant:write",
	annotations: CREATES,
	input: createTagInput,
	output: written,
	run: async (deps, { name, color }) => {
		if (name === "") {
			refuse("name_required", "Please provide a name for the tag.");
		}

		const created = await validated(async () =>
			createTag(deps, { name, ...(color === undefined ? {} : { color }) }),
		);

		return {
			result: {
				success: true as const,
				tag: tagOf(created),
				message: `Tag '${created.name}' created.`,
			},
			changedRows: 1,
		};
	},
});

export const updateTagTool = defineTool({
	name: "update_tag",
	title: "Update a tag",
	description:
		"Updates an existing tag's name or color, as Sure's update_tag: the tag is named by its current name, exactly as get_tags gives it, and every transaction carrying it shows the change. At least one of new_name or color must be given.",
	scope: "archant:write",
	annotations: REPLACES,
	fieldPaths: { name: "new_name" },
	input: updateTagInput,
	output: written,
	run: async (deps, { name, new_name: newName, color }) => {
		// Sure strips the name, then matches it exactly; its refusal quotes it as given.
		const current = name.trim();
		const id = await tagIdNamed(deps, current);

		if (id === undefined) {
			refuse("not_found", `Tag '${name}' not found.`);
		}

		// Sure's `present?`: a blank value changes nothing.
		const renaming = newName !== undefined && newName !== "";
		const recolouring = color !== undefined;

		if (!renaming && !recolouring) {
			refuse("no_changes", "Provide at least one of new_name or color to update.");
		}

		const tagNow = await validated(async () =>
			updateTag(deps, id, {
				name: renaming ? newName : current,
				...(recolouring ? { color } : {}),
			}),
		);

		return {
			result: { success: true as const, tag: tagOf(tagNow), message: "Tag updated." },
			changedRows: 1,
		};
	},
});
