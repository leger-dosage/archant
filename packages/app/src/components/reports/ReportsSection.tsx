import type { DashboardSortable } from "@/components/DashboardWidget";
import type { KeyboardEvent, ReactNode } from "react";

import { ChevronDownIcon, GripVerticalIcon } from "lucide-react";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { ReportsSection as ReportsSectionKey } from "@archant/data/reports-sections";

import { DashboardWidgetContext, useTouchHold } from "@/components/DashboardWidget";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Sure's reports `holdDelay`: shorter than the dashboard's, the grip being the only target. */
const HOLD_DELAY = 150;

/** Sure's `reports.<section>.title`. */
const REPORTS_SECTION_TITLES = {
	trends_insights: "reports.trends.title",
	transactions_breakdown: "reports.breakdown.title",
	net_worth: "reports.netWorth.title",
	investment_performance: "reports.investments.title",
	investment_flows: "reports.investmentFlows.title",
} as const satisfies Record<ReportsSectionKey, string>;

/**
 * One section of « Rapports », as Sure's `section[data-section-key]`: a list
 * item that a keyboard user grabs with Enter or Space and moves with the
 * arrows, a mouse drags by its grip and a finger holds, its chevron folding
 * it. A viewer gets the section alone: nothing to arrange, nothing saved (AD-21).
 */
export function ReportsSection({
	sectionKey,
	collapsed,
	editable,
	sortable,
	onToggle,
	children,
}: {
	sectionKey: ReportsSectionKey;
	collapsed: boolean;
	editable: boolean;
	sortable: DashboardSortable<ReportsSectionKey>;
	onToggle: () => void;
	children: ReactNode;
}) {
	const { t } = useTranslation();
	const contentId = useId();
	const element = useRef<HTMLDivElement>(null);
	const title = t(REPORTS_SECTION_TITLES[sectionKey]);
	const grabbed = sortable.grabbed === sectionKey;
	const dragging = sortable.dragged === sectionKey;

	useTouchHold(
		element,
		editable,
		{
			start: () => sortable.start(sectionKey),
			over: sortable.over,
			drop: sortable.drop,
			end: sortable.end,
		},
		HOLD_DELAY,
	);

	const toggle = editable ? (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={t("reports.toggleSection")}
			aria-expanded={!collapsed}
			aria-controls={contentId}
			onClick={onToggle}
		>
			<ChevronDownIcon className={cn("transition-transform", collapsed && "-rotate-90")} />
		</Button>
	) : null;

	// A grab surface, not a button that does something, as Sure's: no hover fill.
	const controls = editable ? (
		<button
			type="button"
			draggable
			aria-label={t("reports.dragToReorder")}
			className="flex size-7 cursor-grab items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none group-focus-within/widget:opacity-100 group-hover/widget:opacity-100 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
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
						"aria-label": t("reports.sectionInstructions", { title }),
						onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
							if (event.target !== event.currentTarget) {
								return;
							}

							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								sortable.keyboard(sectionKey, "toggle");
							} else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
								event.preventDefault();
								sortable.keyboard(sectionKey, event.key === "ArrowUp" ? "up" : "down");
							} else if (
								(event.key === "ArrowLeft" || event.key === "ArrowRight") &&
								sortable.grabbed !== null
							) {
								// Keeps the period hotkeys from leaving the page before the order saves on release.
								event.preventDefault();
							} else if (event.key === "Escape" && sortable.grabbed !== null) {
								event.preventDefault();
								sortable.keyboard(sectionKey, "release");
							}
						},
					}
				: {})}
			className={cn(
				"group/widget relative min-w-0 rounded-xl outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
				value={{ toggle, controls, collapsed, contentId, heightPx: 288, colSpan: "single" }}
			>
				<Section title={title}>
					<div className="p-4">{children}</div>
				</Section>
			</DashboardWidgetContext.Provider>
		</div>
	);
}
