import type { AssistantAccount } from "../services/balances.ts";

import { z } from "zod";

import type { AccountType } from "@archant/data/account-types";
import { CLASSIFICATIONS } from "@archant/data/account-types";

import { SURE_INTERVALS } from "../domain/balances/sure-periods.ts";
import { today } from "../domain/dates.ts";
import { getAccountsInput } from "../schemas/assistants.ts";
import { listAssistantAccounts } from "../services/balances.ts";
import { BANK_TEXT, READ_ONLY, decimalOf, defineTool, formatMoney } from "./tool.ts";

/** Sure's `accountable_type` for each of Archant's account types. */
const SURE_TYPES = {
	depository: "Depository",
	credit_card: "CreditCard",
	loan: "Loan",
	investment: "Investment",
	property: "Property",
	vehicle: "Vehicle",
} as const satisfies Record<AccountType, string>;

const account = z.object({
	id: z.string(),
	name: z.string(),
	balance: z.string().describe('Today\'s balance as a decimal string, such as "1234.5".'),
	currency: z.string(),
	balance_formatted: z.string().describe('The balance as Sure writes it, such as "1 234,50 €".'),
	classification: z.enum(CLASSIFICATIONS),
	type: z.enum(SURE_TYPES),
	start_date: z.string().describe("The day before its first entry, YYYY-MM-DD."),
	is_linked: z.boolean().describe("A bank connection feeds it."),
	provider: z.literal("enable_banking").nullable(),
	status: z.literal("active"),
	historical_balances: z
		.object({
			start_date: z.string(),
			end_date: z.string(),
			interval: z.enum(SURE_INTERVALS),
			currency: z.string(),
			values: z.array(z.number()).describe("The end-of-day balance at each step, oldest first."),
		})
		.optional()
		.describe("With include_balance_series, absent for an account starting after the period."),
});

function accountOf(item: AssistantAccount): z.input<typeof account> {
	const { currency, linked } = item;

	return {
		id: item.id,
		name: item.name,
		balance: decimalOf({ amount: item.balance, currency }),
		currency,
		balance_formatted: formatMoney({ amount: item.balance, currency }),
		classification: item.classification,
		type: SURE_TYPES[item.type],
		start_date: item.startDate,
		is_linked: linked,
		provider: linked ? "enable_banking" : null,
		status: "active",
		...(item.series === undefined || item.series === null
			? {}
			: {
					historical_balances: {
						start_date: item.series.range.from,
						end_date: item.series.range.to,
						interval: item.series.interval,
						currency,
						// Read through the decimal text, never divided as a float.
						values: item.series.values.map((amount) => Number(decimalOf({ amount, currency }))),
					},
				}),
	};
}

export const getAccounts = defineTool({
	name: "get_accounts",
	title: "Accounts",
	description: `Use this to see what accounts the user has along with their current balances, as Sure's get_accounts. Returns account ids: use them for account_ids filters in other tools. Pass include_balance_series: true only when the user asks about balance history; the series is omitted by default to keep responses small. ${BANK_TEXT}`,
	scope: "archant:read",
	annotations: READ_ONLY,
	input: getAccountsInput,
	output: z.object({
		as_of_date: z.string().describe("Today, YYYY-MM-DD: the day of every balance."),
		accounts: z.array(account),
	}),
	run: async (deps, input) => {
		const listed = await listAssistantAccounts(
			deps,
			input.include_balance_series ? input.series_period : undefined,
		);

		return {
			result: { as_of_date: today(deps.timeZone), accounts: listed.map(accountOf) },
			changedRows: 0,
		};
	},
});
