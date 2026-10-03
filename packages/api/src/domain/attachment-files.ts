import type { AttachmentContentType } from "@archant/data/attachments";

/** Bytes to compare, or `null` for one any byte matches. */
type Signature = readonly (number | null)[];

const ascii = (text: string): number[] => Array.from(new TextEncoder().encode(text));

/**
 * The first bytes of each allowed type. The type a client declares is never
 * read: a browser guesses it from the extension, and any caller may send
 * anything, so an HTML page named `.pdf` would be served as what it claims.
 */
const SIGNATURES: readonly (readonly [AttachmentContentType, Signature])[] = [
	["image/jpeg", [0xff, 0xd8, 0xff]],
	["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
	["image/gif", ascii("GIF87a")],
	["image/gif", ascii("GIF89a")],
	// `RIFF`, the chunk's size in four bytes, then `WEBP`.
	["image/webp", [...ascii("RIFF"), null, null, null, null, ...ascii("WEBP")]],
	["application/pdf", ascii("%PDF-")],
];

function startsWith(bytes: Uint8Array, signature: Signature): boolean {
	return (
		bytes.length >= signature.length &&
		signature.every((byte, index) => byte === null || bytes[index] === byte)
	);
}

/** The allowed type `bytes` start as, or `null`: an empty file is none. */
export function attachmentTypeOf(bytes: Uint8Array): AttachmentContentType | null {
	return SIGNATURES.find(([, signature]) => startsWith(bytes, signature))?.[0] ?? null;
}

/**
 * Active Storage's `Filename#sanitized` list, the right-to-left override
 * first, then every other bidirectional control: each reorders a name on
 * screen, so a `.exe` could read as a `.pdf`. Named one by one rather than
 * `\p{Cf}`, which holds the zero-width joiner that draws a family emoji as one.
 */
const REPLACED = /[\u202e\u061c\u200e\u200f\u202a-\u202d\u2066-\u2069%$|:;/<>?*"\\\p{Cc}]/gu;

/** A file name's longest length in UTF-8 bytes, as ext4 and APFS count it. */
const MAX_NAME_BYTES = 255;

const encoder = new TextEncoder();

const byteLength = (text: string): number => encoder.encode(text).byteLength;

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * `name` cut to `MAX_NAME_BYTES` between graphemes, what a reader sees as
 * one character, so a cut never splits an emoji or an accent from its
 * letter; the extension kept when it fits. A first grapheme that alone
 * outgrows the room, such as a letter under thousands of combining marks,
 * leaves `attachment`.
 */
function shortened(name: string): string {
	const characters = Array.from(graphemes.segment(name), ({ segment }) => segment);
	const dot = characters.lastIndexOf(".");
	const extension = dot > 0 ? characters.slice(dot).join("") : "";
	const kept = byteLength(extension) < MAX_NAME_BYTES ? extension : "";
	const base = kept === "" ? characters : characters.slice(0, dot);
	const room = MAX_NAME_BYTES - byteLength(kept);
	const taken: string[] = [];
	let used = 0;

	for (const character of base) {
		used += byteLength(character);

		if (used > room) {
			break;
		}

		taken.push(character);
	}

	return taken.length === 0 ? "attachment" : `${taken.join("")}${kept}`;
}

/**
 * A file name as Active Storage's `Filename#sanitized` cleans it: composed,
 * trimmed, every path separator, character Active Storage replaces, control
 * character and bidirectional control turned into `-`, so no name reads as
 * a path, reorders itself on screen or breaks a header. At most 255 UTF-8
 * bytes, so a `Content-Disposition` naming it stays small; `attachment` when
 * nothing is left.
 */
export function attachmentFileName(name: string): string {
	const cleaned = name.normalize("NFC").trim().replace(REPLACED, "-");

	if (cleaned === "") {
		return "attachment";
	}

	return byteLength(cleaned) > MAX_NAME_BYTES ? shortened(cleaned) : cleaned;
}
