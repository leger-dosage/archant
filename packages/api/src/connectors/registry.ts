import type { FileSource } from "./file-source.ts";

import type { FileSourceId } from "@archant/data/schema/imports";

import { csvSource } from "./csv/csv.ts";
import { ofxSource } from "./ofx/ofx.ts";

// Static on purpose: no plugin loading (AD-3). A record, so a connector id
// without its source fails to compile. OFX first: its header identifies it
// whatever the file is called, where CSV goes by the name alone.
const SOURCES: Record<FileSourceId, FileSource> = { ofx: ofxSource, csv: csvSource };

/** Every file source, in detection order. */
export const FILE_SOURCES: readonly FileSource[] = Object.values(SOURCES);

/** The source that reads this file, `null` when none does. */
export function detectFileSource(bytes: Uint8Array, fileName: string): FileSource | null {
	return FILE_SOURCES.find((source) => source.detect(bytes, fileName)) ?? null;
}

/** The source a stored import was read with. */
export function fileSource(id: FileSourceId): FileSource {
	return SOURCES[id];
}
