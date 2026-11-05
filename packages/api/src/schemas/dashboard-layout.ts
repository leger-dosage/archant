import { z } from "zod";

import type { DashboardLayoutPatch } from "@archant/data/dashboard-layout";
import {
	DASHBOARD_COL_SPANS,
	DASHBOARD_HEIGHT_PRESET_KEYS,
	DASHBOARD_SECTION_LAYOUTS,
	DASHBOARD_SECTIONS,
} from "@archant/data/dashboard-sections";

const section = z.enum(DASHBOARD_SECTIONS);

/**
 * One change to the dashboard, as Sure's `preferences_params`, each part
 * optional because each control saves its own. A key Archant has no widget
 * for, `insights_feed` included, is refused rather than stored; so is a size
 * the widget's guardrails do not offer, as Sure's menu never shows it.
 */
export const dashboardLayoutSchema = z
	.strictObject({
		sectionOrder: z
			.array(section)
			.refine((keys) => new Set(keys).size === keys.length, "duplicate_section")
			.optional(),
		collapsedSections: z.partialRecord(section, z.boolean()).optional(),
		// One key at a time in Sure, `update_dashboard_section_hidden`: true hides, false shows.
		hiddenSections: z.partialRecord(section, z.boolean()).optional(),
		sectionLayout: z
			.partialRecord(
				section,
				z.strictObject({
					height: z.enum(DASHBOARD_HEIGHT_PRESET_KEYS).optional(),
					colSpan: z.enum(DASHBOARD_COL_SPANS).optional(),
				}),
			)
			.optional(),
	})
	.superRefine((value, context) => {
		for (const [key, size] of Object.entries(value.sectionLayout ?? {})) {
			const guardrails = DASHBOARD_SECTION_LAYOUTS[section.parse(key)];

			if (size.height !== undefined && !guardrails.grow) {
				context.addIssue({
					code: "custom",
					path: ["sectionLayout", key, "height"],
					message: "size_not_offered",
				});
			}

			if (size.colSpan !== undefined && !guardrails.widthToggle) {
				context.addIssue({
					code: "custom",
					path: ["sectionLayout", key, "colSpan"],
					message: "size_not_offered",
				});
			}
		}
	}) satisfies z.ZodType<DashboardLayoutPatch>;

export type DashboardLayoutInput = z.infer<typeof dashboardLayoutSchema>;
