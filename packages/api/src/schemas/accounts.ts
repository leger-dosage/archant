import { z } from "zod";

import type { AccountSubtype, LoanDetails, LoanRateChange } from "@archant/data/account-types";
import {
	ACCOUNT_SUBTYPES,
	ACCOUNT_TYPE_IDS,
	ACCOUNT_TYPES,
	LOAN_INSURANCE_TYPES,
	LOAN_RATE_TYPES,
	MAX_LOAN_TERM_MONTHS,
	isAccountSubtype,
	isSubtypeOf,
} from "@archant/data/account-types";
import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode, parseAmount } from "@archant/data/money";

export const EARLIEST_OPENING_DATE = "1900-01-01";

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
// either exactly. No sign, so a negative rate is refused with the rest. A
// trailing `%` is accepted: the label says « (%) ».
export const INTEREST_RATE_DECIMALS = 3;
export const INSURANCE_RATE_DECIMALS = 4;

// Sure's `MAX_INTEREST_RATE`, 100 %, in millionths.
const MAX_RATE = 1_000_000;

/**
 * A percentage as typed into millionths of one, from the digits so no float
 * rounds it: `parseRate("1,82", 3)` is 18200, `parseRate("0,2917", 4)` is 2917.
 * Null when it is not a number, has more than `decimals` decimals, or is
 * above 100 %.
 */
export function parseRate(text: string, decimals: number): number | null {
	const match = new RegExp(`^(\\d{1,3})(?:[.,](\\d{1,${decimals}}))?(?:\\s*%)?$`, "u").exec(
		text.trim(),
	);

	if (match === null) {
		return null;
	}

	const [, units = "", fraction = ""] = match;
	const rate = Number(units) * 10_000 + Number(fraction.padEnd(4, "0"));

	return rate <= MAX_RATE ? rate : null;
}

const TERM_PATTERN = /^\d{1,4}$/u;

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
 * the service checks it.
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

		if (amount === null || amount <= 0) {
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
		const months = TERM_PATTERN.test(text) ? Number(text) : 0;

		if (months >= 1 && months <= MAX_LOAN_TERM_MONTHS) {
			details.termMonths = months;
		} else {
			issues.push({ field: "termMonths", code: "invalid_term" });
		}
	}

	if (input.rateType !== undefined && input.rateType !== "") {
		details.rateType = input.rateType;
	}

	if (!blank(input.interestRate)) {
		details.interestRate = parseRate(input.interestRate ?? "", INTEREST_RATE_DECIMALS);

		if (details.interestRate === null) {
			issues.push({ field: "interestRate", code: "invalid_rate" });
		}
	}

	if (!blank(input.insuranceRate)) {
		details.insuranceRate = parseRate(input.insuranceRate ?? "", INSURANCE_RATE_DECIMALS);

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
		const rate = parseRate(row.rate, INTEREST_RATE_DECIMALS);

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

/** Adds each invalid loan detail to a schema's issues, under `details.<field>`. */
function reportLoanDetailsIssues(
	context: z.RefinementCtx,
	details: LoanDetailsInput,
	currency: unknown,
	openingDate: unknown,
): void {
	const validCurrency = typeof currency === "string" && isCurrencyCode(currency) ? currency : null;
	const validOpeningDate =
		typeof openingDate === "string" && z.iso.date().safeParse(openingDate).success
			? openingDate
			: null;

	for (const issue of parseLoanDetails(details, validCurrency, validOpeningDate).issues) {
		context.addIssue({ code: "custom", path: ["details", issue.field], message: issue.code });
	}
}

// Shared with the interface, whose form resolver runs this same schema, so a
// value the form accepts is a value the API accepts, with the same field codes.
// Custom issues carry their field code as their message (lib/zod-error.ts).
export const createAccountSchema = z
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
		// A loan's only; any other type refuses them.
		details: loanDetailsInputSchema.optional(),
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
			if (value.type !== "loan") {
				context.addIssue({ code: "custom", path: ["details"], message: "invalid_details" });
			} else {
				reportLoanDetailsIssues(context, value.details, value.currency, value.openingDate);
			}
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

		// A loan always stores its details, each null until known; other types none.
		const details =
			value.type === "loan"
				? parseLoanDetails(value.details ?? {}, value.currency, value.openingDate).details
				: null;

		return { ...value, openingBalance, details };
	});

export type CreateAccountInput = z.input<typeof createAccountSchema>;
export type CreateAccountRequest = z.output<typeof createAccountSchema>;

/**
 * An edit of an account's settings: any non-empty subset of these fields.
 * Type, currency and opening balance are fixed at creation. Whether `subtype`
 * fits the account needs its stored type, so the service checks it and raises
 * the same `invalid_subtype` field error as creation. `details` likewise: the
 * service refuses it on a non-loan and parses it in the account's currency.
 * It replaces the stored details whole, so every field is required, a
 * blank one clearing its value: a partial object would otherwise clear the
 * fields it left out without saying so.
 */
export const updateAccountSchema = z
	.object({
		name: accountName.optional(),
		subtype: accountSubtype.optional(),
		active: z.boolean().optional(),
		excludedFromReports: z.boolean().optional(),
		details: loanDetailsInputSchema.required().optional(),
	})
	.refine((value) => Object.values(value).some((field) => field !== undefined), "empty_patch");

export type UpdateAccountInput = z.input<typeof updateAccountSchema>;
export type UpdateAccountRequest = z.output<typeof updateAccountSchema>;

/**
 * The account's edit dialog: the name and subtype as typed, the exclusion switch,
 * and a loan's details, checked the way the API checks them. The account's
 * currency decides how many decimals the amounts may have, and its opening
 * date is origination when the loan gives no start date.
 */
export function accountSettingsFormSchema(currency: string, openingDate: string) {
	return z
		.object({
			name: accountName,
			subtype: z.enum(ACCOUNT_SUBTYPES).nullable(),
			excludedFromReports: z.boolean(),
			details: loanDetailsInputSchema.optional(),
		})
		.superRefine((value, context) => {
			if (value.details === undefined) {
				return;
			}

			reportLoanDetailsIssues(context, value.details, currency, openingDate);
		});
}

export type AccountSettingsFormInput = z.input<ReturnType<typeof accountSettingsFormSchema>>;
