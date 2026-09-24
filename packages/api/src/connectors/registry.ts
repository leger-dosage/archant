import type { BankConnector } from "./bank-connector.ts";
import type { EnableBankingConfig } from "./enable-banking/client.ts";
import type { FileSource } from "./file-source.ts";

import type { BankConnectorId } from "@archant/data/schema/bank-connections";
import type { FileSourceId } from "@archant/data/schema/imports";

import { csvSource } from "./csv/csv.ts";
import { createEnableBankingConnector } from "./enable-banking/client.ts";
import { ofxSource } from "./ofx/ofx.ts";
import { qifSource } from "./qif/qif.ts";

// Static on purpose: no plugin loading (AD-3). A record, so a connector id
// without its source fails to compile. OFX and QIF first: their headers
// identify them whatever the file is called, where CSV goes by the name alone.
const SOURCES: Record<FileSourceId, FileSource> = {
	ofx: ofxSource,
	qif: qifSource,
	csv: csvSource,
};

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

// A factory rather than an instance: a bank connector needs the credentials
// the environment holds. A record, as above, so an id without its connector
// fails to compile.
const BANK_CONNECTORS: Record<BankConnectorId, (config: EnableBankingConfig) => BankConnector> = {
	"enable-banking": createEnableBankingConnector,
};

/** The bank connector `id`, built with its credentials. */
export function createBankConnector(
	id: BankConnectorId,
	config: EnableBankingConfig,
): BankConnector {
	return BANK_CONNECTORS[id](config);
}
