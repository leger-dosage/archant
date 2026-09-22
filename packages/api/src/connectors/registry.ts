import type { FileSource } from "./file-source.ts";

import type { FileSourceId } from "@archant/data/schema/imports";

import { ofxSource } from "./ofx/ofx.ts";

// Static on purpose: no plugin loading (AD-3). A record, so a connector id
// without its source fails to compile.
const SOURCES: Record<FileSourceId, FileSource> = { ofx: ofxSource };

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
