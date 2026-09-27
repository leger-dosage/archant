import { describe, expect, it } from "vitest";

import { SHARED_CLIENT_KEY, clientKey, forwardedFor, withForwardedFor } from "./client-address.ts";

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

describe("clientKey", () => {
	const proxies = ["127.0.0.1", "::1", "10.0.0.0/8"];

	it.each([
		["no header shares one bucket", null, [], SHARED_CLIENT_KEY],
		["no trusted proxy believes a single value", "203.0.113.7", [], "203.0.113.7"],
		["no trusted proxy refuses a list", "198.51.100.1, 203.0.113.7", [], SHARED_CLIENT_KEY],
		["no trusted proxy refuses a value that is no address", "nobody", [], SHARED_CLIENT_KEY],
		[
			"walks right to left past the trusted proxies",
			"198.51.100.1, 203.0.113.7, 10.1.2.3, 127.0.0.1",
			proxies,
			"203.0.113.7",
		],
		[
			"stops at the first hop that is no address",
			"203.0.113.7, junk, 127.0.0.1",
			proxies,
			SHARED_CLIENT_KEY,
		],
		["only trusted hops share one bucket", "10.0.0.1, 127.0.0.1", proxies, SHARED_CLIENT_KEY],
		["an IPv4-mapped peer is its IPv4", "::ffff:203.0.113.7", [], "203.0.113.7"],
		[
			"an IPv4-mapped trusted proxy is trusted",
			"203.0.113.7, ::ffff:127.0.0.1",
			proxies,
			"203.0.113.7",
		],
		[
			"an IPv6 address counts as its /64",
			"2001:DB8:1:2:3:4:5:6",
			[],
			"2001:0db8:0001:0002:0000:0000:0000:0000",
		],
		[
			"a compressed IPv6 address expands",
			"2001:db8::1, ::1",
			proxies,
			"2001:0db8:0000:0000:0000:0000:0000:0000",
		],
	] as const)("%s", (_name, forwarded, trusted, expected) => {
		expect(clientKey(forwarded, trusted)).toBe(expected);
	});
});
