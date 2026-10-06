import { z } from "zod";

import type { MatchSignals } from "@archant/data/schema/recurring-occurrences";

const aliasesSchema = z.array(z.string());

const signalsSchema = z.object({
	merchant: z.number().int().optional(),
	name: z.number().int().optional(),
	amount: z.number().int().optional(),
	date: z.number().int().optional(),
	account: z.number().int().optional(),
});

/**
 * A series' aliases, parsed rather than trusted: only the matcher's learning
 * writes them, so a row this refuses was written by hand, and reads as none.
 */
export function parseAliases(stored: unknown): string[] {
	const parsed = aliasesSchema.safeParse(stored);

	return parsed.success ? parsed.data : [];
}

/** A payment's match signals, parsed as the aliases are. */
export function parseSignals(stored: unknown): MatchSignals {
	const parsed = signalsSchema.safeParse(stored);

	return parsed.success ? parsed.data : {};
}
