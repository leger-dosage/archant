import type { GoalEvent, GoalKind, GoalState } from "./goals.ts";

import { describe, expect, it } from "vitest";

import { CATEGORY_COLORS } from "./category-presets.ts";
import { GOAL_EVENTS, GOAL_STATES, canBackGoal, goalTransition, sampleGoalColor } from "./goals.ts";

/** Sure's AASM events, as `app/models/goal.rb` declares them, for a one-off goal. */
const SURE: Record<GoalEvent, Partial<Record<GoalState, GoalState>>> = {
	pause: { active: "paused" },
	resume: { paused: "active" },
	complete: { active: "completed", paused: "completed" },
	archive: { active: "archived", paused: "archived", completed: "archived" },
	restore: { archived: "active" },
	reopen: { completed: "active" },
};

describe("goalTransition", () => {
	it.each(GOAL_EVENTS.flatMap((event) => GOAL_STATES.map((state) => [event, state] as const)))(
		"%s from %s goes where Sure's goes, or nowhere",
		(event, state) => {
			expect(goalTransition(state, "one_off", event)).toBe(SURE[event][state] ?? null);
		},
	);

	it("never completes a reserve, which Sure guards to one-off goals", () => {
		const reserve: GoalKind = "maintained";

		expect(goalTransition("active", reserve, "complete")).toBeNull();
		expect(goalTransition("paused", reserve, "complete")).toBeNull();
		expect(goalTransition("active", reserve, "archive")).toBe("archived");
		expect(goalTransition("archived", reserve, "restore")).toBe("active");
	});
});

describe("canBackGoal", () => {
	it("takes an active current, savings or investment account, and nothing else", () => {
		expect(canBackGoal({ active: true, type: "depository" })).toBe(true);
		expect(canBackGoal({ active: true, type: "investment" })).toBe(true);
		expect(canBackGoal({ active: false, type: "depository" })).toBe(false);
		expect(canBackGoal({ active: true, type: "loan" })).toBe(false);
	});
});

describe("sampleGoalColor", () => {
	it("draws any category swatch, as Sure's COLORS.sample", () => {
		expect(sampleGoalColor(() => 0)).toBe(CATEGORY_COLORS[0]);
		expect(sampleGoalColor(() => 0.999_999)).toBe(CATEGORY_COLORS.at(-1));
		expect(CATEGORY_COLORS).toContain(sampleGoalColor());
	});

	it("keeps to the swatches when the draw reaches one", () => {
		expect(sampleGoalColor(() => 1)).toBe(CATEGORY_COLORS[0]);
	});
});
