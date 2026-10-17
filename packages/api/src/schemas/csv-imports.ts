import { z } from "zod";

import { ACCOUNT_SUBTYPES, ACCOUNT_TYPE_IDS } from "@archant/data/account-types";

// Sure's CSV imports at 00dd977fb: the raw-data `TransactionImport`,
// `AccountImport`, `CategoryImport`, `MerchantImport`, `RuleImport` and
// `TradeImport`, and the financial tools' `MintImport`, `YnabImport` and
// `ActualImport`, their choices and limits. Shared with the interface, which
// lists the same choices in « Configurer ».

/** The six sources of « Données brutes », then Sure's three financial tools, as the routes name them. */
export const CSV_IMPORT_TYPES = [
	"transactions",
	"accounts",
	"categories",
	"merchants",
	"rules",
	"trades",
	"mint",
	"ynab",
	"actual",
] as const;

export type CsvImportType = (typeof CSV_IMPORT_TYPES)[number];

/** Sure's financial tools whose export is a transactions CSV with its columns already mapped. */
export const TOOL_IMPORT_TYPES = ["mint", "ynab", "actual"] as const;

export type ToolImportType = (typeof TOOL_IMPORT_TYPES)[number];

export const isToolImport = (type: CsvImportType): type is ToolImportType =>
	TOOL_IMPORT_TYPES.some((tool) => tool === type);

/** Sure's `Import::SEPARATORS`, the comma first and by default. */
export const CSV_SEPARATORS = [",", ";"] as const;

export type CsvSeparator = (typeof CSV_SEPARATORS)[number];

/** Sure's `Import::NUMBER_FORMATS` keys, in its order; the first is its default. */
export const NUMBER_FORMATS = ["1,234.56", "1.234,56", "1 234,56", "1,234"] as const;

export type NumberFormat = (typeof NUMBER_FORMATS)[number];

/** Sure's `Family::DATE_FORMATS`: a label and its `strptime` format, in its order. */
export const DATE_FORMATS = [
	["MM-DD-YYYY", "%m-%d-%Y"],
	["DD.MM.YYYY", "%d.%m.%Y"],
	["DD-MM-YYYY", "%d-%m-%Y"],
	["YYYY-MM-DD", "%Y-%m-%d"],
	["DD/MM/YYYY", "%d/%m/%Y"],
	["YYYY/MM/DD", "%Y/%m/%d"],
	["MM/DD/YYYY", "%m/%d/%Y"],
	["D/MM/YYYY", "%e/%m/%Y"],
	["YYYY.MM.DD", "%Y.%m.%d"],
	["YYYYMMDD", "%Y%m%d"],
	["DD MMM YYYY", "%d %b %Y"],
] as const;

/**
 * Sure's `Import::CSV_ONLY_DATE_FORMATS`: a two-digit year is ambiguous, so
 * Sure offers it only where the file's own dates show beside it, in the
 * account and transaction imports' forms.
 */
export const CSV_ONLY_DATE_FORMATS = [["DD/MM/YY", "%d/%m/%y"]] as const;

const STRPTIME_FORMATS: ReadonlySet<string> = new Set(
	[...DATE_FORMATS, ...CSV_ONLY_DATE_FORMATS].map(([, format]) => format),
);

/** Sure's fallback when no format reads the file's dates, `detect_date_format`'s. */
export const DEFAULT_DATE_FORMAT = "%Y-%m-%d";

/** The date formats « Format des dates » offers for an import of `type`. */
export function dateFormatsOf(type: CsvImportType): readonly (readonly [string, string])[] {
	return type === "accounts" || type === "transactions"
		? [...DATE_FORMATS, ...CSV_ONLY_DATE_FORMATS]
		: DATE_FORMATS;
}

/**
 * Sure's `SIGNAGE_CONVENTIONS`: for trades « Les achats sont en quantité
 * positive » or « négative », for transactions « Les revenus sont positifs »
 * or « négatifs », and for a type column's value « Revenu (entrée) » or
 * « Dépense (sortie) ».
 */
export const SIGNAGE_CONVENTIONS = ["inflows_positive", "inflows_negative"] as const;

export type SignageConvention = (typeof SIGNAGE_CONVENTIONS)[number];

/**
 * Sure's `AMOUNT_TYPE_STRATEGIES`: a transaction's sign from the amount
 * itself, or from a type column whose one value marks one side.
 */
export const AMOUNT_TYPE_STRATEGIES = ["signed_amount", "custom_column"] as const;

export type AmountTypeStrategy = (typeof AMOUNT_TYPE_STRATEGIES)[number];

/**
 * Sure's `column_keys` of the imports « Configurer » maps by column, in its
 * form's order; a tool's are those its `DEFAULT_COLUMN_MAPPINGS` reads,
 * Mint's notes included though its form does not show them.
 */
export const COLUMN_KEYS = {
	transactions: [
		"date",
		"amount",
		"currency",
		"entity_type",
		"account",
		"name",
		"category",
		"tags",
		"notes",
	],
	accounts: ["entity_type", "name", "amount", "currency", "date"],
	trades: [
		"date",
		"qty",
		"currency",
		"ticker",
		"exchange_operating_mic",
		"price",
		"account",
		"name",
	],
	mint: ["date", "amount", "currency", "account", "name", "category", "tags", "notes"],
	ynab: ["date", "account", "name", "category", "notes"],
	actual: ["date", "amount", "account", "name", "category", "notes"],
} as const;

export type ColumnKey = (typeof COLUMN_KEYS)[keyof typeof COLUMN_KEYS][number];

/** Every key « Configurer » maps, whatever the import. */
export const COLUMN_KEY_LIST = [
	...new Set<ColumnKey>([
		...COLUMN_KEYS.transactions,
		...COLUMN_KEYS.accounts,
		...COLUMN_KEYS.trades,
		...COLUMN_KEYS.mint,
	]),
];

/**
 * Every refusal the raw-data imports report on a line or a mapping, closed so
 * the page that translates them cannot fall out of step with the server.
 */
export const CSV_ISSUE_CODES = [
	"duplicate_headers",
	"missing_columns",
	"required",
	"invalid_number",
	"invalid_date",
	"date_out_of_range",
	"invalid_currency",
	"CURRENCY_MISMATCH",
	"too_many_tags",
	"custom_column_requires_inflow",
	"negative_price",
	"trade_too_large",
	"security_currency",
	"own_parent",
	"nested_category",
	"unsupported_resource_type",
	"invalid_json",
	"min_actions",
	"unsupported_rule",
	"unmapped_account_type",
	"unmapped_account",
] as const;

export type CsvIssueCode = (typeof CSV_ISSUE_CODES)[number];

/** Sure's `Import::MAX_CSV_SIZE`, 10 MB. */
export const MAX_CSV_BYTES = 10 * 1024 * 1024;

/** Sure's `max_row_count`: 50 rows for accounts, 10,000 for every other import. */
export function maxRowsOf(type: CsvImportType): number {
	return type === "accounts" ? 50 : 10_000;
}

/**
 * Sure's `Import::Mapping::CREATE_NEW_KEY`: « Ajouter comme nouveau compte »,
 * « … nouvelle catégorie » or « … nouvelle étiquette ».
 */
export const CREATE_NEW_KEY = "internal_new_resource";

/** Sure's `rows_to_skip` has no bound but the file; this one keeps a request's work small. */
export const MAX_ROWS_TO_SKIP = 1000;

/** A file's distinct values to map stay far below this; a bound on what a request carries. */
const MAX_MAPPINGS = 10_000;

/** A form field holding JSON text, parsed by `schema`; a text that is no JSON is `invalid_json`. */
function jsonText<Schema extends z.ZodType>(schema: Schema) {
	return z
		.string()
		.transform((text, context): unknown => {
			try {
				return JSON.parse(text) as unknown;
			} catch {
				context.addIssue({ code: "custom", message: "invalid_json" });

				return z.NEVER;
			}
		})
		.pipe(schema);
}

/**
 * What « Téléverser » and « Configurer » chose. An absent choice takes
 * Sure's default, or what the file suggests: a column whose header is the
 * key or one of Sure's aliases, the date format `detect_date_format` finds.
 * A column set to `null` is « Laisser vide ».
 */
export const csvImportConfigurationSchema = z.object({
	separator: z.enum(CSV_SEPARATORS).optional(),
	numberFormat: z.enum(NUMBER_FORMATS).optional(),
	dateFormat: z
		.string()
		.refine((format) => STRPTIME_FORMATS.has(format), "invalid_value")
		.optional(),
	signage: z.enum(SIGNAGE_CONVENTIONS).optional(),
	/** « Ignorer les n premières lignes » of a transaction import: raw lines dropped before the headers. */
	rowsToSkip: z.number().int().min(0).max(MAX_ROWS_TO_SKIP).optional(),
	/** « Stratégie de type de montant » of a transaction import. */
	amountTypeStrategy: z.enum(AMOUNT_TYPE_STRATEGIES).optional(),
	/** The type column's value that marks one side, Sure's `amount_type_identifier_value`. */
	amountTypeIdentifier: z.string().nullable().optional(),
	/** What that value is, Sure's `amount_type_inflow_value`: « Revenu (entrée) » or « Dépense (sortie) ». */
	amountTypeInflow: z.enum(SIGNAGE_CONVENTIONS).nullable().optional(),
	/** « Compte (facultatif) » of a transaction or trade import; `null` is « Importation multi-comptes ». */
	accountId: z.string().min(1).nullable().optional(),
	columns: z.partialRecord(z.enum(COLUMN_KEY_LIST), z.string().nullable()).optional(),
});

export type CsvImportConfigurationInput = z.input<typeof csvImportConfigurationSchema>;

/** One value of the file mapped to a row of the household, `CREATE_NEW_KEY`, or none. */
const valueMappingsSchema = z
	.array(z.object({ key: z.string(), value: z.string().min(1).nullable() }))
	.max(MAX_MAPPINGS);

/**
 * « Mapper »: each type value of an account file to an Archant type and
 * subtype; each account name of a trade or transaction file to an account or
 * to `CREATE_NEW_KEY`; each category and tag of a transaction file to one of
 * the household's, `CREATE_NEW_KEY` or none. A key the file holds and the
 * list lacks takes the preselection; `null` is no choice, which only a
 * category or a tag may keep.
 */
export const csvImportMappingsSchema = z.object({
	accountTypes: z
		.array(
			z.object({
				key: z.string(),
				type: z.enum(ACCOUNT_TYPE_IDS).nullable(),
				subtype: z.enum(ACCOUNT_SUBTYPES).nullable(),
			}),
		)
		.max(MAX_MAPPINGS)
		.optional(),
	accounts: valueMappingsSchema.optional(),
	categories: valueMappingsSchema.optional(),
	tags: valueMappingsSchema.optional(),
});

export type CsvImportMappingsInput = z.input<typeof csvImportMappingsSchema>;

/**
 * `multipart/form-data`: the import's `type`, its `file`, and the choices of
 * « Configurer » and « Mapper » as JSON text, absent before they are made.
 */
export const csvImportUploadSchema = z.object({
	type: z.enum(CSV_IMPORT_TYPES),
	file: z.instanceof(File),
	configuration: jsonText(csvImportConfigurationSchema).optional(),
	mappings: jsonText(csvImportMappingsSchema).optional(),
});
