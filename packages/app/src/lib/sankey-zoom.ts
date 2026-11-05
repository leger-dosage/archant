type Graph<Node extends { id: string }, Link extends { source: number; target: number }> = {
	nodes: readonly Node[];
	links: readonly Link[];
};

const CENTRE_ID = "cash_flow_node";

/** Each node's links, by the index at `end`. */
function linksBy<Link extends { source: number; target: number }>(
	links: readonly Link[],
	end: "source" | "target",
): Map<number, Link[]> {
	const groups = new Map<number, Link[]>();

	for (const link of links) {
		groups.set(link[end], [...(groups.get(link[end]) ?? []), link]);
	}

	return groups;
}

function canReach(outbound: ReadonlyMap<number, { target: number }[]>, from: number, to: number) {
	const seen = new Set([from]);
	const queue = [from];

	for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
		if (current === to) {
			return true;
		}

		for (const link of outbound.get(current) ?? []) {
			if (!seen.has(link.target)) {
				seen.add(link.target);
				queue.push(link.target);
			}
		}
	}

	return false;
}

/**
 * Sure's `childIndexesFor`: what a node opens onto, away from the centre.
 * The centre and every node after it open onto their targets, every node
 * before it onto its sources.
 */
function childrenOf<Node extends { id: string }, Link extends { source: number; target: number }>(
	graph: Graph<Node, Link>,
	index: number,
): number[] {
	const centre = graph.nodes.findIndex((node) => node.id === CENTRE_ID);
	const outbound = linksBy(graph.links, "source");

	if (centre < 0) {
		return [];
	}

	if (index === centre || canReach(outbound, centre, index)) {
		return (outbound.get(index) ?? []).map((link) => link.target);
	}

	if (canReach(outbound, index, centre)) {
		return (linksBy(graph.links, "target").get(index) ?? []).map((link) => link.source);
	}

	return [];
}

/** Sure's `sankeyNodeHasChildren`: whether a click on the node zooms. */
export function sankeyNodeHasChildren<
	Node extends { id: string },
	Link extends { source: number; target: number },
>(graph: Graph<Node, Link>, id: string): boolean {
	const index = graph.nodes.findIndex((node) => node.id === id);

	return index >= 0 && childrenOf(graph, index).length > 0;
}

/**
 * Sure's `zoomSankeyData`: the node and every node it opens onto, in their
 * order, with the links between them re-indexed. A node that opens onto
 * nothing leaves the graph whole.
 */
export function zoomSankey<
	Node extends { id: string },
	Link extends { source: number; target: number },
>(graph: Graph<Node, Link>, rootId: string): Graph<Node, Link> {
	const root = graph.nodes.findIndex((node) => node.id === rootId);

	if (root < 0) {
		return graph;
	}

	const included = new Set([root]);
	const queue = [root];

	for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
		for (const child of childrenOf(graph, current)) {
			if (!included.has(child)) {
				included.add(child);
				queue.push(child);
			}
		}
	}

	if (included.size <= 1) {
		return graph;
	}

	const kept = graph.nodes.flatMap((_, index) => (included.has(index) ? [index] : []));
	const reindexed = new Map(kept.map((index, position) => [index, position]));

	return {
		nodes: kept.flatMap((index) => graph.nodes[index] ?? []),
		links: graph.links.flatMap((link) => {
			const source = reindexed.get(link.source);
			const target = reindexed.get(link.target);

			return source === undefined || target === undefined ? [] : [{ ...link, source, target }];
		}),
	};
}
