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
const unsigned = decimal.refine((value) => !value.startsWith("-"), "negative");
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

const TRANSACTION_KINDS = [
	"standard",
	"funds_movement",
	"cc_payment",
	"loan_payment",
	"one_time",
	"investment_contribution",
] as const;

/** A decimal string as an integer count of its smallest digit, at `scale` digits. */
function scaled(text: string, scale: number): bigint {
	const [whole = "0", fraction = ""] = text.replace("-", "").split(".");
	const units = BigInt(whole + fraction.padEnd(scale, "0"));

	return text.startsWith("-") ? -units : units;
}

/** `validate_split_line_total`: the lines sum to the transaction's amount, exactly. */
function sumsTo(amount: string, lines: readonly { amount: string }[]): boolean {
	const scale = Math.max(
		...[amount, ...lines.map((line) => line.amount)].map((text) => text.split(".")[1]?.length ?? 0),
	);

	return (
		lines.reduce((total, line) => total + scaled(line.amount, scale), 0n) === scaled(amount, scale)
	);
}

// `serialize_split_lines_for_export`'s keys; `importable_split_rows` needs an amount.
const splitLine = z.strictObject({
	id,
	entry_id: id,
	amount: decimal,
	currency,
	name: present,
	notes: z.string().nullable(),
	excluded: z.boolean(),
	category_id: z.string().nullable(),
	merchant_id: z.string().nullable(),
	tag_ids: z.array(id),
	kind: z.enum(TRANSACTION_KINDS),
	...stamps,
	archant,
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
	Balance: z.strictObject({
		account_id: id,
		date,
		balance: decimal,
		// Read when present, `balance` otherwise.
		cash_balance: decimal.optional(),
		currency,
	}),
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
	RecurringTransaction: z
		.strictObject({
			id,
			account_id: id,
			merchant_id: z.string().nullable(),
			// `merchant_or_name_present`; every Archant pattern has a label.
			name: present,
			amount: decimal,
			expected_amount_min: decimal.nullable(),
			expected_amount_max: decimal.nullable(),
			expected_amount_avg: decimal.nullable(),
			currency,
			expected_day_of_month: z.number().int().min(1).max(31),
			last_occurrence_date: date,
			next_expected_date: date,
			status: z.enum(["suggested", "active", "paused", "inactive", "ended"]),
			occurrence_count: z.number().int().min(0),
			manual: z.boolean(),
			payment_url: z.url({ protocol: /^https?$/u }).nullable(),
			autopay: z.boolean(),
			notes: z.string().nullable(),
			// `bill_type_matches_shape`: no transfer without a destination account.
			bill_type: z.enum(["bill", "subscription", "installment", "income", "other"]),
			category_id: z.string().nullable(),
			anchor_date: date.nullable(),
			end_mode: z.enum(["never", "on_date", "after_count"]),
			// `MAX_END_AFTER_COUNT`.
			end_after_count: z.number().int().min(1).max(600).nullable(),
			matcher_hints: z.strictObject({ schedule_pinned_at: timestamp.optional() }),
			dedup_scope: z.string(),
			...stamps,
		})
		// `amount_variance_consistency`.
		.refine(
			(row) =>
				row.expected_amount_min === null ||
				row.expected_amount_max === null ||
				Number(row.expected_amount_min) <= Number(row.expected_amount_max),
			{ message: "expected_amount_min is above expected_amount_max" },
		)
		// `end_mode_fields_consistent`.
		.refine((row) => (row.end_mode === "after_count") === (row.end_after_count !== null), {
			message: "end_after_count does not match end_mode",
		}),
	// `RecurrenceRule`'s validations and `day_spec_coherent`, the nth weekday aside.
	RecurrenceRule: z
		.strictObject({
			id,
			recurring_transaction_id: id,
			frequency: z.enum(["weekly", "monthly", "yearly"]),
			interval: z.number().int().min(1),
			day_of_month: z
				.number()
				.int()
				.min(-1)
				.max(31)
				.refine((day) => day !== 0)
				.nullable(),
			weekday: z.number().int().min(0).max(6).nullable(),
			weekday_ordinal: z.null(),
			month_of_year: z.number().int().min(1).max(12).nullable(),
			position: z.number().int().min(0),
		})
		.refine(
			(rule) =>
				rule.frequency === "weekly"
					? rule.weekday !== null && rule.day_of_month === null && rule.month_of_year === null
					: rule.day_of_month !== null &&
						rule.weekday === null &&
						(rule.month_of_year !== null) === (rule.frequency === "yearly"),
			{ message: "the day fields do not fit the frequency" },
		),
	Transaction: z
		.strictObject({
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
			kind: z.enum(TRANSACTION_KINDS),
			...stamps,
			split_lines: z.array(splitLine).min(1).optional(),
			archant,
		})
		.refine(
			(row) => row.split_lines === undefined || sumsTo(row.amount, row.split_lines),
			"split line amounts that do not sum to the transaction's",
		),
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
	// `Trade` requires a quantity, a price and a currency; the preflight, a ticker.
	Trade: z.strictObject({
		id,
		entry_id: id,
		account_id: id,
		// `null` for interest on cash: Sure's importer finds its security by ticker.
		security_id: id.nullable(),
		ticker: present,
		security_name: present,
		exchange_operating_mic: z.string().nullable(),
		// Sure's `Trade::ACTIVITY_LABELS` that Archant records.
		investment_activity_label: z.enum(["Buy", "Sell", "Dividend", "Interest"]),
		date,
		qty: decimal,
		price: decimal,
		amount: decimal,
		currency,
		...stamps,
		archant,
	}),
	// `Holding` validates a quantity, a price and an amount of zero or more; the
	// preflight requires a ticker, as a `Trade`'s.
	Holding: z.strictObject({
		account_id: id,
		security_id: id,
		ticker: present,
		security_name: present,
		exchange_operating_mic: z.string().nullable(),
		date,
		qty: unsigned,
		price: unsigned,
		amount: unsigned,
		currency,
		cost_basis: unsigned.nullable(),
		cost_basis_source: z.enum(["manual", "calculated", "provider"]).nullable(),
		cost_basis_locked: z.boolean(),
		security_locked: z.boolean(),
		archant,
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
		rolled_over_amount: unsigned,
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
	RecurringTransaction: {
		account_id: "accounts",
		merchant_id: "merchants",
		category_id: "categories",
	},
	RecurrenceRule: { recurring_transaction_id: "recurring_transactions" },
	Transaction: { account_id: "accounts", category_id: "categories", merchant_id: "merchants" },
	Transfer: { inflow_transaction_id: "transactions", outflow_transaction_id: "transactions" },
	RejectedTransfer: {
		inflow_transaction_id: "transactions",
		outflow_transaction_id: "transactions",
	},
	Trade: { account_id: "accounts" },
	Holding: { account_id: "accounts" },
	Valuation: { account_id: "accounts" },
	BudgetCategory: { budget_id: "budgets", category_id: "categories" },
};

type Row = { line: number; type: SureType; data: Record<string, unknown> };

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** A transaction's split lines, as far as they are objects; none for any other row. */
const splitLinesOf = (row: Row): Record<string, unknown>[] =>
	row.type === "Transaction"
		? z
				.array(z.record(z.string(), z.unknown()))
				.catch([])
				.parse(row.data["split_lines"] ?? [])
		: [];

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

			// `add_split_line_source_ids`: a split line's id is a transaction's too.
			for (const value of [row.data, ...splitLinesOf(row)].map((data) => text(data["id"]))) {
				const first = seen.get(value);

				if (first !== undefined) {
					problems.push(`line ${row.line} repeats the ${namespace} id of line ${first}`);
				}

				seen.set(value, row.line);
			}

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

	// A split line's references, as `validate_split_line_references` reads them.
	const subjects = rows.flatMap((row) => [
		{ row, type: row.type, data: row.data, references: REFERENCES[row.type] ?? {} },
		...splitLinesOf(row).map((data) => ({
			row,
			type: "Transaction split line",
			data,
			references: { category_id: "categories", merchant_id: "merchants" },
		})),
	]);

	for (const { row, type, data, references } of subjects) {
		const tags =
			row.type === "Transaction" ? z.array(z.string()).catch([]).parse(data["tag_ids"]) : [];

		for (const [field, namespace] of [
			...Object.entries(references),
			...tags.map((tag): [string, string] => [`tag_ids ${tag}`, "tags"]),
		]) {
			const value = field.startsWith("tag_ids ") ? field.slice(8) : text(data[field]);

			if (value !== "" && ids.get(namespace)?.has(value) !== true) {
				problems.push(`line ${row.line} ${type}.${field} points at no exported row`);
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
