import type { AccountDetail, OpeningBalanceChange } from "../services/accounts.ts";

import { z } from "zod";

import { toMinorUnits } from "@archant/data/money";

import { AppError } from "../lib/errors.ts";
import { setOpeningBalanceInput } from "../schemas/assistants/opening-balance.ts";
import { getAccount, setAccountOpeningBalance } from "../services/accounts.ts";
import { RAILS_FALSE, REPLACES, decimalOf, defineTool, refuse, sureDecimalText } from "./tool.ts";

/** Sure's `{ date, balance }` of the opening balance, its balance as Sure's decimal text. */
const point = z.object({
	date: z.string(),
	balance: z.string().describe('The stored balance as Sure\'s decimal text, such as "1500.0".'),
});

/** The account, or Sure's `not_found` for an unknown or deactivated one. */
async function writableAccount(deps: Parameters<typeof getAccount>[0], id: string) {
	let account: AccountDetail;

	try {
		account = await getAccount(deps, id);
	} catch (error) {
		if (error instanceof AppError && error.code === "NOT_FOUND") {
			return null;
		}

		throw error;
	}

	return account.active ? account : null;
}

/**
 * Sure's `current_balance_effect`: a later snapshot pins today's balance,
 * else today's balance moves by what the opening balance moved.
 */
function effectOf(change: OpeningBalanceChange, currency: string) {
	const delta = toMinorUnits(change.after.balance - change.before.balance);

	if (change.pinnedBy !== null) {
		return {
			changes: false,
			reason: `The balance update on ${change.pinnedBy} fixes the balance from that date, so only the history before it changes.`,
		};
	}

	if (delta === 0) {
		return { changes: false, reason: "The opening balance amount is unchanged." };
	}

	return {
		changes: true,
		by: decimalOf({ amount: delta, currency }),
		reason:
			"No later balance update, so the current balance moves by the same amount as the opening balance.",
	};
}

/** A refusal of the date by the service, as Sure's `invalid_date`; anything else passes. */
function refuseDate(error: unknown): void {
	if (!(error instanceof AppError) || error.code !== "VALIDATION_ERROR") {
		return;
	}

	const codes = new Set((error.fields ?? []).map((field) => field.code));
	const oldest = error.params?.["date"];

	if (codes.has("not_before_oldest_entry") && oldest !== undefined) {
		refuse(
			"invalid_date",
			`Opening balance date must be before the oldest entry date (${oldest}).`,
			{ oldest_entry_date: oldest },
		);
	}

	if (codes.has("date_in_future")) {
		refuse("invalid_date", "date must not be after today.");
	}
}

export const setOpeningBalanceTool = defineTool({
	name: "set_opening_balance",
	title: "Set an opening balance",
	description: [
		"Sets the opening balance of a manual account (one not synced from a bank or other provider) and, optionally, the date it applies from, as Sure's set_opening_balance and the « Solde d'ouverture » row of Archant's « Soldes » tab. Use it when an account's history starts on the wrong date or from the wrong amount, e.g. a loan whose first repayment predates its opening balance, or a savings account that opened at zero.",
		"balance uses the same sign convention as get_accounts (a loan's outstanding amount is positive). date must be before the account's oldest entry and not after today; omit it to keep the current opening date.",
		"The result says whether the current balance changes: if the account has a later balance update, only the history before it changes. Pass dry_run: true to see the effect without changing anything.",
		"Refusals answer Sure's keys, in Sure's order: not_found, linked_account, invalid_balance, invalid_date, the last with oldest_entry_date when the date is on or after the oldest entry. An amount with more decimals than the account's currency holds answers validation_error naming balance, and a date before 1900 validation_error naming date.",
	].join("\n\n"),
	scope: "archant:write",
	annotations: REPLACES,
	input: setOpeningBalanceInput,
	output: z.object({
		success: z.literal(true),
		dry_run: z.literal(true).optional().describe("Present on a dry run, which wrote nothing."),
		changed: z
			.boolean()
			.optional()
			.describe("Whether the date or the amount moved; absent on a dry run."),
		account: z.object({ id: z.string(), name: z.string(), currency: z.string() }),
		before: point,
		after: point,
		current_balance: z.object({
			changes: z.boolean(),
			by: z
				.string()
				.optional()
				.describe("How far today's balance moves, as Sure's decimal text, when it does."),
			reason: z.string(),
		}),
	}),
	run: async (deps, input) => {
		const account = await writableAccount(deps, input.account_id);

		if (account === null) {
			refuse("not_found", `No account with id '${input.account_id}' that you can write to.`);
		}

		if (account.bankConnection !== null) {
			refuse(
				"linked_account",
				`${account.name} is synced from a provider, which manages its balances. Only manual accounts have an editable opening balance.`,
			);
		}

		const balance = typeof input.balance === "boolean" ? null : sureDecimalText(input.balance);

		if (balance === null) {
			refuse("invalid_balance", "balance must be a number.");
		}

		// A supplied blank date is an error, not "keep the current date", as Sure's.
		if (
			input.date !== undefined &&
			input.date !== null &&
			!z.iso.date().safeParse(input.date).success
		) {
			refuse("invalid_date", "date must be YYYY-MM-DD.");
		}

		const dryRun =
			input.dry_run !== undefined &&
			input.dry_run !== null &&
			input.dry_run !== "" &&
			!RAILS_FALSE.has(input.dry_run);
		let change: OpeningBalanceChange;

		try {
			change = await setAccountOpeningBalance(
				deps,
				account.id,
				{ date: input.date ?? account.openingDate, balance },
				{ dryRun },
			);
		} catch (error) {
			refuseDate(error);

			throw error;
		}

		const { currency } = account;
		const of = (opening: OpeningBalanceChange["before"]) => ({
			date: opening.date,
			balance: decimalOf({ amount: opening.balance, currency }),
		});
		const outcome = dryRun ? { dry_run: true as const } : { changed: change.changed };

		return {
			result: {
				success: true as const,
				...outcome,
				account: { id: account.id, name: account.name, currency },
				before: of(change.before),
				after: of(change.after),
				current_balance: effectOf(change, currency),
			},
			changedRows: dryRun || !change.changed ? 0 : 1,
		};
	},
});
