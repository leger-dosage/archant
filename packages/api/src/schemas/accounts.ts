import { z } from "zod";

import {
	ACCOUNT_SUBTYPES,
	ACCOUNT_TYPE_IDS,
	ACCOUNT_TYPES,
	isSubtypeOf,
} from "@archant/data/account-types";
import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode, parseAmount } from "@archant/data/money";

export const EARLIEST_OPENING_DATE = "1900-01-01";

// Shared with the interface, whose form resolver runs this same schema, so a
// value the form accepts is a value the API accepts, with the same field codes.
// Custom issues carry their field code as their message (lib/zod-error.ts).
export const createAccountSchema = z
	.object({
		name: z.string().trim().min(1).max(100),
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
	})
	.transform((value, context) => {
		const openingBalance = parseAmount(value.openingBalance, value.currency);

		if (openingBalance === null) {
			// Already reported by the refinement above; kept so the output type
			// never has to pretend.
			context.addIssue({ code: "custom", path: ["openingBalance"], message: "invalid_amount" });

			return z.NEVER;
		}

		return { ...value, openingBalance };
	});

export type CreateAccountInput = z.input<typeof createAccountSchema>;
export type CreateAccountRequest = z.output<typeof createAccountSchema>;
