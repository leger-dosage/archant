import type { Logger } from "../lib/logger.ts";
import type { RuleInput } from "../schemas/rules.ts";
import type { ServiceDeps } from "./deps.ts";
import type { Transaction } from "./ledger/shared.ts";
import type { ImportedAccount, SureIds } from "./ledger/sure-import.ts";
import type { PlanCategory, PlanNamed, SurePlan } from "./sure-import-plan.ts";
import type { SureCounts, SureImportLimits, SurePreflight } from "./sure-import-preflight.ts";

import { and, eq } from "drizzle-orm";
import Papa from "papaparse";

import { errorCode } from "@archant/data/backup";
import type { CategoryKind } from "@archant/data/category-presets";
import { CATEGORY_NAME_MAX_LENGTH, newCategory } from "@archant/data/category-presets";
import type { Database } from "@archant/data/client";
import { refreshStatistics } from "@archant/data/client";
import { parseDecimalAmount, toDecimalString } from "@archant/data/money";
import { MERCHANT_NAME_MAX_LENGTH, TAG_NAME_MAX_LENGTH } from "@archant/data/name-limits";
import { RULE_ACTION_TYPES, RULE_CONDITION_TYPES } from "@archant/data/rules";
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
import { cut, readSureArchive } from "./sure-import-plan.ts";
import { foldName } from "./sure-import-preflight.ts";

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

/** A name not taken yet, folded as `assertNameFree` compares names, or the row holding it. */
type NameBook = Map<string, string>;

async function nameBook(
	tx: Transaction,
	table: typeof categories | typeof tags | typeof merchants,
): Promise<NameBook> {
	const rows = await tx.select({ id: table.id, name: table.name }).from(table);

	return new Map(rows.map((row) => [foldName(row.name), row.id]));
}

type Taxonomy = {
	ids: {
		categories: Map<string, string>;
		tags: Map<string, string>;
		merchants: Map<string, string>;
	};
	names: { categories: NameBook; tags: NameBook; merchants: NameBook };
	/** Each category's kind by its id, the household's and the new ones. */
	kinds: Map<string, CategoryKind>;
};

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

type Data = Record<string, unknown>;

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const isData = (value: unknown): value is Data =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Sure's `rule_operand_value`: a value, else the name its `value_ref` gives. */
function operandOf(data: Data): string | null {
	const raw = data.value;
	const value = typeof raw === "string" ? (raw.trim() === "" ? null : raw) : raw;
	// A blank name is no operand: the rule then fails `ruleSchema` and is skipped.
	const refName =
		isData(data.value_ref) &&
		typeof data.value_ref.name === "string" &&
		data.value_ref.name.trim() !== ""
			? data.value_ref.name
			: null;

	if (typeof value === "string" && UUID_PATTERN.test(value) && refName !== null) {
		return refName;
	}

	if (value !== null && value !== undefined) {
		return typeof value === "string"
			? value
			: typeof value === "number" || typeof value === "boolean"
				? String(value)
				: null;
	}

	return refName;
}

type ReferenceKind = "categories" | "merchants" | "tags";

/** The longest name each kind of row takes, as its form bounds it. */
const NAME_LIMITS: Record<ReferenceKind, number> = {
	categories: CATEGORY_NAME_MAX_LENGTH,
	merchants: MERCHANT_NAME_MAX_LENGTH,
	tags: TAG_NAME_MAX_LENGTH,
};

/** A row a rule names that does not exist yet, created only once the rule is kept. */
type Missing = { kind: ReferenceKind; id: string; name: string };

/**
 * What one rule's operands resolve against. `missing` collects the rows it
 * names that nobody holds, so a rule skipped leaves none behind.
 */
type RuleContext = {
	taxonomy: Taxonomy;
	accounts: ReadonlyMap<string, ImportedAccount>;
	missing: Map<string, Missing>;
};

/**
 * The id of the category, merchant or tag a rule names: an archive's own id
 * maps through the import, a name finds the row holding it, else a new id
 * the rule creates when it is kept, as Sure's `find_or_create_rule_*`.
 */
function referenceId(context: RuleContext, kind: ReferenceKind, value: string): string {
	const known =
		context.taxonomy.ids[kind].get(value) ?? context.taxonomy.names[kind].get(foldName(value));

	if (known !== undefined) {
		return known;
	}

	const key = `${kind} ${foldName(value)}`;
	const missing = context.missing.get(key) ?? {
		kind,
		id: crypto.randomUUID(),
		name: cut(value.trim(), NAME_LIMITS[kind]),
	};

	context.missing.set(key, missing);

	return missing.id;
}

/** Creates the rows a kept rule named, and books them for the rules after it. */
async function createMissing(
	tx: Transaction,
	taxonomy: Taxonomy,
	missing: Iterable<Missing>,
	now: number,
): Promise<void> {
	const stamps = { createdAt: now, updatedAt: now };

	await oneByOne([...missing], async ({ kind, id, name }) => {
		if (kind === "categories") {
			const preset = newCategory(name);

			await tx.insert(categories).values({
				id,
				name,
				kind: preset.kind,
				color: preset.color,
				icon: preset.icon,
				parentId: null,
				...stamps,
			});
			taxonomy.kinds.set(id, preset.kind);
		} else {
			await tx.insert(kind === "tags" ? tags : merchants).values({ id, name, ...stamps });
		}

		taxonomy.names[kind].set(foldName(name), id);
	});
}

const REFERENCE_CONDITIONS = {
	transaction_category: "categories",
	transaction_merchant: "merchants",
	transaction_tag: "tags",
} as const;

type ConditionInput = RuleInput["conditions"][number];

/** A condition in Archant's terms, `null` when Archant lacks it and the rule is skipped. */
function conditionOf(context: RuleContext, data: unknown): ConditionInput | null {
	if (
		!isData(data) ||
		typeof data.condition_type !== "string" ||
		typeof data.operator !== "string"
	) {
		return null;
	}

	const type = RULE_CONDITION_TYPES.find((known) => known === data.condition_type);

	if (type === undefined) {
		return null;
	}

	if (type === "compound") {
		const children = listOf(data.sub_conditions).map((child) => conditionOf(context, child));

		return children.some((child) => child === null)
			? null
			: {
					conditionType: type,
					operator: data.operator,
					conditions: children.filter((child) => child !== null),
				};
	}

	const value = data.operator === "is_null" ? null : operandOf(data);

	if (value === null) {
		return { conditionType: type, operator: data.operator, value: null };
	}

	if (type === "transaction_account") {
		const account = context.accounts.get(value);

		return account === undefined
			? null
			: { conditionType: type, operator: data.operator, value: account.id };
	}

	if (type === "transaction_amount") {
		const currency = getReportingCurrency();
		const amount = parseDecimalAmount(value, currency);

		return amount === null
			? null
			: {
					conditionType: type,
					operator: data.operator,
					value: toDecimalString({ amount, currency }),
				};
	}

	const reference =
		type === "transaction_category" || type === "transaction_merchant" || type === "transaction_tag"
			? REFERENCE_CONDITIONS[type]
			: null;

	return {
		conditionType: type,
		operator: data.operator,
		value: reference === null ? value : referenceId(context, reference, value),
	};
}

/** Sure's `resolve_multi_tag_action_value`: the names of `value_ref`, else of the value's CSV line. */
function tagsValue(context: RuleContext, data: Data): string {
	const refs = Array.isArray(data.value_ref)
		? data.value_ref
		: isData(data.value_ref)
			? [data.value_ref]
			: [];
	const names =
		refs.length > 0
			? refs.map((ref) => (isData(ref) && typeof ref.name === "string" ? ref.name : ""))
			: typeof data.value === "string"
				? (Papa.parse<string[]>(data.value).data[0] ?? [])
				: [];
	const ids = names
		.filter((name) => name.trim() !== "")
		.map((name) => referenceId(context, "tags", name));

	return [...new Set(ids)].join(",");
}

type ActionInput = RuleInput["actions"][number];

/** An action in Archant's terms; `null` when Archant lacks it, which drops it. */
function actionOf(context: RuleContext, data: unknown): ActionInput | null {
	if (!isData(data)) {
		return null;
	}

	const type = RULE_ACTION_TYPES.find((known) => known === data.action_type);

	switch (type) {
		case undefined:
		case "replace_in_transaction_name":
			return null;
		case "exclude_transaction":
			return { actionType: type, value: null };
		case "set_transaction_tags":
			return { actionType: type, value: tagsValue(context, data) };
		case "set_as_transfer_or_payment": {
			const account = context.accounts.get(operandOf(data) ?? "");

			return account === undefined ? null : { actionType: type, value: account.id };
		}
		default: {
			const value = operandOf(data);

			if (value === null) {
				return { actionType: type, value: null };
			}

			return {
				actionType: type,
				value:
					type === "set_transaction_category"
						? referenceId(context, "categories", value)
						: type === "set_transaction_merchant"
							? referenceId(context, "merchants", value)
							: value,
			};
		}
	}
}

/**
 * A rule in Archant's terms, `null` when it is skipped: a condition Archant
 * lacks would make it match more than it did, and a rule left without an
 * action does nothing. `archant.actions` restores a replacement in the label.
 */
function ruleInputOf(context: RuleContext, data: Data): RuleInput | null {
	const conditions = listOf(data.conditions).map((condition) => conditionOf(context, condition));

	if (conditions.some((condition) => condition === null)) {
		return null;
	}

	const archant = isData(data.archant) ? data.archant : {};
	const actions = [
		...listOf(data.actions)
			.map((action) => actionOf(context, action))
			.filter((action) => action !== null),
		...listOf(archant.actions).flatMap((own): ActionInput[] =>
			isData(own) &&
			own.action_type === "replace_in_transaction_name" &&
			typeof own.value === "string"
				? [
						{
							actionType: "replace_in_transaction_name",
							value: own.value,
							replacement: typeof own.replacement === "string" ? own.replacement : "",
						},
					]
				: [],
		),
	];

	if (actions.length === 0) {
		return null;
	}

	return {
		name: typeof data.name === "string" ? data.name : null,
		effectiveDate:
			typeof data.effective_date === "string" && data.effective_date !== ""
				? data.effective_date.slice(0, 10)
				: null,
		conditions: conditions.filter((condition) => condition !== null),
		actions,
	};
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

/** Every write of an archive, in Sure's order, inside the caller's transaction. */
async function writeArchive(deps: ServiceDeps, tx: Transaction, plan: SurePlan): Promise<void> {
	const now = Date.now();
	const accounts = await insertSureAccounts(tx, plan.accounts, now);
	const taxonomy: Taxonomy = {
		ids: { categories: new Map(), tags: new Map(), merchants: new Map() },
		names: {
			categories: await nameBook(tx, categories),
			tags: await nameBook(tx, tags),
			merchants: await nameBook(tx, merchants),
		},
		kinds: new Map(),
	};

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
async function afterImport(deps: SureImportDeps): Promise<void> {
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
