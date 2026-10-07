import type { IsoDate } from "../domain/dates.ts";
import type { ParsedStatement } from "../domain/statement.ts";
import type { Logger } from "../lib/logger.ts";
import type { ImportPreviewInput } from "../schemas/imports.ts";
import type { ServiceDeps } from "./deps.ts";
import type { Removable } from "./ledger/import-revert.ts";
import type { IngestGroups, IngestResult, StatementBalanceOutcome } from "./ledger/ingest.ts";

import { and, count, desc, eq, inArray, lt } from "drizzle-orm";

import { errorCode } from "@archant/data/backup";
import type { Database } from "@archant/data/client";
import { refreshStatistics } from "@archant/data/client";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode } from "@archant/data/money";
import type { QifDateOrder } from "@archant/data/qif-options";
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
import { qifDateOrder } from "../connectors/qif/qif.ts";
import { detectFileSource, fileSource } from "../connectors/registry.ts";
import { AppError } from "../lib/errors.ts";
import { MAX_IMPORT_BYTES, csvMappingSchema } from "../schemas/imports.ts";
import { getAccount } from "./accounts.ts";
import { removableOf, revertImport as revertLedgerImport } from "./ledger/import-revert.ts";
import { countsOf, ingest } from "./ledger/ingest.ts";
import { runRecurring } from "./recurring/pipeline.ts";

/**
 * `$client` too: a large import refreshes SQLite's statistics, which only the
 * client can do, after its transaction commits.
 */
export type ImportDeps = ServiceDeps & { logger: Logger; db: Pick<Database, "$client"> };

/**
 * Past this many created lines an import changes the table enough for the
 * planner's statistics to mislead it; below, `ANALYZE` costs more than it buys.
 */
export const STATISTICS_REFRESH_LINES = 1000;

/** How long an unconfirmed preview keeps its file before the purge at start. */
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

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
type CsvPreview = {
	/** The file's first records as they are, split with the delimiter in use. */
	sample: string[][];
	mapping: CsvMapping | null;
	saved: boolean;
	prefill: CsvMapping;
};

/**
 * How a QIF file's dates were read. `ambiguous` says every date reads both
 * ways, so Aperçu offers the choice.
 */
type QifPreview = { dateOrder: QifDateOrder; ambiguous: boolean };

export type ImportPreview = {
	id: string;
	fileName: string;
	source: FileSourceId;
	/** The account's currency, which every amount here is in. */
	currency: CurrencyCode;
	groups: IngestGroups;
	/** The opening date the Rejetées tab offers, the day before the earliest refused line. */
	openingSuggestion: IsoDate | null;
	/** The opening anchor confirming moves to, with its new balance (AD-5). */
	opening: { date: IsoDate; balance: MinorUnits } | null;
	/** What confirming does with the file's closing balance, `null` when it has none. */
	statementBalance: StatementBalanceOutcome | null;
	/** `null` for every source but CSV. */
	csv: CsvPreview | null;
	/** `null` for every source but QIF. */
	qif: QifPreview | null;
};

export type ConfirmedImport = { id: string; counts: ImportCounts };

/**
 * One row of an account's import history. `removable` is what a revert would
 * delete now, `null` once reverted; `counts` stay as confirm stored them.
 */
type ImportHistoryItem = {
	id: string;
	fileName: string;
	source: FileSourceId;
	confirmedAt: number;
	revertedAt: number | null;
	counts: ImportCounts;
	removable: Removable | null;
};

export type ImportHistoryPage = {
	items: ImportHistoryItem[];
	page: number;
	pageSize: number;
	total: number;
};

export type RevertedImport = { id: string; removed: Removable };

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
function statementOf(row: Import, options: ImportOptions, currency: CurrencyCode): ParsedStatement {
	return fileSource(row.source).parse(new Uint8Array(row.content), {
		currency,
		csv: options.csv,
		qif: options.qif,
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
	currency: CurrencyCode,
): Promise<ImportPreview> {
	await deps.db
		.update(imports)
		.set({ options, previewDigest: null })
		.where(and(eq(imports.id, row.id), eq(imports.status, "previewed")));

	return {
		id: row.id,
		fileName: row.fileName,
		source: row.source,
		currency,
		groups: { created: [], present: [], matched: [], duplicates: [], rejected: [] },
		openingSuggestion: null,
		opening: null,
		statementBalance: null,
		csv: await csvPreview(deps, row, undefined),
		qif: null,
	};
}

/** The order a QIF import's dates were read in: the user's choice, else the detected one. */
function qifPreview(row: Import, options: ImportOptions): QifPreview {
	const detected = qifDateOrder(new Uint8Array(row.content));

	return {
		dateOrder: options.qif?.dateOrder ?? detected.dateOrder,
		ambiguous: detected.ambiguous,
	};
}

/** Runs the ledger's dry run and stores what it promised, for confirm to check. */
async function runPreview(
	deps: ImportDeps,
	row: Import,
	statement: ParsedStatement,
	options: ImportOptions,
	currency: CurrencyCode,
): Promise<ImportPreview> {
	const result: IngestResult = await ingest(
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
	deps.logger.info({ importId: row.id, counts: countsOf(result.groups) }, "import previewed");

	return {
		id: row.id,
		fileName: row.fileName,
		source: row.source,
		currency,
		groups: result.groups,
		openingSuggestion: result.openingSuggestion,
		opening: result.opening,
		statementBalance: result.balance,
		csv: row.source === "csv" ? await csvPreview(deps, row, options.csv) : null,
		qif: row.source === "qif" ? qifPreview(row, options) : null,
	};
}

/**
 * Reads an uploaded file into the account's preview. The file is kept with
 * status `previewed`; nothing reaches the ledger's tables until confirm.
 * `maxBytes` lowers the dialog's limit, for a file an assistant sends.
 */
export async function createImport(
	deps: ImportDeps,
	accountId: string,
	file: { name: string; bytes: Uint8Array },
	{ maxBytes = MAX_IMPORT_BYTES }: { maxBytes?: number } = {},
): Promise<ImportPreview> {
	// Each preview holds up to 5 MB of bank data; a server that runs for weeks
	// would otherwise keep every abandoned one until its next start.
	await purgeStalePreviews(deps);
	const currency = await currencyOf(deps, accountId);
	const source = file.bytes.length > maxBytes ? null : detectFileSource(file.bytes, file.name);

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
		revertedAt: null,
		previousOpeningDate: null,
	};

	await deps.db.insert(imports).values(row);

	return statement === null
		? unmappedPreview(deps, row, options, currency)
		: runPreview(deps, row, statement, options, currency);
}

/** Previews a stored import again, with the options the user just chose. */
export async function previewImport(
	deps: ImportDeps,
	id: string,
	input: ImportPreviewInput,
): Promise<ImportPreview> {
	const row = await previewedImport(deps, id);
	const csv = row.source === "csv" ? (input.csv ?? row.options.csv) : undefined;
	const qif = row.source === "qif" ? (input.qif ?? row.options.qif) : undefined;
	const options: ImportOptions = {
		...(input.moveOpeningDate === null ? {} : { moveOpeningDate: input.moveOpeningDate }),
		...(csv === undefined ? {} : { csv }),
		...(qif === undefined ? {} : { qif }),
	};

	const currency = await currencyOf(deps, row.accountId);

	if (row.source === "csv" && csv === undefined) {
		return unmappedPreview(deps, row, options, currency);
	}

	return runPreview(deps, row, statementOf(row, options, currency), options, currency);
}

/**
 * Writes a previewed import. The ledger re-runs the preview under its write
 * lock and refuses with `IMPORT_PREVIEW_STALE` when the groups changed, or
 * differ from `expectedCounts`, the counts an assistant showed the owner; the
 * interface then asks for a new preview.
 */
export async function confirmImport(
	deps: ImportDeps,
	id: string,
	expectedCounts?: ImportCounts,
): Promise<ConfirmedImport> {
	const row = await previewedImport(deps, id);
	const mapping = row.options.csv;

	if (row.source === "csv" && mapping === undefined) {
		throw new AppError("VALIDATION_ERROR", "The import has no column mapping yet.");
	}

	const statement = statementOf(row, row.options, await currencyOf(deps, row.accountId));

	try {
		const result = await deps.db.transaction(
			async (tx) => {
				// The ledger opens its own transaction on what it is given; on this
				// one that is a savepoint, so the mapping below commits with the
				// lines or not at all.
				const inner: ServiceDeps = { ...deps, db: tx };
				const ingested = await ingest(
					inner,
					row.accountId,
					statement,
					{ importId: row.id },
					{ origin: ORIGIN, moveOpeningDate: row.options.moveOpeningDate, expectedCounts },
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
		const counts = countsOf(result.groups);

		if (counts.created > STATISTICS_REFRESH_LINES) {
			await refreshAfterImport(deps, id);
		}
		await detectAfterImport(deps, id);
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
 * Statistics once a large confirm is committed. Best-effort, as Turso may
 * refuse `ANALYZE`: a failure is logged, code only, and the import stands.
 */
async function refreshAfterImport(deps: ImportDeps, importId: string): Promise<void> {
	try {
		await refreshStatistics(deps.db);
	} catch (error) {
		deps.logger.warn({ importId, code: errorCode(error) }, "statistics refresh failed");
	}
}

/**
 * The recurring pipeline once a confirm or a revert is committed, so series
 * and their payments follow the lines it wrote or removed. The import is
 * done by then: a failure here is logged, code only, and never fails the
 * request.
 */
async function detectAfterImport(deps: ImportDeps, importId: string): Promise<void> {
	try {
		await runRecurring(deps, { backfill: false });
	} catch (error) {
		// The code only: an unexpected error's message may embed bound amounts.
		const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";

		deps.logger.error({ importId, code }, "recurring detection failed");
	}
}

/**
 * A page of the account's confirmed and reverted imports, the latest
 * confirmed first. Previews are left out: they wrote nothing.
 */
export async function listImports(
	deps: ServiceDeps,
	accountId: string,
	page: { page: number; pageSize: number },
): Promise<ImportHistoryPage> {
	await getAccount(deps, accountId);
	const where = and(
		eq(imports.accountId, accountId),
		inArray(imports.status, ["confirmed", "reverted"]),
	);
	const rows = await deps.db
		.select({
			id: imports.id,
			fileName: imports.fileName,
			source: imports.source,
			status: imports.status,
			confirmedAt: imports.confirmedAt,
			revertedAt: imports.revertedAt,
			counts: imports.counts,
		})
		.from(imports)
		.where(where)
		.orderBy(desc(imports.confirmedAt), desc(imports.id))
		.limit(page.pageSize)
		.offset((page.page - 1) * page.pageSize);
	const totals = await deps.db.select({ total: count() }).from(imports).where(where).get();
	const removable = await removableOf(
		deps,
		rows.filter((row) => row.status === "confirmed").map((row) => row.id),
	);

	return {
		items: rows.map(({ confirmedAt, counts, ...row }) => {
			// Confirm writes both; a row without them is a bug, not a state.
			if (confirmedAt === null || counts === null) {
				throw new AppError("INTERNAL_ERROR", "Something went wrong.");
			}

			return {
				id: row.id,
				fileName: row.fileName,
				source: row.source,
				confirmedAt,
				revertedAt: row.revertedAt,
				counts,
				removable: removable.get(row.id) ?? null,
			};
		}),
		page: page.page,
		pageSize: page.pageSize,
		total: totals?.total ?? 0,
	};
}

/**
 * Undoes a confirmed import (AD-7). The ledger checks the status under its
 * write lock, so two reverts racing each other delete once. Recurring
 * detection then recomputes the series built on the removed lines.
 */
export async function revertImport(deps: ImportDeps, id: string): Promise<RevertedImport> {
	const started = performance.now();

	try {
		const { removed } = await revertLedgerImport(deps, id, { origin: "user" });
		// The revert's own time: detection after it logs its own failure.
		const durationMs = Math.round(performance.now() - started);

		await detectAfterImport(deps, id);
		deps.logger.info({ importId: id, removed, durationMs }, "import reverted");

		return { id, removed };
	} catch (error) {
		const durationMs = Math.round(performance.now() - started);

		// The code only: an unexpected error's message may embed bound amounts.
		if (error instanceof AppError) {
			deps.logger.info({ importId: id, code: error.code, durationMs }, "import revert refused");
		} else {
			deps.logger.error(
				{ importId: id, code: "INTERNAL_ERROR", durationMs },
				"import revert failed",
			);
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
