import { describe, expect, it } from "vitest";

import { categoryTree } from "./category-tree";

const category = (id: string, name: string, parentId: string | null = null) => ({
	id,
	name,
	parentId,
});

describe("categoryTree", () => {
	it("sorts parents and children as a French reader does, children under their parent", () => {
		const tree = categoryTree([
			category("t", "Transports"),
			category("e", "Épargne"),
			category("l", "Logement"),
			category("r", "Loyer", "l"),
			category("n", "Énergie", "l"),
		]);

		expect(tree.map(({ parent, children }) => [parent.name, children.map((c) => c.name)])).toEqual([
			["Épargne", []],
			["Logement", ["Énergie", "Loyer"]],
			["Transports", []],
		]);
	});

	it("keeps a child whose parent is missing, as a parent", () => {
		expect(categoryTree([category("r", "Loyer", "gone")])).toEqual([
			{ parent: category("r", "Loyer", "gone"), children: [] },
		]);
	});
});
