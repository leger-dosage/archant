const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

export type Charset = "utf-8" | "windows-1252";

function withoutBom(bytes: Uint8Array): Uint8Array {
	return UTF8_BOM.every((byte, index) => bytes[index] === byte) ? bytes.subarray(3) : bytes;
}

/**
 * Turns a file's bytes into text. UTF-8 when the bytes are valid UTF-8,
 * `windows-1252` otherwise: French banks export in one or the other, and a
 * byte sequence that is invalid UTF-8 is almost always 1252 accents. A
 * `charset` the file declares wins. A UTF-8 BOM never reaches the parser.
 */
export function decodeText(bytes: Uint8Array, charset?: Charset): string {
	const body = withoutBom(bytes);

	if (charset !== "windows-1252") {
		try {
			return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
		} catch {
			// Not UTF-8: fall through to 1252, which decodes any byte.
		}
	}

	return new TextDecoder("windows-1252").decode(body);
}
