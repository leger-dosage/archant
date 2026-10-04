import { describe, expect, it } from "vitest";

import { formatFileSize } from "./file-size.ts";

describe("formatFileSize", () => {
	it.each([
		[0, "0 o"],
		[512, "512 o"],
		[1023, "1 023 o"],
		[1024, "1 ko"],
		[1536, "1,5 ko"],
		[10 * 1024 * 1024, "10 Mo"],
		[2.5 * 1024 * 1024 * 1024, "2,5 Go"],
		[3 * 1024 ** 4, "3 072 Go"],
	])("shows %d bytes as %s, in powers of 1024", (bytes, shown) => {
		expect(formatFileSize(bytes).replaceAll(/\s/gu, " ")).toBe(shown);
	});

	it("moves to the next unit when the size rounds up to 1 024", () => {
		expect(formatFileSize(1024 * 1024 - 1).replaceAll(/\s/gu, " ")).toBe("1 Mo");
	});
});
