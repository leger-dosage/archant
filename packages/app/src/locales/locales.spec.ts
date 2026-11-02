import { describe, expect, it } from "vitest";

import en from "./en.json";
import fr from "./fr.json";

type Tree = { [key: string]: string | Tree };

const placeholders = (text: string) => (text.match(/\{\{[^}]+\}\}/gu) ?? []).toSorted().join();

function leaves(tree: Tree, path = ""): [string, string][] {
	return Object.entries(tree).flatMap(([key, value]) =>
		typeof value === "string" ? [[`${path}${key}`, value]] : leaves(value, `${path}${key}.`),
	);
}

describe("the English file", () => {
	const reference = new Map(leaves(fr));
	const translated = new Map(leaves(en));

	it("has the keys of the French file, no more, no less", () => {
		expect([...translated.keys()].toSorted()).toEqual([...reference.keys()].toSorted());
	});

	it("keeps every placeholder of the French string", () => {
		const changed = [...reference]
			.filter(([key, text]) => placeholders(text) !== placeholders(translated.get(key) ?? ""))
			.map(([key]) => key);

		expect(changed).toEqual([]);
	});

	it("leaves no string empty", () => {
		expect([...translated].filter(([, text]) => text.trim() === "").map(([key]) => key)).toEqual(
			[],
		);
	});
});
