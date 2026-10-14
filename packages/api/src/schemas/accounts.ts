import { z } from "zod";

import type {
	AccountSubtype,
	CreditCardDetails,
	LoanDetails,
	LoanRateChange,
} from "@archant/data/account-types";
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
// either exactly. No sign, so a negative rate is refused with the rest. A
// trailing `%` is accepted: the label says « (%) ».
export const INTEREST_RATE_DECIMALS = 3;
export const INSURANCE_RATE_DECIMALS = 4;

// Sure's `MAX_INTEREST_RATE`, 100 %, in millionths.
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
 * A loan's rate as typed into millionths of one: `parseRate("1,82", 3)` is
 * 18200, `parseRate("0,2917", 4)` is 2917. Null when it is not a number, has
 * more than `decimals` decimals, or is above 100 %.
 */
export function parseRate(text: string, decimals: number): number | null {
	const rate = parsePercent(text, decimals, 3);

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

/** Adds each invalid card detail to a schema's issues, under `details.<field>`. */
function reportCreditCardDetailsIssues(
	context: z.RefinementCtx,
	details: CreditCardDetailsInput,
	currency: unknown,
): void {
	const validCurrency = typeof currency === "string" && isCurrencyCode(currency) ? currency : null;

	for (const issue of parseCreditCardDetails(details, validCurrency).issues) {
		context.addIssue({ code: "custom", path: ["details", issue.field], message: issue.code });
	}
}

/**
 * Either type's details, in one object so a form can keep both while the type
 * changes; a field of the other type is refused (`hasForeignDetails`).
 */
const accountDetailsInputSchema = loanDetailsInputSchema.extend(creditCardDetailsInputSchema.shape);

type AccountDetailsInput = z.input<typeof accountDetailsInputSchema>;

const LOAN_DETAIL_FIELDS = loanDetailsInputSchema.keyof().options;
const CREDIT_CARD_DETAIL_FIELDS = creditCardDetailsInputSchema.keyof().options;

/** Whether details give a field the account's type does not have. */
function hasForeignDetails(type: "loan" | "credit_card", details: AccountDetailsInput): boolean {
	const foreign: readonly (keyof AccountDetailsInput)[] =
		type === "loan" ? CREDIT_CARD_DETAIL_FIELDS : LOAN_DETAIL_FIELDS;

	return foreign.some((field) => details[field] !== undefined);
}

/** Reports details on a type without any, or with another type's fields, else each invalid one. */
function reportDetailsIssues(
	context: z.RefinementCtx,
	account: { type: unknown; currency: unknown; openingDate: unknown },
	details: AccountDetailsInput,
): void {
	if (
		(account.type !== "loan" && account.type !== "credit_card") ||
		hasForeignDetails(account.type, details)
	) {
		context.addIssue({ code: "custom", path: ["details"], message: "invalid_details" });
	} else if (account.type === "loan") {
		reportLoanDetailsIssues(context, details, account.currency, account.openingDate);
	} else {
		reportCreditCardDetailsIssues(context, details, account.currency);
	}
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
		// A loan's or a credit card's only; any other type refuses them.
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
			reportDetailsIssues(context, value, value.details);
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

		// A loan and a card always store their details, each null until known;
		// other types none.
		const details =
			value.type === "loan"
				? parseLoanDetails(value.details ?? {}, value.currency, value.openingDate).details
				: value.type === "credit_card"
					? parseCreditCardDetails(value.details ?? {}, value.currency).details
					: null;

		return { ...value, openingBalance, details };
	});

export type CreateAccountInput = z.input<typeof createAccountSchema>;
export type CreateAccountRequest = z.output<typeof createAccountSchema>;

/**
 * An edit of an account's settings: any non-empty subset of these fields.
 * Type and currency are fixed at creation; the opening balance has its own
 * route, `PATCH /api/accounts/:id/opening-balance`. Whether `subtype`
 * fits the account needs its stored type, so the service checks it and raises
 * the same `invalid_subtype` field error as creation. `details` likewise: the
 * service refuses a loan's on any other account and a card's likewise, and
 * parses them in the account's currency. They replace the stored details
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
			.union([loanDetailsInputSchema.required(), creditCardDetailsInputSchema.required()])
			.optional(),
		treatBalanceAsAvailableCredit: z.boolean().optional(),
	})
	.refine((value) => Object.values(value).some((field) => field !== undefined), "empty_patch");

export type UpdateAccountInput = z.input<typeof updateAccountSchema>;
export type UpdateAccountRequest = z.output<typeof updateAccountSchema>;

/** Whether details sent for an update are a card's rather than a loan's. */
export function isCreditCardDetailsInput(
	details: NonNullable<UpdateAccountRequest["details"]>,
): details is Extract<NonNullable<UpdateAccountRequest["details"]>, { availableCredit: string }> {
	return "availableCredit" in details;
}

/**
 * The account's edit dialog: the name and subtype as typed, the exclusion
 * switch, a loan's or a card's details, checked the way the API checks them,
 * and a linked card's toggle. The account's currency decides how many
 * decimals the amounts may have, and its opening date is origination when
 * the loan gives no start date.
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
				reportDetailsIssues(context, account, value.details);
			}
		});
}

export type AccountSettingsFormInput = z.input<ReturnType<typeof accountSettingsFormSchema>>;
