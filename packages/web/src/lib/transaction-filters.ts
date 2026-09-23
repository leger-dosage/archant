import { z } from "zod";

import {
	UNCATEGORISED,
	compareAmountBounds,
	parseAmountBound,
} from "@archant/api/schemas/transactions";

import { isoToFrench } from "@/lib/dates";

// The router reads `?amountMin=40` or `?q=2024` as JSON, so a number, while a
// value set by the page is a string: both mean the same text.
const text = z.union([z.string(), z.number()]).transform(String);

const isoDate = z.iso.date();

/**
 * The search params of `/operations`. A value from an old or hand-edited link
 * that the API would refuse is dropped rather than failing the page, and the
 * other filters stay: each param is checked on its own, then an end before
 * its start loses the end.
 */
export const operationsSearchSchema = z
	.object({
		page: z.number().int().min(1).optional().catch(undefined),
		// A hand-written `?account=<id>` reaches the router as a lone string, a form
		// the API accepts too.
		account: z
			.union([z.string().transform((id) => [id]), z.array(z.string())])
			.pipe(z.array(z.string()).min(1))
			.optional()
			.catch(undefined),
		// Category ids, `none` standing for « Sans catégorie ».
		category: z
			.union([z.string().transform((id) => [id]), z.array(z.string())])
			.pipe(z.array(z.string()).min(1))
			.optional()
			.catch(undefined),
		// Merchant ids, ORed.
		merchant: z
			.union([z.string().transform((id) => [id]), z.array(z.string())])
			.pipe(z.array(z.string()).min(1))
			.optional()
			.catch(undefined),
		// Tag ids, ORed.
		tag: z
			.union([z.string().transform((id) => [id]), z.array(z.string())])
			.pipe(z.array(z.string()).min(1))
			.optional()
			.catch(undefined),
		from: isoDate.optional().catch(undefined),
		to: isoDate.optional().catch(undefined),
		amountMin: text
			.refine((value) => parseAmountBound(value) !== null)
			.optional()
			.catch(undefined),
		amountMax: text
			.refine((value) => parseAmountBound(value) !== null)
			.optional()
			.catch(undefined),
		q: text
			.transform((value) => value.trim())
			.pipe(z.string().min(1))
			.optional()
			.catch(undefined),
	})
	.transform((search) => {
		const min = search.amountMin === undefined ? null : parseAmountBound(search.amountMin);
		const max = search.amountMax === undefined ? null : parseAmountBound(search.amountMax);
		const toBeforeFrom =
			search.from !== undefined && search.to !== undefined && search.to < search.from;
		const maxBelowMin = min !== null && max !== null && compareAmountBounds(min, max) > 0;

		return {
			...search,
			...(toBeforeFrom ? { to: undefined } : {}),
			...(maxBelowMin ? { amountMax: undefined } : {}),
		};
	});

export type OperationsSearch = z.output<typeof operationsSearchSchema>;

/** The filters alone, without the page: what the query key and the chips read. */
export type TransactionFilters = Omit<OperationsSearch, "page">;

export const FILTER_KINDS = ["account", "category", "tag", "merchant", "period", "amount"] as const;

export type FilterKind = (typeof FILTER_KINDS)[number];

const PARAMS_OF: Record<FilterKind | "q", readonly (keyof TransactionFilters)[]> = {
	account: ["account"],
	category: ["category"],
	tag: ["tag"],
	merchant: ["merchant"],
	period: ["from", "to"],
	amount: ["amountMin", "amountMax"],
	q: ["q"],
};

export function filtersOf({ page: _page, ...filters }: OperationsSearch): TransactionFilters {
	return filters;
}

export function hasFilters(filters: TransactionFilters): boolean {
	return Object.values(filters).some((value) => value !== undefined);
}

/** The search without one filter, back on the first page. */
export function withoutFilter(search: OperationsSearch, kind: FilterKind | "q"): OperationsSearch {
	const next: OperationsSearch = { ...search, page: undefined };

	for (const param of PARAMS_OF[kind]) {
		next[param] = undefined;
	}

	return next;
}

/** The query of `GET /api/transactions`, absent params left out. */
export function toApiQuery(filters: TransactionFilters, page: number) {
	return {
		page: String(page),
		...(filters.account === undefined ? {} : { account: filters.account }),
		...(filters.category === undefined ? {} : { category: filters.category }),
		...(filters.merchant === undefined ? {} : { merchant: filters.merchant }),
		...(filters.tag === undefined ? {} : { tag: filters.tag }),
		...(filters.from === undefined ? {} : { from: filters.from }),
		...(filters.to === undefined ? {} : { to: filters.to }),
		...(filters.amountMin === undefined ? {} : { amountMin: filters.amountMin }),
		...(filters.amountMax === undefined ? {} : { amountMax: filters.amountMax }),
		...(filters.q === undefined ? {} : { q: filters.q }),
	};
}

type ChipKey = `operations.chips.${
	| "unknownAccount"
	| "unknownCategory"
	| "uncategorised"
	| "unknownMerchant"
	| "unknownTag"
	| "periodBetween"
	| "periodSince"
	| "periodUntil"
	| "amountBetween"
	| "amountAtLeast"
	| "amountAtMost"}`;

/** i18next's `t`, narrowed to the chip labels so a test can stand in for it. */
export type Translate = (key: ChipKey, values?: Record<string, string>) => string;

export type FilterChip = { kind: FilterKind; label: string };

/** The names the chips show, looked up in the lists the page already holds. */
export type FilterNames = {
	account: (id: string) => string | undefined;
	category: (id: string) => string | undefined;
	merchant: (id: string) => string | undefined;
	tag: (id: string) => string | undefined;
};

function accountLabel(ids: readonly string[], names: FilterNames, t: Translate) {
	return ids.map((id) => names.account(id) ?? t("operations.chips.unknownAccount")).join(", ");
}

function categoryLabel(ids: readonly string[], names: FilterNames, t: Translate) {
	return ids
		.map((id) =>
			id === UNCATEGORISED
				? t("operations.chips.uncategorised")
				: (names.category(id) ?? t("operations.chips.unknownCategory")),
		)
		.join(", ");
}

function merchantLabel(ids: readonly string[], names: FilterNames, t: Translate) {
	return ids.map((id) => names.merchant(id) ?? t("operations.chips.unknownMerchant")).join(", ");
}

function tagLabel(ids: readonly string[], names: FilterNames, t: Translate) {
	return ids.map((id) => names.tag(id) ?? t("operations.chips.unknownTag")).join(", ");
}

function periodLabel(from: string | undefined, to: string | undefined, t: Translate) {
	if (from !== undefined && to !== undefined) {
		return t("operations.chips.periodBetween", { from: isoToFrench(from), to: isoToFrench(to) });
	}

	return from === undefined
		? t("operations.chips.periodUntil", { to: isoToFrench(to ?? "") })
		: t("operations.chips.periodSince", { from: isoToFrench(from) });
}

function amountLabel(min: string | undefined, max: string | undefined, t: Translate) {
	if (min !== undefined && max !== undefined) {
		return t("operations.chips.amountBetween", { min, max });
	}

	return min === undefined
		? t("operations.chips.amountAtMost", { max: max ?? "" })
		: t("operations.chips.amountAtLeast", { min });
}

/**
 * One removable chip per filter set from the « Filtrer » menu, in the menu's
 * order. The text search has its own field and no chip.
 */
export function filterChips(
	filters: TransactionFilters,
	names: FilterNames,
	t: Translate,
): FilterChip[] {
	const chips: FilterChip[] = [];

	if (filters.account !== undefined) {
		chips.push({ kind: "account", label: accountLabel(filters.account, names, t) });
	}

	if (filters.category !== undefined) {
		chips.push({ kind: "category", label: categoryLabel(filters.category, names, t) });
	}

	if (filters.tag !== undefined) {
		chips.push({ kind: "tag", label: tagLabel(filters.tag, names, t) });
	}

	if (filters.merchant !== undefined) {
		chips.push({ kind: "merchant", label: merchantLabel(filters.merchant, names, t) });
	}

	if (filters.from !== undefined || filters.to !== undefined) {
		chips.push({ kind: "period", label: periodLabel(filters.from, filters.to, t) });
	}

	if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
		chips.push({ kind: "amount", label: amountLabel(filters.amountMin, filters.amountMax, t) });
	}

	return chips;
}
