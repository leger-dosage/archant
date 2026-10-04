/**
 * Characters RFC 5987's `attr-char` refuses that `encodeURIComponent` leaves
 * as they are.
 */
const UNSAFE_IN_EXTENDED_VALUE = /['()*]/gu;

/**
 * `Content-Disposition: inline` naming `filename`: an ASCII `filename` for an
 * old client, every other character replaced by `_`, and the exact name in an
 * RFC 5987 `filename*` that every current browser prefers. A quote, a
 * backslash or a control character never reaches the header unescaped.
 */
export function inlineDisposition(filename: string): string {
	const ascii = filename.replace(/[^\x20-\x7e]|["\\]/gu, "_");
	const extended = encodeURIComponent(filename).replace(
		UNSAFE_IN_EXTENDED_VALUE,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);

	return `inline; filename="${ascii}"; filename*=UTF-8''${extended}`;
}
