import type { ReportsSection, StoredReportsLayout } from "./reports-sections.ts";

import { DEFAULT_REPORTS_ORDER, REPORTS_SECTIONS } from "./reports-sections.ts";

// Pure, apart from the `users` table, so the API merges a change and the
// interface applies it at once with the same code.

/** A user's reports page as it is laid out: every section, each collapsed or not. */
export type ReportsLayout = {
	sectionOrder: ReportsSection[];
	collapsedSections: Record<ReportsSection, boolean>;
};

/** One change, as Sure's `update_preferences` takes it: an order, or collapsed sections. */
export type ReportsLayoutPatch = {
	sectionOrder?: ReportsSection[] | undefined;
	collapsedSections?: Partial<Record<ReportsSection, boolean>> | undefined;
};

const KNOWN = new Set<string>(REPORTS_SECTIONS);

const isSection = (key: string): key is ReportsSection => KNOWN.has(key);

/** The known keys of a stored list, once each, in their stored order. */
function knownKeys(keys: readonly string[]): ReportsSection[] {
	return [...new Set(keys.filter(isSection))];
}

/** The stored layout without any key the code no longer knows. */
function cleaned(stored: StoredReportsLayout | null): {
	sectionOrder?: ReportsSection[];
	collapsedSections: Partial<Record<ReportsSection, boolean>>;
} {
	return {
		...(stored?.sectionOrder === undefined ? {} : { sectionOrder: knownKeys(stored.sectionOrder) }),
		collapsedSections: Object.fromEntries(
			Object.entries(stored?.collapsedSections ?? {}).filter(([key]) => isSection(key)),
		),
	};
}

/**
 * Sure's `reports_section_order` read as `build_reports_sections` does: the
 * stored order, else Sure's default, then every section it misses, in the
 * base order.
 */
export function resolveReportsLayout(stored: StoredReportsLayout | null): ReportsLayout {
	const clean = cleaned(stored);
	const order = clean.sectionOrder ?? DEFAULT_REPORTS_ORDER;

	return {
		sectionOrder: [...order, ...REPORTS_SECTIONS.filter((key) => !order.includes(key))],
		collapsedSections: {
			net_worth: clean.collapsedSections.net_worth === true,
			trends_insights: clean.collapsedSections.trends_insights === true,
			transactions_breakdown: clean.collapsedSections.transactions_breakdown === true,
		},
	};
}

/**
 * Sure's `update_reports_preferences`: collapsed sections merge key by key,
 * so a stale tab collapsing one never reopens another; an order replaces the
 * stored one.
 */
export function mergeReportsLayout(
	stored: StoredReportsLayout | null,
	patch: ReportsLayoutPatch,
): StoredReportsLayout {
	const clean = cleaned(stored);
	const sectionOrder = patch.sectionOrder ?? clean.sectionOrder;

	return {
		...(sectionOrder === undefined ? {} : { sectionOrder: knownKeys(sectionOrder) }),
		collapsedSections: { ...clean.collapsedSections, ...patch.collapsedSections },
	};
}
