import { z } from "zod";

import { readMicros } from "@archant/data/micros";

import { listedSecurityChoiceSchema } from "./trades.ts";

// The text as typed, so the typed client knows the body; the service parses it.
export const costBasisBodySchema = z.object({ costBasis: z.string() });

export type CostBasisInput = z.input<typeof costBasisBodySchema>;

/**
 * A cost basis set by hand, per unit in the account's currency, typed the
 * French or English way: zero or more, as a free share's. Shared with the
 * position sheet's form, so both report `invalid_cost_basis`: it keeps
 * millionths, where a trade's price takes ten decimals.
 */
export const costBasisSchema = z.object({
	costBasis: z.string().transform((text, context) => {
		const value = readMicros(text);

		if (value === null || value < 0) {
			context.addIssue({ code: "custom", message: "invalid_cost_basis" });

			return z.NEVER;
		}

		return value;
	}),
});

/** The security a position's trades move to. */
export const remapBodySchema = z.object({ security: listedSecurityChoiceSchema });

export type RemapBody = z.output<typeof remapBodySchema>;
