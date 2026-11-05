import type { DashboardCashFlowData } from "@/hooks/useDashboardCashFlow";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { SankeyLinkProps, SankeyNodeProps } from "recharts";

import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveContainer, Sankey } from "recharts";

import { UNCATEGORISED } from "@archant/api/schemas/transactions";
import { toMinorUnits } from "@archant/data/money";

import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format-money";
import { intlLocale } from "@/lib/locale";
import { sankeyNodeHasChildren, zoomSankey } from "@/lib/sankey-zoom";

type FlowNode = DashboardCashFlowData["sankey"]["nodes"][number];

type FlowLink = DashboardCashFlowData["sankey"]["links"][number];

/** A node as recharts lays it out: its own fields, then its place. */
type LaidOutNode = FlowNode & { label: string; depth: number; x: number; y: number; dy: number };

/** What the pointer rests on: a node, or a link, by index. */
type Hovered = { kind: "node"; index: number } | { kind: "link"; index: number } | null;

type Tooltip = { x: number; y: number; context: string; amount: number; share: number };

// Sure's `sankey_chart_controller` constants.
const NODE_WIDTH = 15;
const NODE_PADDING = 20;
const MIN_NODE_PADDING = 4;
const MAX_PADDING_RATIO = 0.4;
const EXTENT_MARGIN = 16;
const HOVER_OPACITY = 0.4;
const LINK_OPACITY = 0.1;
const CORNER_RADIUS = 8;
const MIN_LABEL_SPACING = 28;

/** Sure's shares, `percentage.round(1)`. */
const shareFormat = new Intl.NumberFormat(intlLocale, {
	style: "percent",
	maximumFractionDigits: 1,
});

/** Sure's `calculateNodePadding`: many nodes share the height rather than overflow it. */
function nodePadding(nodeCount: number, height: number): number {
	const available = (height - EXTENT_MARGIN * 2) * MAX_PADDING_RATIO;

	return Math.max(
		MIN_NODE_PADDING,
		Math.min(NODE_PADDING, Math.floor(available / Math.max(nodeCount - 1, 1))),
	);
}

/**
 * Sure's `calculateHiddenLabels`: in each column, top to bottom, a label too
 * close to the last one shown is hidden; a tall chart keeps every tall node's.
 */
function hiddenLabels(nodes: ReadonlyMap<number, LaidOutNode>, height: number): Set<number> {
	const hidden = new Set<number>();
	const large = height > 600;
	const spacing = large ? MIN_LABEL_SPACING * 0.7 : MIN_LABEL_SPACING;
	const columns = new Map<number, [number, LaidOutNode][]>();

	for (const entry of nodes) {
		columns.set(entry[1].depth, [...(columns.get(entry[1].depth) ?? []), entry]);
	}

	for (const column of columns.values()) {
		let lastShown = Number.NEGATIVE_INFINITY;

		for (const [index, node] of column.toSorted(
			([, a], [, b]) => a.y + a.dy / 2 - (b.y + b.dy / 2),
		)) {
			const middle = node.y + node.dy / 2;

			if (large && node.dy > spacing * 1.5) {
				lastShown = middle;
			} else if (middle - lastShown < spacing) {
				hidden.add(index);
			} else {
				lastShown = middle;
			}
		}
	}

	return hidden;
}

/** Sure's `nodePath`: a source's left corners rounded, a target's right ones. */
function nodePath(
	x: number,
	y: number,
	width: number,
	height: number,
	side: "left" | "right" | null,
) {
	const r = Math.max(0, Math.min(CORNER_RADIUS, height / 2));
	const [x0, y0, x1, y1] = [x, y, x + width, y + height];

	if (side === null || height < r * 2) {
		return `M ${x0},${y0} L ${x1},${y0} L ${x1},${y1} L ${x0},${y1} Z`;
	}

	return side === "left"
		? `M ${x0 + r},${y0} L ${x1},${y0} L ${x1},${y1} L ${x0 + r},${y1} Q ${x0},${y1} ${x0},${y1 - r} L ${x0},${y0 + r} Q ${x0},${y0} ${x0 + r},${y0} Z`
		: `M ${x0},${y0} L ${x1 - r},${y0} Q ${x1},${y0} ${x1},${y0 + r} L ${x1},${y1 - r} Q ${x1},${y1} ${x1 - r},${y1} L ${x0},${y1} Z`;
}

/** Sure's `isNavigableCategoryNode`: the centre and the surplus open no list. */
const isCategoryNode = (node: FlowNode) => node.kind === "income" || node.kind === "expense";

/**
 * Sure's cash flow Sankey, drawn by recharts: income lines flow into the
 * centre, the centre into expense lines and the surplus, links in a
 * gradient of their ends' colours. A label sits right of a node in the left
 * half, left of it otherwise, its name above its amount; labels that would
 * overlap in a column hide until a hover shows them. Hovering a node or a
 * link dims the rest and names it in a tooltip. Clicking a category's label
 * opens its transactions of the period; clicking a node that opens onto
 * others zooms onto them, « Retour à la trésorerie totale » zooming out.
 */
export function CashFlowSankey({
	data,
	height,
	label,
}: {
	data: DashboardCashFlowData;
	height: number;
	/** The sentence that describes the chart to assistive technology. */
	label: string;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const gradientPrefix = useId();
	const [zoomRoot, setZoomRoot] = useState<string | null>(null);
	const [hovered, setHovered] = useState<Hovered>(null);
	const [tooltip, setTooltip] = useState<Tooltip | null>(null);
	const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
	// Bumped once the container has measured: recharts draws the nodes in that
	// later render, after which the label hiding below can read their places.
	const [, setMeasured] = useState(0);
	const container = useRef<HTMLDivElement>(null);
	// Filled while recharts draws the nodes, read once it has: label hiding
	// needs every node's place in its column.
	const laidOut = useRef(new Map<number, LaidOutNode>());

	const graph = zoomRoot === null ? data.sankey : zoomSankey(data.sankey, zoomRoot);
	const nameOf = (node: FlowNode) =>
		node.kind === "cash_flow"
			? t("dashboard.cashflowSankey.cashFlow")
			: node.kind === "surplus"
				? t("dashboard.cashflowSankey.surplus")
				: (node.name ?? t("dashboard.uncategorised"));
	const money = (amount: number) =>
		formatMoney({ amount: toMinorUnits(amount), currency: data.currency });
	const chartData = {
		nodes: graph.nodes.map((node) => ({ ...node, label: nameOf(node) })),
		links: graph.links.map((link) => ({ ...link, value: link.amount })),
	};

	useLayoutEffect(() => {
		const next = hiddenLabels(laidOut.current, height);

		setHidden((current) =>
			current.size === next.size && [...next].every((index) => current.has(index)) ? current : next,
		);
	});

	const connected = (() => {
		if (hovered === null) {
			return null;
		}

		const links = graph.links.flatMap((link, index) =>
			hovered.kind === "link"
				? index === hovered.index
					? [index]
					: []
				: link.source === hovered.index || link.target === hovered.index
					? [index]
					: [],
		);
		const nodes = new Set(
			links.flatMap((index) => {
				const link = graph.links[index];

				return link === undefined ? [] : [link.source, link.target];
			}),
		);

		if (hovered.kind === "node") {
			nodes.add(hovered.index);
		}

		return { links: new Set(links), nodes };
	})();

	const pointAt = (event: ReactMouseEvent) => {
		const box = container.current?.getBoundingClientRect();

		return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
	};

	const showNode = (event: ReactMouseEvent, index: number) => {
		const node = graph.nodes[index];

		if (node !== undefined) {
			setHovered({ kind: "node", index });
			setTooltip({
				...pointAt(event),
				context: nameOf(node),
				amount: node.amount,
				share: node.share,
			});
		}
	};

	const leave = () => {
		setHovered(null);
		setTooltip(null);
	};

	const zoomInto = (node: FlowNode) => {
		if (sankeyNodeHasChildren(graph, node.id)) {
			setZoomRoot(node.id);
			leave();
		}
	};

	const openTransactions = (node: FlowNode) => {
		if (!isCategoryNode(node)) {
			zoomInto(node);
			return;
		}

		void navigate({
			to: "/transactions",
			search: {
				// A net line holds both signs: its list shows every row it nets.
				category: [node.categoryId ?? UNCATEGORISED],
				from: data.from,
				to: data.to,
			},
		});
	};

	const renderNode = (props: SankeyNodeProps) => {
		const index = props.index;
		const flow = graph.nodes[index];

		if (flow === undefined) {
			return <g />;
		}

		const node: LaidOutNode = {
			...flow,
			label: nameOf(flow),
			depth: props.payload.depth,
			x: props.x,
			y: props.y,
			dy: props.height,
		};
		laidOut.current.set(index, node);
		const onLeft = props.x < (container.current?.clientWidth ?? 0) / 2;
		const isSource = graph.links.some((link) => link.source === index);
		const isTarget = graph.links.some((link) => link.target === index);
		const corners = isSource === isTarget ? null : isSource ? "left" : "right";
		const dimmed = connected !== null && !connected.nodes.has(index);
		const labelShown = connected === null ? !hidden.has(index) : connected.nodes.has(index);
		const zooms = sankeyNodeHasChildren(graph, node.id);
		const labelOpens = isCategoryNode(node) || zooms;

		return (
			<g
				key={`node-${node.id}`}
				data-node={node.id}
				style={{ opacity: dimmed ? HOVER_OPACITY : 1, transition: "opacity 0.3s ease" }}
			>
				<path
					d={nodePath(props.x, props.y, props.width, props.height, corners)}
					fill={node.color}
					style={{ cursor: zooms ? "pointer" : "default" }}
					onMouseEnter={(event) => showNode(event, index)}
					onMouseMove={(event) => showNode(event, index)}
					onMouseLeave={leave}
					onClick={() => zoomInto(node)}
				/>
				<text
					x={onLeft ? props.x + props.width + 6 : props.x - 6}
					y={props.y + props.height / 2}
					dy="-0.2em"
					textAnchor={onLeft ? "start" : "end"}
					className="fill-foreground text-xs font-medium select-none"
					style={{
						opacity: labelShown ? 1 : 0,
						cursor: labelOpens ? "pointer" : "default",
						transition: "opacity 0.2s ease",
					}}
					onMouseEnter={(event) => showNode(event, index)}
					onMouseMove={(event) => showNode(event, index)}
					onMouseLeave={leave}
					onClick={() => openTransactions(node)}
				>
					<tspan>{node.label}</tspan>
					<tspan
						x={onLeft ? props.x + props.width + 6 : props.x - 6}
						dy="1.2em"
						// Sure's 0.65rem falls under DESIGN.md's 12 px floor for any text.
						className="fill-muted-foreground font-mono text-xs"
					>
						{money(node.amount)}
					</tspan>
				</text>
			</g>
		);
	};

	const renderLink = (props: SankeyLinkProps) => {
		const link: FlowLink | undefined = graph.links[props.index];
		const source = link === undefined ? undefined : graph.nodes[link.source];
		const target = link === undefined ? undefined : graph.nodes[link.target];

		if (link === undefined || source === undefined || target === undefined) {
			return <path />;
		}

		const id = `${gradientPrefix}-link-${props.index}`;
		const dimmed = connected !== null && !connected.links.has(props.index);

		return (
			<g key={`link-${props.index}`}>
				<defs>
					<linearGradient
						id={id}
						gradientUnits="userSpaceOnUse"
						x1={props.sourceX}
						x2={props.targetX}
					>
						<stop offset="0%" stopColor={source.color} stopOpacity={LINK_OPACITY} />
						<stop offset="100%" stopColor={target.color} stopOpacity={LINK_OPACITY} />
					</linearGradient>
				</defs>
				<path
					d={`M${props.sourceX},${props.sourceY} C${props.sourceControlX},${props.sourceY} ${props.targetControlX},${props.targetY} ${props.targetX},${props.targetY}`}
					fill="none"
					stroke={`url(#${CSS.escape(id)})`}
					strokeWidth={Math.max(1, props.linkWidth)}
					style={{
						opacity: dimmed ? HOVER_OPACITY : 1,
						filter: connected?.links.has(props.index) ? "saturate(1.3) brightness(1.1)" : "none",
						transition: "opacity 0.3s ease",
					}}
					onMouseEnter={(event) => {
						setHovered({ kind: "link", index: props.index });
						setTooltip({
							...pointAt(event),
							context: t("dashboard.cashflowSankey.flow", {
								source: nameOf(source),
								target: nameOf(target),
							}),
							amount: link.amount,
							share: link.share,
						});
					}}
					onMouseMove={(event) =>
						setTooltip((current) => (current === null ? null : { ...current, ...pointAt(event) }))
					}
					onMouseLeave={leave}
				/>
			</g>
		);
	};

	laidOut.current = new Map();

	return (
		<div className="flex h-full flex-col gap-2">
			{zoomRoot !== null && (
				<div className="flex justify-start px-4">
					<Button
						variant="ghost"
						size="icon-sm"
						title={t("dashboard.cashflowSankey.zoomOut")}
						aria-label={t("dashboard.cashflowSankey.zoomOut")}
						onClick={() => {
							setZoomRoot(null);
							leave();
						}}
					>
						<ArrowLeftIcon />
					</Button>
				</div>
			)}
			<div ref={container} role="img" aria-label={label} className="relative min-h-0 flex-1">
				<ResponsiveContainer
					width="100%"
					height={height}
					onResize={() => setMeasured((count) => count + 1)}
				>
					<Sankey
						data={chartData}
						nameKey="label"
						sort={false}
						nodeWidth={NODE_WIDTH}
						nodePadding={nodePadding(graph.nodes.length, height)}
						margin={{
							top: EXTENT_MARGIN,
							right: EXTENT_MARGIN,
							bottom: EXTENT_MARGIN,
							left: EXTENT_MARGIN,
						}}
						node={renderNode}
						link={renderLink}
						accessibilityLayer={false}
					/>
				</ResponsiveContainer>
				{tooltip !== null && (
					<div
						role="tooltip"
						className="pointer-events-none absolute z-10 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
						style={{ left: tooltip.x + 10, top: tooltip.y - 10 }}
					>
						<div className="mb-1 max-w-64 truncate text-xs text-muted-foreground">
							{tooltip.context}
						</div>
						<div>
							<span className="font-medium tabular-nums">{money(tooltip.amount)}</span>{" "}
							<span className="text-muted-foreground">({shareFormat.format(tooltip.share)})</span>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
