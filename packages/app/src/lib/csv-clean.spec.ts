import { describe, expect, it } from "vitest";

import { fileIssuesOf, isCleaned } from "./csv-clean";

const issue = (code: string, params: Record<string, string> = {}) => ({ code, params });

const row = (issues: { column: number; issue: ReturnType<typeof issue> }[] = []) => ({
	line: 2,
	values: ["01/09/2026"],
	issues,
});

describe("isCleaned", () => {
	it("holds once every row is valid, whatever « Mapper » has left", () => {
		const preview = {
			clean: { columns: ["date" as const], rows: [row()] },
			errors: [issue("unmapped_account", { key: "Livret" })],
		};

		expect(isCleaned(preview)).toBe(true);
		expect(fileIssuesOf(preview)).toEqual([]);
	});

	it("fails while a row has a refusal", () => {
		const refusal = issue("invalid_date", { line: "2", format: "DD/MM/YYYY" });

		expect(
			isCleaned({
				clean: { columns: ["date"], rows: [row([{ column: 0, issue: refusal }])] },
				errors: [refusal],
			}),
		).toBe(false);
	});

	it("fails while the file itself is refused", () => {
		const preview = {
			clean: { columns: ["name" as const], rows: [row()] },
			errors: [issue("missing_columns", { columns: "name" })],
		};

		expect(isCleaned(preview)).toBe(false);
		expect(fileIssuesOf(preview)).toEqual([issue("missing_columns", { columns: "name" })]);
	});
});
