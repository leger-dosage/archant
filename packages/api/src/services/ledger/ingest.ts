import type { SnapshotRejectionCode } from "../../domain/balances/snapshot.ts";
import type { IsoDate } from "../../domain/dates.ts";
import type { LineKeys } from "../../domain/keys.ts";
import type { GroupCandidate, PendingCandidate } from "../../domain/pending.ts";
import type {
	NormalizedTransaction,
	ParsedStatement,
	RejectionCode,
	StatementBalance,
} from "../../domain/statement.ts";
import type { ServiceDeps } from "../deps.ts";
import type { KeyTarget } from "./entry-keys.ts";
import type { Origin, Transaction } from "./shared.ts";

import { and, eq } from "drizzle-orm";

import type { AccountType } from "@archant/data/account-types";
import { classificationOf } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { bankConnections } from "@archant/data/schema/bank-connections";
import type { BankConnectorId } from "@archant/data/schema/bank-connections";
import { entries } from "@archant/data/schema/entries";
import { ASSISTANT_KEY_SOURCE } from "@archant/data/schema/entry-keys";
import type { ImportCounts } from "@archant/data/schema/imports";
import { imports } from "@archant/data/schema/imports";
import { taggings } from "@archant/data/schema/taggings";
import type { LockableField } from "@archant/data/schema/transactions";
import { transactions } from "@archant/data/schema/transactions";

import { snapshotRejectionFor } from "../../domain/balances/snapshot.ts";
import { toStoredBalance, toStoredBankBalance } from "../../domain/balances/stored-balance.ts";
import { addDays, today } from "../../domain/dates.ts";
import { fingerprintOf, lineKeys, pairLines, previewDigest, tripleOf } from "../../domain/keys.ts";
import { MAX_IDENTICAL_LINES, absorbPending, assignIdentical } from "../../domain/pending.ts";
import { planActions } from "../../domain/rules/matching.ts";
import { rejectionFor } from "../../domain/statement.ts";
import { AppError } from "../../lib/errors.ts";
import { MAX_TAGS_PER_TRANSACTION } from "../../schemas/transactions.ts";
import { loadEnabledRules } from "../rule-reader.ts";
import { getReportingCurrency } from "../settings.ts";
import { accountWithOpeningDate, recomputeBalances } from "./balances.ts";
import { anchorDate, rotateCurrentAnchor } from "./bank-link.ts";
import {
	attachKeys,
	entriesByKey,
	isBankConnector,
	pairCandidates,
	tombstoneLookupKey,
	tombstonedKeys,
} from "./entry-keys.ts";
import { categoryExists, categoryOriginOf, merchantExists, tagsExist } from "./patch.ts";
import { absorb, countMissedSyncs, heldFingerprints, pendingOfConnection } from "./pending.ts";
import { applyRulePlan } from "./rule-plans.ts";
import { ROWS_PER_INSERT, inSequence, invalidField, oneByOne } from "./shared.ts";
import { snapshotOn } from "./snapshots.ts";
import { matchNewTransfers } from "./transfers.ts";

/**
 * Where the statement comes from. A manual line carries no key; an import's
 * lines are keyed under its source, a sync's under its connection's
 * connector (AD-7). A sync's `missesFrom` is the first day its read speaks
 * for: a pending entry dated before it is not missing, only unread. `null`
 * when the read stopped part way and speaks for no pending entry.
 */
export type IngestSource =
	| {
			manual: true;
			/** Set and locked on the created line, as an edit by the user would (AD-10). */
			classification?: ManualClassification | undefined;
			/**
			 * The `ext:` key an assistant gives the line: a line of the account
			 * holding it already is `present`, and nothing is written.
			 */
			assistantKey?: string | undefined;
	  }
	| { importId: string }
	| { connectionId: string; missesFrom: IsoDate | null };

/**
 * What an assistant's `create_transaction` sets on the line it records, as
 * Sure's: each one given is locked, so no rule changes it afterwards.
 */
type ManualClassification = {
	categoryId: string | null;
	merchantId: string | null;
	tagIds: readonly string[];
};

const NO_CLASSIFICATION: ManualClassification = { categoryId: null, merchantId: null, tagIds: [] };

/** The fields a classification sets, locked beside the typed ones. */
function classifiedFields(classification: ManualClassification): LockableField[] {
	return [
		classification.categoryId === null ? null : ("category" as const),
		classification.merchantId === null ? null : ("merchant" as const),
		classification.tagIds.length === 0 ? null : ("tags" as const),
	].filter((field) => field !== null);
}

/** Refuses, on its field, a category, a merchant or a tag that does not exist, as an edit does. */
async function refuseUnknown(tx: Transaction, classification: ManualClassification) {
	if (
		classification.categoryId !== null &&
		!(await categoryExists(tx, classification.categoryId))
	) {
		throw invalidField("categoryId");
	}

	if (
		classification.merchantId !== null &&
		!(await merchantExists(tx, classification.merchantId))
	) {
		throw invalidField("merchantId");
	}

	if (classification.tagIds.length > 0 && !(await tagsExist(tx, classification.tagIds))) {
		throw invalidField("tagIds");
	}
}

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
type PreviewLine = {
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
type RejectedLine = {
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

/** The connector a bank connection's lines are keyed under; anything else is unknown. */
async function connectionConnector(
	tx: Transaction,
	connectionId: string,
): Promise<BankConnectorId> {
	const row = await tx
		.select({ connector: bankConnections.connector })
		.from(bankConnections)
		.where(eq(bankConnections.id, connectionId))
		.get();

	if (row === undefined) {
		throw new AppError("NOT_FOUND", "No bank connection has this id.");
	}

	return row.connector;
}

type Keyed = { ref: string; line: NormalizedTransaction; keys: LineKeys };

type Paired = Keyed & { entryId: string };

/**
 * `absorbed` holds step 3's lines (AD-17): a booked line taking over a pending
 * entry, or a pending line refreshing one. Only a sync has them. `named`
 * holds the entries a refused line's key names; `sharing`, the refs of
 * created lines whose fingerprint another entry already holds; `grouped`,
 * the refs of absorbed lines recognised within their group of identical
 * lines, whose fingerprint the entry does not take.
 */
type Groups = {
	created: Keyed[];
	present: Paired[];
	matched: Paired[];
	duplicates: Keyed[];
	absorbed: Paired[];
	named: string[];
	sharing: Set<string>;
	grouped: Set<string>;
};

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
 * Sorts the accepted lines of a keyed statement into present, matched,
 * possible duplicates, absorbed and created (AD-7, AD-17), each in statement
 * order. A booked line is looked up by its fingerprint, then its external
 * key; a pending line by its external key only, since its fingerprint shifts
 * once an identical line before it is booked. A key hit on a pending entry
 * absorbs the line, whatever its status, unless a booked line of the same
 * statement booked that entry first. Pending lines no key found are then
 * recognised within their group of identical lines (`assignIdentical`), and
 * booked lines no key found take a pending entry of the connection by amount
 * and date. A pending line never pairs by amount and date: it is recognised,
 * present on the entry its fingerprint names, or created. A line no live key
 * resolves is dropped when its reference, or its fingerprint when it has
 * none, is a tombstone: the user deleted its entry, so it is neither
 * recognised in its group, paired, absorbed by amount, nor created. The keys
 * of the lines step 1 refused are looked up too, for the entries they name.
 */
async function groupLines(
	tx: Transaction,
	accountId: string,
	target: KeyTarget,
	accepted: readonly Keyed[],
	refusedKeys: readonly string[],
): Promise<Groups> {
	const known = await entriesByKey(tx, accountId, target.source, [
		...accepted.flatMap(({ keys }) =>
			keys.external === null ? [keys.fingerprint] : [keys.fingerprint, keys.external],
		),
		...refusedKeys,
	]);
	const groups: Groups = {
		created: [],
		present: [],
		matched: [],
		duplicates: [],
		absorbed: [],
		sharing: new Set(),
		grouped: new Set(),
		named: refusedKeys.flatMap((key) => {
			const entry = known.get(key);

			return entry === undefined ? [] : [entry.entryId];
		}),
	};
	const remaining: (Keyed & { date: IsoDate; amount: MinorUnits })[] = [];
	const identical = new Map<string, Keyed[]>();
	// Entries this statement already booked or refreshed: a later pending line
	// for a booked one changes nothing, and step 3's amount match skips both.
	const booked = new Set<string>();
	const claimed = new Set<string>();

	for (const item of accepted) {
		const byExternal = item.keys.external === null ? undefined : known.get(item.keys.external);
		const hit = item.line.pending ? byExternal : (known.get(item.keys.fingerprint) ?? byExternal);

		if (hit === undefined && item.line.pending) {
			const triple = tripleOf(item.line);
			identical.set(triple, [...(identical.get(triple) ?? []), item]);
		} else if (hit === undefined) {
			remaining.push({ ...item, date: item.line.date, amount: item.line.amount });
		} else if (hit.pending && !booked.has(hit.entryId)) {
			// Only a bank connector's keys sit on a pending entry: only a sync gets here.
			groups.absorbed.push({ ...item, entryId: hit.entryId });
			claimed.add(hit.entryId);

			if (!item.line.pending) {
				booked.add(hit.entryId);
			}
		} else {
			groups.present.push({ ...item, entryId: hit.entryId });
		}
	}

	const tombstoned = isBankConnector(target.source)
		? await tombstonedKeys(
				tx,
				accountId,
				target.source,
				[...remaining, ...[...identical.values()].flat()].map(({ keys }) =>
					tombstoneLookupKey(keys),
				),
			)
		: new Set<string>();
	const isTombstoned = ({ keys }: Keyed) => tombstoned.has(tombstoneLookupKey(keys));
	const pendingEntries =
		target.connectionId === null
			? []
			: await pendingOfConnection(tx, accountId, target.connectionId);
	const held = await heldFingerprints(
		tx,
		target.source,
		identical.size === 0
			? []
			: pendingEntries.filter(({ id }) => !claimed.has(id)).map(({ id }) => id),
	);
	const unattributed = new Set(held.keys());

	for (const [triple, listed] of identical) {
		// A deleted reference never reaches the group: it could take a live twin.
		const lines = listed.filter((item) => item.keys.external === null || !isTombstoned(item));
		// Each held key belongs to one triple: once all are placed, no index is left to try.
		const lowest = new Map<string, GroupCandidate>();

		for (
			let occurrence = 0;
			occurrence < MAX_IDENTICAL_LINES && unattributed.size > 0;
			occurrence += 1
		) {
			const key = fingerprintOf(triple, occurrence);
			const entry = held.get(key);

			if (entry !== undefined && !lowest.has(entry.id)) {
				lowest.set(entry.id, { ...entry, occurrence });
			}

			unattributed.delete(key);
		}

		const candidates = [...lowest.values()].filter(({ id }) => !claimed.has(id));

		const assigned = assignIdentical(
			lines.map((item) => ({
				item,
				referenced: item.keys.external !== null,
				holder: held.get(item.keys.fingerprint)?.id ?? null,
			})),
			candidates,
		);

		for (const {
			line: { item },
			entryId,
		} of assigned) {
			const named = entryId === null ? known.get(item.keys.fingerprint) : undefined;

			if (entryId !== null) {
				groups.absorbed.push({ ...item, entryId });
				groups.grouped.add(item.ref);
				claimed.add(entryId);
			} else if (named !== undefined && (!named.pending || item.keys.external === null)) {
				// Booked, or refreshed by another line of this statement: that entry
				// listed again. Creating it would store the key twice.
				groups.present.push({ ...item, entryId: named.entryId });
			} else if (!isTombstoned(item)) {
				groups.created.push(item);

				if (named !== undefined) {
					// A reference no entry holds is a new line, though its fingerprint
					// names a pending entry under another reference: it goes in, and
					// leaves that fingerprint where it is.
					groups.sharing.add(item.ref);
				}
			}
		}
	}

	const survivors = pendingEntries
		.filter(({ id }) => !claimed.has(id))
		.map((row): PendingCandidate => ({
			id: row.id,
			date: row.date,
			amount: toMinorUnits(row.amount),
			createdAt: row.createdAt,
		}));
	const unpaired: typeof remaining = [];

	for (const { line: item, survivorId } of absorbPending(
		remaining.filter((listed) => !isTombstoned(listed)),
		survivors,
	)) {
		if (survivorId === null) {
			unpaired.push(item);
		} else {
			groups.absorbed.push({
				ref: item.ref,
				line: item.line,
				keys: item.keys,
				entryId: survivorId,
			});
		}
	}

	const candidates = await pairCandidates(
		tx,
		accountId,
		target.source,
		unpaired.map(({ date }) => date),
	);

	for (const { line: item, pairing } of pairLines(unpaired, candidates)) {
		const keyed = { ref: item.ref, line: item.line, keys: item.keys };

		if (pairing.kind === "matched") {
			groups.matched.push({ ...keyed, entryId: pairing.candidateId });
		} else if (pairing.kind === "tie") {
			groups.duplicates.push(keyed);
		} else {
			groups.created.push(keyed);
		}
	}

	for (const group of [groups.created, groups.present, groups.absorbed]) {
		group.sort((a, b) => Number(a.ref) - Number(b.ref));
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
 * Step 7 for a sync, planned: the bank's balance becomes the account's
 * `current_anchor` (AD-8), dated the day it describes and never after today;
 * the one it supersedes stays as a reconciliation (`rotateCurrentAnchor`).
 * Skipped in another currency: FR56 wants the bank's own figure, unconverted,
 * and then nothing changes.
 */
function planCurrentAnchor(
	account: { type: AccountType; currency: string },
	statementBalance: StatementBalance,
	day: IsoDate,
): StatementBalanceOutcome {
	const date = anchorDate(statementBalance, day);
	const balance = toStoredBankBalance(account, statementBalance.amount);

	return statementBalance.currency === account.currency
		? { status: "recorded", date, balance }
		: { status: "skipped", date, balance, reason: "CURRENCY_MISMATCH" };
}

/**
 * Writes a statement into one account, in one transaction, following the
 * pipeline order of AD-4. A manual line carries no key and is always
 * created; an import's or a sync's lines are keyed and grouped (AD-7), and a
 * sync's reconcile with pending entries (AD-17): absorbed in place, or, when
 * dated `missesFrom` or later and named by no line of the statement, refused
 * ones included, counted missing once a day at most and deleted at the
 * second miss. With `dryRun`, the groups are computed and nothing is written.
 * Confirming an import refuses with `IMPORT_PREVIEW_STALE` when the groups
 * differ from its preview, and marks
 * it confirmed with its counts in the same transaction. A sync's statement
 * balance becomes the account's `current_anchor`, the anchor it supersedes
 * a reconciliation on its own day.
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
			const connectionId = "connectionId" in source ? source.connectionId : null;
			const missesFrom = "connectionId" in source ? source.missesFrom : null;
			const keyTarget: KeyTarget | null =
				target !== null
					? { source: target.source, importId: target.id, connectionId: null }
					: connectionId === null
						? null
						: {
								source: await connectionConnector(tx, connectionId),
								importId: null,
								connectionId,
							};
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
			// A refused line still names its entry: a pending one it names is not missed.
			const refusedKeys: string[] = [];

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
					refusedKeys.push(...[keys.fingerprint, keys.external].filter((key) => key !== null));
				}
			}

			// 2. Key matching, batched per statement (AD-7). A manual line has no
			// key, but for the one an assistant gives it: holding it, the line is
			// already there.
			const assistantKey = "manual" in source ? source.assistantKey : undefined;
			const known =
				assistantKey === undefined
					? undefined
					: (await entriesByKey(tx, accountId, ASSISTANT_KEY_SOURCE, [assistantKey])).get(
							assistantKey,
						);
			const grouped: Groups =
				keyTarget === null
					? {
							created: known === undefined ? accepted : [],
							present:
								known === undefined
									? []
									: accepted.map((item) => ({ ...item, entryId: known.entryId })),
							matched: [],
							duplicates: [],
							absorbed: [],
							named: [],
							sharing: new Set(),
							grouped: new Set(),
						}
					: await groupLines(tx, accountId, keyTarget, accepted, refusedKeys);
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
			// the digest covers it. A manual statement carries none.
			const balancePlan =
				target === null || statement.balance === null
					? null
					: await planStatementBalance(tx, account, statement.balance, context, target.id);
			const anchorPlan =
				connectionId === null || statement.balance === null
					? null
					: planCurrentAnchor(account, statement.balance, context.today);
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
				balance: balancePlan?.outcome ?? anchorPlan,
			};

			if (options.dryRun === true) {
				return result;
			}

			if (target !== null && target.digest !== digest) {
				throw new AppError("IMPORT_PREVIEW_STALE", "The account changed since the preview.");
			}

			const classification =
				"manual" in source ? (source.classification ?? NO_CLASSIFICATION) : NO_CLASSIFICATION;

			if (written.length > 0) {
				await refuseUnknown(tx, classification);
			}

			// 3. Pending reconciliation (AD-17): each absorbed line updates its
			// entry in place, keeping its id and everything the user set.
			const now = Date.now();
			const absorbedFrom: IsoDate[] = [];

			if (keyTarget !== null) {
				await oneByOne(grouped.absorbed, async ({ ref, entryId, line, keys }) => {
					// An entry keeps one fingerprint per group: a second one, from a
					// shifted index, would later name it for a twin bought since, which
					// would then never go in.
					const taken = grouped.grouped.has(ref) ? { ...keys, fingerprint: null } : keys;

					absorbedFrom.push(
						await absorb(tx, entryId, { line, keys: taken }, keyTarget, options.origin, now),
					);
				});
			}

			// 4. Insert the new entries, attach keys to matched ones.
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
			const locksOf = (line: NormalizedTransaction) =>
				options.origin === "user"
					? [...filledFields(line), ...classifiedFields(classification)]
					: [];

			await inSequence(rows, ROWS_PER_INSERT, (chunk) =>
				tx.insert(transactions).values(
					chunk.map(({ id, line, duplicate }) => ({
						entryId: id,
						label: line.label,
						notes: line.notes,
						reference: line.reference,
						possibleDuplicate: duplicate,
						pending: line.pending,
						lockedFields: locksOf(line),
						categoryId: classification.categoryId,
						categoryOrigin:
							classification.categoryId === null ? null : categoryOriginOf(options.origin),
						merchantId: classification.merchantId,
					})),
				),
			);
			await inSequence(
				rows.flatMap(({ id }) =>
					classification.tagIds.map((tagId) => ({ transactionId: id, tagId })),
				),
				ROWS_PER_INSERT,
				(chunk) => tx.insert(taggings).values(chunk),
			);

			if (assistantKey !== undefined) {
				await attachKeys(
					tx,
					accountId,
					{ source: ASSISTANT_KEY_SOURCE, importId: null, connectionId: null },
					rows.map(({ id }) => ({
						entryId: id,
						keys: { fingerprint: null, external: assistantKey },
					})),
				);
			}

			if (keyTarget !== null) {
				const sharing = rows.filter(({ ref }) => grouped.sharing.has(ref));

				await attachKeys(tx, accountId, keyTarget, [
					...rows
						.filter(({ ref }) => !grouped.sharing.has(ref))
						.map(({ id, keys }) => ({ entryId: id, keys })),
					...grouped.matched.map(({ entryId, keys }) => ({ entryId, keys })),
				]);
				await attachKeys(
					tx,
					accountId,
					keyTarget,
					sharing.map(({ id, keys }) => ({ entryId: id, keys })),
					{ keepExisting: true },
				);
			}

			if (target !== null) {
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

			// A pending entry of the connection this statement did not speak for
			// counts a miss, one per day at most; the second deletes it. A line the
			// statement refused still speaks for the entry it names. A failed sync
			// rolls back with this transaction, and an interrupted one reads too
			// little to tell, so neither counts.
			const missedFrom: IsoDate[] = [];

			if (connectionId !== null && missesFrom !== null) {
				const seen = new Set([
					...grouped.absorbed.map(({ entryId }) => entryId),
					...rows.map(({ id }) => id),
					...grouped.named,
				]);

				missedFrom.push(
					...(await countMissedSyncs(tx, accountId, connectionId, missesFrom, seen, context.today)),
				);
			}

			// 5. Rules, on the rows this ingest created, possible duplicates
			// included. Loaded once per call, inside this transaction. A new row
			// carries no transfer yet, nor a merchant, category or tag but an
			// assistant's, locked.
			if (rows.length > 0) {
				const { plan } = planActions(
					await loadEnabledRules(tx),
					rows.map(({ id, line }) => ({
						id,
						accountId,
						date: line.date,
						amount: line.amount,
						currency: line.currency,
						label: line.label,
						notes: line.notes,
						merchantId: classification.merchantId,
						categoryId: classification.categoryId,
						tagIds: [...classification.tagIds],
						excluded: false,
						transfer: null,
						expectedTransferAccountId: null,
						lockedFields: locksOf(line),
					})),
					getReportingCurrency(),
					MAX_TAGS_PER_TRANSACTION,
				);

				await applyRulePlan(tx, plan, { origin: "rule" });
			}

			// 6. Transfer matching, once every new row exists (AD-11).
			await matchNewTransfers(
				tx,
				rows.map((row) => row.id),
				now,
			);

			// 7. The statement balance (AD-8). A sync's earlier bank figure stays
			// as a reconciliation, so one missing line cannot shift the whole past.
			const snapshotDate =
				balancePlan === null ? null : await writeStatementBalance(tx, account, balancePlan, now);
			const anchorWritten =
				anchorPlan?.status === "recorded"
					? await rotateCurrentAnchor(
							tx,
							account,
							anchorPlan,
							opening?.date ?? account.openingDate,
							now,
						)
					: null;

			// 8. Recompute balances from the earliest date this write touched.
			const [earliest] = [
				...rows.map(({ line }) => line.date),
				...absorbedFrom,
				...missedFrom,
				...(opening === null ? [] : [opening.date]),
				...(snapshotDate === null ? [] : [snapshotDate]),
				...(anchorWritten === null ? [] : [anchorWritten]),
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
