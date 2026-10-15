import { z } from "zod";

import type {
	AccountDetails,
	AccountSubtype,
	AccountType,
	CreditCardDetails,
	LoanDetails,
	LoanRateChange,
	PropertyDetails,
	VehicleDetails,
} from "@archant/data/account-types";
import {
	ACCOUNT_SUBTYPES,
	ACCOUNT_TYPE_IDS,
	ACCOUNT_TYPES,
	AREA_UNITS,
	LOAN_INSURANCE_TYPES,
	LOAN_RATE_TYPES,
	MAX_LOAN_TERM_MONTHS,
	MILEAGE_UNITS,
	isAccountSubtype,
	isSubtypeOf,
} from "@archant/data/account-types";
import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode, parseAmount } from "@archant/data/money";

export const EARLIEST_OPENING_DATE = "1900-01-01";

/**
 * The date of an entry the owner types: a line, a trade or a snapshot. Any
 * day before the opening date goes, as in Sure, but not before 1900: each day
 * from the oldest entry on gets a balance row, and a year typo such as 0026
 * would write hundreds of thousands in one transaction.
 */
export const entryDateSchema = z.iso.date().refine((date) => date >= EARLIEST_OPENING_DATE, {
	message: "date_too_early",
	// A malformed date reports its format alone.
	when: (payload) => payload.issues.length === 0,
});

export const ACCOUNT_NAME_MAX_LENGTH = 100;

// One rule for creating and renaming, so a name the one accepts the other does too.
const accountName = z.string().trim().min(1).max(ACCOUNT_NAME_MAX_LENGTH);

// `invalid_subtype`, not the enum's `invalid_value`: a subtype no type has,
// such as a vehicle's `car`, is refused the way another type's subtype is.
const accountSubtype = z.custom<AccountSubtype>(isAccountSubtype, "invalid_subtype").nullable();

/**
 * A loan's details as typed. Every field is optional, and a blank one means
 * "not known": the outstanding balance is all a loan needs. Amounts, rates and
 * the term are text, as the opening balance: the amounts' minor units depend
 * on the currency, and a JavaScript number would already have rounded a rate.
 */
export const loanDetailsInputSchema = z.object({
	originalAmount: z.string().optional(),
	downPayment: z.string().optional(),
	startDate: z.string().optional(),
	termMonths: z.string().optional(),
	// Blank is "not known", as Sure's `rate_type` before it is chosen.
	rateType: z.enum(["", ...LOAN_RATE_TYPES]).optional(),
	interestRate: z.string().optional(),
	insuranceRate: z.string().optional(),
	insuranceRateType: z.enum(["", ...LOAN_INSURANCE_TYPES]).optional(),
	// One change a month at most is all a schedule can read.
	rateChanges: z
		.array(z.object({ effectiveDate: z.string(), rate: z.string() }))
		.max(MAX_LOAN_TERM_MONTHS)
		.optional(),
});

export type LoanDetailsInput = z.input<typeof loanDetailsInputSchema>;

export type LoanDetailsIssue = {
	field: keyof LoanDetailsInput;
	code:
		| "invalid_amount"
		| "invalid_rate"
		| "invalid_term"
		| "invalid_date"
		| "invalid_rate_change"
		| "rate_change_before_origination";
};

// An interest rate is quoted with three decimals, an insurance rate with four
// (0,2917 %); four decimals of a percent are six of one, so millionths hold
// either exactly. No sign, so a negative rate is refused with the rest: Sure's
// form never sends one, and the amortisation divides by zero at −1 200 %. A
// trailing `%` is accepted: the label says « (%) ».
export const INTEREST_RATE_DECIMALS = 3;
export const INSURANCE_RATE_DECIMALS = 4;

// Sure's `MAX_INTEREST_RATE`, 100 %, in millionths. Only a rate change is
// held to it, as Sure's `rate_changes=`; its `Loan` caps neither rate.
const MAX_RATE = 1_000_000;

/**
 * A percentage as typed into millionths of one, from the digits so no float
 * rounds it. Null when it is not a number or has more than `decimals`
 * decimals or `unitDigits` digits before them.
 */
function parsePercent(text: string, decimals: number, unitDigits: number): number | null {
	const match = new RegExp(
		`^(\\d{1,${unitDigits}})(?:[.,](\\d{1,${decimals}}))?(?:\\s*%)?$`,
		"u",
	).exec(text.trim());

	if (match === null) {
		return null;
	}

	const [, units = "", fraction = ""] = match;

	return Number(units) * 10_000 + Number(fraction.padEnd(4, "0"));
}

/**
 * A loan's interest rate as typed into millionths of one: `parseInterestRate("1,82")`
 * is 18200. Sure's `interest_rate` is a `decimal(10,3)` with no cap, so three
 * decimals and seven digits before them.
 */
export function parseInterestRate(text: string): number | null {
	return parsePercent(text, INTEREST_RATE_DECIMALS, 7);
}

/**
 * A loan's insurance rate as typed into millionths of one:
 * `parseInsuranceRate("0,2917")` is 2917. Sure's `insurance_rate` is a
 * `decimal(8,4)` with no cap, so four decimals and four digits before them.
 */
export function parseInsuranceRate(text: string): number | null {
	return parsePercent(text, INSURANCE_RATE_DECIMALS, 4);
}

/** A rate change's rate in millionths of one, null above 100 %. */
function parseRateChangeRate(text: string): number | null {
	const rate = parsePercent(text, INTEREST_RATE_DECIMALS, 3);

	return rate !== null && rate <= MAX_RATE ? rate : null;
}

/**
 * A card's APR as typed into millionths of one: `parseApr("15,99")` is
 * 159900. Sure's `apr` is a `decimal(10,2)` with no cap, so two decimals and
 * eight digits before them, below 100 000 000 %.
 */
export function parseApr(text: string): number | null {
	return parsePercent(text, 2, 8);
}

// Sure's `term_months` is an integer column its model never bounds: a provider
// writes terms its form would refuse, and the loan is saved unamortised. Nine
// digits stay within the column's 32 bits.
const TERM_PATTERN = /^\d{1,9}$/u;

const blank = (text: string | undefined) => text === undefined || text.trim() === "";

const isoDate = (text: string): string | null => {
	const parsed = z.iso.date().safeParse(text.trim());

	return parsed.success ? parsed.data : null;
};

/**
 * Reads typed loan details into what `accounts.details` stores, `endDate`
 * always null: a save replaces Story 7.1's end date with the term. `currency`
 * null means it is itself invalid, so the amounts cannot be judged yet and
 * are left unreported. `openingDate` is the account's, origination when no
 * start date is given; null leaves a rate change's date unchecked against it.
 * Whether the start date is after today needs the household's time zone, so
 * the service checks it. Only what Sure's `Loan` model and columns refuse is
 * refused: a term, an amount borrowed or a rate it cannot amortise is saved,
 * and `amortizationSchedule` declines it on read, as Sure's `amortizable?`.
 */
export function parseLoanDetails(
	input: LoanDetailsInput,
	currency: string | null,
	openingDate: string | null,
): { details: LoanDetails; issues: LoanDetailsIssue[] } {
	const issues: LoanDetailsIssue[] = [];
	const details: LoanDetails = {
		originalAmount: null,
		downPayment: null,
		startDate: null,
		termMonths: null,
		rateType: null,
		interestRate: null,
		insuranceRate: null,
		insuranceRateType: null,
		rateChanges: [],
		endDate: null,
	};

	if (!blank(input.originalAmount) && currency !== null) {
		const amount = parseAmount(input.originalAmount ?? "", currency);

		if (amount === null) {
			issues.push({ field: "originalAmount", code: "invalid_amount" });
		} else {
			details.originalAmount = amount;
		}
	}

	if (!blank(input.downPayment) && currency !== null) {
		const amount = parseAmount(input.downPayment ?? "", currency);

		if (amount === null || amount < 0) {
			issues.push({ field: "downPayment", code: "invalid_amount" });
		} else {
			details.downPayment = amount;
		}
	}

	if (!blank(input.startDate)) {
		details.startDate = isoDate(input.startDate ?? "");

		if (details.startDate === null) {
			issues.push({ field: "startDate", code: "invalid_date" });
		}
	}

	if (!blank(input.termMonths)) {
		const text = input.termMonths?.trim() ?? "";

		if (TERM_PATTERN.test(text)) {
			details.termMonths = Number(text);
		} else {
			issues.push({ field: "termMonths", code: "invalid_term" });
		}
	}

	if (input.rateType !== undefined && input.rateType !== "") {
		details.rateType = input.rateType;
	}

	if (!blank(input.interestRate)) {
		details.interestRate = parseInterestRate(input.interestRate ?? "");

		if (details.interestRate === null) {
			issues.push({ field: "interestRate", code: "invalid_rate" });
		}
	}

	if (!blank(input.insuranceRate)) {
		details.insuranceRate = parseInsuranceRate(input.insuranceRate ?? "");

		if (details.insuranceRate === null) {
			issues.push({ field: "insuranceRate", code: "invalid_rate" });
		}
	}

	if (input.insuranceRateType !== undefined && input.insuranceRateType !== "") {
		details.insuranceRateType = input.insuranceRateType;
	}

	const changes = parseRateChanges(input.rateChanges ?? []);
	details.rateChanges = changes.rateChanges;

	// Sure disables the rows of any other rate type, so nothing typed there is
	// refused: an invalid row is dropped, a valid one kept but never read.
	const followsChanges = details.rateType === "variable" || details.rateType === "adjustable";

	if (followsChanges && changes.incomplete) {
		issues.push({ field: "rateChanges", code: "invalid_rate_change" });
	}

	// Sure's `rate_changes_after_origination`, which a fixed rate skips.
	const origination = details.startDate ?? openingDate;

	if (
		followsChanges &&
		origination !== null &&
		details.rateChanges.some((change) => change.effectiveDate < origination)
	) {
		issues.push({ field: "rateChanges", code: "rate_change_before_origination" });
	}

	return { details, issues };
}

/**
 * Sure's `rate_changes=`: a row left empty is skipped, an incomplete or
 * invalid one makes the list invalid, and a date given twice keeps its last
 * rate. Sorted by date, the order the schedule reads them in.
 */
function parseRateChanges(rows: readonly { effectiveDate: string; rate: string }[]): {
	rateChanges: LoanRateChange[];
	incomplete: boolean;
} {
	const byDate = new Map<string, number>();
	let incomplete = false;

	for (const row of rows) {
		if (blank(row.effectiveDate) && blank(row.rate)) {
			continue;
		}

		const effectiveDate = isoDate(row.effectiveDate);
		const rate = parseRateChangeRate(row.rate);

		if (effectiveDate === null || rate === null) {
			incomplete = true;
		} else {
			byDate.set(effectiveDate, rate);
		}
	}

	const rateChanges = [...byDate]
		.map(([effectiveDate, rate]) => ({ effectiveDate, rate }))
		.toSorted((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

	return { rateChanges, incomplete };
}

/**
 * A credit card's details as typed, every one optional and a blank one "not
 * known", as Sure's `CreditCard` columns. Text, as a loan's: the amounts'
 * minor units depend on the currency, and a JavaScript number would already
 * have rounded the APR.
 */
export const creditCardDetailsInputSchema = z.object({
	availableCredit: z.string().optional(),
	minimumPayment: z.string().optional(),
	apr: z.string().optional(),
	expirationDate: z.string().optional(),
	annualFee: z.string().optional(),
});

export type CreditCardDetailsInput = z.input<typeof creditCardDetailsInputSchema>;

export type CreditCardDetailsIssue = {
	field: keyof CreditCardDetailsInput;
	code: "invalid_amount" | "invalid_rate" | "invalid_date";
};

const CREDIT_CARD_AMOUNTS = ["availableCredit", "minimumPayment", "annualFee"] as const;

/**
 * Reads typed card details into what `accounts.details` stores. Amounts are
 * in the account's currency and never negative, as Sure's `min: 0`; `currency`
 * null means it is itself invalid, so they are left unreported.
 */
export function parseCreditCardDetails(
	input: CreditCardDetailsInput,
	currency: string | null,
): { details: CreditCardDetails; issues: CreditCardDetailsIssue[] } {
	const issues: CreditCardDetailsIssue[] = [];
	const details: CreditCardDetails = {
		availableCredit: null,
		minimumPayment: null,
		apr: null,
		expirationDate: null,
		annualFee: null,
	};

	for (const field of CREDIT_CARD_AMOUNTS) {
		if (!blank(input[field]) && currency !== null) {
			const amount = parseAmount(input[field] ?? "", currency);

			if (amount === null || amount < 0) {
				issues.push({ field, code: "invalid_amount" });
			} else {
				details[field] = amount;
			}
		}
	}

	if (!blank(input.apr)) {
		details.apr = parseApr(input.apr ?? "");

		if (details.apr === null) {
			issues.push({ field: "apr", code: "invalid_rate" });
		}
	}

	if (!blank(input.expirationDate)) {
		details.expirationDate = isoDate(input.expirationDate ?? "");

		if (details.expirationDate === null) {
			issues.push({ field: "expirationDate", code: "invalid_date" });
		}
	}

	return { details, issues };
}

/**
 * A property's details as typed, every one optional and a blank one "not
 * known", as Sure's `Property` columns and its `Address`. Numbers are text, as
 * the form types them.
 */
export const propertyDetailsInputSchema = z.object({
	yearBuilt: z.string().optional(),
	areaValue: z.string().optional(),
	areaUnit: z.enum(AREA_UNITS).optional(),
	addressLine1: z.string().optional(),
	locality: z.string().optional(),
	region: z.string().optional(),
	postalCode: z.string().optional(),
	country: z.string().optional(),
});

export type PropertyDetailsInput = z.input<typeof propertyDetailsInputSchema>;

/** A vehicle's details as typed, every one optional, as Sure's `Vehicle` columns. */
export const vehicleDetailsInputSchema = z.object({
	make: z.string().optional(),
	model: z.string().optional(),
	year: z.string().optional(),
	mileageValue: z.string().optional(),
	mileageUnit: z.enum(MILEAGE_UNITS).optional(),
});

export type VehicleDetailsInput = z.input<typeof vehicleDetailsInputSchema>;

type DetailsIssue<Field extends string> = {
	field: Field;
	code: "invalid_number" | "too_long" | "invalid_year" | "invalid_area" | "invalid_mileage";
};

// Sure's string columns; a longer text is refused rather than cut.
const DETAIL_TEXT_MAX_LENGTH = 255;

// Sure's integer columns, which its models never bound: nine digits stay
// within their 32 bits.
const INTEGER_PATTERN = /^-?\d{1,9}$/u;

/** Reads typed integers and texts, blank as null, collecting each refusal. */
function detailReader<Field extends string>(
	input: Partial<Record<Field, string | undefined>>,
	issues: DetailsIssue<Field>[],
) {
	return {
		integer(field: Field): number | null {
			const text = input[field]?.trim() ?? "";

			if (text === "") {
				return null;
			}

			if (!INTEGER_PATTERN.test(text)) {
				issues.push({ field, code: "invalid_number" });

				return null;
			}

			return Number(text);
		},
		text(field: Field): string | null {
			const text = input[field]?.trim() ?? "";

			if (text.length > DETAIL_TEXT_MAX_LENGTH) {
				issues.push({ field, code: "too_long" });
			}

			return text === "" ? null : text;
		},
	};
}

type PropertyField = keyof PropertyDetailsInput;
type VehicleField = keyof VehicleDetailsInput;

/**
 * Reads typed property details into what `accounts.details` stores. Only a
 * number that is not an integer, or a text longer than Sure's column, is
 * refused: Sure's `Property` validates nothing more.
 */
function parsePropertyDetails(input: PropertyDetailsInput): {
	details: PropertyDetails;
	issues: DetailsIssue<PropertyField>[];
} {
	const issues: DetailsIssue<PropertyField>[] = [];
	const read = detailReader<PropertyField>(input, issues);
	const details: PropertyDetails = {
		yearBuilt: read.integer("yearBuilt"),
		areaValue: read.integer("areaValue"),
		areaUnit: input.areaUnit ?? "sqm",
		addressLine1: read.text("addressLine1"),
		locality: read.text("locality"),
		region: read.text("region"),
		postalCode: read.text("postalCode"),
		country: read.text("country"),
	};

	return { details, issues };
}

/** Reads typed vehicle details into what `accounts.details` stores, as a property's. */
function parseVehicleDetails(input: VehicleDetailsInput): {
	details: VehicleDetails;
	issues: DetailsIssue<VehicleField>[];
} {
	const issues: DetailsIssue<VehicleField>[] = [];
	const read = detailReader<VehicleField>(input, issues);
	const details: VehicleDetails = {
		make: read.text("make"),
		model: read.text("model"),
		year: read.integer("year"),
		mileageValue: read.integer("mileageValue"),
		mileageUnit: input.mileageUnit ?? "km",
	};

	return { details, issues };
}

/**
 * Every type's details, in one object so a form can keep them all while the
 * type changes; a field of another type is refused (`parseAccountDetails`).
 */
const accountDetailsInputSchema = loanDetailsInputSchema
	.extend(creditCardDetailsInputSchema.shape)
	.extend(propertyDetailsInputSchema.shape)
	.extend(vehicleDetailsInputSchema.shape);

type AccountDetailsInput = z.input<typeof accountDetailsInputSchema>;

/** What a type's details are read against: the account's currency and opening date, null when invalid. */
type DetailsContext = { currency: string | null; openingDate: string | null };

type ParsedDetails = { details: AccountDetails; issues: { field: string; code: string }[] };

/**
 * The types that carry details, each with its fields and its reader. `dialog`
 * adds what Sure's form bounds in the browser beyond its model, so a value
 * the dialog accepts is one the API accepts too.
 */
const DETAILS_BY_TYPE = {
	loan: {
		fields: loanDetailsInputSchema.keyof().options,
		parse: (input: AccountDetailsInput, context: DetailsContext, dialog: boolean) => {
			const parsed = parseLoanDetails(input, context.currency, context.openingDate);
			const { termMonths } = parsed.details;

			// The `min` and `max` of Sure's `loans/_form` term field; the API saves
			// any term, which a provider may write.
			return dialog && termMonths !== null && (termMonths < 1 || termMonths > MAX_LOAN_TERM_MONTHS)
				? {
						details: parsed.details,
						issues: [{ field: "termMonths", code: "invalid_term" }, ...parsed.issues],
					}
				: parsed;
		},
	},
	credit_card: {
		fields: creditCardDetailsInputSchema.keyof().options,
		parse: (input: AccountDetailsInput, context: DetailsContext) =>
			parseCreditCardDetails(input, context.currency),
	},
	property: {
		fields: propertyDetailsInputSchema.keyof().options,
		parse: (input: AccountDetailsInput, _context: DetailsContext, dialog: boolean) => {
			const parsed = parsePropertyDetails(input);
			const { yearBuilt, areaValue } = parsed.details;
			const issues: ParsedDetails["issues"] = [...parsed.issues];

			// The `min` and `max` of Sure's `properties/_form` fields.
			if (dialog && yearBuilt !== null && (yearBuilt < 1500 || yearBuilt > currentYear())) {
				issues.push({ field: "yearBuilt", code: "invalid_year" });
			}

			if (dialog && areaValue !== null && areaValue < 0) {
				issues.push({ field: "areaValue", code: "invalid_area" });
			}

			return { details: parsed.details, issues };
		},
	},
	vehicle: {
		fields: vehicleDetailsInputSchema.keyof().options,
		parse: (input: AccountDetailsInput, _context: DetailsContext, dialog: boolean) => {
			const parsed = parseVehicleDetails(input);
			const { year, mileageValue } = parsed.details;
			const issues: ParsedDetails["issues"] = [...parsed.issues];

			// The `min` and `max` of Sure's `vehicles/_form` fields.
			if (dialog && year !== null && (year < 1900 || year > currentYear() + 1)) {
				issues.push({ field: "year", code: "invalid_year" });
			}

			if (dialog && mileageValue !== null && mileageValue < 0) {
				issues.push({ field: "mileageValue", code: "invalid_mileage" });
			}

			return { details: parsed.details, issues };
		},
	},
} satisfies Partial<
	Record<
		AccountType,
		{
			fields: readonly (keyof AccountDetailsInput)[];
			parse: (
				input: AccountDetailsInput,
				context: DetailsContext,
				dialog: boolean,
			) => ParsedDetails;
		}
	>
>;

// Sure's `Time.current.year`, the browser's in the dialog.
const currentYear = () => new Date().getFullYear();

function hasDetails(type: AccountType): type is keyof typeof DETAILS_BY_TYPE {
	return Object.hasOwn(DETAILS_BY_TYPE, type);
}

/**
 * Reads details for an account of `type`. Null when the type carries none or
 * the details give a field of another type: `invalid_details`.
 */
export function parseAccountDetails(
	type: AccountType,
	input: AccountDetailsInput,
	context: DetailsContext,
	dialog = false,
): ParsedDetails | null {
	if (!hasDetails(type)) {
		return null;
	}

	const own: readonly string[] = DETAILS_BY_TYPE[type].fields;
	const foreign = Object.entries(input).some(
		([field, value]) => value !== undefined && !own.includes(field),
	);

	return foreign ? null : DETAILS_BY_TYPE[type].parse(input, context, dialog);
}

/** Reports details the account's type does not take, else each invalid one under `details.<field>`. */
function reportDetailsIssues(
	context: z.RefinementCtx,
	account: { type: unknown; currency: unknown; openingDate: unknown },
	details: AccountDetailsInput,
	dialog: boolean,
): void {
	const type =
		typeof account.type === "string" && Object.hasOwn(ACCOUNT_TYPES, account.type)
			? ACCOUNT_TYPE_IDS.find((id) => id === account.type)
			: undefined;
	const parsed =
		type === undefined
			? null
			: parseAccountDetails(
					type,
					details,
					{
						currency:
							typeof account.currency === "string" && isCurrencyCode(account.currency)
								? account.currency
								: null,
						openingDate:
							typeof account.openingDate === "string" &&
							z.iso.date().safeParse(account.openingDate).success
								? account.openingDate
								: null,
					},
					dialog,
				);

	if (parsed === null) {
		context.addIssue({ code: "custom", path: ["details"], message: "invalid_details" });

		return;
	}

	for (const issue of parsed.issues) {
		context.addIssue({ code: "custom", path: ["details", issue.field], message: issue.code });
	}
}

/**
 * An account's creation. `dialog` adds the bounds Sure's form sets in the
 * browser, so a value the dialog accepts is a value the API accepts, with the
 * same field codes. Custom issues carry their field code as their message
 * (lib/zod-error.ts).
 */
const accountCreationSchema = (dialog: boolean) =>
	z
		.object({
			name: accountName,
			type: z.enum(ACCOUNT_TYPE_IDS),
			subtype: accountSubtype,
			currency: z.custom<CurrencyCode>(
				(value) => typeof value === "string" && isCurrencyCode(value),
				"invalid_currency",
			),
			// Text, not a number: the minor units depend on the currency, and a
			// JavaScript number would already have rounded the input.
			openingBalance: z.string(),
			// Every day from the opening date gets a balance row, written under the
			// write lock: year 1 would mean 740 000 rows in one transaction.
			openingDate: z.iso.date().refine((date) => date >= EARLIEST_OPENING_DATE, "date_too_early"),
			// A loan's, a credit card's, a property's or a vehicle's only; any
			// other type refuses them.
			details: accountDetailsInputSchema.optional(),
		})
		// Runs even when another field failed, so the form shows every error at
		// once. Each check guards on the fields it reads being valid themselves.
		.superRefine((value, context) => {
			if (
				Object.hasOwn(ACCOUNT_TYPES, value.type) &&
				(value.subtype === null || isAccountSubtype(value.subtype)) &&
				!isSubtypeOf(value.type, value.subtype)
			) {
				context.addIssue({ code: "custom", path: ["subtype"], message: "invalid_subtype" });
			}

			if (
				typeof value.currency === "string" &&
				isCurrencyCode(value.currency) &&
				typeof value.openingBalance === "string" &&
				parseAmount(value.openingBalance, value.currency) === null
			) {
				context.addIssue({ code: "custom", path: ["openingBalance"], message: "invalid_amount" });
			}

			if (value.details !== undefined) {
				reportDetailsIssues(context, value, value.details, dialog);
			}
		})
		.transform((value, context) => {
			const openingBalance = parseAmount(value.openingBalance, value.currency);

			if (openingBalance === null) {
				// Already reported by the refinement above; kept so the output type
				// never has to pretend.
				context.addIssue({ code: "custom", path: ["openingBalance"], message: "invalid_amount" });

				return z.NEVER;
			}

			// A type with details always stores them, each null until known;
			// other types none.
			const details =
				parseAccountDetails(value.type, value.details ?? {}, {
					currency: value.currency,
					openingDate: value.openingDate,
				})?.details ?? null;

			return { ...value, openingBalance, details };
		});

export const createAccountSchema = accountCreationSchema(false);

/** The creation dialog's: the API's checks and the bounds of Sure's forms. */
export const createAccountFormSchema = accountCreationSchema(true);

export type CreateAccountInput = z.input<typeof createAccountSchema>;
export type CreateAccountRequest = z.output<typeof createAccountSchema>;

/**
 * An edit of an account's settings: any non-empty subset of these fields.
 * Type and currency are fixed at creation; the opening balance has its own
 * route, `PATCH /api/accounts/:id/opening-balance`. Whether `subtype`
 * fits the account needs its stored type, so the service checks it and raises
 * the same `invalid_subtype` field error as creation. `details` likewise: the
 * service refuses one type's on an account of another, and parses them in
 * the account's currency. They replace the stored details
 * whole, so every field of their type is required, a blank one clearing its
 * value: a partial object would otherwise clear the fields it left out
 * without saying so. `treatBalanceAsAvailableCredit` is the card's bank
 * account's, ignored on any other account, as Sure's.
 */
export const updateAccountSchema = z
	.object({
		name: accountName.optional(),
		subtype: accountSubtype.optional(),
		active: z.boolean().optional(),
		excludedFromReports: z.boolean().optional(),
		details: z
			.union([
				loanDetailsInputSchema.required(),
				creditCardDetailsInputSchema.required(),
				propertyDetailsInputSchema.required(),
				vehicleDetailsInputSchema.required(),
			])
			.optional(),
		treatBalanceAsAvailableCredit: z.boolean().optional(),
	})
	.refine((value) => Object.values(value).some((field) => field !== undefined), "empty_patch");

export type UpdateAccountInput = z.input<typeof updateAccountSchema>;
export type UpdateAccountRequest = z.output<typeof updateAccountSchema>;

/**
 * The account's edit dialog: the name and subtype as typed, the exclusion
 * switch, its type's details, checked the way the API checks them plus the
 * bounds of Sure's forms, and a linked card's toggle. The
 * account's currency decides how many decimals the amounts may have, and its
 * opening date is origination when the loan gives no start date.
 */
export function accountSettingsFormSchema(account: {
	type: string;
	currency: string;
	openingDate: string;
}) {
	return z
		.object({
			name: accountName,
			subtype: z.enum(ACCOUNT_SUBTYPES).nullable(),
			excludedFromReports: z.boolean(),
			details: accountDetailsInputSchema.optional(),
			treatBalanceAsAvailableCredit: z.boolean().optional(),
		})
		.superRefine((value, context) => {
			if (value.details !== undefined) {
				reportDetailsIssues(context, account, value.details, true);
			}
		});
}

export type AccountSettingsFormInput = z.input<ReturnType<typeof accountSettingsFormSchema>>;
