import { describe, expect, it } from "vitest";

import { CITATION_MAX_LENGTH, mergedNotes, parseCitation } from "./citation.ts";

// Sure's `test/models/provenance/citation_test.rb`, case for case.

describe("parseCitation", () => {
	it("parses a plain citation with a reliability grade", () => {
		expect(
			parseCitation("Private bank statement 2026-03-31, category subtotals (grade: A)"),
		).toEqual({
			ok: true,
			citation: {
				source: "Private bank statement 2026-03-31, category subtotals (grade: A)",
				citation: "Private bank statement 2026-03-31, category subtotals",
				estimated: false,
				grade: "A",
			},
		});
	});

	it("parses an estimated citation", () => {
		expect(
			parseCitation("estimated: linear interpolation over 2024-08 / 2024-12 anchors (grade: C)"),
		).toMatchObject({
			ok: true,
			citation: {
				citation: "linear interpolation over 2024-08 / 2024-12 anchors",
				estimated: true,
				grade: "C",
			},
		});
	});

	it("takes no grade on a citation that is not an estimate", () => {
		expect(parseCitation("Appraisal report 2026-03-12")).toMatchObject({
			ok: true,
			citation: { citation: "Appraisal report 2026-03-12", estimated: false, grade: null },
		});
	});

	it("reads the grade whatever the spacing after the colon", () => {
		for (const raw of ["Doc (grade:A)", "Doc (grade: A)", "Doc (grade:  A)"]) {
			expect(parseCitation(raw)).toMatchObject({
				ok: true,
				citation: { citation: "Doc", grade: "A" },
			});
		}
	});

	it("keeps the source trimmed", () => {
		expect(parseCitation("  Statement 2026-01-31 (grade: A) ")).toMatchObject({
			ok: true,
			citation: { source: "Statement 2026-01-31 (grade: A)" },
		});
	});

	it("refuses an unknown grade, whatever the spacing", () => {
		for (const raw of ["Doc (grade:D)", "Doc (grade:  D)", "Some document (grade: D)"]) {
			expect(parseCitation(raw)).toEqual({ ok: false, code: "unknown_grade" });
		}
	});

	it("refuses a blank citation", () => {
		expect(parseCitation("   ")).toEqual({ ok: false, code: "source_required" });
	});

	it("refuses an estimate without a grade", () => {
		expect(parseCitation("estimated: interpolated from neighbouring months")).toEqual({
			ok: false,
			code: "estimate_without_grade",
		});
	});

	it("refuses an estimate marker other than the exact prefix", () => {
		expect(parseCitation("Estimated: interpolated (grade: C)")).toEqual({
			ok: false,
			code: "estimated_prefix",
		});
	});

	it("refuses a citation naming no document", () => {
		expect(parseCitation("ab")).toEqual({ ok: false, code: "no_document_named" });
		expect(parseCitation("ab (grade: A)")).toEqual({ ok: false, code: "no_document_named" });
	});

	it("refuses a citation over two lines, as Sure's pattern does", () => {
		expect(parseCitation("Statement\n2026-01-31")).toEqual({ ok: false, code: "source_invalid" });
	});

	it("refuses a citation over the length limit", () => {
		expect(parseCitation("x".repeat(CITATION_MAX_LENGTH))).toMatchObject({ ok: true });
		expect(parseCitation("x".repeat(CITATION_MAX_LENGTH + 1))).toEqual({
			ok: false,
			code: "source_too_long",
		});
	});
});

// Sure's `merged_notes`, in `Assistant::Function::RecordValuation`.
describe("mergedNotes", () => {
	const source = "Appraisal report 2024-06-30 (grade: A)";

	it("is the citation alone on a valuation without notes", () => {
		expect(mergedNotes(null, source)).toBe(source);
		expect(mergedNotes("  \n ", source)).toBe(source);
	});

	it("keeps what the owner wrote and appends the citation below it", () => {
		expect(mergedNotes("Appraiser said the roof needs work", source)).toBe(
			`Appraiser said the roof needs work\n\n${source}`,
		);
	});

	it("does not stack a citation already on one of its lines", () => {
		expect(mergedNotes(source, source)).toBe(source);
		expect(mergedNotes(`Roof\n\n  ${source}  `, source)).toBe(`Roof\n\n  ${source}`);
	});

	it("appends a changed citation, so the trail survives", () => {
		const revised = "Revised appraisal 2024-07-15 (grade: A)";

		expect(mergedNotes(source, revised)).toBe(`${source}\n\n${revised}`);
	});
});
