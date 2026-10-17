import type { RuleInput } from "../schemas/rules.ts";
import type { HeaderLookup } from "./csv-import-format.ts";
import type { CsvRow } from "./csv-import-format.ts";
import type { ServiceDeps } from "./deps.ts";
import type { Transaction } from "./ledger/shared.ts";
import type { RuleData } from "./rules.ts";
import type { SureIssue } from "./sure-import-preflight.ts";
import type { RuleContext, Taxonomy } from "./sure-rules.ts";

import { accounts } from "@archant/data/schema/accounts";

import { ruleSchema } from "../schemas/rules.ts";
import { columnOf, csvIssue } from "./csv-import-format.ts";
import { oneByOne } from "./ledger/shared.ts";
import { createRule, listRules, setRuleEnabled, updateRule } from "./rules.ts";
import { getReportingCurrency } from "./settings.ts";
import { createMissing, ruleInputOf, taxonomyOf } from "./sure-rules.ts";

// Sure's `RuleImport` at 00dd977fb: a row per rule, its conditions and
// actions as JSON, read by `normalize_rule_row` and `parse_json_safely`,
// names resolved as Story 30.1's rules resolve them. A rule of the same name
// is updated rather than added, as Sure's `find_or_initialize_by`.

/** One rule row as Sure's `normalize_rule_row` reads it. */
type RuleRow = {
	line: number;
	name: string | null;
	resourceType: string;
	active: boolean;
	effectiveDate: string;
	conditions: string;
	actions: string;
};

/**
 * Sure's `extract_conditions_and_actions`: the cells after the fourth joined
 * again, then split between the two JSON arrays, for a file whose unescaped
 * quotes broke the JSON across cells.
 */
function conditionsAndActions(fragments: readonly string[], separator: string): [string, string] {
	if (fragments.length === 0) {
		return ["", ""];
	}

	const combined = fragments.join(separator);
	const boundary = /(?<=\])"\s*,\s*"(?=\[)/u.exec(combined);
	const parts =
		boundary === null
			? [fragments[0], fragments[1]]
			: [combined.slice(0, boundary.index), combined.slice(boundary.index + boundary[0].length)];

	const [conditions = "", actions = ""] = parts.map((part) =>
		(part ?? "").trim().replaceAll(/^"+|"+$/gu, ""),
	);

	return [conditions, actions];
}

/** Sure's `parse_boolean`: `true`, `1`, `yes` and `y`, case aside, are true; anything else false. */
const parseBoolean = (value: string) => ["true", "1", "yes", "y"].includes(value.toLowerCase());

/** Sure's `normalize_rule_row`: a column by its header, else by its place. */
function ruleRowOf(row: CsvRow, lookup: HeaderLookup, separator: string): RuleRow {
	const byHeader = (header: string) => {
		const column = columnOf(lookup, header);
		const value = column === undefined ? undefined : row.cells[column];

		return value === undefined || value === "" ? undefined : value;
	};
	const [name = "", resourceType = "", active = "", effectiveDate = ""] = row.cells;
	const [conditions, actions] = conditionsAndActions(row.cells.slice(4), separator);

	return {
		line: row.line,
		name: (byHeader("name") ?? name).trim() || null,
		resourceType: (byHeader("resource_type") ?? resourceType).trim(),
		active: parseBoolean(byHeader("active") ?? active),
		effectiveDate: (byHeader("effective_date") ?? effectiveDate).trim(),
		conditions: conditions.trim(),
		actions: actions.trim(),
	};
}

/** Sure's `normalize_json_values`: escaped quotes and `\u` escapes a CSV round trip left. */
function normalizeJson(value: unknown, legacy: boolean): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => normalizeJson(item, legacy));
	}

	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, normalizeJson(item, legacy)]),
		);
	}

	if (typeof value !== "string") {
		return value;
	}

	const normalized = value
		.replaceAll(/\\u([0-9a-f]{4})/giu, (_, code: string) =>
			String.fromCodePoint(Number.parseInt(code, 16)),
		)
		.replaceAll('\\"', '"');

	return legacy
		? normalized.replaceAll("\\n", "\n").replaceAll("\\r", "\r").replaceAll("\\t", "\t")
		: normalized;
}

/** Sure's `parse_json_payload`: a JSON text, itself JSON text once more when it wraps an array or object. */
function jsonPayload(payload: string, legacy: boolean): unknown {
	const parsed: unknown = JSON.parse(payload);
	const unwrapped: unknown =
		typeof parsed === "string" && /^\s*[[{]/u.test(parsed) ? JSON.parse(parsed) : parsed;

	return normalizeJson(unwrapped, legacy);
}

/**
 * Sure's `parse_json_safely`: `[]` when blank, the JSON as it is, else the
 * text cleaned of the quotes and backslashes an older export left around
 * it. `undefined` when neither reads, Sure's `invalid_json`.
 */
function parseJsonSafely(text: string): unknown {
	if (text.trim() === "") {
		return [];
	}

	const cleaned = text.trim();

	try {
		return jsonPayload(cleaned, false);
	} catch {
		let legacy = cleaned.replaceAll(/^["']+|["']+$/gu, "");
		let previous = "";

		while (legacy !== previous) {
			previous = legacy;
			legacy = legacy.replaceAll(/\\+"/gu, '"').replaceAll(/\\+'/gu, "'").replaceAll("\\\\", "\\");
		}

		legacy = legacy.replaceAll(/\\u([0-9a-f]{4})/giu, (_, code: string) =>
			String.fromCodePoint(Number.parseInt(code, 16)),
		);

		try {
			return jsonPayload(legacy, true);
		} catch {
			return undefined;
		}
	}
}

/** Sure's `parse_date` as Archant keeps a start date: an ISO day, else none. */
function effectiveDateOf(text: string): string | null {
	const day = /^(\d{4}-\d{2}-\d{2})/u.exec(text)?.[1];

	// A round trip, since `Date.parse` rolls 2024-02-30 over to March: an
	// impossible day is none, as Sure's `Date.parse` rescues to nil.
	return day !== undefined &&
		!Number.isNaN(Date.parse(`${day}T00:00:00Z`)) &&
		new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day
		? day
		: null;
}

/** A rule row Archant can hold, ready to write. */
type ReadRule = { line: number; active: boolean; data: Record<string, unknown> };

/**
 * A rule's place in the household: a named one by its name, an unnamed one
 * by its conditions, actions and start date, so a reimported export updates
 * what it wrote rather than adding a copy.
 */
function ruleKey(rule: {
	effectiveDate: string | null;
	conditions: readonly ConditionShape[];
	actions: readonly { actionType: string; value: string | null }[];
}): string {
	const condition = (shape: ConditionShape): unknown =>
		shape.conditionType === "compound"
			? ["compound", shape.operator, (shape.conditions ?? []).map(condition)]
			: [shape.conditionType, shape.operator, shape.value ?? null];

	return JSON.stringify([
		rule.effectiveDate,
		rule.conditions.map(condition),
		rule.actions
			.filter((action) => action.actionType !== "replace_in_transaction_name")
			.map((action) => [action.actionType, action.value]),
	]);
}

type ConditionShape = {
	conditionType: string;
	operator: string;
	value?: string | null;
	conditions?: readonly ConditionShape[];
};

/** The household's accounts by id, which an account condition or action names. */
async function accountsById(db: Pick<Transaction, "select">) {
	const rows = await db.select({ id: accounts.id }).from(accounts);

	return new Map(rows.map((row) => [row.id, row]));
}

export type RulesAnalysis = {
	errors: SureIssue[];
	counts: { rules: number };
	write: (tx: Transaction, deps: ServiceDeps) => Promise<void>;
};

/**
 * Reads every rule row, refusing on its line what Sure's `RuleImport` or
 * Archant refuses: a resource other than transactions, JSON that does not
 * read, no action, a rule Archant cannot hold. Writes nothing; `write`
 * creates or updates each rule inside the import's transaction.
 */
export async function analyseRules(
	db: Pick<Transaction, "select">,
	sheet: { rows: readonly CsvRow[]; lookup: HeaderLookup; separator: string },
): Promise<RulesAnalysis> {
	const errors: SureIssue[] = [];
	const read: ReadRule[] = [];
	const schema = ruleSchema(getReportingCurrency());
	const taxonomy = await taxonomyOf(db);
	const household = await accountsById(db);

	for (const row of sheet.rows) {
		const rule = ruleRowOf(row, sheet.lookup, sheet.separator);
		const line = String(rule.line);
		const missing = (["resource_type", "conditions", "actions"] as const).filter(
			(field) =>
				(field === "resource_type"
					? rule.resourceType
					: field === "conditions"
						? rule.conditions
						: rule.actions) === "",
		);

		if (missing.length > 0) {
			errors.push(...missing.map((field) => csvIssue("required", { line, field })));
			continue;
		}

		if (rule.resourceType !== "transaction") {
			errors.push(
				csvIssue("unsupported_resource_type", { line, resource_type: rule.resourceType }),
			);
			continue;
		}

		const conditions = parseJsonSafely(rule.conditions);
		const actions = parseJsonSafely(rule.actions);

		if (conditions === undefined || actions === undefined) {
			errors.push(csvIssue("invalid_json", { line }));
			continue;
		}

		if (Array.isArray(actions) && actions.length === 0) {
			errors.push(csvIssue("min_actions", { line }));
			continue;
		}

		const data = {
			name: rule.name,
			effective_date: effectiveDateOf(rule.effectiveDate) ?? "",
			conditions,
			actions,
		};
		const context: RuleContext = { taxonomy, accounts: household, missing: new Map() };
		const input =
			Array.isArray(conditions) && Array.isArray(actions) ? ruleInputOf(context, data) : null;

		if (input === null || !schema.safeParse(input).success) {
			errors.push(csvIssue("unsupported_rule", { line }));
			continue;
		}

		read.push({ line: rule.line, active: rule.active, data });
	}

	return {
		errors,
		counts: { rules: sheet.rows.length },
		write: async (tx, deps) => writeRules(tx, deps, read),
	};
}

/** The replacements in the label a rule holds, which Sure's file cannot carry. */
const replacementsOf = (rule: RuleData): RuleInput["actions"] =>
	rule.actions
		.filter((action) => action.actionType === "replace_in_transaction_name")
		.map((action) => ({ ...action }));

/**
 * Each read rule in the file's order: the rows it names created first, then
 * the rule of that name updated, or the identical unnamed one, else a new
 * one, enabled as its `active` says.
 */
async function writeRules(tx: Transaction, deps: ServiceDeps, read: readonly ReadRule[]) {
	const scoped = { ...deps, db: tx };
	const schema = ruleSchema(getReportingCurrency());
	const taxonomy: Taxonomy = await taxonomyOf(tx);
	const household = await accountsById(tx);
	const existing = await listRules(scoped);
	const byName = new Map(
		existing.flatMap((rule) => (rule.name === null ? [] : [[rule.name, rule]])),
	);
	const byKey = new Map(
		existing.flatMap((rule) => (rule.name === null ? [[ruleKey(rule), rule]] : [])),
	);
	const now = Date.now();

	await oneByOne(read, async ({ active, data }) => {
		const context: RuleContext = { taxonomy, accounts: household, missing: new Map() };
		const input = ruleInputOf(context, data);

		if (input === null) {
			return;
		}

		const parsed = schema.parse(input);

		await createMissing(tx, taxonomy, context.missing.values(), now);

		const found = parsed.name === null ? byKey.get(ruleKey(parsed)) : byName.get(parsed.name);
		// A replacement in the label has no place in Sure's file: an update keeps the rule's own.
		const saved =
			found === undefined
				? await createRule(scoped, input)
				: await updateRule(scoped, found.id, {
						...input,
						actions: [...input.actions, ...replacementsOf(found)],
					});

		if (saved.enabled !== active) {
			await setRuleEnabled(scoped, saved.id, { enabled: active });
		}

		if (saved.name === null) {
			byKey.set(ruleKey(saved), { ...saved, enabled: active });
		} else {
			byName.set(saved.name, { ...saved, enabled: active });
		}
	});
}
