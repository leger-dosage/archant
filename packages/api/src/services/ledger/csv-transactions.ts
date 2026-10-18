import type { NormalizedTransaction } from "../../domain/statement.ts";
import type { ServiceDeps } from "../deps.ts";

import type { FileSourceId } from "@archant/data/schema/imports";
import { imports } from "@archant/data/schema/imports";

import { ingest } from "./ingest.ts";
import { oneByOne } from "./shared.ts";

/** One account's lines of a CSV or QIF transaction import, in file order. */
export type CsvStatement = { accountId: string; lines: NormalizedTransaction[] };

/**
 * Writes each account's lines of a CSV transaction import through the
 * pipeline (AD-4), under an import of its own, so the account's history
 * lists it and a revert removes it. The file was read in this request and
 * is not kept (AD-14); the lines are written as a bank's file is, no field
 * locked (AD-10), and a line found already takes the file's category, tags
 * and notes, as Sure's `TransactionImport`. A QIF import moves the opening
 * anchor before its earliest line, as `ingest` does for its source. Runs
 * inside the caller's transaction.
 */
export async function ingestCsvStatements(
	deps: ServiceDeps,
	statements: readonly CsvStatement[],
	fileName: string,
	source: Extract<FileSourceId, "csv" | "qif"> = "csv",
): Promise<{ created: number; importIds: string[] }> {
	const now = Date.now();
	const importIds: string[] = [];
	let created = 0;

	await oneByOne(statements, async ({ accountId, lines }) => {
		const importId = crypto.randomUUID();

		await deps.db.insert(imports).values({
			id: importId,
			accountId,
			source,
			fileName,
			status: "previewed",
			content: Buffer.alloc(0),
			options: {},
			previewDigest: null,
			counts: null,
			createdAt: now,
			confirmedAt: null,
			revertedAt: null,
			previousOpeningDate: null,
		});

		const result = await ingest(
			deps,
			accountId,
			{ transactions: lines, balance: null, rejected: [] },
			{ importId },
			{ origin: "sync", stateless: true, updateMatched: true },
		);

		created += result.created.length;
		importIds.push(importId);
	});

	return { created, importIds };
}
