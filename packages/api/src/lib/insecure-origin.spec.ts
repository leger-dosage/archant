import { describe, expect, it } from "vitest";

import { isInsecurePublicOrigin } from "./insecure-origin.ts";

describe("isInsecurePublicOrigin", () => {
	it.each([
		"http://archant.example.org",
		"http://203.0.113.10:8787",
		"http://[2001:db8::1]:8787",
		"http://172.32.0.1",
		"http://100.128.0.1",
		"http://[::ffff:203.0.113.10]",
		"http://archant.local.example.org",
	])("warns on %s", (origin) => {
		expect(isInsecurePublicOrigin(origin)).toBe(true);
	});

	it.each([
		"http://localhost:8787",
		"http://archant.localhost:8787",
		"http://127.0.0.1:8787",
		"http://127.1.2.3",
		"http://10.1.2.3",
		"http://172.16.0.1",
		"http://172.31.255.255",
		"http://192.168.1.20:8787",
		"http://169.254.1.1",
		"http://100.101.102.103",
		"http://[::1]:8787",
		"http://[fd7a:115c:a1e0::1]",
		"http://[fe80::1]",
		"http://[::ffff:192.168.1.20]",
		"http://nas:8787",
		"http://NAS.:8787",
		"http://archant.local",
		"http://archant.home.arpa",
		"http://archant.internal",
		"http://archant.tailnet-name.ts.net",
		"https://archant.example.org",
		"https://203.0.113.10:8787",
	])("stays quiet on %s", (origin) => {
		expect(isInsecurePublicOrigin(origin)).toBe(false);
	});
});
