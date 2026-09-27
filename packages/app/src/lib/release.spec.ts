import { describe, expect, it } from "vitest";

import { releaseUrl } from "./release.ts";

describe("releaseUrl", () => {
	it("links a release version to its tag", () => {
		expect(releaseUrl("1.2.3")).toBe("https://github.com/leger-dosage/archant/releases/tag/v1.2.3");
	});

	it("has nothing to link for a development build", () => {
		expect(releaseUrl(null)).toBeNull();
	});
});
