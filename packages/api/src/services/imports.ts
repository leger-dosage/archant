import type { IsoDate } from "../domain/dates.ts";
import type { ParsedStatement } from "../domain/statement.ts";
import type { Logger } from "../lib/logger.ts";
import type { ImportPreviewInput } from "../schemas/imports.ts";
import type { ServiceDeps } from "./deps.ts";
import type { IngestGroups, IngestResult, StatementBalanceOutcome } from "./ledger.ts";

import { and, eq, lt } from "drizzle-orm";

import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { isCurrencyCode } from "@archant/data/money";
import type { FileSourceId, ImportCounts, ImportOptions } from "@archant/data/schema/imports";
import { imports } from "@archant/data/schema/imports";
import type { Import } from "@archant/data/types";

import { detectFileSource, fileSource } from "../connectors/registry.ts";
import { AppError } from "../lib/errors.ts";
import { MAX_IMPORT_BYTES } from "../schemas/imports.ts";
import { getAccount } from "./accounts.ts";
import * as ledger from "./ledger.ts";

export type ImportDeps = ServiceDeps & { logger: Logger };

/** How long an unconfirmed preview keeps its file before the purge at start. */
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

// Imports write as a bank does, not as the user typing: no field gets locked
// (AD-10), so later rules may still categorise what a file brought in.
const ORIGIN = "sync";

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
async function statementOf(deps: ServiceDeps, row: Import): Promise<ParsedStatement> {
	const currency = await currencyOf(deps, row.accountId);

	return fileSource(row.source).parse(new Uint8Array(row.content), { currency });
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

	let statement: ParsedStatement;

	try {
		statement = source.parse(file.bytes, { currency });
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

	return runPreview(deps, row, statement, {});
}

/** Previews a stored import again, with the options the user just chose. */
export async function previewImport(
	deps: ImportDeps,
	id: string,
	input: ImportPreviewInput,
): Promise<ImportPreview> {
	const row = await previewedImport(deps, id);
	const options: ImportOptions =
		input.moveOpeningDate === null ? {} : { moveOpeningDate: input.moveOpeningDate };

	return runPreview(deps, row, await statementOf(deps, row), options);
}

/**
 * Writes a previewed import. The ledger re-runs the preview under its write
 * lock and refuses with `IMPORT_PREVIEW_STALE` when the groups changed; the
 * interface then asks for a new preview.
 */
export async function confirmImport(deps: ImportDeps, id: string): Promise<ConfirmedImport> {
	const row = await previewedImport(deps, id);
	const statement = await statementOf(deps, row);

	try {
		const result = await ledger.ingest(
			deps,
			row.accountId,
			statement,
			{ importId: row.id },
			{ origin: ORIGIN, moveOpeningDate: row.options.moveOpeningDate },
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
