import type { IsoDate } from "../domain/dates.ts";
import type { ParsedStatement } from "../domain/statement.ts";
import type { Logger } from "../lib/logger.ts";
import type { ImportPreviewInput } from "../schemas/imports.ts";
import type { ServiceDeps } from "./deps.ts";
import type { IngestGroups, IngestResult, StatementBalanceOutcome } from "./ledger.ts";

import { and, eq, lt } from "drizzle-orm";

import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode } from "@archant/data/money";
import { importMappings } from "@archant/data/schema/import-mappings";
import type {
	CsvMapping,
	FileSourceId,
	ImportCounts,
	ImportOptions,
} from "@archant/data/schema/imports";
import { imports } from "@archant/data/schema/imports";
import type { Import } from "@archant/data/types";

import {
	csvLayout,
	defaultMapping,
	fitMapping,
	guessDelimiter,
	mappingFits,
} from "../connectors/csv/csv.ts";
import { detectFileSource, fileSource } from "../connectors/registry.ts";
import { AppError } from "../lib/errors.ts";
import { MAX_IMPORT_BYTES, csvMappingSchema } from "../schemas/imports.ts";
import { getAccount } from "./accounts.ts";
import * as ledger from "./ledger.ts";

export type ImportDeps = ServiceDeps & { logger: Logger };

/** How long an unconfirmed preview keeps its file before the purge at start. */
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

// Imports write as a bank does, not as the user typing: no field gets locked
// (AD-10), so later rules may still categorise what a file brought in.
const ORIGIN = "sync";

/**
 * What the Colonnes step needs. `mapping` is the one the groups were computed
 * with, `null` when none was, and the groups are then empty. `saved` says it
 * is the account's saved mapping. `prefill` is what the step starts from: the
 * mapping in use, else the saved one fitted to the file's columns, else the
 * French defaults.
 */
export type CsvPreview = {
	/** The file's first records as they are, split with the delimiter in use. */
	sample: string[][];
	mapping: CsvMapping | null;
	saved: boolean;
	prefill: CsvMapping;
};

export type ImportPreview = {
	id: string;
	fileName: string;
	source: FileSourceId;
	groups: IngestGroups;
	/** The opening date the Rejetées tab offers, the day before the earliest refused line. */
	openingSuggestion: IsoDate | null;
	/** The opening anchor confirming moves to, with its new balance (AD-5). */
	opening: { date: IsoDate; balance: MinorUnits } | null;
	/** What confirming does with the file's closing balance, `null` when it has none. */
	statementBalance: StatementBalanceOutcome | null;
	/** `null` for every source but CSV. */
	csv: CsvPreview | null;
};

export type ConfirmedImport = { id: string; counts: ImportCounts };

function invalidFile(): AppError {
	return new AppError("INVALID_IMPORT_FILE", "The file is not a readable statement.");
}

async function currencyOf(deps: ServiceDeps, accountId: string): Promise<CurrencyCode> {
	const account = await getAccount(deps, accountId);

	if (!isCurrencyCode(account.currency)) {
		throw new AppError("INTERNAL_ERROR", "Something went wrong.");
	}

	return account.currency;
}

async function previewedImport(deps: ServiceDeps, id: string): Promise<Import> {
	const row = await deps.db
		.select()
		.from(imports)
		.where(and(eq(imports.id, id), eq(imports.status, "previewed")))
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No previewed import has this id.");
	}

	return row;
}

/** Parses the stored bytes again, with the account's currency of today. */
async function statementOf(
	deps: ServiceDeps,
	row: Import,
	options: ImportOptions,
): Promise<ParsedStatement> {
	const currency = await currencyOf(deps, row.accountId);

	return fileSource(row.source).parse(new Uint8Array(row.content), {
		currency,
		csv: options.csv,
	});
}

/**
 * The CSV mapping the account's last CSV import used. Parsed again, like any
 * input: a mapping stored by an older version may no longer be valid.
 */
async function savedMapping(deps: ServiceDeps, accountId: string): Promise<CsvMapping | null> {
	const row = await deps.db
		.select({ mapping: importMappings.mapping })
		.from(importMappings)
		.where(eq(importMappings.accountId, accountId))
		.get();
	const parsed = csvMappingSchema.safeParse(row?.mapping);

	return parsed.success ? parsed.data : null;
}

// Both come out of `csvMappingSchema`, so their keys are in the same order.
const sameMapping = (a: CsvMapping, b: CsvMapping | null) =>
	JSON.stringify(a) === JSON.stringify(b);

/** The Colonnes step's view of a CSV import read with `mapping`, or with none yet. */
async function csvPreview(
	deps: ServiceDeps,
	row: Import,
	mapping: CsvMapping | undefined,
): Promise<CsvPreview> {
	const bytes = new Uint8Array(row.content);
	const saved = await savedMapping(deps, row.accountId);
	let prefill = mapping;

	if (prefill === undefined && saved !== null) {
		prefill = fitMapping(saved, csvLayout(bytes, saved).width);
	} else if (prefill === undefined) {
		const delimiter = guessDelimiter(bytes);

		prefill = defaultMapping(delimiter, csvLayout(bytes, { delimiter, skipRows: 0 }).width);
	}

	return {
		sample: csvLayout(bytes, prefill).sample,
		mapping: mapping ?? null,
		saved: mapping !== undefined && sameMapping(mapping, saved),
		prefill,
	};
}

/**
 * A CSV import nobody has mapped yet: nothing is computed, and the stored
 * digest is cleared so confirm cannot write what no preview showed.
 */
async function unmappedPreview(
	deps: ImportDeps,
	row: Import,
	options: ImportOptions,
): Promise<ImportPreview> {
	await deps.db
		.update(imports)
		.set({ options, previewDigest: null })
		.where(and(eq(imports.id, row.id), eq(imports.status, "previewed")));

	return {
		id: row.id,
		fileName: row.fileName,
		source: row.source,
		groups: { created: [], present: [], matched: [], duplicates: [], rejected: [] },
		openingSuggestion: null,
		opening: null,
		statementBalance: null,
		csv: await csvPreview(deps, row, undefined),
	};
}

/** Runs the ledger's dry run and stores what it promised, for confirm to check. */
async function runPreview(
	deps: ImportDeps,
	row: Import,
	statement: ParsedStatement,
	options: ImportOptions,
): Promise<ImportPreview> {
	const result: IngestResult = await ledger.ingest(
		deps,
		row.accountId,
		statement,
		{ importId: row.id },
		{ origin: ORIGIN, dryRun: true, moveOpeningDate: options.moveOpeningDate },
	);

	await deps.db
		.update(imports)
		.set({ options, previewDigest: result.digest })
		// A confirm that finished meanwhile keeps its row as it wrote it.
		.where(and(eq(imports.id, row.id), eq(imports.status, "previewed")));
	deps.logger.info(
		{ importId: row.id, counts: ledger.countsOf(result.groups) },
		"import previewed",
	);

	return {
		id: row.id,
		fileName: row.fileName,
		source: row.source,
		groups: result.groups,
		openingSuggestion: result.openingSuggestion,
		opening: result.opening,
		statementBalance: result.balance,
		csv: row.source === "csv" ? await csvPreview(deps, row, options.csv) : null,
	};
}

/**
 * Reads an uploaded file into the account's preview. The file is kept with
 * status `previewed`; nothing reaches the ledger's tables until confirm.
 */
export async function createImport(
	deps: ImportDeps,
	accountId: string,
	file: { name: string; bytes: Uint8Array },
): Promise<ImportPreview> {
	// Each preview holds up to 5 MB of bank data; a server that runs for weeks
	// would otherwise keep every abandoned one until its next start.
	await purgeStalePreviews(deps);
	const currency = await currencyOf(deps, accountId);
	const source =
		file.bytes.length > MAX_IMPORT_BYTES ? null : detectFileSource(file.bytes, file.name);

	if (source === null) {
		deps.logger.info({ accountId, code: "INVALID_IMPORT_FILE" }, "import refused");

		throw invalidFile();
	}

	let options: ImportOptions = {};
	let statement: ParsedStatement | null = null;
	// Read outside the `try`: a database failure is not an unreadable file.
	const saved = source.id === "csv" ? await savedMapping(deps, accountId) : null;

	try {
		if (source.id === "csv") {
			// A first CSV file waits for its mapping. A saved one applies at once
			// when the file still has every column it reads: same bank, same export.
			// Reading every record refuses a file with no table or an unterminated
			// quote before anything is stored.
			csvLayout(file.bytes, { delimiter: guessDelimiter(file.bytes), skipRows: 0 });

			if (saved !== null && mappingFits(saved, csvLayout(file.bytes, saved).width)) {
				options = { csv: saved };
				statement = source.parse(file.bytes, { currency, csv: saved });
			}
		} else {
			statement = source.parse(file.bytes, { currency });
		}
	} catch (error) {
		deps.logger.info({ accountId, code: "INVALID_IMPORT_FILE" }, "import refused");

		throw error;
	}

	const row: Import = {
		id: crypto.randomUUID(),
		accountId,
		source: source.id,
		fileName: file.name,
		status: "previewed",
		content: Buffer.from(file.bytes),
		options: {},
		previewDigest: null,
		counts: null,
		createdAt: Date.now(),
		confirmedAt: null,
	};

	await deps.db.insert(imports).values(row);

	return statement === null
		? unmappedPreview(deps, row, options)
		: runPreview(deps, row, statement, options);
}

/** Previews a stored import again, with the options the user just chose. */
export async function previewImport(
	deps: ImportDeps,
	id: string,
	input: ImportPreviewInput,
): Promise<ImportPreview> {
	const row = await previewedImport(deps, id);
	const csv = row.source === "csv" ? (input.csv ?? row.options.csv) : undefined;
	const options: ImportOptions = {
		...(input.moveOpeningDate === null ? {} : { moveOpeningDate: input.moveOpeningDate }),
		...(csv === undefined ? {} : { csv }),
	};

	if (row.source === "csv" && csv === undefined) {
		return unmappedPreview(deps, row, options);
	}

	return runPreview(deps, row, await statementOf(deps, row, options), options);
}

/**
 * Writes a previewed import. The ledger re-runs the preview under its write
 * lock and refuses with `IMPORT_PREVIEW_STALE` when the groups changed; the
 * interface then asks for a new preview.
 */
export async function confirmImport(deps: ImportDeps, id: string): Promise<ConfirmedImport> {
	const row = await previewedImport(deps, id);
	const mapping = row.options.csv;

	if (row.source === "csv" && mapping === undefined) {
		throw new AppError("VALIDATION_ERROR", "The import has no column mapping yet.");
	}

	const statement = await statementOf(deps, row, row.options);

	try {
		const result = await deps.db.transaction(
			async (tx) => {
				// The ledger opens its own transaction on what it is given; on this
				// one that is a savepoint, so the mapping below commits with the
				// lines or not at all.
				const inner: ServiceDeps = { ...deps, db: tx };
				const ingested = await ledger.ingest(
					inner,
					row.accountId,
					statement,
					{ importId: row.id },
					{ origin: ORIGIN, moveOpeningDate: row.options.moveOpeningDate },
				);

				if (mapping !== undefined) {
					const updatedAt = Date.now();

					await tx
						.insert(importMappings)
						.values({ accountId: row.accountId, mapping, updatedAt })
						.onConflictDoUpdate({
							target: importMappings.accountId,
							set: { mapping, updatedAt },
						});
				}

				return ingested;
			},
			{ behavior: "immediate" },
		);
		const counts = ledger.countsOf(result.groups);

		deps.logger.info({ importId: id, counts }, "import confirmed");

		return { id, counts };
	} catch (error) {
		if (error instanceof AppError) {
			deps.logger.info({ importId: id, code: error.code }, "import refused");
		}

		throw error;
	}
}

/**
 * Deletes the previews left unconfirmed for a day, with their files. Called
 * at start; returns how many went.
 */
export async function purgeStalePreviews(deps: ServiceDeps, now = Date.now()): Promise<number> {
	const purged = await deps.db
		.delete(imports)
		.where(and(eq(imports.status, "previewed"), lt(imports.createdAt, now - PREVIEW_TTL_MS)))
		.returning({ id: imports.id });

	return purged.length;
}
