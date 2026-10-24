import { z } from "zod";

import { DEFAULT_PAGE_SIZE } from "../transactions.ts";

/**
 * A value Sure's write requires, kept required in the advertised schema: a
 * missing one reaches `run` blank, which refuses it with Sure's key, as
 * `requiredSureName` does for a name.
 */
/** Sure's `presence`: a blank value reads as absent rather than refused. */
export const present = <Schema extends z.ZodType>(schema: Schema) =>
	z.preprocess(
		(value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
		schema.optional(),
	);

export const requiredLoose = <Schema extends z.ZodType>(schema: Schema) =>
	z.preprocess((value) => value ?? "", schema);

/** Sure's `amount`: a JSON number, read through its decimal text, or a decimal string. */
export const sureAmount = z.union([z.string().max(40), z.number()]);

/** A whole number Sure reads with `Integer(value.to_s)` or `to_i`: a number or its text. */
export const looseInteger = z.union([z.number(), z.string()]);

/** A flag Sure reads through its allowlist: a JSON boolean, or `"true"`, `"t"`, `"1"`, `1` and their false twins. */
export const looseBoolean = z.union([z.boolean(), z.string(), z.number()]);

/** The page an assistant reads at once: a list page of the interface, no more. */
const MAX_TOOL_PAGE_SIZE = 100;

/**
 * A page argument as Sure's `to_i` reads text: its leading whole number, or 0
 * without one; a blank one is absent, as Rails' `blank?` says.
 */
function pageNumberOf(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}

	if (value.trim() === "") {
		return undefined;
	}

	const leading = /^\s*([+-]?\d+)/u.exec(value)?.[1];

	return leading === undefined ? 0 : Number(leading);
}

/**
 * Sure's `resolved_page` and `resolved_page_size`: a page below 1 or not a
 * whole number reads the first, a page size is held within 1 and 100, and
 * neither refuses the call.
 */
export const clampedPageFields = {
	page: z
		.preprocess(pageNumberOf, z.number().int().min(1).catch(1))
		.default(1)
		.describe("Page number, 1 by default."),
	page_size: z
		.preprocess(
			pageNumberOf,
			z
				.number()
				.transform((size) => Math.min(MAX_TOOL_PAGE_SIZE, Math.max(1, Math.trunc(size))))
				.catch(DEFAULT_PAGE_SIZE),
		)
		.default(DEFAULT_PAGE_SIZE)
		.describe(`Results per page, ${DEFAULT_PAGE_SIZE} by default, ${MAX_TOOL_PAGE_SIZE} at most.`),
};

/** A page of a list, as Sure's. */
export const listPageInput = z.strictObject(clampedPageFields);

/**
 * A name as Sure's writes take it: trimmed and composed, a blank one left to
 * the tool's `run`, which refuses it with Sure's `name_required`.
 */
export const sureName = (max: number) =>
	z
		.string()
		.trim()
		.transform((value) => value.normalize("NFC"))
		.pipe(z.string().max(max));

/** A name Sure's write requires: a missing one reaches `run` blank, refused there as Sure's. */
export const requiredSureName = (max: number) =>
	z.preprocess((value) => value ?? "", sureName(max));

export const merchantId = z
	.string()
	.min(1)
	.describe("A merchant id from get_merchants or create_merchant.");

export const accountId = z.string().min(1).describe("An account id from get_accounts.");
