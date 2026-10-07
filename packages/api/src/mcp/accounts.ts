import type { AccountSummary } from "../services/accounts.ts";

import { z } from "zod";

import type { Classification } from "@archant/data/account-types";
import { CLASSIFICATIONS } from "@archant/data/account-types";
import { toDecimalString } from "@archant/data/money";

import { today } from "../domain/dates.ts";
import { getAccountsInput } from "../schemas/assistants.ts";
import { listAccounts } from "../services/accounts.ts";
import { listAccountsWithHistory } from "../services/balances.ts";
import { BANK_TEXT, READ_ONLY, defineTool, seriesOf, seriesOutput } from "./tool.ts";

const account = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string(),
	subtype: z.string().nullable(),
	classification: z.enum(CLASSIFICATIONS),
	currency: z.string(),
	balance: z
		.string()
		.describe("Today's balance as a decimal string in the account's currency, such as \"-12.50\"."),
	active: z.boolean(),
	excluded_from_reports: z.boolean(),
	historical_balances: seriesOutput
		.optional()
		.describe(
			"With include_balance_series: the end-of-day balance in the account's currency over the period, oldest first, today last; empty for an account opening after today.",
		),
});

function accountOf(
	summary: AccountSummary,
	classification: Classification,
): z.input<typeof account> {
	return {
		id: summary.id,
		name: summary.name,
		type: summary.type,
		subtype: summary.subtype,
		classification,
		currency: summary.currency,
		balance: toDecimalString({ amount: summary.balance, currency: summary.currency }),
		active: summary.active,
		excluded_from_reports: summary.excludedFromReports,
	};
}

export const getAccounts = defineTool({
	name: "get_accounts",
	title: "Accounts",
	description: `Every account with today's balance, assets then liabilities, inactive ones included. With include_balance_series, each also gives its balance over the period, as its page charts it. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: getAccountsInput,
	output: z.object({
		as_of_date: z.string().describe("Today, YYYY-MM-DD: the day of every balance."),
		accounts: z.array(account),
	}),
	run: async (deps, input) => {
		if (!input.include_balance_series) {
			const { groups } = await listAccounts(deps);

			return {
				result: {
					as_of_date: today(deps.timeZone),
					accounts: groups.flatMap((group) =>
						group.accounts.map((summary) => accountOf(summary, group.classification)),
					),
				},
				changedRows: 0,
			};
		}

		const { groups } = await listAccountsWithHistory(deps, input.series_period);

		return {
			result: {
				as_of_date: today(deps.timeZone),
				accounts: groups.flatMap((group) =>
					group.accounts.map((summary) => ({
						...accountOf(summary, group.classification),
						historical_balances: seriesOf(summary.balanceSeries, summary.currency),
					})),
				),
			},
			changedRows: 0,
		};
	},
});
