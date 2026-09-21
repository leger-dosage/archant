import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect } from "vitest";

// A test that reaches the network fails in CI for reasons nobody can
// reproduce. msw intercepts every request; an unhandled one is recorded rather
// than thrown, because the code under test may catch the error and carry on,
// and the test fails afterwards naming the URL it wanted.
const unhandled: string[] = [];

export const server = setupServer();

beforeAll(() => {
	server.listen({
		onUnhandledRequest: (request, print) => {
			unhandled.push(`${request.method} ${request.url}`);
			// Without this the request is let through to the real network.
			print.error();
		},
	});
});

afterEach(() => {
	server.resetHandlers();
	const requests = unhandled.splice(0);

	expect(requests, `Unmocked network requests: ${requests.join(", ")}`).toEqual([]);
});

afterAll(() => {
	server.close();
});
