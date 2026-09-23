import { useState } from "react";

type SelectionState = {
	/** What the selection belongs to: a filter or page change starts another. */
	scope: string;
	/** Rows of the current page, in the order they were added. */
	ids: readonly string[];
	/** Every row matching the current filters, on every page. */
	all: boolean;
	/** The row last toggled, where a `Shift`+click range starts. */
	anchor: string | null;
};

/** What a bulk action sends: the ids, or « every result » for the current filters. */
export type SelectionTarget = { kind: "ids"; ids: readonly string[] } | { kind: "all" };

export type Selection = {
	/** Whether the row is ticked; every row is while « all results » is selected. */
	isSelected: (id: string) => boolean;
	target: SelectionTarget | null;
	toggle: (id: string) => void;
	/** Ticks every row from the last toggled one to `id`, both included. */
	extendTo: (id: string) => void;
	/** Ticks `id`, keeping the rest. */
	add: (id: string) => void;
	selectAll: () => void;
	clear: () => void;
};

const emptyIn = (scope: string): SelectionState => ({ scope, ids: [], all: false, anchor: null });

/**
 * The rows ticked on `/operations`. `scope` names the filters and the page:
 * when it changes, the selection is empty again, with no effect to wait for,
 * so an action can never apply to rows the list no longer shows. `pageIds`
 * are the rows of the page, in the order shown.
 */
export function useSelection(scope: string, pageIds: readonly string[]): Selection {
	const [stored, setStored] = useState<SelectionState>(() => emptyIn(scope));
	// Dropped for good on a scope change, so going back to the page ticks nothing.
	if (stored.scope !== scope) {
		setStored(emptyIn(scope));
	}

	const kept = stored.scope === scope ? stored : emptyIn(scope);
	// A row deleted or edited out of the filter leaves the page: sent on, it
	// would fail the whole request on `ids`.
	const onPage = new Set(pageIds);
	const state = { ...kept, ids: kept.ids.filter((id) => onPage.has(id)) };
	const update = (next: (current: SelectionState) => SelectionState) =>
		setStored((previous) =>
			next(
				previous.scope === scope
					? { ...previous, ids: previous.ids.filter((id) => onPage.has(id)) }
					: emptyIn(scope),
			),
		);
	const selected = new Set(state.ids);
	const hasAny = state.all || state.ids.length > 0;

	return {
		isSelected: (id) => state.all || selected.has(id),
		target: !hasAny ? null : state.all ? { kind: "all" } : { kind: "ids", ids: state.ids },
		toggle: (id) =>
			update((current) => {
				// Unticking one row of « all results » leaves the rest of the page ticked.
				const ids = current.all ? pageIds : current.ids;

				return {
					...current,
					all: false,
					ids: ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id],
					anchor: id,
				};
			}),
		extendTo: (id) =>
			update((current) => {
				if (current.all) {
					return { ...current, anchor: id };
				}

				const from = current.anchor === null ? -1 : pageIds.indexOf(current.anchor);
				const to = pageIds.indexOf(id);
				const range =
					from === -1 || to === -1
						? [id]
						: pageIds.slice(Math.min(from, to), Math.max(from, to) + 1);
				const { ids } = current;

				return {
					...current,
					ids: [...ids, ...range.filter((other) => !ids.includes(other))],
					anchor: id,
				};
			}),
		add: (id) =>
			update((current) => ({
				...current,
				ids: current.all || current.ids.includes(id) ? current.ids : [...current.ids, id],
				anchor: id,
			})),
		selectAll: () => update((current) => ({ ...current, all: true })),
		clear: () => update(() => emptyIn(scope)),
	};
}
