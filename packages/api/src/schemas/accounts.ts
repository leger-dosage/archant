import { z } from "zod";

import type { LoanDetails } from "@archant/data/account-types";
import {
	ACCOUNT_SUBTYPES,
	ACCOUNT_TYPE_IDS,
	ACCOUNT_TYPES,
	isSubtypeOf,
} from "@archant/data/account-types";
import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode, parseAmount } from "@archant/data/money";

export const EARLIEST_OPENING_DATE = "1900-01-01";

export const ACCOUNT_NAME_MAX_LENGTH = 100;

// One rule for creating and renaming, so a name the one accepts the other does too.
const accountName = z.string().trim().min(1).max(ACCOUNT_NAME_MAX_LENGTH);

/**
 * A loan's details as typed. Every field is optional, and a blank one means
 * "not known": the outstanding balance is all a loan needs.
 */
export const loanDetailsInputSchema = z.object({
	// Text, as the opening balance: its minor units depend on the currency.
	originalAmount: z.string().optional(),
	interestRate: z.string().optional(),
	endDate: z.string().optional(),
});

export type LoanDetailsInput = z.input<typeof loanDetailsInputSchema>;

export type LoanDetailsIssue = {
	field: keyof LoanDetailsInput;
	code: "invalid_amount" | "invalid_rate" | "invalid_date";
};

// Two decimals at most, as lenders quote a rate; no sign, so a negative rate
// is refused with the rest. A trailing `%` is accepted: the label says « (%) ».
const RATE_PATTERN = /^(\d{1,3})(?:[.,](\d{1,2}))?(?:\s*%)?$/u;

const MAX_RATE_BASIS_POINTS = 10_000;

/** `3,45` into 345 basis points, from the digits so no float rounds it; null if invalid. */
export function parseRate(text: string): number | null {
	const match = RATE_PATTERN.exec(text.trim());

	if (match === null) {
		return null;
	}

	const [, units = "", hundredths = ""] = match;
	const basisPoints = Number(units) * 100 + Number(hundredths.padEnd(2, "0"));

	return basisPoints <= MAX_RATE_BASIS_POINTS ? basisPoints : null;
}

const blank = (text: string | undefined) => text === undefined || text.trim() === "";

/**
 * Reads typed loan details into what `accounts.details` stores. `currency`
 * null means it is itself invalid, so the amount cannot be judged yet and is
 * left unreported.
 */
export function parseLoanDetails(
	input: LoanDetailsInput,
	currency: string | null,
): { details: LoanDetails; issues: LoanDetailsIssue[] } {
	const issues: LoanDetailsIssue[] = [];
	const details: LoanDetails = { originalAmount: null, interestRate: null, endDate: null };

	if (!blank(input.originalAmount) && currency !== null) {
		const amount = parseAmount(input.originalAmount ?? "", currency);

		if (amount === null || amount <= 0) {
			issues.push({ field: "originalAmount", code: "invalid_amount" });
		} else {
			details.originalAmount = amount;
		}
	}

	if (!blank(input.interestRate)) {
		const rate = parseRate(input.interestRate ?? "");

		if (rate === null) {
			issues.push({ field: "interestRate", code: "invalid_rate" });
		} else {
			details.interestRate = rate;
		}
	}

	if (!blank(input.endDate)) {
		const endDate = z.iso.date().safeParse(input.endDate?.trim());

		if (endDate.success) {
			details.endDate = endDate.data;
		} else {
			issues.push({ field: "endDate", code: "invalid_date" });
		}
	}

	return { details, issues };
}

/** Adds each invalid loan detail to a schema's issues, under `details.<field>`. */
function reportLoanDetailsIssues(
	context: z.RefinementCtx,
	details: LoanDetailsInput,
	currency: unknown,
): void {
	const validCurrency = typeof currency === "string" && isCurrencyCode(currency) ? currency : null;

	for (const issue of parseLoanDetails(details, validCurrency).issues) {
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
		subtype: z.enum(ACCOUNT_SUBTYPES).nullable(),
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
		if (Object.hasOwn(ACCOUNT_TYPES, value.type) && !isSubtypeOf(value.type, value.subtype)) {
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
				reportLoanDetailsIssues(context, value.details, value.currency);
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
			value.type === "loan" ? parseLoanDetails(value.details ?? {}, value.currency).details : null;

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
 * It replaces the stored details whole, so all three fields are required,
 * a blank one clearing its value: a partial object would otherwise clear the
 * fields it left out without saying so.
 */
export const updateAccountSchema = z
	.object({
		name: accountName.optional(),
		subtype: z.enum(ACCOUNT_SUBTYPES).nullable().optional(),
		active: z.boolean().optional(),
		excludedFromReports: z.boolean().optional(),
		details: loanDetailsInputSchema.required().optional(),
	})
	.refine((value) => Object.values(value).some((field) => field !== undefined), "empty_patch");

export type UpdateAccountInput = z.input<typeof updateAccountSchema>;
export type UpdateAccountRequest = z.output<typeof updateAccountSchema>;

/**
 * The Paramètres form: the name and subtype as typed, the exclusion switch,
 * and a loan's details, checked the way the API checks them. The account's
 * currency decides how many decimals the amount borrowed may have.
 */
export function accountSettingsFormSchema(currency: string) {
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

			reportLoanDetailsIssues(context, value.details, currency);
		});
}

export type AccountSettingsFormInput = z.input<ReturnType<typeof accountSettingsFormSchema>>;
