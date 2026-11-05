import type { DashboardLayoutData } from "@/hooks/useDashboardLayout";
import type { KeyboardEvent, ReactNode, RefObject } from "react";

import {
	ChevronDownIcon,
	EyeOffIcon,
	GripVerticalIcon,
	MoveHorizontalIcon,
	MoveVerticalIcon,
	SlidersHorizontalIcon,
} from "lucide-react";
import {
	createContext,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";

import type {
	DashboardColSpan,
	DashboardHeightPreset,
	DashboardSection,
} from "@archant/data/dashboard-sections";
import {
	DASHBOARD_HEIGHT_PRESET_KEYS,
	DASHBOARD_HEIGHT_PRESETS,
	DASHBOARD_SECTION_LAYOUTS,
} from "@archant/data/dashboard-sections";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/** What a widget's `Section` reads from the dashboard around it. */
type DashboardWidgetContextValue = {
	/** The chevron, before the title. */
	toggle: ReactNode;
	/** Hiding, the size menu and the grip, before the section's own action. */
	controls: ReactNode;
	collapsed: boolean;
	/** The id of the content the chevron shows and hides. */
	contentId: string;
	/** The chart height of a widget that takes a height preset. */
	heightPx: (typeof DASHBOARD_HEIGHT_PRESETS)[DashboardHeightPreset];
	colSpan: DashboardColSpan;
};

const DashboardWidgetContext = createContext<DashboardWidgetContextValue | null>(null);

/** The dashboard widget a section sits in, null anywhere else. */
export function useDashboardWidget(): DashboardWidgetContextValue | null {
	return useContext(DashboardWidgetContext);
}

/** Sure's `pages.dashboard.<key>.title`, as « Réglages » and the hidden-widget card name them. */
export const SECTION_TITLES = {
	cashflow_sankey: "dashboard.cashflowSankey.title",
	outflows_donut: "dashboard.outflowsDonut.title",
	net_worth_chart: "dashboard.netWorth",
	balance_sheet: "dashboard.balanceSheet.title",
	money_flow: "dashboard.moneyFlow.title",
	spending_trend: "dashboard.spendingTrend.title",
	investment_summary: "dashboard.investmentSummary.title",
	goals: "dashboard.goals.title",
} as const satisfies Record<DashboardSection, string>;

type LayoutChange = (change: {
	collapsedSections?: Partial<Record<DashboardSection, boolean>>;
	hiddenSections?: Partial<Record<DashboardSection, boolean>>;
	sectionLayout?: Partial<
		Record<DashboardSection, { height?: DashboardHeightPreset; colSpan?: DashboardColSpan }>
	>;
	sectionOrder?: DashboardSection[];
}) => void;

/**
 * Sure's `dashboard-widget-size` menu: « Largeur » on a widget whose width
 * may change, shown only where two columns are, and « Hauteur » on a chart
 * that takes a preset. A pick applies at once and saves.
 */
function SizeMenu({
	sectionKey,
	size,
	onChange,
}: {
	sectionKey: DashboardSection;
	size: { height: DashboardHeightPreset; colSpan: DashboardColSpan };
	onChange: LayoutChange;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const { grow, widthToggle } = DASHBOARD_SECTION_LAYOUTS[sectionKey];

	if (!grow && !widthToggle) {
		return null;
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t("dashboard.widgetSize.label")}
					title={t("dashboard.widgetSize.label")}
					// Sure's `hidden lg:block`; a menu offering only the width shows only
					// where the width changes anything, its `show_width && two_column`.
					className={cn(
						"hidden opacity-0 group-focus-within/widget:opacity-100 group-hover/widget:opacity-100 data-[state=open]:opacity-100",
						grow ? "lg:inline-flex" : "2xl:inline-flex",
					)}
				>
					<SlidersHorizontalIcon />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="flex w-52 flex-col gap-3 p-3">
				{widthToggle && (
					<div className={cn("flex flex-col gap-1.5", grow && "hidden 2xl:flex")}>
						<p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
							<MoveHorizontalIcon aria-hidden="true" className="size-3.5" />
							{t("dashboard.widgetSize.widthLabel")}
						</p>
						<ToggleGroup
							type="single"
							variant="outline"
							size="sm"
							spacing={0}
							className="w-full"
							aria-label={t("dashboard.widgetSize.widthLabel")}
							value={size.colSpan}
							// Radix reports an empty value when the pressed item is pressed again.
							onValueChange={(value) => {
								if (value === "single" || value === "full") {
									onChange({ sectionLayout: { [sectionKey]: { colSpan: value } } });
									setOpen(false);
								}
							}}
						>
							<ToggleGroupItem value="single" className="flex-1">
								{t("dashboard.widgetSize.half")}
							</ToggleGroupItem>
							<ToggleGroupItem value="full" className="flex-1">
								{t("dashboard.widgetSize.full")}
							</ToggleGroupItem>
						</ToggleGroup>
					</div>
				)}
				{grow && (
					<div className="flex flex-col gap-1.5">
						<p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
							<MoveVerticalIcon aria-hidden="true" className="size-3.5" />
							{t("dashboard.widgetSize.heightLabel")}
						</p>
						<ToggleGroup
							type="single"
							variant="outline"
							size="sm"
							spacing={0}
							className="w-full"
							aria-label={t("dashboard.widgetSize.heightLabel")}
							value={size.height}
							onValueChange={(value) => {
								const preset = DASHBOARD_HEIGHT_PRESET_KEYS.find((each) => each === value);

								if (preset !== undefined) {
									onChange({ sectionLayout: { [sectionKey]: { height: preset } } });
									setOpen(false);
								}
							}}
						>
							{DASHBOARD_HEIGHT_PRESET_KEYS.map((preset) => (
								<ToggleGroupItem key={preset} value={preset} className="flex-1">
									{t(`dashboard.widgetSize.${preset}`)}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

/** Pointer moves past this many pixels before the hold ends cancel it, Sure's 10 px radius. */
const HOLD_SLOP = 10;

/** Sure's `holdDelay`: a deliberate press, so a scroll never picks a widget up. */
const HOLD_DELAY = 800;

/** One reorder in progress, shared by every widget of the grid. */
export type DashboardSortable = {
	/** The widget a keyboard user holds, if any. */
	grabbed: DashboardSection | null;
	/** The widget a dragged one would land before. */
	dropTarget: DashboardSection | null;
	dragged: DashboardSection | null;
	/** Whether a drag runs, read at once: the first `dragover` can come before the next render. */
	dragging: () => boolean;
	keyboard: (key: DashboardSection, action: "toggle" | "up" | "down" | "release") => void;
	start: (key: DashboardSection) => void;
	over: (x: number, y: number) => void;
	drop: (x: number, y: number) => void;
	end: () => void;
	register: (key: DashboardSection, element: HTMLElement | null) => void;
};

/**
 * Sure's `dashboard_sortable_controller.js`: a keyboard grab moves a widget
 * among the shown ones and saves on release; a mouse drag or a touch hold
 * drops it before the widget whose centre is nearest. Widgets that draw
 * nothing are skipped, as Sure never renders them.
 */
export function useDashboardSortable(
	order: readonly DashboardSection[],
	onSave: (order: DashboardSection[]) => void,
): { order: readonly DashboardSection[]; sortable: DashboardSortable } {
	const [grabbed, setGrabbed] = useState<DashboardSection | null>(null);
	const [draft, setDraft] = useState<DashboardSection[] | null>(null);
	const [dragged, setDragged] = useState<DashboardSection | null>(null);
	const [dropTarget, setDropTarget] = useState<DashboardSection | null>(null);
	const draggedNow = useRef<DashboardSection | null>(null);
	const elements = useRef(new Map<DashboardSection, HTMLElement>());
	const shown = draft ?? order;

	const rendered = (key: DashboardSection) =>
		(elements.current.get(key)?.getClientRects().length ?? 0) > 0;

	// React moves the node, and a moved node loses focus: the held widget keeps it.
	useLayoutEffect(() => {
		if (grabbed !== null) {
			elements.current.get(grabbed)?.focus();
		}
	}, [grabbed, draft]);

	const nearest = (x: number, y: number): DashboardSection | null => {
		let closest: DashboardSection | null = null;
		let distance = Number.POSITIVE_INFINITY;

		for (const key of shown) {
			const element = elements.current.get(key);

			if (key === draggedNow.current || element === undefined || !rendered(key)) {
				continue;
			}

			const box = element.getBoundingClientRect();
			const next = Math.hypot(x - (box.left + box.width / 2), y - (box.top + box.height / 2));

			if (next < distance) {
				distance = next;
				closest = key;
			}
		}

		return closest;
	};

	const move = (key: DashboardSection, step: -1 | 1) => {
		const current = [...shown];
		const index = current.indexOf(key);
		let target = index + step;

		while (target >= 0 && target < current.length && !rendered(current[target]!)) {
			target += step;
		}

		if (target < 0 || target >= current.length) {
			return;
		}

		// Removing the widget first shifts a later target back by one, so it lands after it.
		current.splice(index, 1);
		current.splice(target, 0, key);
		setDraft(current);
	};

	const release = () => {
		if (draft !== null) {
			onSave(draft);
		}

		setGrabbed(null);
		setDraft(null);
	};

	return {
		order: shown,
		sortable: {
			grabbed,
			dragged,
			dropTarget,
			keyboard: (key, action) => {
				if (action === "toggle") {
					if (grabbed === key) {
						release();
					} else {
						// Grabbing another widget releases the one held, as Sure's.
						release();
						setGrabbed(key);
					}
				} else if (action === "release") {
					release();
				} else if (grabbed === key) {
					move(key, action === "up" ? -1 : 1);
				}
			},
			dragging: () => draggedNow.current !== null,
			start: (key) => {
				draggedNow.current = key;
				setDragged(key);
			},
			over: (x, y) => setDropTarget(nearest(x, y)),
			drop: (x, y) => {
				const target = nearest(x, y);
				const moving = draggedNow.current;

				if (moving !== null && target !== null) {
					const next = shown.filter((each) => each !== moving);
					next.splice(next.indexOf(target), 0, moving);
					onSave(next);
				}

				draggedNow.current = null;
				setDragged(null);
				setDropTarget(null);
			},
			end: () => {
				draggedNow.current = null;
				setDragged(null);
				setDropTarget(null);
			},
			register: (key, element) => {
				if (element === null) {
					elements.current.delete(key);
				} else {
					elements.current.set(key, element);
				}
			},
		},
	};
}

/**
 * Sure's touch reorder: an 800 ms hold picks the widget up, a move past
 * 10 px before then is a scroll and cancels it. Listeners of its own, not
 * React's, because a move must be able to stop the page scrolling, which a
 * passive listener cannot.
 */
function useTouchHold(
	element: RefObject<HTMLElement | null>,
	enabled: boolean,
	callbacks: {
		start: () => void;
		over: (x: number, y: number) => void;
		drop: (x: number, y: number) => void;
		end: () => void;
	},
) {
	const latest = useRef(callbacks);
	latest.current = callbacks;

	useEffect(() => {
		const node = element.current;

		if (!enabled || node === null) {
			return undefined;
		}

		let timer: ReturnType<typeof setTimeout> | undefined;
		let active = false;
		let origin = { x: 0, y: 0 };
		let last = { x: 0, y: 0 };

		const reset = () => {
			clearTimeout(timer);
			timer = undefined;
			active = false;
			node.style.userSelect = "";
		};

		const onStart = (event: TouchEvent) => {
			const touch = event.touches[0];

			if (touch === undefined) {
				return;
			}

			origin = { x: touch.clientX, y: touch.clientY };
			last = origin;
			node.style.userSelect = "none";
			// A second finger restarts the hold: the first timer would fire after the lift.
			clearTimeout(timer);
			timer = setTimeout(() => {
				active = true;
				latest.current.start();
				navigator.vibrate?.(30);
			}, HOLD_DELAY);
		};

		const onMove = (event: TouchEvent) => {
			const touch = event.touches[0];

			if (touch === undefined) {
				return;
			}

			if (!active) {
				if (Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y) > HOLD_SLOP) {
					reset();
				}

				return;
			}

			event.preventDefault();
			last = { x: touch.clientX, y: touch.clientY };
			latest.current.over(last.x, last.y);
		};

		const onEnd = () => {
			if (active) {
				latest.current.drop(last.x, last.y);
			} else {
				latest.current.end();
			}

			reset();
		};

		node.addEventListener("touchstart", onStart, { passive: true });
		node.addEventListener("touchmove", onMove, { passive: false });
		node.addEventListener("touchend", onEnd);
		node.addEventListener("touchcancel", onEnd);

		return () => {
			reset();
			node.removeEventListener("touchstart", onStart);
			node.removeEventListener("touchmove", onMove);
			node.removeEventListener("touchend", onEnd);
			node.removeEventListener("touchcancel", onEnd);
		};
	}, [element, enabled]);
}

/**
 * One dashboard widget, as Sure's `section[data-section-key]`: a list item
 * that a keyboard user grabs with Enter or Space and moves with the arrows,
 * a mouse drags by its grip and a finger holds, and that lends its section
 * the chevron, the size menu and the grip. A viewer gets the widget alone:
 * nothing to arrange, nothing saved (AD-21).
 */
export function DashboardWidget({
	sectionKey,
	layout,
	editable,
	customizing,
	sortable,
	onChange,
	children,
}: {
	sectionKey: DashboardSection;
	layout: DashboardLayoutData;
	/** An administrator's: the controls show and every change saves. */
	editable: boolean;
	customizing: boolean;
	sortable: DashboardSortable;
	onChange: LayoutChange;
	children: ReactNode;
}) {
	const { t } = useTranslation();
	const contentId = useId();
	const element = useRef<HTMLDivElement>(null);
	const size = layout.sectionLayout[sectionKey];
	const collapsed = layout.collapsedSections[sectionKey];
	const title = t(SECTION_TITLES[sectionKey]);
	const grabbed = sortable.grabbed === sectionKey;
	const dragging = sortable.dragged === sectionKey;

	useTouchHold(element, editable, {
		start: () => sortable.start(sectionKey),
		over: sortable.over,
		drop: sortable.drop,
		end: sortable.end,
	});

	const toggle = editable ? (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={t("dashboard.toggleSection")}
			aria-expanded={!collapsed}
			aria-controls={contentId}
			onClick={() => onChange({ collapsedSections: { [sectionKey]: !collapsed } })}
		>
			<ChevronDownIcon className={cn("transition-transform", collapsed && "-rotate-90")} />
		</Button>
	) : null;

	const controls = editable ? (
		<div className="flex items-center gap-1">
			{customizing && (
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t("dashboard.customize.hide", { title })}
					title={t("dashboard.customize.hide", { title })}
					onClick={() => onChange({ hiddenSections: { [sectionKey]: true } })}
				>
					<EyeOffIcon />
				</Button>
			)}
			<SizeMenu sectionKey={sectionKey} size={size} onChange={onChange} />
			{/* A grab surface, not a button that does something, as Sure's: no hover fill. */}
			<button
				type="button"
				draggable
				aria-label={t("dashboard.dragToReorder")}
				className="hidden size-7 cursor-grab items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none group-focus-within/widget:opacity-100 group-hover/widget:opacity-100 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing lg:flex"
				onDragStart={(event) => {
					event.dataTransfer.effectAllowed = "move";
					// Firefox starts no drag without data.
					event.dataTransfer.setData("text/plain", sectionKey);

					sortable.start(sectionKey);
				}}
				onDragEnd={sortable.end}
			>
				<GripVerticalIcon aria-hidden="true" className="size-4" />
			</button>
		</div>
	) : null;

	return (
		<div
			ref={(node) => {
				element.current = node;
				sortable.register(sectionKey, node);
			}}
			role="listitem"
			data-section-key={sectionKey}
			{...(editable
				? {
						tabIndex: 0,
						"aria-grabbed": grabbed || dragging,
						"aria-label": t("dashboard.widgetInstructions", { title }),
						onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
							// Keys on a control inside belong to that control, not to the grab.
							if (event.target !== event.currentTarget) {
								return;
							}

							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								sortable.keyboard(sectionKey, "toggle");
							} else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
								event.preventDefault();
								sortable.keyboard(sectionKey, event.key === "ArrowUp" ? "up" : "down");
							} else if (event.key === "Escape" && sortable.grabbed !== null) {
								event.preventDefault();
								sortable.keyboard(sectionKey, "release");
							}
						},
					}
				: {})}
			className={cn(
				// A widget that draws nothing takes no room, as Sure never renders it.
				"group/widget relative min-w-0 rounded-xl outline-none transition-opacity empty:hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
				size.colSpan === "full" && "2xl:col-span-2",
				grabbed && "ring-2 ring-primary ring-offset-2",
				dragging && "opacity-50",
			)}
		>
			{sortable.dropTarget === sectionKey && (
				<span
					aria-hidden="true"
					className="absolute inset-x-0 -top-3.5 h-1 rounded-full bg-primary"
				/>
			)}
			<DashboardWidgetContext.Provider
				value={{
					toggle,
					controls,
					collapsed,
					contentId,
					heightPx: DASHBOARD_HEIGHT_PRESETS[size.height],
					colSpan: size.colSpan,
				}}
			>
				{children}
			</DashboardWidgetContext.Provider>
		</div>
	);
}
