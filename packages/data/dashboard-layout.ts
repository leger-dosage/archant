import type {
	DashboardColSpan,
	DashboardHeightPreset,
	DashboardSection,
	DashboardSectionSize,
	StoredDashboardLayout,
} from "./dashboard-sections.ts";

import {
	DASHBOARD_HEIGHT_PRESETS,
	DASHBOARD_SECTION_LAYOUTS,
	DASHBOARD_SECTIONS,
	DEFAULT_DASHBOARD_ORDER,
	DEFAULT_HEIGHT_PRESET,
	perSection,
} from "./dashboard-sections.ts";

// Pure, apart from the `users` table, so the API merges a change and the
// interface applies it at once with the same code.

/** A user's dashboard as it is laid out: every widget, each with its state. */
export type DashboardLayout = {
	/** Every widget, hidden ones in their place. */
	sectionOrder: DashboardSection[];
	hiddenSections: DashboardSection[];
	collapsedSections: Record<DashboardSection, boolean>;
	sectionLayout: Record<
		DashboardSection,
		{ height: DashboardHeightPreset; colSpan: DashboardColSpan }
	>;
};

/**
 * One change, as Sure's dashboard sends it: an order, collapsed widgets and
 * sizes merged key by key, and widgets hidden or shown one key at a time.
 */
export type DashboardLayoutPatch = {
	sectionOrder?: DashboardSection[] | undefined;
	collapsedSections?: Partial<Record<DashboardSection, boolean>> | undefined;
	hiddenSections?: Partial<Record<DashboardSection, boolean>> | undefined;
	sectionLayout?:
		| Partial<
				Record<
					DashboardSection,
					{ height?: DashboardHeightPreset | undefined; colSpan?: DashboardColSpan | undefined }
				>
		  >
		| undefined;
};

const KNOWN = new Set<string>(DASHBOARD_SECTIONS);

const isSection = (key: string): key is DashboardSection => KNOWN.has(key);

const isHeightPreset = (value: unknown): value is DashboardHeightPreset =>
	typeof value === "string" && Object.hasOwn(DASHBOARD_HEIGHT_PRESETS, value);

const isColSpan = (value: unknown): value is DashboardColSpan =>
	value === "single" || value === "full";

/** The known keys of a stored list, once each, in their stored order. */
function knownKeys(keys: readonly string[] | undefined): DashboardSection[] {
	return [...new Set((keys ?? []).filter(isSection))];
}

function knownEntries<Value>(map: Record<string, Value> | undefined): [DashboardSection, Value][] {
	return Object.entries(map ?? {}).filter((entry): entry is [DashboardSection, Value] =>
		isSection(entry[0]),
	);
}

/**
 * The stored layout without any key the code no longer knows, so a widget
 * removed from the code never comes back from an old row.
 */
function cleaned(stored: StoredDashboardLayout | null): Required<StoredDashboardLayout> {
	return {
		sectionOrder: knownKeys(stored?.sectionOrder),
		collapsedSections: Object.fromEntries(knownEntries(stored?.collapsedSections)),
		hiddenSections: knownKeys(stored?.hiddenSections),
		sectionLayout: Object.fromEntries(knownEntries(stored?.sectionLayout)),
	};
}

/**
 * The stored order then every widget it does not list, in the default order,
 * as Sure's `ordered_dashboard_section_keys`.
 */
function laidOutOrder(stored: Required<StoredDashboardLayout>): DashboardSection[] {
	const saved = knownKeys(stored.sectionOrder);

	return [...saved, ...DEFAULT_DASHBOARD_ORDER.filter((key) => !saved.includes(key))];
}

/**
 * A widget's size, as Sure's `section_layout`: the stored height when it is
 * a preset, else `auto`; the stored width only on a widget whose width may
 * change, else its default.
 */
function sizeOf(key: DashboardSection, stored: DashboardSectionSize | undefined) {
	const base = DASHBOARD_SECTION_LAYOUTS[key];

	return {
		height: base.grow && isHeightPreset(stored?.height) ? stored.height : DEFAULT_HEIGHT_PRESET,
		colSpan: base.widthToggle && isColSpan(stored?.colSpan) ? stored.colSpan : base.colSpan,
	};
}

/** What the dashboard lays out from a stored layout, null for a user who never arranged it. */
export function resolveLayout(stored: StoredDashboardLayout | null): DashboardLayout {
	const clean = cleaned(stored);

	return {
		sectionOrder: laidOutOrder(clean),
		hiddenSections: knownKeys(clean.hiddenSections),
		collapsedSections: perSection((key) => clean.collapsedSections[key] === true),
		sectionLayout: perSection((key) => sizeOf(key, clean.sectionLayout[key])),
	};
}

/**
 * Sure's `keep_hidden_sections_in_order`: the dashboard only sends the order
 * of the widgets it shows, so each hidden one goes back after the widget it
 * followed in the previous order, or first when none did.
 */
export function keepHiddenInOrder<Key extends string>(
	next: readonly Key[],
	previous: readonly Key[],
	hidden: readonly Key[],
): Key[] {
	const order = next.filter((key) => !hidden.includes(key));

	for (const key of previous.filter((each) => hidden.includes(each))) {
		const predecessor = previous
			.slice(0, previous.indexOf(key))
			.toReversed()
			.find((each) => order.includes(each));

		order.splice(predecessor === undefined ? 0 : order.indexOf(predecessor) + 1, 0, key);
	}

	return order;
}

/**
 * Sure's `update_dashboard_preferences` and `update_dashboard_section_hidden`
 * in one: hidden widgets change one key at a time, so a stale tab hiding one
 * never brings back another; collapsed widgets and sizes merge key by key, so
 * a width leaves the height; an order keeps each hidden widget in place.
 */
export function mergeLayout(
	stored: StoredDashboardLayout | null,
	patch: DashboardLayoutPatch,
): StoredDashboardLayout {
	const clean = cleaned(stored);
	let hidden = knownKeys(clean.hiddenSections);

	for (const [key, hide] of knownEntries(patch.hiddenSections)) {
		hidden = hidden.filter((each) => each !== key);

		if (hide) {
			hidden.push(key);
		}
	}

	const sectionLayout = { ...clean.sectionLayout };

	for (const [key, size] of knownEntries(patch.sectionLayout)) {
		sectionLayout[key] = {
			...sectionLayout[key],
			...(size.height === undefined ? {} : { height: size.height }),
			...(size.colSpan === undefined ? {} : { colSpan: size.colSpan }),
		};
	}

	return {
		sectionOrder:
			patch.sectionOrder === undefined
				? clean.sectionOrder
				: keepHiddenInOrder(patch.sectionOrder, laidOutOrder(clean), hidden),
		collapsedSections: { ...clean.collapsedSections, ...patch.collapsedSections },
		hiddenSections: hidden,
		sectionLayout,
	};
}
