import { describe, expect, it } from "vitest";

import { pageSearch } from "./page-search";

describe("pageSearch", () => {
	it("sets only the transactions page", () => {
		expect(pageSearch("page", 3)).toEqual({ page: 3 });
	});

	it("sets only the snapshots page", () => {
		expect(pageSearch("snapshotsPage", 2)).toEqual({ snapshotsPage: 2 });
	});

	it("drops the param for the first page", () => {
		expect(pageSearch("page", 1)).toEqual({ page: undefined });
		expect(pageSearch("snapshotsPage", 1)).toEqual({ snapshotsPage: undefined });
	});
});
