import { z } from "zod";

import type { AmountOperator, TransactionStatus } from "@archant/api/schemas/transactions";
import {
	AMOUNT_OPERATORS,
	STATUSES,
	UNCATEGORISED,
	directionSchema,
	parseAmountBound,
} from "@archant/api/schemas/transactions";

import { isoToFrench } from "@/lib/dates";

// The router reads `?amount=40` or `?q=2024` as JSON, so a number, while a
// value set by the page is a string: both mean the same text.
const text = z.union([z.string(), z.number()]).transform(String);

const isoDate = z.iso.date();

/**
 * The search params of `/transactions`. A value from an old or hand-edited link
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
		// Income, expense or transfer, ORed; repeats are dropped.
		direction: z
			.union([z.string().transform((value) => [value]), z.array(z.string())])
			.pipe(z.array(directionSchema).min(1))
			.transform((values) => [...new Set(values)])
			.optional()
			.catch(undefined),
		// Sure's « Statut »; both, as none, is no filter, so the URL drops them.
		status: z
			.union([z.string().transform((value) => [value]), z.array(z.string())])
			.pipe(z.array(z.enum(STATUSES)).min(1))
			.transform((values) => [...new Set(values)])
			.transform((values) => (values.length === STATUSES.length ? undefined : values))
			.optional()
			.catch(undefined),
		from: isoDate.optional().catch(undefined),
		to: isoDate.optional().catch(undefined),
		amount: text
			.refine((value) => parseAmountBound(value) !== null)
			.optional()
			.catch(undefined),
		amountOperator: z.enum(AMOUNT_OPERATORS).optional().catch(undefined),
		q: text
			.transform((value) => value.trim())
			.pipe(z.string().min(1))
			.optional()
			.catch(undefined),
	})
	.transform((search): typeof search => {
		const toBeforeFrom =
			search.from !== undefined && search.to !== undefined && search.to < search.from;

		return {
			...search,
			...(toBeforeFrom ? { to: undefined } : {}),
			// An operator alone filters nothing, so it leaves the URL; an amount
			// alone from a hand-written link takes Sure's first option, as its select.
			...(search.amount === undefined
				? { amountOperator: undefined }
				: { amountOperator: search.amountOperator ?? "equal" }),
		};
	});

export type OperationsSearch = z.output<typeof operationsSearchSchema>;

/** The filters alone, without the page: what the query key and the chips read. */
export type TransactionFilters = Omit<OperationsSearch, "page">;

export const FILTER_KINDS = [
	"account",
	"category",
	"tag",
	"merchant",
	"period",
	"status",
	"amount",
	"direction",
] as const;

/** The `direction` values, in the order the « Sens » editor lists them. */
export const DIRECTIONS = directionSchema.options;

export type Direction = (typeof DIRECTIONS)[number];

/** The « Statut » values, in the order Sure's editor lists them. */
export const STATUS_OPTIONS = [
	"confirmed",
	"pending",
] as const satisfies readonly TransactionStatus[];

/** The « Montant » operators, in the order Sure's select lists them. */
export const OPERATOR_OPTIONS = [
	"equal",
	"greater",
	"less",
] as const satisfies readonly AmountOperator[];

export type FilterKind = (typeof FILTER_KINDS)[number];

const PARAMS_OF: Record<FilterKind | "q", readonly (keyof TransactionFilters)[]> = {
	account: ["account"],
	category: ["category"],
	tag: ["tag"],
	merchant: ["merchant"],
	period: ["from", "to"],
	status: ["status"],
	amount: ["amount", "amountOperator"],
	direction: ["direction"],
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
	return { page: String(page), ...toTotalsQuery(filters) };
}

/** The query of `GET /api/transactions/totals`: the list's, without its page. */
export function toTotalsQuery(filters: TransactionFilters) {
	return {
		...(filters.account === undefined ? {} : { account: filters.account }),
		...(filters.category === undefined ? {} : { category: filters.category }),
		...(filters.merchant === undefined ? {} : { merchant: filters.merchant }),
		...(filters.tag === undefined ? {} : { tag: filters.tag }),
		...(filters.from === undefined ? {} : { from: filters.from }),
		...(filters.to === undefined ? {} : { to: filters.to }),
		...(filters.status === undefined ? {} : { status: filters.status }),
		...(filters.amount === undefined ? {} : { amount: filters.amount }),
		...(filters.amountOperator === undefined ? {} : { amountOperator: filters.amountOperator }),
		...(filters.q === undefined ? {} : { q: filters.q }),
		...(filters.direction === undefined ? {} : { direction: filters.direction }),
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
	| "statuses.confirmed"
	| "statuses.pending"
	| "amountEqual"
	| "amountGreater"
	| "amountLess"
	| "directions.income"
	| "directions.expense"
	| "directions.transfer"}`;

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

function directionLabel(values: readonly Direction[], t: Translate) {
	return values.map((value) => t(`operations.chips.directions.${value}`)).join(", ");
}

function statusLabel(values: readonly TransactionStatus[], t: Translate) {
	return values.map((value) => t(`operations.chips.statuses.${value}`)).join(", ");
}

const AMOUNT_CHIP = {
	equal: "operations.chips.amountEqual",
	greater: "operations.chips.amountGreater",
	less: "operations.chips.amountLess",
} as const satisfies Record<AmountOperator, ChipKey>;

/** Sure's badge, « égal à 42,90 », prefixed by the filter's name as the other chips are. */
function amountLabel(amount: string, operator: AmountOperator | undefined, t: Translate) {
	return t(AMOUNT_CHIP[operator ?? "equal"], { amount });
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

	if (filters.status !== undefined) {
		chips.push({ kind: "status", label: statusLabel(filters.status, t) });
	}

	if (filters.amount !== undefined) {
		chips.push({ kind: "amount", label: amountLabel(filters.amount, filters.amountOperator, t) });
	}

	if (filters.direction !== undefined) {
		chips.push({ kind: "direction", label: directionLabel(filters.direction, t) });
	}

	return chips;
}
