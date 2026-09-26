import { z } from "zod";

import type { AccountSubtype } from "@archant/data/account-types";
import {
	ACCOUNT_TYPE_IDS,
	isAccountSubtype,
	isBankAccountTarget,
} from "@archant/data/account-types";
import { BANK_COUNTRIES } from "@archant/data/bank-countries";

/**
 * What « Réglages › Banques » sends: the application ID and the `.pem`
 * file's text, which the browser read. The service parses the key itself, so
 * a file that holds none fails on `privateKey` like any other field.
 */
export const saveBankCredentialsSchema = z.object({
	applicationId: z.string().trim().min(1).max(200),
	// A key and its certificate fit in a few kilobytes; a larger file is not one.
	privateKey: z.string().min(1).max(64_000),
});

export type SaveBankCredentialsInput = z.infer<typeof saveBankCredentialsSchema>;

export const institutionsQuerySchema = z.object({ country: z.enum(BANK_COUNTRIES) });

/** The bank the user picked; the service reads it again from the provider's list. */
export const startConnectionSchema = z.object({
	country: z.enum(BANK_COUNTRIES),
	institution: z.string().trim().min(1).max(200),
});

export type StartConnectionInput = z.infer<typeof startConnectionSchema>;

/** What the bank put in the return URL, posted by the return page. */
export const completeConnectionSchema = z.object({
	code: z.string().min(1).max(2000),
	state: z.string().min(1).max(200),
});

export type CompleteConnectionInput = z.infer<typeof completeConnectionSchema>;

const id = z.string().min(1).max(100);

/** Route parameter of a connection's pages. */
export const connectionParamSchema = z.object({ id });

/** A new account for the bank account: Sure's `setup_accounts` choice. */
const createLinkSchema = z
	.object({
		bankAccountId: id,
		action: z.literal("create"),
		type: z.enum(ACCOUNT_TYPE_IDS),
		subtype: z.custom<AccountSubtype>(isAccountSubtype, "invalid_subtype").nullable(),
	})
	.superRefine((value, context) => {
		if (!isBankAccountTarget(value.type, value.subtype)) {
			context.addIssue({ code: "custom", path: ["subtype"], message: "invalid_subtype" });
		}
	});

/** An existing account for the bank account: Sure's `link_existing_account`. */
const existingLinkSchema = z.object({
	bankAccountId: id,
	action: z.literal("link"),
	accountId: id,
});

/**
 * The rows the user did not skip. A skipped row is simply absent: nothing
 * is written for it, and it stays linkable later.
 */
export const linkBankAccountsSchema = z.object({
	links: z
		.array(z.discriminatedUnion("action", [createLinkSchema, existingLinkSchema]))
		.min(1)
		.max(100),
});

export type LinkBankAccountsInput = z.infer<typeof linkBankAccountsSchema>;
