/**
 * Characters RFC 5987's `attr-char` refuses that `encodeURIComponent` leaves
 * as they are.
 */
const UNSAFE_IN_EXTENDED_VALUE = /['()*]/gu;

/**
 * `Content-Disposition` of `type` naming `filename`: an ASCII `filename` for
 * an old client, every other character replaced by `_`, and the exact name in
 * an RFC 5987 `filename*` that every current browser prefers. A quote, a
 * backslash or a control character never reaches the header unescaped.
 * `inline` lets the browser show the file, `attachment` makes it save it.
 */
export function contentDisposition(type: "inline" | "attachment", filename: string): string {
	const ascii = filename.replace(/[^\x20-\x7e]|["\\]/gu, "_");
	const extended = encodeURIComponent(filename).replace(
		UNSAFE_IN_EXTENDED_VALUE,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);

	return `${type}; filename="${ascii}"; filename*=UTF-8''${extended}`;
}
