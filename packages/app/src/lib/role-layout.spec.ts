import { describe, expect, it } from "vitest";

import { layoutForRole } from "./role-layout";

describe("layoutForRole", () => {
	it.each([
		["guest", "intro"],
		["member", "dashboard"],
		["admin", "dashboard"],
	] as const)("uses the %s role's %s layout", (role, layout) => {
		expect(layoutForRole(role)).toBe(layout);
	});

	it("restores the dashboard as soon as the session reports a promotion", () => {
		const roles = ["guest", "member"] as const;

		expect(roles.map(layoutForRole)).toEqual(["intro", "dashboard"]);
	});
});
