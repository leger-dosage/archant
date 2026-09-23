import type { DailyBalance } from "../domain/balances/forward.ts";
import type { SnapshotRejectionCode } from "../domain/balances/snapshot.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { LineKeys, PairCandidate } from "../domain/keys.ts";
import type {
	NormalizedTransaction,
	ParsedStatement,
	RejectionCode,
	StatementBalance,
} from "../domain/statement.ts";
import type { AmountRange } from "../domain/transaction-filter.ts";
import type { ServiceDeps } from "./deps.ts";
import type { SQL } from "drizzle-orm";

import {
	and,
	between,
	count,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lte,
	ne,
	notExists,
	or,
	sql,
	sum,
} from "drizzle-orm";

import type { AccountSubtype, AccountType } from "@archant/data/account-types";
import { classificationOf } from "@archant/data/account-types";
import type { CurrencyCode, MinorUnits, Money } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";
import { balances } from "@archant/data/schema/balances";
import { entries } from "@archant/data/schema/entries";
import { entryKeys } from "@archant/data/schema/entry-keys";
import type { FileSourceId, ImportCounts } from "@archant/data/schema/imports";
import { imports } from "@archant/data/schema/imports";
import type { LockableField } from "@archant/data/schema/transactions";
import { transactions } from "@archant/data/schema/transactions";
import type { Account, NewBalance } from "@archant/data/types";

import { forwardBalances } from "../domain/balances/forward.ts";
import { fillDays } from "../domain/balances/history.ts";
import { snapshotGap, snapshotRejectionFor } from "../domain/balances/snapshot.ts";
import { toStoredBalance } from "../domain/balances/stored-balance.ts";
import { addDays, maxDate, minDate, today } from "../domain/dates.ts";
import { MATCH_WINDOW_DAYS, lineKeys, pairLines, previewDigest } from "../domain/keys.ts";
import { rejectionFor } from "../domain/statement.ts";
import { LIKE_ESCAPE, escapeLike } from "../domain/transaction-filter.ts";
import { AppError } from "../lib/errors.ts";

/** Who asked for a write (AD-2). Only `user` locks fields (AD-10). */
export type Origin = "user" | "rule" | "provider" | "sync" | "maintenance";

export type NewAccountInput = {
	name: string;
	type: AccountType;
	subtype: AccountSubtype | null;
	currency: CurrencyCode;
	/** A stored balance (AD-5): an asset's value, a liability's amount owed. */
	openingBalance: MinorUnits;
	openingDate: IsoDate;
};

type Transaction = Parameters<Parameters<ServiceDeps["db"]["transaction"]>[0]>[0];

// SQLite caps bound parameters per statement at 32 766; four columns per row
// keeps a chunk far below it, and a decade of history is 3 650 rows.
const BALANCE_ROWS_PER_INSERT = 1000;

// Nine columns per entry row: 500 rows bind 4 500 parameters, far below the
// cap whatever the table. Epic 1 inserted a statement in one query, which a
// 3 600-line file would have pushed past it.
const ROWS_PER_INSERT = 500;

// Keys per lookup query; each query also binds the account and the source.
const KEYS_PER_LOOKUP = 500;

function chunksOf<Row>(rows: readonly Row[], size: number): Row[][] {
	return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) =>
		rows.slice(index * size, (index + 1) * size),
	);
}

/** Runs `write` on each chunk strictly in sequence, so a failed chunk rolls back with nothing else queued. */
async function inSequence<Row>(
	rows: readonly Row[],
	size: number,
	write: (chunk: Row[]) => Promise<unknown>,
): Promise<void> {
	await chunksOf(rows, size).reduce<Promise<unknown>>(
		(pending, chunk) => pending.then(() => write(chunk)),
		Promise.resolve(),
	);
}

// A `current_anchor` belongs to a bank-linked account, computed backward from
// it (AD-8); the forward computation reads only these two.
const FORWARD_VALUATION_KINDS = ["opening_anchor", "reconciliation"] as const;

/** The stored balance at the end of `date`: the last row on or before it. */
async function lastBalanceOnOrBefore(
	db: Pick<ServiceDeps["db"], "select"> | Pick<Transaction, "select">,
	accountId: string,
	date: IsoDate,
) {
	return db
		.select({ date: balances.date, balance: balances.balance, currency: balances.currency })
		.from(balances)
		.where(and(eq(balances.accountId, accountId), lte(balances.date, date)))
		.orderBy(desc(balances.date))
		.limit(1)
		.get();
}

/**
 * Rewrites an account's daily balances from `affected`, the earliest date the
 * write touched, to `max(today, latest entry date)`, and deletes the rows past
 * that end. Called by every ledger write inside its own transaction, so no
 * commit ever leaves `balances` stale (AD-2).
 */
async function recomputeBalances(
	tx: Transaction,
	account: Pick<Account, "id" | "type" | "currency">,
	affected: IsoDate,
	timeZone: string,
): Promise<void> {
	const previous = await lastBalanceOnOrBefore(tx, account.id, addDays(affected, -1));
	// Rows stop where the last write ended. A line dated past that day leaves a
	// gap the recompute fills from the last stored row. No row at all means the
	// account is being created: its opening anchor sets the first balance.
	const [from, opening] =
		previous === undefined ? [affected, 0] : [addDays(previous.date, 1), previous.balance];
	const movements = await tx
		.select({ date: entries.date, amount: sum(entries.amount).mapWith(Number) })
		.from(entries)
		.where(
			and(
				eq(entries.accountId, account.id),
				eq(entries.kind, "transaction"),
				gte(entries.date, from),
			),
		)
		.groupBy(entries.date);
	const valuations = await tx
		.select({ date: entries.date, balance: entries.amount })
		.from(entries)
		.where(
			and(
				eq(entries.accountId, account.id),
				inArray(entries.valuationKind, FORWARD_VALUATION_KINDS),
				gte(entries.date, from),
			),
		);
	// An array rather than `.get()`: the account always holds its opening anchor.
	const latest = await tx
		.select({ date: entries.date })
		.from(entries)
		.where(eq(entries.accountId, account.id))
		.orderBy(desc(entries.date))
		.limit(1);
	const until = latest.reduce((end, row) => maxDate(end, row.date), today(timeZone));

	const rows: NewBalance[] = forwardBalances({
		from,
		previous: toMinorUnits(opening),
		valuations: valuations.map((row) => ({ date: row.date, balance: toMinorUnits(row.balance) })),
		movements: movements.map((row) => ({ date: row.date, amount: toMinorUnits(row.amount) })),
		until,
		classification: classificationOf(account.type),
	}).map((row) => ({ accountId: account.id, currency: account.currency, ...row }));

	await tx
		.delete(balances)
		.where(
			and(
				eq(balances.accountId, account.id),
				or(gte(balances.date, from), gt(balances.date, until)),
			),
		);

	await inSequence(rows, BALANCE_ROWS_PER_INSERT, (chunk) => tx.insert(balances).values(chunk));
}

async function accountWithOpeningDate(tx: Transaction, accountId: string) {
	const row = await tx
		.select({
			id: accounts.id,
			type: accounts.type,
			currency: accounts.currency,
			openingId: entries.id,
			openingDate: entries.date,
			openingBalance: entries.amount,
		})
		.from(accounts)
		.innerJoin(
			entries,
			and(eq(entries.accountId, accounts.id), eq(entries.valuationKind, "opening_anchor")),
		)
		.where(eq(accounts.id, accountId))
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No account has this id.");
	}

	return row;
}

/**
 * Creates an account with its opening anchor and its daily balances, all or
 * nothing. `immediate` takes the write lock up front, so two concurrent ledger
 * writes queue on the busy timeout instead of failing halfway on an upgrade.
 */
export async function createAccount(
	deps: ServiceDeps,
	input: NewAccountInput,
	_options: { origin: Origin },
): Promise<Account> {
	const now = Date.now();
	const account: Account = {
		id: crypto.randomUUID(),
		name: input.name,
		type: input.type,
		subtype: input.subtype,
		currency: input.currency,
		active: true,
		excludedFromReports: false,
		createdAt: now,
		updatedAt: now,
	};

	await deps.db.transaction(
		async (tx) => {
			await tx.insert(accounts).values(account);
			await tx.insert(entries).values({
				id: crypto.randomUUID(),
				accountId: account.id,
				kind: "valuation",
				valuationKind: "opening_anchor",
				date: input.openingDate,
				amount: input.openingBalance,
				currency: account.currency,
				createdAt: now,
				updatedAt: now,
			});
			await recomputeBalances(tx, account, input.openingDate, deps.timeZone);
		},
		{ behavior: "immediate" },
	);

	return account;
}

/**
 * Where the statement comes from. A manual line carries no key; an import's
 * lines are keyed under its source (AD-7). Bank sync adds its connection with
 * Epic 10.
 */
export type IngestSource = { manual: true } | { importId: string };

export type IngestOptions = {
	origin: Origin;
	/** Computes the groups and writes nothing: the import preview (AD-4). */
	dryRun?: boolean | undefined;
	/**
	 * An earlier opening date the user accepted so the lines on or before the
	 * current one go in. Ignored unless it is earlier.
	 */
	moveOpeningDate?: IsoDate | undefined;
};

/** A line as the preview shows it; `entryId` names the entry it is or pairs with. */
export type PreviewLine = {
	ref: string;
	date: IsoDate;
	amount: MinorUnits;
	label: string;
	entryId: string | null;
};

/**
 * A refused line. `line` is `null` when the source could not read it, and
 * `ref` is then the line's position in the source rather than in the statement.
 */
export type RejectedLine = {
	ref: string;
	reason: RejectionCode;
	line: { date: IsoDate; amount: MinorUnits; label: string } | null;
};

/** The five groups of an import preview (AD-4). */
export type IngestGroups = {
	/** New entries. */
	created: PreviewLine[];
	/** Recognised by a key: nothing is written. */
	present: PreviewLine[];
	/** Paired with an entry of another source: its keys are attached to it. */
	matched: PreviewLine[];
	/** Two entries equally near: created, flagged `possible_duplicate`. */
	duplicates: PreviewLine[];
	rejected: RejectedLine[];
};

/** How many lines fell in each group: the import's stored counts. */
export function countsOf(groups: IngestGroups): ImportCounts {
	return {
		created: groups.created.length,
		present: groups.present.length,
		matched: groups.matched.length,
		duplicates: groups.duplicates.length,
		rejected: groups.rejected.length,
	};
}

/**
 * What step 7 of the pipeline does with the statement balance (AD-8), in
 * stored balances (AD-5). `recorded`: confirm writes it as a snapshot owned by
 * the import. `present`: a snapshot with the same value is on that date
 * already, whoever wrote it. `kept`: the user entered another value on that
 * date, which stays; `gap` is `balance - recorded`. `skipped`: the account
 * cannot hold a snapshot on that date, or in that currency.
 */
export type StatementBalanceOutcome =
	| { status: "recorded"; date: IsoDate; balance: MinorUnits }
	| { status: "present"; date: IsoDate; balance: MinorUnits }
	| { status: "kept"; date: IsoDate; balance: MinorUnits; recorded: MinorUnits; gap: MinorUnits }
	| {
			status: "skipped";
			date: IsoDate;
			balance: MinorUnits;
			reason: Exclude<SnapshotRejectionCode, "SNAPSHOT_EXISTS"> | "CURRENCY_MISMATCH";
	  };

export type IngestResult = {
	/** Entry ids written, in statement order: the created lines and the possible duplicates. */
	created: string[];
	/** Every refused line, the source's first; `ref` is the line's index in the statement. */
	rejected: { ref: string; reason: RejectionCode }[];
	groups: IngestGroups;
	/** The hash confirm compares with the preview's. */
	digest: string;
	/**
	 * The day before the earliest line refused for being on or before the
	 * opening date: the opening date that would let every such line in.
	 */
	openingSuggestion: IsoDate | null;
	/** The opening anchor this ingest moves, `null` when it stays. */
	opening: { date: IsoDate; balance: MinorUnits } | null;
	/** Step 7's outcome, `null` when the statement has no balance. */
	balance: StatementBalanceOutcome | null;
};

function filledFields(line: NormalizedTransaction): LockableField[] {
	return line.notes === null ? ["date", "amount", "label"] : ["date", "amount", "label", "notes"];
}

/** The previewed import a keyed ingest belongs to; anything else is unknown. */
async function previewedImport(tx: Transaction, importId: string, accountId: string) {
	const row = await tx
		.select({ source: imports.source, digest: imports.previewDigest })
		.from(imports)
		.where(
			and(
				eq(imports.id, importId),
				eq(imports.accountId, accountId),
				eq(imports.status, "previewed"),
			),
		)
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No previewed import has this id.");
	}

	return row;
}

/** The entry holding each key already, looked up 500 keys per query. */
async function entriesByKey(
	tx: Transaction,
	accountId: string,
	source: FileSourceId,
	keys: readonly string[],
): Promise<Map<string, string>> {
	const found = new Map<string, string>();

	await inSequence(keys, KEYS_PER_LOOKUP, async (chunk) => {
		const rows = await tx
			.select({ key: entryKeys.key, entryId: entryKeys.entryId })
			.from(entryKeys)
			.where(
				and(
					eq(entryKeys.accountId, accountId),
					eq(entryKeys.source, source),
					inArray(entryKeys.key, chunk),
				),
			);

		for (const row of rows) {
			found.set(row.key, row.entryId);
		}
	});

	return found;
}

/**
 * The account's transactions a line may pair with (AD-7): dated within the
 * window of the lines, and carrying no key from this source.
 */
async function pairCandidates(
	tx: Transaction,
	accountId: string,
	source: FileSourceId,
	dates: readonly IsoDate[],
): Promise<PairCandidate[]> {
	const sorted = dates.toSorted();
	const [first] = sorted;
	const last = sorted.at(-1);

	if (first === undefined || last === undefined) {
		return [];
	}

	const rows = await tx
		.select({ id: entries.id, date: entries.date, amount: entries.amount })
		.from(entries)
		.where(
			and(
				eq(entries.accountId, accountId),
				eq(entries.kind, "transaction"),
				between(entries.date, addDays(first, -MATCH_WINDOW_DAYS), addDays(last, MATCH_WINDOW_DAYS)),
				notExists(
					tx
						.select({ key: entryKeys.key })
						.from(entryKeys)
						.where(and(eq(entryKeys.entryId, entries.id), eq(entryKeys.source, source))),
				),
			),
		);

	return rows.map((row) => ({ ...row, amount: toMinorUnits(row.amount) }));
}

type Keyed = { ref: string; line: NormalizedTransaction; keys: LineKeys };

type Paired = Keyed & { entryId: string };

type Groups = { created: Keyed[]; present: Paired[]; matched: Paired[]; duplicates: Keyed[] };

function previewLine({ ref, line, ...rest }: Keyed & { entryId?: string }): PreviewLine {
	return {
		ref,
		date: line.date,
		amount: line.amount,
		label: line.label,
		entryId: rest.entryId ?? null,
	};
}

/**
 * Writes the keys of an import's lines onto their entries (AD-7). Two lines
 * of one file may share a FITID: the second keeps its fingerprint only.
 */
async function attachKeys(
	tx: Transaction,
	accountId: string,
	target: { id: string; source: FileSourceId },
	lines: readonly { entryId: string; keys: LineKeys }[],
): Promise<void> {
	const claimed = new Set<string>();
	const rows = lines.flatMap(({ entryId, keys }) =>
		[keys.fingerprint, keys.external]
			.filter((key): key is string => key !== null && !claimed.has(key))
			.map((key) => {
				claimed.add(key);

				return { entryId, accountId, source: target.source, key, importId: target.id };
			}),
	);

	await inSequence(rows, ROWS_PER_INSERT, (chunk) => tx.insert(entryKeys).values(chunk));
}

/**
 * Sorts the accepted lines of an import into present, matched, possible
 * duplicates and created (AD-7), each in statement order.
 */
async function groupLines(
	tx: Transaction,
	accountId: string,
	source: FileSourceId,
	accepted: readonly Keyed[],
): Promise<Groups> {
	const known = await entriesByKey(
		tx,
		accountId,
		source,
		accepted.flatMap(({ keys }) =>
			keys.external === null ? [keys.fingerprint] : [keys.fingerprint, keys.external],
		),
	);
	const groups: Groups = { created: [], present: [], matched: [], duplicates: [] };
	const remaining: (Keyed & { date: IsoDate; amount: MinorUnits })[] = [];

	for (const item of accepted) {
		const entryId =
			known.get(item.keys.fingerprint) ??
			(item.keys.external === null ? undefined : known.get(item.keys.external));

		if (entryId === undefined) {
			remaining.push({ ...item, date: item.line.date, amount: item.line.amount });
		} else {
			groups.present.push({ ...item, entryId });
		}
	}

	const candidates = await pairCandidates(
		tx,
		accountId,
		source,
		remaining.map(({ date }) => date),
	);

	for (const { line: item, pairing } of pairLines(remaining, candidates)) {
		const keyed = { ref: item.ref, line: item.line, keys: item.keys };

		if (pairing.kind === "matched") {
			groups.matched.push({ ...keyed, entryId: pairing.candidateId });
		} else if (pairing.kind === "tie") {
			groups.duplicates.push(keyed);
		} else {
			groups.created.push(keyed);
		}
	}

	return groups;
}

type BalancePlan = {
	outcome: StatementBalanceOutcome;
	/** The snapshot already on the statement's date, if any. */
	existing: { id: string; balance: MinorUnits; importId: string | null } | undefined;
	importId: string;
};

/**
 * Step 7 of the pipeline, planned (AD-8): what the statement balance becomes,
 * checked against the opening date after any accepted move. A snapshot the
 * user entered on that date wins; one an earlier import wrote gives way, as
 * the bank's latest file is the better word, and Sure's `ReconciliationManager`
 * updates in place.
 */
async function planStatementBalance(
	tx: Transaction,
	account: { id: string; type: AccountType; currency: string },
	statementBalance: StatementBalance,
	context: { openingDate: IsoDate; today: IsoDate },
	importId: string,
): Promise<BalancePlan> {
	const { date } = statementBalance;
	const balance = toStoredBalance(account, statementBalance.amount);
	const reason =
		snapshotRejectionFor(date, context) ??
		(statementBalance.currency === account.currency ? null : "CURRENCY_MISMATCH");

	if (reason !== null) {
		return { outcome: { status: "skipped", date, balance, reason }, existing: undefined, importId };
	}

	const row = await snapshotOn(tx, account.id, date);
	const existing = row === undefined ? undefined : { ...row, balance: toMinorUnits(row.balance) };

	// As a line already present: an equal value writes nothing, so a re-import
	// changes nothing and the first import stays the owner.
	if (existing?.balance === balance) {
		return { outcome: { status: "present", date, balance }, existing, importId };
	}

	if (existing !== undefined && existing.importId === null) {
		const recorded = existing.balance;

		return {
			outcome: { status: "kept", date, balance, recorded, gap: toMinorUnits(balance - recorded) },
			existing,
			importId,
		};
	}

	return { outcome: { status: "recorded", date, balance }, existing, importId };
}

/**
 * Step 7 of the pipeline, written: inserts the statement balance as a
 * snapshot owned by the import, or moves an earlier import's snapshot to it.
 * Returns the date written, `null` when nothing was.
 */
async function writeStatementBalance(
	tx: Transaction,
	account: { id: string; currency: string },
	plan: BalancePlan,
	now: number,
): Promise<IsoDate | null> {
	const { outcome, existing, importId } = plan;

	if (outcome.status !== "recorded") {
		return null;
	}

	if (existing === undefined) {
		await tx.insert(entries).values({
			id: crypto.randomUUID(),
			accountId: account.id,
			kind: "valuation",
			valuationKind: "reconciliation",
			date: outcome.date,
			amount: outcome.balance,
			currency: account.currency,
			importId,
			createdAt: now,
			updatedAt: now,
		});
	} else {
		await tx
			.update(entries)
			.set({ amount: outcome.balance, importId, updatedAt: now })
			.where(eq(entries.id, existing.id));
	}

	return outcome.date;
}

/**
 * Writes a statement into one account, in one transaction, following the
 * pipeline order of AD-4. Steps 3, 5 and 6 arrive with their epics, in
 * their slot. A manual line carries no key and is always created; an
 * import's lines are keyed and grouped (AD-7). With `dryRun`, the groups are
 * computed and nothing is written. Confirming an import refuses with
 * `IMPORT_PREVIEW_STALE` when the groups differ from its preview, and marks
 * it confirmed with its counts in the same transaction.
 */
export async function ingest(
	deps: ServiceDeps,
	accountId: string,
	statement: ParsedStatement,
	source: IngestSource,
	options: IngestOptions,
): Promise<IngestResult> {
	return deps.db.transaction(
		async (tx) => {
			const account = await accountWithOpeningDate(tx, accountId);
			const target =
				"importId" in source
					? {
							id: source.importId,
							...(await previewedImport(tx, source.importId, accountId)),
						}
					: null;
			const moveTo =
				options.moveOpeningDate !== undefined && options.moveOpeningDate < account.openingDate
					? options.moveOpeningDate
					: null;
			const context = {
				openingDate: moveTo ?? account.openingDate,
				currency: account.currency,
				today: today(deps.timeZone),
			};
			const accepted: Keyed[] = [];
			const refused: (RejectedLine & { line: NonNullable<RejectedLine["line"]> })[] = [];

			// 1. Reject lines the account cannot hold. Keys cover every line,
			// refused ones included, so a line's occurrence index never depends on
			// the account's opening date.
			for (const [index, { line, keys }] of lineKeys(statement.transactions).entries()) {
				const reason = rejectionFor(line, context);
				const ref = String(index);

				if (reason === null) {
					accepted.push({ ref, line, keys });
				} else {
					refused.push({
						ref,
						reason,
						line: { date: line.date, amount: line.amount, label: line.label },
					});
				}
			}

			// 2. Key matching, batched per statement (AD-7). A manual line has no key.
			const grouped: Groups =
				target === null
					? { created: accepted, present: [], matched: [], duplicates: [] }
					: await groupLines(tx, accountId, target.source, accepted);
			const unreadable: RejectedLine[] = statement.rejected.map((item) => ({
				...item,
				line: null,
			}));
			const groups: IngestGroups = {
				created: grouped.created.map(previewLine),
				present: grouped.present.map(previewLine),
				matched: grouped.matched.map(previewLine),
				duplicates: grouped.duplicates.map(previewLine),
				rejected: [...unreadable, ...refused],
			};
			const written = [
				...grouped.created.map((item) => ({ ...item, duplicate: false })),
				...grouped.duplicates.map((item) => ({ ...item, duplicate: true })),
			];
			const [earliestRefused] = refused
				.filter(({ reason }) => reason === "BEFORE_OPENING_DATE")
				.map(({ line }) => line.date)
				.toSorted();
			// AD-5: the opening balance changes so that the old opening day ends on
			// the same balance once the lines up to it count. Sure's
			// `adjust_opening_anchor_if_needed!` keeps the amount and shifts today's
			// balance instead.
			const movedIn = written
				.filter(({ line }) => line.date <= account.openingDate)
				.reduce((total, { line }) => total + line.amount, 0);
			const opening =
				moveTo === null
					? null
					: {
							date: moveTo,
							balance: toMinorUnits(
								classificationOf(account.type) === "asset"
									? account.openingBalance - movedIn
									: account.openingBalance + movedIn,
							),
						};
			// 7. The statement balance, planned here so the preview shows it and
			// the digest covers it. Only an import carries one today.
			const balancePlan =
				target === null || statement.balance === null
					? null
					: await planStatementBalance(tx, account, statement.balance, context, target.id);
			const digest = previewDigest([
				...(["created", "present", "matched", "duplicates"] as const).flatMap((group) =>
					groups[group].map(({ ref, entryId }) => ({ group, ref, entryId })),
				),
				...unreadable.map(({ ref, reason }) => ({ group: `source:${reason}`, ref, entryId: null })),
				...refused.map(({ ref, reason }) => ({ group: `ledger:${reason}`, ref, entryId: null })),
				// The opening confirm would write must be the one the preview showed.
				{ group: "opening", ref: JSON.stringify(opening), entryId: null },
				// A snapshot entered on that date since the preview turns `recorded`
				// into `kept`: confirm must not write what the preview did not show.
				{
					group: "balance",
					ref: JSON.stringify(balancePlan?.outcome ?? null),
					entryId: balancePlan?.existing?.id ?? null,
				},
			]);
			const result: IngestResult = {
				created: [],
				rejected: groups.rejected.map(({ ref, reason }) => ({ ref, reason })),
				groups,
				digest,
				openingSuggestion: earliestRefused === undefined ? null : addDays(earliestRefused, -1),
				opening,
				balance: balancePlan?.outcome ?? null,
			};

			if (options.dryRun === true) {
				return result;
			}

			if (target !== null && target.digest !== digest) {
				throw new AppError("IMPORT_PREVIEW_STALE", "The account changed since the preview.");
			}

			// 3. Pending reconciliation arrives with Epic 10.

			// 4. Insert the new entries, attach keys to matched ones.
			const now = Date.now();
			const rows = written.map((item) => ({ ...item, id: crypto.randomUUID() }));

			await inSequence(rows, ROWS_PER_INSERT, (chunk) =>
				tx.insert(entries).values(
					chunk.map(({ id, line }) => ({
						id,
						accountId,
						kind: "transaction" as const,
						date: line.date,
						amount: line.amount,
						currency: line.currency,
						// The creation marker a revert deletes by. Matched entries get
						// keys only: keys alone cannot tell them from created ones.
						importId: target?.id ?? null,
						createdAt: now,
						updatedAt: now,
					})),
				),
			);
			await inSequence(rows, ROWS_PER_INSERT, (chunk) =>
				tx.insert(transactions).values(
					chunk.map(({ id, line, duplicate }) => ({
						entryId: id,
						label: line.label,
						notes: line.notes,
						reference: line.reference,
						possibleDuplicate: duplicate,
						lockedFields: options.origin === "user" ? filledFields(line) : [],
					})),
				),
			);

			if (target !== null) {
				await attachKeys(tx, accountId, target, [
					...rows.map(({ id, keys }) => ({ entryId: id, keys })),
					...grouped.matched.map(({ entryId, keys }) => ({ entryId, keys })),
				]);
				await tx
					.update(imports)
					.set({
						status: "confirmed",
						confirmedAt: now,
						// Nothing reads the file after confirm, and it holds the full
						// account number and every amount (AD-14).
						content: Buffer.alloc(0),
						counts: countsOf(groups),
						// A revert gives back the shift of the moved-in lines it deletes;
						// without it, every later balance would stay off by their sum.
						previousOpeningDate: opening === null ? null : account.openingDate,
					})
					.where(eq(imports.id, target.id));
			}

			if (opening !== null) {
				await tx
					.update(entries)
					.set({ date: opening.date, amount: opening.balance, updatedAt: now })
					.where(eq(entries.id, account.openingId));
			}

			// 5. Rules arrive with Epic 8, 6. transfer matching with Epic 5.

			// 7. The statement balance (AD-8).
			const snapshotDate =
				balancePlan === null ? null : await writeStatementBalance(tx, account, balancePlan, now);

			// 8. Recompute balances from the earliest date this write touched.
			const [earliest] = [
				...rows.map(({ line }) => line.date),
				...(opening === null ? [] : [opening.date]),
				...(snapshotDate === null ? [] : [snapshotDate]),
			].toSorted();

			if (earliest !== undefined) {
				await recomputeBalances(tx, account, earliest, deps.timeZone);
			}

			result.created.push(...rows.map((row) => row.id));

			return result;
		},
		{ behavior: "immediate" },
	);
}

/** An absent or `undefined` field is left as it is. */
export type TransactionPatch = {
	date?: IsoDate | undefined;
	amount?: MinorUnits | undefined;
	label?: string | undefined;
	notes?: string | null | undefined;
	excluded?: boolean | undefined;
};

export type UpdateResult = { status: "updated" } | { status: "rejected"; reason: RejectionCode };

async function transactionRow(tx: Transaction, entryId: string) {
	const row = await tx
		.select({
			accountId: entries.accountId,
			date: entries.date,
			amount: entries.amount,
			currency: entries.currency,
			label: transactions.label,
			notes: transactions.notes,
			excluded: transactions.excluded,
			lockedFields: transactions.lockedFields,
		})
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(entries.id, entryId))
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No transaction has this id.");
	}

	return row;
}

/**
 * Edits a transaction and recomputes its account's balances from the earlier
 * of its old and new dates. Excluding one from reports changes no balance. A `user` edit locks every field it changes; any
 * other origin leaves locked fields as they are (AD-10).
 */
export async function updateTransaction(
	deps: ServiceDeps,
	entryId: string,
	patch: TransactionPatch,
	options: { origin: Origin },
): Promise<UpdateResult> {
	return deps.db.transaction(
		async (tx): Promise<UpdateResult> => {
			const current = await transactionRow(tx, entryId);
			const account = await accountWithOpeningDate(tx, current.accountId);
			const locked = new Set(current.lockedFields);
			const next = { ...current };
			const changed: LockableField[] = [];

			for (const field of ["date", "amount", "label", "notes", "excluded"] as const) {
				const value = patch[field];
				const allowed = options.origin === "user" || !locked.has(field);

				if (value !== undefined && value !== current[field] && allowed) {
					changed.push(field);
					Object.assign(next, { [field]: value });
				}
			}

			const reason = rejectionFor(
				{ date: next.date, currency: current.currency },
				{
					openingDate: account.openingDate,
					currency: account.currency,
					today: today(deps.timeZone),
				},
			);

			if (reason !== null) {
				return { status: "rejected", reason };
			}

			if (changed.length === 0) {
				return { status: "updated" };
			}

			await tx
				.update(entries)
				.set({ date: next.date, amount: next.amount, updatedAt: Date.now() })
				.where(eq(entries.id, entryId));
			await tx
				.update(transactions)
				.set({
					label: next.label,
					notes: next.notes,
					excluded: next.excluded,
					lockedFields:
						options.origin === "user"
							? [...new Set([...current.lockedFields, ...changed])]
							: current.lockedFields,
				})
				.where(eq(transactions.entryId, entryId));
			await recomputeBalances(tx, account, minDate(current.date, next.date), deps.timeZone);

			return { status: "updated" };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Deletes a transaction for good, as Sure does, and recomputes its account's
 * balances from its date. The rows past the new end go with it.
 */
export async function deleteTransaction(
	deps: ServiceDeps,
	entryId: string,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const current = await transactionRow(tx, entryId);
			const account = await accountWithOpeningDate(tx, current.accountId);

			// Keys and the detail row first: their foreign keys restrict deleting
			// the entry. Without its keys, the line comes back on re-import, as in Sure.
			await tx.delete(entryKeys).where(eq(entryKeys.entryId, entryId));
			await tx.delete(transactions).where(eq(transactions.entryId, entryId));
			await tx.delete(entries).where(eq(entries.id, entryId));
			await recomputeBalances(tx, account, current.date, deps.timeZone);
		},
		{ behavior: "immediate" },
	);
}

/**
 * Moves every transaction of category `from` to `to`, or leaves them
 * uncategorised with `null`, and returns how many moved. Called by a
 * category's delete and merge with `origin: "maintenance"`: the user chose
 * the category, not each transaction, so `locked_fields` stays as it is
 * (AD-10). No balance changes, so nothing is recomputed. One statement,
 * whatever the count: a category can hold years of transactions.
 */
export async function recategorise(
	deps: ServiceDeps,
	from: string,
	to: string | null,
	// Maintenance only until Story 4.2 defines the category lock: a `user`
	// call here would be expected to lock and would not.
	_options: { origin: "maintenance" },
): Promise<number> {
	return deps.db.transaction(
		async (tx) => {
			const result = await tx
				.update(transactions)
				.set({ categoryId: to })
				.where(eq(transactions.categoryId, from));

			return result.rowsAffected;
		},
		{ behavior: "immediate" },
	);
}

/**
 * How many transactions each category holds, by category id. A category
 * absent from the map holds none. Counted in children and parents alike:
 * rolling children up into their parent is the reports' business (Epic 6).
 */
export async function countByCategory(deps: ServiceDeps): Promise<Map<string, number>> {
	const rows = await deps.db
		.select({
			// Never null: the `where` below leaves uncategorised rows out.
			categoryId: sql<string>`${transactions.categoryId}`,
			count: count(),
		})
		.from(transactions)
		.where(isNotNull(transactions.categoryId))
		.groupBy(transactions.categoryId);

	return new Map(rows.map((row) => [row.categoryId, row.count]));
}

/** What reverting an import deletes now: its created transactions, and its snapshot (0 or 1). */
export type Removable = { transactions: number; snapshot: number };

/**
 * An entry no key holds but those of `owner`, the import that created it: a
 * key from another import, or from no import at all (a bank connection, Epic
 * 10), keeps the entry. A later import of the same source never keys an entry
 * this one created, since an exact key match writes nothing and matching skips
 * entries the source keyed already; so any other key is another source's (AD-7).
 */
function unclaimedBeyond(
	db: Pick<Transaction, "select">,
	owner: string | typeof entries.importId,
): SQL {
	return notExists(
		db
			.select({ key: entryKeys.key })
			.from(entryKeys)
			.where(
				and(
					eq(entryKeys.entryId, entries.id),
					or(isNull(entryKeys.importId), ne(entryKeys.importId, owner)),
				),
			),
	);
}

/**
 * What reverting each of `importIds` would delete now, for the history list.
 * Two grouped queries whatever the number of imports.
 */
export async function removableOf(
	deps: ServiceDeps,
	importIds: readonly string[],
): Promise<Map<string, Removable>> {
	if (importIds.length === 0) {
		return new Map();
	}

	const created = await deps.db
		.select({ importId: entries.importId, count: count() })
		.from(entries)
		.where(
			and(
				inArray(entries.importId, [...importIds]),
				eq(entries.kind, "transaction"),
				unclaimedBeyond(deps.db, entries.importId),
			),
		)
		.groupBy(entries.importId);
	const snapshots = await deps.db
		.select({ importId: entries.importId, count: count() })
		.from(entries)
		.where(
			and(inArray(entries.importId, [...importIds]), eq(entries.valuationKind, "reconciliation")),
		)
		.groupBy(entries.importId);
	const createdBy = new Map(created.map((row) => [row.importId, row.count]));
	const snapshotBy = new Map(snapshots.map((row) => [row.importId, row.count]));

	return new Map(
		importIds.map((id) => [
			id,
			{ transactions: createdBy.get(id) ?? 0, snapshot: snapshotBy.get(id) ?? 0 },
		]),
	);
}

export type RevertResult = { accountId: string; removed: Removable };

/**
 * Undoes a confirmed import, in one transaction (AD-7): deletes the keys it
 * wrote, the transactions it created that no other source holds, edited ones
 * included as Sure deletes every entry of an import, and the snapshot it still
 * owns. When the import moved the opening anchor, its date stays, as Sure
 * never moves it back, and its amount gets back what the deleted lines had
 * shifted it by. Then marks the import `reverted` and recomputes. The `imports` row stays, for the history.
 */
export async function revertImport(
	deps: ServiceDeps,
	importId: string,
	_options: { origin: Origin },
): Promise<RevertResult> {
	return deps.db.transaction(
		async (tx): Promise<RevertResult> => {
			const row = await tx
				.select({
					accountId: imports.accountId,
					status: imports.status,
					previousOpeningDate: imports.previousOpeningDate,
				})
				.from(imports)
				.where(eq(imports.id, importId))
				.get();

			if (row === undefined) {
				throw new AppError("NOT_FOUND", "No import has this id.");
			}

			// A preview wrote nothing and is purged; a reverted import has nothing
			// left to undo, and a revert is never undone.
			if (row.status !== "confirmed") {
				throw new AppError("IMPORT_NOT_REVERTABLE", "Only a confirmed import can be reverted.");
			}

			const account = await accountWithOpeningDate(tx, row.accountId);
			const now = Date.now();

			// 1. Every key it wrote, on the entries it created and matched alike.
			await tx.delete(entryKeys).where(eq(entryKeys.importId, importId));

			// 2. What it created and nothing else holds; the detail rows first,
			// since their foreign key restricts deleting the entry.
			const created = await tx
				.select({ id: entries.id, date: entries.date, amount: entries.amount })
				.from(entries)
				.where(
					and(
						eq(entries.importId, importId),
						eq(entries.kind, "transaction"),
						unclaimedBeyond(tx, importId),
					),
				);
			const ids = created.map((entry) => entry.id);

			await inSequence(ids, ROWS_PER_INSERT, (chunk) =>
				tx.delete(transactions).where(inArray(transactions.entryId, chunk)),
			);
			await inSequence(ids, ROWS_PER_INSERT, (chunk) =>
				tx.delete(entries).where(inArray(entries.id, chunk)),
			);
			// Another source confirmed these: they stay, and are no longer this
			// import's to delete.
			await tx
				.update(entries)
				.set({ importId: null })
				.where(and(eq(entries.importId, importId), eq(entries.kind, "transaction")));

			// 3. Its snapshot, if it still owns one: an edit hands it to the user,
			// and a newer file's value on that date hands it to the newer import.
			const snapshots = await tx
				.delete(entries)
				.where(and(eq(entries.importId, importId), eq(entries.valuationKind, "reconciliation")))
				.returning({ date: entries.date });

			// 4. The opening anchor keeps the date this import gave it. `ingest`
			// shifted its amount by the lines dated on or before the old opening
			// date so that day kept its balance; the deleted ones give their share
			// back, the kept ones and a later import's keep theirs.
			const previousDate = row.previousOpeningDate;
			const givenBack =
				previousDate === null ? [] : created.filter((entry) => entry.date <= previousDate);

			if (givenBack.length > 0) {
				const shift = givenBack.reduce((total, entry) => total + entry.amount, 0);

				await tx
					.update(entries)
					.set({
						amount: toMinorUnits(
							classificationOf(account.type) === "asset"
								? account.openingBalance + shift
								: account.openingBalance - shift,
						),
						updatedAt: now,
					})
					.where(eq(entries.id, account.openingId));
			}

			// 5.
			await tx
				.update(imports)
				.set({ status: "reverted", revertedAt: now })
				.where(eq(imports.id, importId));

			// 6. From the earliest date touched, the anchor's when its amount changed.
			const [earliest] = [
				...[...created, ...snapshots].map((entry) => entry.date),
				...(givenBack.length > 0 ? [account.openingDate] : []),
			].toSorted();

			if (earliest !== undefined) {
				await recomputeBalances(tx, account, earliest, deps.timeZone);
			}

			return {
				accountId: account.id,
				removed: { transactions: created.length, snapshot: snapshots.length },
			};
		},
		{ behavior: "immediate" },
	);
}

/**
 * Deletes an account and everything it holds, as one write: its entries'
 * keys, its transactions, all its entries, snapshots and opening anchor
 * included, its daily balances, its imports, then the account. Children go first, since their foreign keys restrict.
 * Every delete selects by `account_id` through a subquery, never a list of
 * ids, so a history of 50,000 transactions binds one parameter, not 50,000.
 * When transfers arrive (Epic 5), the ones touching the account go first,
 * leaving the other side an ordinary transaction, as Sure's `cleanup_transfers`.
 */
export async function deleteAccount(
	deps: ServiceDeps,
	accountId: string,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			await accountWithOpeningDate(tx, accountId);

			await tx.delete(entryKeys).where(eq(entryKeys.accountId, accountId));
			await tx
				.delete(transactions)
				.where(
					inArray(
						transactions.entryId,
						tx.select({ id: entries.id }).from(entries).where(eq(entries.accountId, accountId)),
					),
				);
			await tx.delete(entries).where(eq(entries.accountId, accountId));
			await tx.delete(balances).where(eq(balances.accountId, accountId));
			await tx.delete(imports).where(eq(imports.accountId, accountId));
			await tx.delete(accounts).where(eq(accounts.id, accountId));
		},
		{ behavior: "immediate" },
	);
}

/**
 * The balance at the end of `date`: the last stored day on or before it (AD-8).
 * `null` before the account's opening date, when it did not exist yet.
 */
export async function balanceOn(
	deps: ServiceDeps,
	accountId: string,
	date: IsoDate,
): Promise<Money | null> {
	const row = await lastBalanceOnOrBefore(deps.db, accountId, date);

	return row === undefined ? null : { amount: toMinorUnits(row.balance), currency: row.currency };
}

/**
 * The end-of-day balance of every day from `from` to `to`, both included,
 * oldest first, as `balanceOn` would read each one (AD-8). Stored rows stop at
 * the last write's end, so the days after it carry its balance. Days before
 * the opening date are left out. One primary-key range scan plus one lookup.
 */
export async function balancesBetween(
	deps: ServiceDeps,
	accountId: string,
	from: IsoDate,
	to: IsoDate,
): Promise<DailyBalance[]> {
	const previous = await lastBalanceOnOrBefore(deps.db, accountId, from);
	const rows = await deps.db
		.select({ date: balances.date, balance: balances.balance })
		.from(balances)
		.where(and(eq(balances.accountId, accountId), gt(balances.date, from), lte(balances.date, to)))
		.orderBy(balances.date);
	const known = previous === undefined ? rows : [previous, ...rows];

	return fillDays(
		known.map((row) => ({ date: row.date, balance: toMinorUnits(row.balance) })),
		from,
		to,
	);
}

/** The date of the account's opening anchor, `null` for an unknown account. */
export async function openingDateOf(deps: ServiceDeps, accountId: string): Promise<IsoDate | null> {
	const row = await deps.db
		.select({ date: entries.date })
		.from(entries)
		.where(and(eq(entries.accountId, accountId), eq(entries.valuationKind, "opening_anchor")))
		.get();

	return row?.date ?? null;
}

export type TransactionRecord = {
	id: string;
	accountId: string;
	date: IsoDate;
	amount: MinorUnits;
	currency: string;
	label: string;
	notes: string | null;
	/** A cheque or QIF `N` number from the import that created it. */
	reference: string | null;
	/** Left out of reports (AD-9), still counted in the balance. */
	excluded: boolean;
};

/** A transaction as a list shows it, with its account's name. */
export type TransactionListRecord = TransactionRecord & { accountName: string };

const transactionColumns = {
	id: entries.id,
	accountId: entries.accountId,
	date: entries.date,
	amount: entries.amount,
	currency: entries.currency,
	label: transactions.label,
	notes: transactions.notes,
	reference: transactions.reference,
	excluded: transactions.excluded,
};

function toRecord<Row extends { amount: number }>(row: Row): Row & { amount: MinorUnits } {
	return { ...row, amount: toMinorUnits(row.amount) };
}

/** Where an imported entry came from; `confirmedAt` is epoch milliseconds. */
export type ImportOrigin = { source: FileSourceId; confirmedAt: number | null };

/** The import behind each of `entryIds` that has one; manual entries are absent. */
export async function importOrigins(
	deps: ServiceDeps,
	entryIds: readonly string[],
): Promise<Map<string, ImportOrigin>> {
	const found = new Map<string, ImportOrigin>();

	await inSequence(entryIds, KEYS_PER_LOOKUP, async (chunk) => {
		const rows = await deps.db
			.selectDistinct({
				entryId: entryKeys.entryId,
				source: imports.source,
				confirmedAt: imports.confirmedAt,
			})
			.from(entryKeys)
			.innerJoin(imports, eq(imports.id, entryKeys.importId))
			.where(inArray(entryKeys.entryId, chunk));

		for (const { entryId, ...origin } of rows) {
			found.set(entryId, origin);
		}
	});

	return found;
}

/** One transaction, `null` when the id names none. */
export async function findTransaction(
	deps: ServiceDeps,
	entryId: string,
): Promise<TransactionRecord | null> {
	const row = await deps.db
		.select(transactionColumns)
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.where(eq(entries.id, entryId))
		.get();

	return row === undefined ? null : toRecord(row);
}

/**
 * What narrows a transaction list. Every field is optional; an empty filter
 * lists every transaction of every account.
 */
export type TransactionFilter = {
	accountIds?: readonly string[] | undefined;
	/** Inclusive. */
	from?: IsoDate | undefined;
	/** Inclusive. */
	to?: IsoDate | undefined;
	/**
	 * Absolute-value bounds per currency, computed by `amountBoundsFor`. When
	 * set, a transaction in a currency the list leaves out matches nothing.
	 */
	amounts?: readonly ({ currency: string } & AmountRange)[] | undefined;
	/**
	 * Substring of the label or the notes, matched literally. Case is ignored
	 * for ASCII letters only, as SQLite's `LIKE` does: « électricité » does not
	 * find « Électricité ».
	 */
	q?: string | undefined;
};

function absoluteAmountIn(range: AmountRange): SQL | undefined {
	const min = range.min === null ? null : Number(range.min);
	const max = range.max === null ? null : Number(range.max);

	if (min !== null && max !== null) {
		return or(between(entries.amount, min, max), between(entries.amount, -max, -min));
	}

	if (min !== null) {
		return or(gte(entries.amount, min), lte(entries.amount, -min));
	}

	return max === null ? undefined : between(entries.amount, -max, max);
}

// `LIKE` rather than FTS5 until the 300 ms target of Story 1.5 fails. Drizzle's
// `like` has no `escape` clause, and without one `50%` would find `Remise 500`.
function contains(column: typeof transactions.label | typeof transactions.notes, q: string): SQL {
	return sql`${column} like ${`%${escapeLike(q)}%`} escape ${LIKE_ESCAPE}`;
}

/**
 * The where clause of a filter, `null` when it can match nothing at all, so
 * the caller skips the query rather than asking SQLite for an empty `or`.
 */
function filterCondition(filter: TransactionFilter): SQL | undefined | null {
	const { accountIds, amounts, q } = filter;

	if (accountIds?.length === 0 || amounts?.length === 0) {
		return null;
	}

	return and(
		eq(entries.kind, "transaction"),
		accountIds === undefined ? undefined : inArray(entries.accountId, [...accountIds]),
		filter.from === undefined ? undefined : gte(entries.date, filter.from),
		filter.to === undefined ? undefined : lte(entries.date, filter.to),
		amounts === undefined
			? undefined
			: or(
					...amounts.map((range) =>
						and(eq(entries.currency, range.currency), absoluteAmountIn(range)),
					),
				),
		q === undefined
			? undefined
			: or(contains(transactions.label, q), contains(transactions.notes, q)),
	);
}

/**
 * A page of transactions matching `filter`, most recent first (AD-15), each
 * with its account's name. The count joins `transactions` only when the text
 * search needs its columns, so the unfiltered count reads one index.
 */
export async function listTransactions(
	deps: ServiceDeps,
	filter: TransactionFilter,
	page: { page: number; pageSize: number },
): Promise<{ items: TransactionListRecord[]; total: number }> {
	const where = filterCondition(filter);

	if (where === null) {
		return { items: [], total: 0 };
	}

	const rows = await deps.db
		.select({ ...transactionColumns, accountName: accounts.name })
		.from(entries)
		.innerJoin(transactions, eq(transactions.entryId, entries.id))
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.where(where)
		.orderBy(desc(entries.date), desc(entries.createdAt), desc(entries.id))
		.limit(page.pageSize)
		.offset((page.page - 1) * page.pageSize);
	const totals =
		filter.q === undefined
			? await deps.db.select({ total: count() }).from(entries).where(where)
			: await deps.db
					.select({ total: count() })
					.from(entries)
					.innerJoin(transactions, eq(transactions.entryId, entries.id))
					.where(where);

	return {
		items: rows.map(toRecord),
		total: totals.reduce((sumOfRows, row) => sumOfRows + row.total, 0),
	};
}

/**
 * The signed sum and the count of the transactions matching `filter`, one row
 * per currency. Excluded transactions count: the sum describes the rows the
 * list shows, not a report. Joins `transactions` only for the text search, as
 * the count does.
 */
export async function sumTransactions(
	deps: ServiceDeps,
	filter: TransactionFilter,
): Promise<{ currency: string; amount: MinorUnits; count: number }[]> {
	const where = filterCondition(filter);

	if (where === null) {
		return [];
	}

	const columns = {
		currency: entries.currency,
		amount: sum(entries.amount).mapWith(Number),
		count: count(),
	};
	const rows =
		filter.q === undefined
			? await deps.db
					.select(columns)
					.from(entries)
					.where(where)
					.groupBy(entries.currency)
					.orderBy(entries.currency)
			: await deps.db
					.select(columns)
					.from(entries)
					.innerJoin(transactions, eq(transactions.entryId, entries.id))
					.where(where)
					.groupBy(entries.currency)
					.orderBy(entries.currency);

	return rows.map(toRecord);
}

export type SnapshotInput = {
	date: IsoDate;
	/** A stored balance (AD-5): an asset's value, a liability's amount owed. */
	balance: MinorUnits;
};

/** An absent or `undefined` field is left as it is. */
export type SnapshotPatch = {
	date?: IsoDate | undefined;
	balance?: MinorUnits | undefined;
};

export type RecordSnapshotResult =
	| { status: "recorded"; id: string }
	| { status: "rejected"; reason: SnapshotRejectionCode };

export type SnapshotUpdateResult =
	| { status: "updated" }
	| { status: "rejected"; reason: SnapshotRejectionCode };

function snapshotRejection(
	account: { openingDate: IsoDate },
	date: IsoDate,
	timeZone: string,
): SnapshotRejectionCode | null {
	return snapshotRejectionFor(date, { openingDate: account.openingDate, today: today(timeZone) });
}

/** The account's snapshot on `date`, other than `except`, if any. */
async function snapshotOn(tx: Transaction, accountId: string, date: IsoDate, except?: string) {
	return tx
		.select({ id: entries.id, balance: entries.amount, importId: entries.importId })
		.from(entries)
		.where(
			and(
				eq(entries.accountId, accountId),
				eq(entries.valuationKind, "reconciliation"),
				eq(entries.date, date),
				except === undefined ? undefined : ne(entries.id, except),
			),
		)
		.get();
}

async function snapshotRow(tx: Transaction, id: string) {
	const row = await tx
		.select({ accountId: entries.accountId, date: entries.date, balance: entries.amount })
		.from(entries)
		.where(and(eq(entries.id, id), eq(entries.valuationKind, "reconciliation")))
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No snapshot has this id.");
	}

	return row;
}

/**
 * Records the balance the bank shows at the end of `date`, a `reconciliation`
 * valuation (AD-8), and recomputes the balances from that day. A snapshot
 * already on that date is updated in place and keeps its id, as in Sure's
 * `Account::ReconciliationManager`.
 */
export async function recordSnapshot(
	deps: ServiceDeps,
	accountId: string,
	input: SnapshotInput,
	_options: { origin: Origin },
): Promise<RecordSnapshotResult> {
	return deps.db.transaction(
		async (tx): Promise<RecordSnapshotResult> => {
			const account = await accountWithOpeningDate(tx, accountId);
			const reason = snapshotRejection(account, input.date, deps.timeZone);

			if (reason !== null) {
				return { status: "rejected", reason };
			}

			const now = Date.now();
			const existing = (await snapshotOn(tx, accountId, input.date))?.id;
			const id = existing ?? crypto.randomUUID();

			if (existing === undefined) {
				await tx.insert(entries).values({
					id,
					accountId,
					kind: "valuation",
					valuationKind: "reconciliation",
					date: input.date,
					amount: input.balance,
					currency: account.currency,
					createdAt: now,
					updatedAt: now,
				});
			} else {
				// The user's value now: later imports keep it, and reverting the
				// import that wrote it leaves it.
				await tx
					.update(entries)
					.set({ amount: input.balance, importId: null, updatedAt: now })
					.where(eq(entries.id, existing));
			}

			await recomputeBalances(tx, account, input.date, deps.timeZone);

			return { status: "recorded", id };
		},
		{ behavior: "immediate" },
	);
}

/**
 * Moves or changes a snapshot and recomputes from the earlier of its old and
 * new dates. Moving it onto a date another snapshot holds is refused: an edit
 * never deletes a second snapshot behind the user's back.
 */
export async function updateSnapshot(
	deps: ServiceDeps,
	id: string,
	patch: SnapshotPatch,
	_options: { origin: Origin },
): Promise<SnapshotUpdateResult> {
	return deps.db.transaction(
		async (tx): Promise<SnapshotUpdateResult> => {
			const current = await snapshotRow(tx, id);
			const account = await accountWithOpeningDate(tx, current.accountId);
			const date = patch.date ?? current.date;
			const balance = patch.balance ?? current.balance;
			const reason = snapshotRejection(account, date, deps.timeZone);

			if (reason !== null) {
				return { status: "rejected", reason };
			}

			if ((await snapshotOn(tx, account.id, date, id)) !== undefined) {
				return { status: "rejected", reason: "SNAPSHOT_EXISTS" };
			}

			// As in `recordSnapshot`, an edited snapshot is the user's.
			await tx
				.update(entries)
				.set({ date, amount: balance, importId: null, updatedAt: Date.now() })
				.where(eq(entries.id, id));
			await recomputeBalances(tx, account, minDate(current.date, date), deps.timeZone);

			return { status: "updated" };
		},
		{ behavior: "immediate" },
	);
}

/** Deletes a snapshot; the balances from its date follow the transactions again. */
export async function deleteSnapshot(
	deps: ServiceDeps,
	id: string,
	_options: { origin: Origin },
): Promise<void> {
	await deps.db.transaction(
		async (tx) => {
			const current = await snapshotRow(tx, id);
			const account = await accountWithOpeningDate(tx, current.accountId);

			await tx.delete(entries).where(eq(entries.id, id));
			await recomputeBalances(tx, account, current.date, deps.timeZone);
		},
		{ behavior: "immediate" },
	);
}

export type SnapshotRecord = {
	id: string;
	accountId: string;
	date: IsoDate;
	/** The recorded stored balance (AD-5). */
	balance: MinorUnits;
	/** The balance the transactions alone give for that day. */
	computed: MinorUnits;
	/** `balance - computed`, derived here and never stored. */
	gap: MinorUnits;
	currency: string;
};

const snapshotColumns = {
	id: entries.id,
	accountId: entries.accountId,
	date: entries.date,
	balance: entries.amount,
	currency: entries.currency,
	type: accounts.type,
};

type SnapshotRow = {
	id: string;
	accountId: string;
	date: string;
	balance: number;
	currency: string;
	type: AccountType;
};

/**
 * Reads what `computed` and `gap` need for snapshots of one account on
 * `dates`: one query for the balances of the days before, one for those days'
 * movements, whatever the number of rows. Returns the function adding them to
 * a row.
 */
async function gapReader(db: ServiceDeps["db"], accountId: string, dates: readonly IsoDate[]) {
	const previousRows = await db
		.select({ date: balances.date, balance: balances.balance })
		.from(balances)
		.where(
			and(
				eq(balances.accountId, accountId),
				inArray(
					balances.date,
					dates.map((date) => addDays(date, -1)),
				),
			),
		);
	const movementRows = await db
		.select({ date: entries.date, amount: sum(entries.amount).mapWith(Number) })
		.from(entries)
		.where(
			and(
				eq(entries.accountId, accountId),
				eq(entries.kind, "transaction"),
				inArray(entries.date, [...dates]),
			),
		)
		.groupBy(entries.date);
	const previous = new Map(previousRows.map((row) => [row.date, row.balance]));
	const movements = new Map(movementRows.map((row) => [row.date, row.amount]));

	return ({ type, ...row }: SnapshotRow): SnapshotRecord => {
		const before = previous.get(addDays(row.date, -1));

		// Balances are written from the opening date on, and a snapshot is dated
		// after it, so the day before always has a row; a missing one is a bug.
		if (before === undefined) {
			throw new AppError("INTERNAL_ERROR", "Something went wrong.");
		}

		const balance = toMinorUnits(row.balance);

		return {
			...row,
			balance,
			...snapshotGap({
				previous: toMinorUnits(before),
				movements: toMinorUnits(movements.get(row.date) ?? 0),
				recorded: balance,
				classification: classificationOf(type),
			}),
		};
	};
}

/** One snapshot with its gap, `null` when the id names none. */
export async function findSnapshot(deps: ServiceDeps, id: string): Promise<SnapshotRecord | null> {
	const row = await deps.db
		.select(snapshotColumns)
		.from(entries)
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.where(and(eq(entries.id, id), eq(entries.valuationKind, "reconciliation")))
		.get();

	if (row === undefined) {
		return null;
	}

	const withGap = await gapReader(deps.db, row.accountId, [row.date]);

	return withGap(row);
}

/** A page of an account's snapshots with their gaps, most recent first (AD-15). */
export async function listSnapshots(
	deps: ServiceDeps,
	accountId: string,
	page: { page: number; pageSize: number },
): Promise<{ items: SnapshotRecord[]; total: number }> {
	const where = and(eq(entries.accountId, accountId), eq(entries.valuationKind, "reconciliation"));
	const rows = await deps.db
		.select(snapshotColumns)
		.from(entries)
		.innerJoin(accounts, eq(accounts.id, entries.accountId))
		.where(where)
		.orderBy(desc(entries.date), desc(entries.createdAt), desc(entries.id))
		.limit(page.pageSize)
		.offset((page.page - 1) * page.pageSize);
	const totals = await deps.db.select({ total: count() }).from(entries).where(where);
	const withGap = await gapReader(
		deps.db,
		accountId,
		rows.map((row) => row.date),
	);

	return {
		items: rows.map(withGap),
		total: totals.reduce((sumOfRows, row) => sumOfRows + row.total, 0),
	};
}
