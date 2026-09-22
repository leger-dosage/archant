import { describe, expect, it } from "vitest";

import { forwardedFor, withForwardedFor } from "./client-address.ts";

describe("forwardedFor", () => {
	it.each([
		["no peer drops the header", "198.51.100.1", undefined, true, null],
		["an empty peer drops the header", null, "", false, null],
		[
			"no trusted proxy ignores a forged header",
			"198.51.100.1",
			"203.0.113.7",
			false,
			"203.0.113.7",
		],
		["no trusted proxy, no header", null, "203.0.113.7", false, "203.0.113.7"],
		[
			"a trusted proxy appends the peer",
			"198.51.100.1",
			"10.0.0.1",
			true,
			"198.51.100.1, 10.0.0.1",
		],
		["a trusted proxy without a header", null, "10.0.0.1", true, "10.0.0.1"],
		["a blank header counts as none", " ", "10.0.0.1", true, "10.0.0.1"],
	] as const)("%s", (_name, incoming, peer, trusts, expected) => {
		expect(forwardedFor(incoming, peer, trusts)).toBe(expected);
	});
});

describe("withForwardedFor", () => {
	it("rewrites the header and keeps the rest of the request", async () => {
		const request = new Request("http://localhost/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.1" },
			body: "{}",
		});

		const rewritten = withForwardedFor(request, "203.0.113.7", false);

		expect(rewritten.headers.get("x-forwarded-for")).toBe("203.0.113.7");
		expect(rewritten.headers.get("content-type")).toBe("application/json");
		expect(rewritten.method).toBe("POST");
		await expect(rewritten.text()).resolves.toBe("{}");
	});

	it("removes the header when there is no peer", () => {
		const request = new Request("http://localhost/", { headers: { "x-forwarded-for": "1.2.3.4" } });

		expect(withForwardedFor(request, undefined, true).headers.has("x-forwarded-for")).toBe(false);
	});
});
