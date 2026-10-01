import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Comments and lint messages cite « AD-n » to justify a rule; a citation that
// resolves to nothing sends a contributor looking for a decision that does not
// exist, so every one must name a heading of the spine.
const root = fileURLToPath(new URL("../../..", import.meta.url));
const spine = join(root, "docs/architecture.md");
const skipped = new Set(["node_modules", "dist", "coverage", "test-results", "playwright-report"]);
const reference = /\bAD-(\d+)\b/g;

function walk(path: string): string[] {
	if (!statSync(path).isDirectory()) {
		return [path];
	}

	return readdirSync(path)
		.filter((name) => !skipped.has(name))
		.flatMap((name) => walk(join(path, name)));
}

function citations(): { file: string; id: string }[] {
	const files = [
		...walk(join(root, "packages")),
		join(root, ".oxlintrc.json"),
		join(root, "AGENTS.md"),
		...walk(join(root, "docs")),
	];
	return files.flatMap((file) => {
		const text = readFileSync(file, "utf8");
		return [...text.matchAll(reference)].map((match) => ({
			file: relative(root, file),
			id: `AD-${match[1]}`,
		}));
	});
}

describe("architecture references", () => {
	it("keeps the spine at docs/architecture.md", () => {
		expect(existsSync(spine)).toBe(true);
	});

	it("resolves every AD-n cited in code, lint rules and documents to a heading of the spine", () => {
		const headings = new Set(
			[...readFileSync(spine, "utf8").matchAll(/^### (AD-\d+)\b/gm)].map((match) => match[1]),
		);
		const found = citations();

		expect(found.length).toBeGreaterThan(0);
		expect(found.filter(({ id }) => !headings.has(id))).toEqual([]);
	});
});
