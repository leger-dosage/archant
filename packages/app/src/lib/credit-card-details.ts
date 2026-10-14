import type { CreditCardDetailsInput, UpdateAccountInput } from "@archant/api/schemas/accounts";
import type { CreditCardDetails } from "@archant/data/account-types";

import { amountToText } from "@/lib/amount-sign";
import { rateToText } from "@/lib/loan-details";

/** Every field of a card's details, as a PATCH must send them. */
type CompleteCreditCardInput = Extract<
	NonNullable<UpdateAccountInput["details"]>,
	{ availableCredit: string }
>;

/** Where the API's field errors on a card's details land in either account form. */
export const CREDIT_CARD_FIELD_NAMES = [
	"details.availableCredit",
	"details.minimumPayment",
	"details.apr",
	"details.expirationDate",
	"details.annualFee",
] as const;

/**
 * A card's typed details with every field present, a missing one blank: a
 * PATCH replaces them whole. Fields of another type are left out, so the API,
 * which refuses them, never sees what the form kept while the type changed.
 */
export function completeCreditCardInput(
	details: CreditCardDetailsInput | undefined,
): CompleteCreditCardInput {
	return {
		availableCredit: details?.availableCredit ?? "",
		minimumPayment: details?.minimumPayment ?? "",
		apr: details?.apr ?? "",
		expirationDate: details?.expirationDate ?? "",
		annualFee: details?.annualFee ?? "",
	};
}

/** Stored card details back into the text the edit dialog edits, blank when unknown. */
export function creditCardDetailsToInput(
	details: CreditCardDetails | null,
	currency: string,
): CompleteCreditCardInput {
	const amount = (value: CreditCardDetails["availableCredit"] | undefined) =>
		value === null || value === undefined ? "" : amountToText(value, currency);

	return {
		availableCredit: amount(details?.availableCredit),
		minimumPayment: amount(details?.minimumPayment),
		apr: details?.apr === null || details?.apr === undefined ? "" : rateToText(details.apr),
		expirationDate: details?.expirationDate ?? "",
		annualFee: amount(details?.annualFee),
	};
}
