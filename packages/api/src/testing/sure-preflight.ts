import { z } from "zod";

// What Sure's `SureImport` checks before it imports an `all.ndjson`, written
// from its code at 14638a7: `SureImport::Preflight`, the validations of the
// models `Family::DataImporter` saves (`Transfer`, `Rule`, `Category`), and
// the `SUBTYPES` of each accountable. A line it would refuse fails the whole
// import, so the archive's spec runs every line through this.

/** `Family::DataImporter::SUPPORTED_TYPES`: an unknown type is a preflight error. */
const SUPPORTED_TYPES = [
	"Account",
	"Balance",
	"Category",
	"Tag",
	"Merchant",
	"ProviderMerchant",
	"RecurringTransaction",
	"RecurrenceRule",
	"RecurringOccurrence",
	"RecurringAllocation",
	"RecurringPriceChange",
	"RecurringMatchRejection",
	"Transaction",
	"Transfer",
	"RejectedTransfer",
	"Trade",
	"Holding",
	"Valuation",
	"Budget",
	"BudgetCategory",
	"Rule",
] as const;

/** Each accountable's `SUBTYPES` keys; a type without the constant accepts any subtype. */
const SUBTYPES: Record<string, readonly string[] | null> = {
	Depository: ["cash", "checking", "savings", "hsa", "cd", "money_market"],
	Investment: [
		"brokerage",
		"cash_management",
		"401k",
		"roth_401k",
		"403b",
		"457b",
		"tsp",
		"ira",
		"roth_ira",
		"sep_ira",
		"simple_ira",
		"529_plan",
		"hsa",
		"ugma",
		"utma",
		"isa",
		"lisa",
		"sipp",
		"workplace_pension_uk",
		"tfsa",
		"rrsp",
		"fhsa",
		"rdsp",
		"resp",
		"dpsp",
		"prpp",
		"lira",
		"rrif",
		"lif",
		"lrif",
		"prif",
		"rlif",
		"super",
		"smsf",
		"assurance_vie",
		"pea",
		"pillar_3a",
		"riester",
		"nps",
		"apy",
		"life_insurance",
		"indian_stocks",
		"indian_equity",
		"indian_etf",
		"ppf",
		"ssy",
		"nsc",
		"scss",
		"fd",
		"rd",
		"pomis",
		"kvp",
		"g_sec",
		"sdl",
		"corporate_bond",
		"infrastructure_bond",
		"tax_free_bond",
		"gold_etf",
		"gold_mf",
		"sgb",
		"pension",
		"retirement",
		"mutual_fund",
		"gold",
		"angel",
		"trust",
		"other",
	],
	Crypto: ["wallet", "exchange"],
	Property: [
		"single_family_home",
		"multi_family_home",
		"condominium",
		"townhouse",
		"investment_property",
		"second_home",
		"apartment",
		"plot",
		"commercial",
		"agri_land",
	],
	Vehicle: null,
	OtherAsset: null,
	CreditCard: ["credit_card"],
	Loan: ["mortgage", "student", "auto", "home_equity", "line_of_credit", "business", "other"],
	OtherLiability: null,
};

/** `Rule::Registry::TransactionResource`'s condition filter keys, and `compound`. */
const CONDITION_TYPES = [
	"transaction_name",
	"transaction_amount",
	"transaction_type",
	"transaction_merchant",
	"transaction_category",
	"transaction_tag",
	"transaction_details",
	"transaction_notes",
	"transaction_account",
	"compound",
] as const;

/** Its action executors' keys. */
const ACTION_TYPES = [
	"set_transaction_category",
	"set_transaction_tags",
	"set_transaction_merchant",
	"set_transaction_name",
	"set_investment_activity_label",
	"exclude_transaction",
	"set_as_transfer_or_payment",
	"send_email_notification",
	"auto_categorize",
	"auto_detect_merchants",
] as const;

/** Rails' `blank?`: what `REQUIRED_FIELDS` refuses. */
const present = z.string().refine((value) => value.trim() !== "", "blank");
const id = present;
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/u, "not a decimal string");
const date = z.iso.date();
const timestamp = z.iso.datetime();
const currency = z.string().regex(/^[A-Z]{3}$/u);
const stamps = { created_at: timestamp, updated_at: timestamp };
const archant = z.record(z.string(), z.unknown());

const valueRef = z.strictObject({ type: z.string(), id, name: present });

type Condition = {
	condition_type: string;
	operator: string;
	value: string | null;
	value_ref?: z.infer<typeof valueRef> | undefined;
	sub_conditions?: Condition[] | undefined;
};

// `Rule::Condition`: a value unless a group or a valueless operator.
const condition: z.ZodType<Condition> = z
	.strictObject({
		condition_type: z.enum(CONDITION_TYPES),
		operator: present,
		value: z.string().nullable(),
		value_ref: valueRef.optional(),
		get sub_conditions() {
			return z.array(condition).optional();
		},
	})
	.refine(
		(row) =>
			row.condition_type === "compound" ||
			row.operator === "is_null" ||
			(row.value ?? "").trim() !== "",
		"a condition without a value",
	);

const action = z.strictObject({
	action_type: z.enum(ACTION_TYPES),
	value: z.string().nullable(),
	value_ref: z.union([valueRef, z.array(valueRef)]).optional(),
});

const SCHEMAS = {
	Account: z.strictObject({
		id,
		name: present,
		balance: decimal,
		currency,
		accountable_type: z.enum(Object.keys(SUBTYPES)),
		subtype: z.string().nullable(),
		status: z.enum(["active", "disabled", "draft"]),
		exclude_from_reports: z.boolean(),
		...stamps,
		accountable: z.strictObject({
			subtype: z.string().nullable(),
			initial_balance: decimal.nullable().optional(),
			interest_rate: decimal.nullable().optional(),
		}),
		archant,
	}),
	Balance: z.strictObject({ account_id: id, date, balance: decimal, currency }),
	// `Category`: a colour Sure's format accepts, an icon, never its filter value.
	Category: z.strictObject({
		id,
		name: present.refine((name) => name !== "__uncategorized__"),
		color: z.string().regex(/^#[0-9A-Fa-f]{6}$/u),
		lucide_icon: present,
		parent_id: z.string().nullable(),
		classification: z.enum(["income", "expense"]),
		...stamps,
	}),
	Tag: z.strictObject({ id, name: present, ...stamps }),
	Merchant: z.strictObject({ id, name: present, ...stamps }),
	RecurringTransaction: z.strictObject({
		id,
		account_id: id,
		merchant_id: z.string().nullable(),
		// `merchant_or_name_present`; every Archant pattern has a label.
		name: present,
		amount: decimal,
		currency,
		expected_day_of_month: z.number().int().min(1).max(31),
		last_occurrence_date: date,
		next_expected_date: date,
		status: z.enum(["suggested", "active", "paused", "inactive", "ended"]),
		occurrence_count: z.number().int().min(0),
		manual: z.boolean(),
		...stamps,
		archant,
	}),
	Transaction: z.strictObject({
		id,
		account_id: id,
		date,
		amount: decimal,
		currency,
		name: present,
		notes: z.string().nullable(),
		excluded: z.boolean(),
		category_id: z.string().nullable(),
		merchant_id: z.string().nullable(),
		tag_ids: z.array(id),
		kind: z.enum([
			"standard",
			"funds_movement",
			"cc_payment",
			"loan_payment",
			"one_time",
			"investment_contribution",
		]),
		...stamps,
		archant,
	}),
	Transfer: z.strictObject({
		id,
		inflow_transaction_id: id,
		outflow_transaction_id: id,
		status: z.enum(["pending", "confirmed"]),
		notes: z.string().nullable(),
		...stamps,
		archant,
	}),
	RejectedTransfer: z.strictObject({
		id,
		inflow_transaction_id: id,
		outflow_transaction_id: id,
		...stamps,
	}),
	Valuation: z.strictObject({
		id,
		account_id: id,
		date,
		amount: decimal,
		currency,
		name: present,
		kind: z.enum(["opening_anchor", "current_anchor", "reconciliation"]),
		...stamps,
		archant: archant.optional(),
	}),
	Budget: z.strictObject({
		id,
		start_date: date,
		end_date: date,
		budgeted_spending: decimal.nullable(),
		expected_income: decimal.nullable(),
		currency,
		...stamps,
	}),
	BudgetCategory: z.strictObject({
		id,
		budget_id: id,
		category_id: id,
		budgeted_spending: decimal,
		currency,
		rollover_enabled: z.boolean(),
		// `chk_budget_categories_rolled_over_amount_non_negative`.
		rolled_over_amount: decimal.refine((value) => !value.startsWith("-")),
		...stamps,
	}),
	// `Rule`: a name of one character at least, an action, never twice the same,
	// and no group inside a group.
	Rule: z.strictObject({
		id,
		name: z.string().min(1).nullable(),
		resource_type: z.literal("transaction"),
		active: z.boolean(),
		effective_date: date.nullable(),
		conditions: z
			.array(condition)
			.refine(
				(rows) =>
					rows.every((row) =>
						(row.sub_conditions ?? []).every((sub) => sub.condition_type !== "compound"),
					),
				"a group inside a group",
			),
		actions: z
			.array(action)
			.min(1)
			.refine(
				(rows) => new Set(rows.map((row) => row.action_type)).size === rows.length,
				"the same action twice",
			),
		...stamps,
		archant,
	}),
} satisfies Partial<Record<(typeof SUPPORTED_TYPES)[number], z.ZodType>>;

type SureType = keyof typeof SCHEMAS;

const lineSchema = z.strictObject({ type: z.string(), data: z.record(z.string(), z.unknown()) });

/** `SOURCE_ID_TYPES`: the id namespaces a duplicate is refused in. */
const SOURCE_IDS: Partial<Record<SureType, string>> = {
	Account: "accounts",
	Category: "categories",
	Tag: "tags",
	Merchant: "merchants",
	RecurringTransaction: "recurring_transactions",
	Transaction: "transactions",
	Budget: "budgets",
};

/** `REFERENCE_FIELDS`, `tag_ids` beside them. */
const REFERENCES: Partial<Record<SureType, Record<string, string>>> = {
	Balance: { account_id: "accounts" },
	Category: { parent_id: "categories" },
	RecurringTransaction: { account_id: "accounts", merchant_id: "merchants" },
	Transaction: { account_id: "accounts", category_id: "categories", merchant_id: "merchants" },
	Transfer: { inflow_transaction_id: "transactions", outflow_transaction_id: "transactions" },
	RejectedTransfer: {
		inflow_transaction_id: "transactions",
		outflow_transaction_id: "transactions",
	},
	Valuation: { account_id: "accounts" },
	BudgetCategory: { budget_id: "budgets", category_id: "categories" },
};

type Row = { line: number; type: SureType; data: Record<string, unknown> };

const text = (value: unknown) => (typeof value === "string" ? value : "");

function isSureType(type: string): type is SureType {
	return Object.hasOwn(SCHEMAS, type);
}

/**
 * Every reason Sure's import would refuse `ndjson`, one message each; none
 * for an archive it accepts. Sure's soft references, a missing merchant or a
 * rejected transfer's side, count here too: the archive holds every row it
 * points at.
 */
export function surePreflight(ndjson: string): string[] {
	const problems: string[] = [];
	const rows: Row[] = [];

	if (!ndjson.endsWith("\n")) {
		problems.push("the file does not end with a newline");
	}

	for (const [index, raw] of ndjson.split("\n").entries()) {
		const line = index + 1;

		if (raw.trim() === "") {
			continue;
		}

		const parsed = lineSchema.safeParse(JSON.parse(raw));

		if (!parsed.success) {
			problems.push(`line ${line} is not {"type","data"}`);
			continue;
		}

		const { type, data } = parsed.data;

		if (!SUPPORTED_TYPES.some((supported) => supported === type)) {
			problems.push(`line ${line} has an unsupported type ${type}`);
			continue;
		}

		if (!isSureType(type)) {
			problems.push(`line ${line} has a type the archive never writes: ${type}`);
			continue;
		}

		const checked = SCHEMAS[type].safeParse(data);

		if (!checked.success) {
			problems.push(`line ${line} ${type}: ${z.prettifyError(checked.error)}`);
		}

		rows.push({ line, type, data });
	}

	if (rows.length === 0) {
		problems.push("no data rows");
	}

	return [...problems, ...crossLineProblems(rows)];
}

function crossLineProblems(rows: readonly Row[]): string[] {
	const problems: string[] = [];
	const ids = new Map<string, Map<string, number>>();
	const of = (type: SureType) => rows.filter((row) => row.type === type);

	for (const row of rows) {
		const namespace = SOURCE_IDS[row.type];

		if (namespace !== undefined) {
			const seen = ids.get(namespace) ?? new Map<string, number>();
			const first = seen.get(text(row.data["id"]));

			if (first !== undefined) {
				problems.push(`line ${row.line} repeats the ${namespace} id of line ${first}`);
			}

			seen.set(text(row.data["id"]), row.line);
			ids.set(namespace, seen);
		}
	}

	for (const type of ["Category", "Tag", "Merchant"] as const) {
		const names = new Map<string, number>();

		for (const row of of(type)) {
			const name = text(row.data["name"]);
			const first = names.get(name);

			if (first !== undefined) {
				problems.push(`${type} name ${name} on lines ${first} and ${row.line}`);
			}

			names.set(name, row.line);
		}
	}

	for (const row of of("Account")) {
		const allowed = SUBTYPES[text(row.data["accountable_type"])];
		const accountable = z
			.object({ subtype: z.string().nullable() })
			.safeParse(row.data["accountable"]);
		const subtype = (accountable.success ? accountable.data.subtype : null) ?? row.data["subtype"];

		if (typeof subtype === "string" && subtype !== "" && allowed && !allowed.includes(subtype)) {
			problems.push(`line ${row.line} has a subtype Sure refuses: ${subtype}`);
		}
	}

	for (const row of rows) {
		const references = Object.entries(REFERENCES[row.type] ?? {});
		const tags =
			row.type === "Transaction" ? z.array(z.string()).catch([]).parse(row.data["tag_ids"]) : [];

		for (const [field, namespace] of [
			...references,
			...tags.map((tag): [string, string] => [`tag_ids ${tag}`, "tags"]),
		]) {
			const value = field.startsWith("tag_ids ") ? field.slice(8) : text(row.data[field]);

			if (value !== "" && ids.get(namespace)?.has(value) !== true) {
				problems.push(`line ${row.line} ${row.type}.${field} points at no exported row`);
			}
		}
	}

	// `Entry`'s `date > 30.years.ago`, against today's clock as Sure's import reads it.
	const now = new Date();
	const oldest = new Date(Date.UTC(now.getUTCFullYear() - 30, now.getUTCMonth(), now.getUTCDate()))
		.toISOString()
		.slice(0, 10);

	for (const row of [...of("Transaction"), ...of("Valuation")]) {
		if (text(row.data["date"]) <= oldest) {
			problems.push(`line ${row.line} ${row.type} is dated 30 years ago or more`);
		}
	}

	const valuations = new Map<string, number>();

	for (const row of of("Valuation")) {
		const key = `${text(row.data["account_id"])} ${text(row.data["date"])}`;
		const first = valuations.get(key);

		if (first !== undefined) {
			problems.push(`line ${row.line} is a second valuation of line ${first}'s account and day`);
		}

		valuations.set(key, row.line);
	}

	// Without one, Sure's import creates an opening balance from the current
	// one, and every imported movement then counts twice.
	const anchored = new Set(
		of("Valuation")
			.filter((row) => row.data["kind"] === "opening_anchor")
			.map((row) => text(row.data["account_id"])),
	);

	for (const row of of("Account")) {
		if (!anchored.has(text(row.data["id"]))) {
			problems.push(`line ${row.line} is an account without an opening anchor`);
		}
	}

	return [...problems, ...transferProblems(of("Transfer"), of("Transaction"))];
}

/** `Transfer`'s validations, which fail Sure's import whole. */
function transferProblems(transfers: readonly Row[], transactions: readonly Row[]): string[] {
	const problems: string[] = [];
	const byId = new Map(transactions.map((row) => [text(row.data["id"]), row.data]));
	const sides = new Map<string, number>();

	for (const transfer of transfers) {
		const inflow = byId.get(text(transfer.data["inflow_transaction_id"]));
		const outflow = byId.get(text(transfer.data["outflow_transaction_id"]));

		for (const side of ["inflow_transaction_id", "outflow_transaction_id"]) {
			const key = `${side} ${text(transfer.data[side])}`;
			const first = sides.get(key);

			if (first !== undefined) {
				problems.push(`line ${transfer.line} reuses the ${side} of line ${first}`);
			}

			sides.set(key, transfer.line);
		}

		if (inflow === undefined || outflow === undefined) {
			continue;
		}

		const inflowAmount = Number(inflow["amount"]);
		const outflowAmount = Number(outflow["amount"]);
		const days =
			Math.abs(Date.parse(text(inflow["date"])) - Date.parse(text(outflow["date"]))) / 86_400_000;

		if (inflow["account_id"] === outflow["account_id"]) {
			problems.push(`line ${transfer.line} moves money within one account`);
		}

		if (!(inflowAmount < 0 && outflowAmount > 0)) {
			problems.push(`line ${transfer.line} has sides of the wrong sign`);
		}

		// Compared as text: a decimal string is exact, a sum of floats is not.
		if (
			inflow["currency"] === outflow["currency"] &&
			text(inflow["amount"]) !== `-${text(outflow["amount"])}`
		) {
			problems.push(`line ${transfer.line} has sides of different amounts`);
		}

		if (days > (transfer.data["status"] === "confirmed" ? 30 : 4)) {
			problems.push(`line ${transfer.line} has sides too far apart`);
		}
	}

	return problems;
}
