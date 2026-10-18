import type { Logger } from "../lib/logger.ts";
import type { ServiceDeps } from "./deps.ts";
import type { Transaction } from "./ledger/shared.ts";
import type { ImportedAccount, SureIds } from "./ledger/sure-import.ts";
import type { PlanCategory, PlanNamed, SurePlan } from "./sure-import-plan.ts";
import type { SureCounts, SureImportLimits, SurePreflight } from "./sure-import-preflight.ts";
import type { NameBook, RuleContext, Taxonomy } from "./sure-rules.ts";

import { and, eq } from "drizzle-orm";

import { errorCode } from "@archant/data/backup";
import type { Database } from "@archant/data/client";
import { refreshStatistics } from "@archant/data/client";
import { budgetCategories, budgets } from "@archant/data/schema/budgets";
import { categories } from "@archant/data/schema/categories";
import { merchants } from "@archant/data/schema/merchants";
import { recurringTransactions } from "@archant/data/schema/recurring-transactions";
import { tags } from "@archant/data/schema/tags";

import { normalizeLabel } from "../domain/normalize-label.ts";
import { monthlyOn } from "../domain/recurring/schedule.ts";
import { DEFAULT_SURE_IMPORT_MAX_ROWS, DEFAULT_SURE_IMPORT_MAX_SIZE_MB } from "../env.ts";
import { AppError } from "../lib/errors.ts";
import { ruleSchema } from "../schemas/rules.ts";
import { oneByOne } from "./ledger/shared.ts";
import { insertSureAccounts, insertSureEntries } from "./ledger/sure-import.ts";
import { runRecurring } from "./recurring/pipeline.ts";
import { insertRules } from "./recurring/rules.ts";
import { createRule, setRuleEnabled } from "./rules.ts";
import { getReportingCurrency } from "./settings.ts";
import { readSureArchive } from "./sure-import-plan.ts";
import { foldName } from "./sure-import-preflight.ts";
import { createMissing, ruleInputOf, taxonomyOf } from "./sure-rules.ts";

/** `$client` too, for the statistics refreshed once the import is committed. */
export type SureImportDeps = ServiceDeps & { logger: Logger; db: Pick<Database, "$client"> };

/** Sure's defaults, which `SURE_IMPORT_MAX_NDJSON_SIZE_MB` and `SURE_IMPORT_MAX_ROWS` replace. */
export const DEFAULT_SURE_IMPORT_LIMITS: SureImportLimits = {
	maxBytes: DEFAULT_SURE_IMPORT_MAX_SIZE_MB * 1024 * 1024,
	maxRows: DEFAULT_SURE_IMPORT_MAX_ROWS,
};

type UploadedFile = { name: string; bytes: Uint8Array };

/**
 * « Confirmer votre importation »: Sure's counts, errors and warnings of an
 * uploaded archive. Nothing is stored: the page keeps the file and sends it
 * again to start the import.
 */
export async function preflightSureImport(
	deps: ServiceDeps,
	file: UploadedFile,
	limits: SureImportLimits,
): Promise<SurePreflight> {
	const { counts, errors, warnings } = await readSureArchive(deps, file, limits);

	return { counts, errors, warnings };
}

/**
 * Categories as Sure's importer reads them: one whose name exists is reused
 * unchanged; a new one takes Sure's classification as its kind, its colour
 * and its icon, then its parent in a second pass when that parent is a
 * top-level category, with the parent's kind and colour.
 */
async function importCategories(
	tx: Transaction,
	plan: readonly PlanCategory[],
	taxonomy: Taxonomy,
	now: number,
): Promise<void> {
	const existing = await tx
		.select({ id: categories.id, kind: categories.kind, parentId: categories.parentId })
		.from(categories);
	const parents = new Map(existing.map((row) => [row.id, row.parentId]));
	const colours = new Map<string, string>();
	const created = new Set<string>();

	for (const row of existing) {
		taxonomy.kinds.set(row.id, row.kind);
	}

	await oneByOne(plan, async (category) => {
		const found = taxonomy.names.categories.get(foldName(category.name));

		if (found !== undefined) {
			taxonomy.ids.categories.set(category.sourceId, found);
			return;
		}

		const id = crypto.randomUUID();

		await tx.insert(categories).values({
			id,
			name: category.name,
			kind: category.kind,
			color: category.color,
			icon: category.icon,
			parentId: null,
			createdAt: now,
			updatedAt: now,
		});
		taxonomy.ids.categories.set(category.sourceId, id);
		taxonomy.names.categories.set(foldName(category.name), id);
		taxonomy.kinds.set(id, category.kind);
		parents.set(id, null);
		colours.set(id, category.color);
		created.add(id);
	});

	// Two levels at most, as Sure's: a category some other names as its parent keeps none.
	const named = new Set(plan.flatMap((category) => category.parentSourceId ?? []));

	await oneByOne(plan, async (category) => {
		const id = taxonomy.ids.categories.get(category.sourceId);
		const parentId =
			category.parentSourceId === null
				? undefined
				: taxonomy.ids.categories.get(category.parentSourceId);

		if (
			id === undefined ||
			parentId === undefined ||
			parentId === id ||
			!created.has(id) ||
			named.has(category.sourceId) ||
			parents.get(parentId) !== null
		) {
			return;
		}

		const kind = taxonomy.kinds.get(parentId) ?? category.kind;
		const parentColour = colours.get(parentId);
		const parent = await tx
			.select({ color: categories.color })
			.from(categories)
			.where(eq(categories.id, parentId))
			.get();

		await tx
			.update(categories)
			.set({ parentId, kind, color: parentColour ?? parent?.color ?? category.color })
			.where(eq(categories.id, id));
		taxonomy.kinds.set(id, kind);
		parents.set(id, parentId);
	});
}

/** Tags or merchants: one whose name exists is reused, any other created. */
async function importNamed(
	tx: Transaction,
	table: typeof tags | typeof merchants,
	plan: readonly PlanNamed[],
	ids: Map<string, string>,
	names: NameBook,
	now: number,
): Promise<void> {
	await oneByOne(plan, async (row) => {
		const found = names.get(foldName(row.name));

		if (found !== undefined) {
			ids.set(row.sourceId, found);
			return;
		}

		const id = crypto.randomUUID();

		await tx.insert(table).values({ id, name: row.name, createdAt: now, updatedAt: now });
		ids.set(row.sourceId, id);
		names.set(foldName(row.name), id);
	});
}

/**
 * Recurring series and their rules, as Sure's importer keeps them; a series
 * whose key, amount, currency and scope another holds already is skipped,
 * which the unique indexes would refuse. Their occurrences and payments are
 * not written: the detection run after the import rebuilds them (AD-24).
 */
async function importRecurring(
	tx: Transaction,
	plan: SurePlan,
	accounts: ReadonlyMap<string, ImportedAccount>,
	taxonomy: Taxonomy,
	now: number,
): Promise<void> {
	await oneByOne(plan.recurring, async (series) => {
		const accountId =
			series.accountSourceId === null ? null : (accounts.get(series.accountSourceId)?.id ?? null);
		const destinationAccountId =
			series.destinationSourceId === null
				? null
				: (accounts.get(series.destinationSourceId)?.id ?? null);
		const merchantId =
			series.merchantSourceId === null
				? null
				: (taxonomy.ids.merchants.get(series.merchantSourceId) ?? null);
		const key =
			destinationAccountId !== null
				? { merchantId: null, labelKey: null }
				: merchantId !== null
					? { merchantId, labelKey: null }
					: { merchantId: null, labelKey: normalizeLabel(series.label) };

		if ((series.destinationSourceId !== null) !== (destinationAccountId !== null)) {
			return;
		}

		const same = await tx
			.select({ id: recurringTransactions.id })
			.from(recurringTransactions)
			.where(
				and(
					accountId === null ? undefined : eq(recurringTransactions.accountId, accountId),
					destinationAccountId === null
						? undefined
						: eq(recurringTransactions.destinationAccountId, destinationAccountId),
					key.merchantId === null
						? undefined
						: eq(recurringTransactions.merchantId, key.merchantId),
					key.labelKey === null ? undefined : eq(recurringTransactions.labelKey, key.labelKey),
					eq(recurringTransactions.amount, series.amount),
					eq(recurringTransactions.currency, series.currency),
					eq(recurringTransactions.dedupScope, series.dedupScope),
				),
			)
			.get();

		if (accountId !== null && same !== undefined) {
			return;
		}

		const id = crypto.randomUUID();

		await tx.insert(recurringTransactions).values({
			id,
			accountId,
			destinationAccountId,
			...key,
			label: series.label,
			name: series.name,
			amount: series.amount,
			expectedAmountMin: series.expectedAmountMin,
			expectedAmountMax: series.expectedAmountMax,
			expectedAmountAvg: series.expectedAmountAvg,
			currency: series.currency,
			expectedDayOfMonth: series.expectedDayOfMonth,
			lastOccurrenceDate: series.lastOccurrenceDate,
			nextExpectedDate: series.nextExpectedDate,
			occurrenceCount: series.occurrenceCount,
			status: series.status,
			manual: series.manual,
			dedupScope: series.dedupScope,
			anchorDate: series.anchorDate,
			endAfterCount: series.endAfterCount,
			billType: series.billType,
			categoryId:
				series.categorySourceId === null
					? null
					: (taxonomy.ids.categories.get(series.categorySourceId) ?? null),
			autopay: series.autopay,
			notes: series.notes,
			paymentUrl: series.paymentUrl,
			schedulePinnedAt: series.schedulePinnedAt,
			nameAliases: series.nameAliases,
			learnedTolerance: series.learnedTolerance,
			createdAt: now,
			updatedAt: now,
		});
		await insertRules(tx, [
			{
				id,
				rules: series.rules.length === 0 ? [monthlyOn(series.expectedDayOfMonth)] : series.rules,
			},
		]);
	});
}

/**
 * Months as Sure's importer keeps them: a month the household set up takes
 * the file's totals; a category's amount the same, one on an income category
 * skipped, as Archant budgets expenses only.
 */
async function importBudgets(
	tx: Transaction,
	plan: SurePlan,
	taxonomy: Taxonomy,
	now: number,
): Promise<void> {
	const currency = getReportingCurrency();
	const months = new Map<string, string>();

	await oneByOne(plan.budgets, async (budget) => {
		const existing = await tx
			.select({ id: budgets.id })
			.from(budgets)
			.where(eq(budgets.month, budget.month))
			.get();
		const totals = {
			budgetedSpending: budget.budgetedSpending,
			expectedIncome: budget.expectedIncome,
		};

		if (existing === undefined) {
			const id = crypto.randomUUID();

			await tx.insert(budgets).values({
				id,
				month: budget.month,
				currency,
				...totals,
				createdAt: now,
				updatedAt: now,
			});
			months.set(budget.sourceId, id);
		} else {
			await tx
				.update(budgets)
				.set({ ...totals, currency, updatedAt: now })
				.where(eq(budgets.id, existing.id));
			months.set(budget.sourceId, existing.id);
		}
	});

	await oneByOne(plan.budgetCategories, async (line) => {
		const budgetId = months.get(line.budgetSourceId);
		const categoryId = taxonomy.ids.categories.get(line.categorySourceId);

		if (
			budgetId === undefined ||
			categoryId === undefined ||
			taxonomy.kinds.get(categoryId) !== "expense"
		) {
			return;
		}

		const rollover =
			line.rolloverEnabled === undefined ? {} : { rolloverEnabled: line.rolloverEnabled };
		const existing = await tx
			.select({ id: budgetCategories.id })
			.from(budgetCategories)
			.where(
				and(eq(budgetCategories.budgetId, budgetId), eq(budgetCategories.categoryId, categoryId)),
			)
			.get();

		if (existing === undefined) {
			await tx.insert(budgetCategories).values({
				id: crypto.randomUUID(),
				budgetId,
				categoryId,
				budgetedSpending: line.amount,
				...rollover,
				createdAt: now,
				updatedAt: now,
			});
		} else {
			await tx
				.update(budgetCategories)
				.set({ budgetedSpending: line.amount, ...rollover, updatedAt: now })
				.where(eq(budgetCategories.id, existing.id));
		}
	});
}

/**
 * Rules through `createRule`, inside the import's transaction. A rule Archant
 * refuses is skipped, and the categories, merchants and tags only it named
 * are never created.
 */
async function importRules(
	tx: Transaction,
	deps: ServiceDeps,
	plan: SurePlan,
	shared: { taxonomy: Taxonomy; accounts: ReadonlyMap<string, ImportedAccount>; now: number },
): Promise<void> {
	const scoped = { ...deps, db: tx };
	const schema = ruleSchema(getReportingCurrency());

	await oneByOne(plan.rules, async (data) => {
		const context: RuleContext = { ...shared, missing: new Map() };
		const input = ruleInputOf(context, data);

		if (input === null || !schema.safeParse(input).success) {
			return;
		}

		await createMissing(tx, shared.taxonomy, context.missing.values(), shared.now);
		const rule = await createRule(scoped, input);
		// Sure's `data["active"] || false`: a rule the file does not say is active is not.
		const active = data.active;

		if (!(active === true || active === "true" || active === 1 || active === "1")) {
			await setRuleEnabled(scoped, rule.id, { enabled: false });
		}
	});
}

/**
 * Every write of an archive, in Sure's order, inside the caller's
 * transaction. Returns each new account by its plan id.
 */
export async function writeArchive(
	deps: ServiceDeps,
	tx: Transaction,
	plan: SurePlan,
): Promise<ReadonlyMap<string, ImportedAccount>> {
	const now = Date.now();
	const accounts = await insertSureAccounts(tx, plan.accounts, now);
	const taxonomy = await taxonomyOf(tx);

	await importCategories(tx, plan.categories, taxonomy, now);
	await importNamed(tx, tags, plan.tags, taxonomy.ids.tags, taxonomy.names.tags, now);
	await importNamed(
		tx,
		merchants,
		plan.merchants,
		taxonomy.ids.merchants,
		taxonomy.names.merchants,
		now,
	);
	await importRecurring(tx, plan, accounts, taxonomy, now);

	const ids: SureIds = { accounts, ...taxonomy.ids };

	await insertSureEntries(tx, plan, ids, { now, timeZone: deps.timeZone });
	await importBudgets(tx, plan, taxonomy, now);
	await importRules(tx, deps, plan, { taxonomy, accounts, now });

	return accounts;
}

/**
 * « Démarrer l'importation »: reads the archive again, refuses it with
 * `SURE_IMPORT_INVALID` while its preflight finds an error, then writes
 * everything in one immediate transaction, in Sure's dependency order, so
 * nothing is written unless everything is. Statistics and recurring
 * detection follow the commit, best-effort, as after a file import. One log
 * line says how it ended, counts and a code only (AD-14).
 */
export async function importSureArchive(
	deps: SureImportDeps,
	file: UploadedFile,
	limits: SureImportLimits,
): Promise<{ counts: SureCounts }> {
	const started = performance.now();

	try {
		// Read and checked before the write lock is taken: the plan depends on
		// no row of the database, and a large file holds no other writer back.
		const archive = await readSureArchive(deps, file, limits);

		if (archive.errors.length > 0) {
			throw new AppError("SURE_IMPORT_INVALID", "The archive's preflight found errors.");
		}

		const { counts } = archive;

		await deps.db.transaction(async (tx) => writeArchive(deps, tx, archive.plan), {
			behavior: "immediate",
		});
		const durationMs = Math.round(performance.now() - started);

		await afterImport(deps);
		deps.logger.info({ ...counts, durationMs }, "sure import finished");

		return { counts };
	} catch (error) {
		const durationMs = Math.round(performance.now() - started);

		// The code only: an unexpected error's message may embed bound amounts.
		if (error instanceof AppError) {
			deps.logger.info({ code: error.code, durationMs }, "sure import refused");
		} else {
			deps.logger.error({ code: "INTERNAL_ERROR", durationMs }, "sure import failed");
		}

		throw error;
	}
}

/**
 * Statistics and the recurring pipeline once the import is committed, as
 * after a file import. The import stands by then: a failure is logged, its
 * code only, and never fails the request.
 */
export async function afterImport(deps: SureImportDeps): Promise<void> {
	try {
		await refreshStatistics(deps.db);
	} catch (error) {
		deps.logger.warn({ code: errorCode(error) }, "statistics refresh failed");
	}

	try {
		await runRecurring(deps, { backfill: false });
	} catch (error) {
		// The code only: an unexpected error's message may embed bound amounts.
		const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";

		deps.logger.error({ code }, "recurring detection failed");
	}
}
