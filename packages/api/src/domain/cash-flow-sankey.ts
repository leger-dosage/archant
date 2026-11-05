import type {
	CashFlowBreakdown,
	CashFlowCategory,
	CashFlowLine,
	SubcategoryLines,
} from "./cash-flow.ts";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

/**
 * What a node stands for: the centre, the surplus, or a category of a side.
 * The interface names the centre and the surplus, as Sure hard-codes theirs.
 */
type SankeyNodeKind = "cash_flow" | "surplus" | "income" | "expense";

type SankeyNode = {
	/** Sure's node keys: `cash_flow_node`, `surplus_node`, `income_<id>`, `expense_sub_<id>`… */
	id: string;
	/** The category's name; `null` for the centre, the surplus and « Sans catégorie ». */
	name: string | null;
	kind: SankeyNodeKind;
	/** The category a node's drill-down opens; `null` for the centre, the surplus and « Sans catégorie ». */
	categoryId: string | null;
	color: string;
	/** The flow through the node, never negative: a flow has no account to be signed from. */
	amount: MinorUnits;
	/** The node over its side's total, or over its parent for a sub-category. */
	share: number;
};

type SankeyLink = {
	/** Indexes into `nodes`. */
	source: number;
	target: number;
	amount: MinorUnits;
	share: number;
	color: string;
};

export type CashFlowSankey = { nodes: SankeyNode[]; links: SankeyLink[] };

/** Sure's `var(--color-success)`, as its Sankey controller maps it for d3. */
const SUCCESS_COLOR = "#10A861";

/** Sure's `Category::UNCATEGORIZED_COLOR`. */
const UNCATEGORISED_COLOR = "#737373";

type Side = "income" | "expense";

/** A sub-category netted across both sides, on the side of its net. */
type NetSubcategory = { categoryId: string; name: string; amount: MinorUnits; side: Side };

/**
 * Sure's `build_net_subcategories`: each sub-category's expense rows netted
 * against its income rows, by parent, zero dropped.
 */
function netSubcategories(subcategories: SubcategoryLines): Map<string, NetSubcategory[]> {
	const sums = new Map<string, { parentId: string; name: string; amount: number }>();

	for (const [parentId, lines] of [...subcategories.expense, ...subcategories.income]) {
		for (const line of lines) {
			const current = sums.get(line.categoryId);
			sums.set(line.categoryId, {
				parentId,
				name: line.name,
				amount: (current?.amount ?? 0) + line.amount,
			});
		}
	}

	const byParent = new Map<string, NetSubcategory[]>();

	for (const [categoryId, { parentId, name, amount }] of sums) {
		if (amount !== 0) {
			byParent.set(parentId, [
				...(byParent.get(parentId) ?? []),
				{
					categoryId,
					name,
					amount: toMinorUnits(Math.abs(amount)),
					side: amount > 0 ? "income" : "expense",
				},
			]);
		}
	}

	return byParent;
}

const shareOf = (amount: MinorUnits, total: MinorUnits) => (total === 0 ? 0 : amount / total);

/**
 * Sure's `build_cashflow_sankey_data` and `process_net_category_nodes` over
 * the net view (AD-9): each net income line flows into the centre, the
 * centre into each net expense line and, when income exceeds expenses, into
 * the surplus. Sure draws no deficit node. A sub-category netted on its
 * parent's side hangs from its parent; one netted on the other side stands
 * alone on that side, linked straight to the centre, its share over that
 * side's total. A sub-category of a parent netted to zero is dropped, as the
 * parent is. The centre is always there; a period without a counted row has
 * no link.
 */
export function cashFlowSankey(
	net: CashFlowBreakdown,
	subcategories: SubcategoryLines,
	categories: readonly CashFlowCategory[],
): CashFlowSankey {
	const colors = new Map(categories.map((category) => [category.id, category.color]));
	const nodes: SankeyNode[] = [];
	const links: SankeyLink[] = [];
	const totals: Record<Side, MinorUnits> = {
		income: toMinorUnits(Math.abs(net.income)),
		expense: toMinorUnits(Math.abs(net.expenses)),
	};
	const subsByParent = netSubcategories(subcategories);

	// Every id is unique: a sub-category has one parent, on one side, so
	// Sure's `node_indices` lookup never finds one already added.
	const addNode = (node: SankeyNode): number => nodes.push(node) - 1;

	const addLink = (
		source: number,
		target: number,
		amount: MinorUnits,
		share: number,
		color: string,
	) => links.push({ source, target, amount, share, color });

	/** Income flows into the centre; the centre flows into an expense. */
	const linkToCentre = (
		side: Side,
		index: number,
		amount: MinorUnits,
		share: number,
		color: string,
	) =>
		side === "income"
			? addLink(index, centre, amount, share, color)
			: addLink(centre, index, amount, share, color);

	const centre = addNode({
		id: "cash_flow_node",
		name: null,
		kind: "cash_flow",
		categoryId: null,
		color: SUCCESS_COLOR,
		amount: totals.income,
		share: 1,
	});

	const processSide = (side: Side, lines: readonly CashFlowLine[]) => {
		const other: Side = side === "income" ? "expense" : "income";

		for (const line of lines) {
			const amount = toMinorUnits(Math.abs(line.amount));
			const share = shareOf(amount, totals[side]);
			const color = line.color ?? UNCATEGORISED_COLOR;
			const subs = line.categoryId === null ? [] : (subsByParent.get(line.categoryId) ?? []);
			const parent = addNode({
				id: `${side}_${line.categoryId ?? "uncategorised"}`,
				name: line.name,
				kind: side,
				categoryId: line.categoryId,
				color,
				amount,
				share,
			});
			linkToCentre(side, parent, amount, share, color);

			for (const sub of subs.filter((item) => item.side === side)) {
				const subShare = shareOf(sub.amount, amount);
				const subColor = colors.get(sub.categoryId) ?? color;
				const child = addNode({
					id: `${side}_sub_${sub.categoryId}`,
					name: sub.name,
					kind: side,
					categoryId: sub.categoryId,
					color: subColor,
					amount: sub.amount,
					share: subShare,
				});

				if (side === "income") {
					addLink(child, parent, sub.amount, subShare, subColor);
				} else {
					addLink(parent, child, sub.amount, subShare, subColor);
				}
			}

			for (const sub of subs.filter((item) => item.side === other)) {
				const subShare = shareOf(sub.amount, totals[other]);
				const subColor = colors.get(sub.categoryId) ?? color;
				const standalone = addNode({
					id: `${other}_sub_${sub.categoryId}`,
					name: sub.name,
					kind: other,
					categoryId: sub.categoryId,
					color: subColor,
					amount: sub.amount,
					share: subShare,
				});
				linkToCentre(other, standalone, sub.amount, subShare, subColor);
			}
		}
	};

	processSide("income", net.lines.income);
	processSide("expense", net.lines.expense);

	const surplus = toMinorUnits(totals.income - totals.expense);

	if (surplus > 0) {
		const share = shareOf(surplus, totals.income);
		const index = addNode({
			id: "surplus_node",
			name: null,
			kind: "surplus",
			categoryId: null,
			color: SUCCESS_COLOR,
			amount: surplus,
			share,
		});
		addLink(centre, index, surplus, share, SUCCESS_COLOR);
	}

	return { nodes, links };
}
