import { describe, expect, it } from "vitest";

import { createRateLimiter } from "./rate-limit.ts";

function limiterAt(start = 0) {
	const clock = { now: start };
	const limiter = createRateLimiter({ max: 3, windowMs: 10_000, now: () => clock.now });

	return { clock, limiter };
}

describe("createRateLimiter", () => {
	it("allows the third request of a window and refuses the fourth", () => {
		const { limiter } = limiterAt();

		expect([1, 2, 3, 4].map(() => limiter.consume("203.0.113.7"))).toEqual([
			true,
			true,
			true,
			false,
		]);
	});

	it("counts each key on its own", () => {
		const { limiter } = limiterAt();

		for (let index = 0; index < 3; index++) {
			expect(limiter.consume("203.0.113.7")).toBe(true);
			expect(limiter.consume("198.51.100.1")).toBe(true);
		}

		expect(limiter.consume("203.0.113.7")).toBe(false);
		expect(limiter.consume("198.51.100.1")).toBe(false);
	});

	it("allows requests again once the window has passed", () => {
		const { clock, limiter } = limiterAt();

		for (let index = 0; index < 4; index++) {
			limiter.consume("203.0.113.7");
		}

		clock.now = 9_999;
		expect(limiter.consume("203.0.113.7")).toBe(false);
		clock.now = 10_000;
		expect(limiter.consume("203.0.113.7")).toBe(true);
	});

	it("prunes expired windows, so many addresses cannot grow it without bound", () => {
		const { clock, limiter } = limiterAt();

		for (let index = 0; index < 100; index++) {
			limiter.consume(`203.0.113.${index}`);
		}

		expect(limiter.size()).toBe(100);
		clock.now = 10_000;
		limiter.consume("198.51.100.1");
		expect(limiter.size()).toBe(1);
	});
});
