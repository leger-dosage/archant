import { describe, expect, it } from "vitest";

import { decodeText } from "./decode.ts";

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("decodeText", () => {
	it("reads valid UTF-8", () => {
		expect(decodeText(utf8("Électricité"))).toBe("Électricité");
	});

	it("strips a UTF-8 BOM", () => {
		expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("Café")]))).toBe("Café");
	});

	it("falls back to windows-1252 on bytes that are not UTF-8", () => {
		// « Élec 5€ » in windows-1252.
		const bytes = new Uint8Array([0xc9, 0x6c, 0x65, 0x63, 0x20, 0x35, 0x80]);

		expect(decodeText(bytes)).toBe("Élec 5€");
	});

	it("reads windows-1252 when the file declares it, even if the bytes are valid UTF-8", () => {
		expect(decodeText(utf8("é"), "windows-1252")).toBe("Ã©");
	});

	it("strips a BOM before a declared windows-1252", () => {
		expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0xe9]), "windows-1252")).toBe("é");
	});

	it("keeps a file shorter than a BOM", () => {
		expect(decodeText(new Uint8Array([0xef]))).toBe("ï");
		expect(decodeText(new Uint8Array([]))).toBe("");
	});
});
