import { describe, expect, it } from "vitest";

import { attachmentFileName, attachmentTypeOf } from "./attachment-files.ts";

const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;

const bytes = (...values: (number | string)[]) =>
	new Uint8Array(
		values.flatMap((value) =>
			typeof value === "number" ? [value] : [...new TextEncoder().encode(value)],
		),
	);

describe("attachmentTypeOf", () => {
	it.each([
		["a JPEG", bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10), "image/jpeg"],
		["a PNG", bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d), "image/png"],
		["a GIF 87a", bytes("GIF87a", 1, 0), "image/gif"],
		["a GIF 89a", bytes("GIF89a", 1, 0), "image/gif"],
		["a WebP", bytes("RIFF", 0x24, 0, 0, 0, "WEBPVP8 "), "image/webp"],
		["a PDF", bytes("%PDF-1.7\n"), "application/pdf"],
	])("reads %s from its first bytes", (_name, file, type) => {
		expect(attachmentTypeOf(file)).toBe(type);
	});

	it.each([
		["an empty file", bytes()],
		["HTML", bytes("<!doctype html><script>alert(1)</script>")],
		["two bytes of a JPEG", bytes(0xff, 0xd8)],
		["a PNG with its last byte wrong", bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0b)],
		["a GIF of an unknown version", bytes("GIF88a")],
		["a RIFF that is no WebP", bytes("RIFF", 0x24, 0, 0, 0, "WAVEfmt ")],
		["a WebP cut short", bytes("RIFF", 0x24, 0, 0, 0, "WEB")],
		["a PDF without its dash", bytes("%PDF1.7")],
		["a PDF signature after a byte", bytes(" %PDF-1.7")],
	])("reads nothing from %s", (_name, file) => {
		expect(attachmentTypeOf(file)).toBeNull();
	});
});

describe("attachmentFileName", () => {
	it.each([
		["a plain name", "ticket.png", "ticket.png"],
		["a path climbing out", "../a<b>.pdf", "..-a-b-.pdf"],
		[
			"every character Active Storage replaces",
			'a\u202eb%c$d|e:f;g/h<i>j?k*l"m\\n.pdf',
			"a-b-c-d-e-f-g-h-i-j-k-l-m-n.pdf",
		],
		[
			"every bidirectional control",
			"a\u061cb\u200ec\u200fd\u202ae\u202bf\u202cg\u202dh\u2066i\u2067j\u2068k\u2069l.pdf",
			"a-b-c-d-e-f-g-h-i-j-k-l.pdf",
		],
		[
			"an emoji joined by U+200D, kept whole",
			"famille \u{1f469}\u200d\u{1f467}.png",
			"famille \u{1f469}\u200d\u{1f467}.png",
		],
		["control characters", "fac\u0000ture\u0007\u007f.pdf", "fac-ture--.pdf"],
		["spaces around it", "  facture mars.pdf \n", "facture mars.pdf"],
		["accents decomposed", "Facture cafe\u0301.pdf", "Facture caf\u00e9.pdf"],
	])("cleans %s", (_name, name, cleaned) => {
		expect(attachmentFileName(name)).toBe(cleaned);
	});

	it.each(["", "   ", "\t\n"])("names an empty name %j `attachment`", (name) => {
		expect(attachmentFileName(name)).toBe("attachment");
	});

	it("cuts a long name to 255 bytes, keeping its extension", () => {
		const cleaned = attachmentFileName(`${"\u00e9".repeat(300)}.pdf`);

		expect(cleaned).toBe(`${"\u00e9".repeat(125)}.pdf`);
		expect(byteLength(cleaned)).toBe(254);
	});

	it("cuts between graphemes, never inside an emoji drawn from several code points", () => {
		const family = "\u{1f469}\u200d\u{1f467}";
		const cleaned = attachmentFileName(`${family.repeat(300)}.jpeg`);

		expect(cleaned).toBe(`${family.repeat(22)}.jpeg`);
		expect(byteLength(cleaned)).toBeLessThanOrEqual(255);
	});

	it("cuts a long name with no extension, or only one, at 255 bytes", () => {
		expect(attachmentFileName("a".repeat(300))).toBe("a".repeat(255));
		expect(attachmentFileName(`.${"a".repeat(300)}`)).toBe(`.${"a".repeat(254)}`);
		expect(attachmentFileName(`a.${"b".repeat(300)}`)).toBe(`a.${"b".repeat(253)}`);
	});

	it("names `attachment` a name whose first grapheme alone outgrows 255 bytes", () => {
		// One letter under thousands of combining marks: a few graphemes, 10 KB.
		expect(attachmentFileName(`a${"\u0301".repeat(5000)}.pdf`)).toBe("attachment");
	});

	it("leaves a name of 255 bytes whole", () => {
		const name = `${"a".repeat(251)}.pdf`;

		expect(attachmentFileName(name)).toBe(name);
	});
});
