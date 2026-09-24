import type { JsonBodyType } from "msw";

import { http, HttpResponse } from "msw";
import { readFile } from "node:fs/promises";
import { z } from "zod";

import { server } from "../../vitest.setup.ts";
import { TEST_PROVIDER_URL } from "./bank.ts";

async function load(name: string): Promise<JsonBodyType> {
	return z
		.json()
		.parse(
			JSON.parse(
				await readFile(
					new URL(`../connectors/enable-banking/fixtures/${name}`, import.meta.url),
					"utf8",
				),
			),
		);
}

/**
 * Written from the Enable Banking API reference, not recorded: no credentials
 * exist in this repository. Each keeps the fields the schemas read, plus a
 * few they must drop.
 */
export const fixtures = {
	aspsps: await load("aspsps-fr.json"),
	auth: await load("auth.json"),
	session: await load("session.json"),
	redirectNotAllowed: await load("error-redirect-not-allowed.json"),
	unauthorized: await load("error-unauthorized.json"),
};

export const FIXTURE_SESSION_ID = "4b1a9f0e-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
export const FIXTURE_AUTH_URL =
	"https://tilisy.enablebanking.com/welcome?sessionid=0d6c1b52-7a47-4e0c-9f6c-3f0b1c2d3e4f";
export const FIXTURE_CONSENT_END = Date.parse("2026-12-20T10:00:00Z");

export type ProviderRequest = {
	method: string;
	path: string;
	search: string;
	authorization: string | null;
	body: unknown;
};

type Endpoint = "aspsps" | "auth" | "sessions";

/**
 * Serves the three endpoints from the fixtures, or from `overrides`, and
 * records every request so a spec can read what was sent.
 */
export function mockProvider(
	overrides: Partial<Record<Endpoint, () => Response>> = {},
): ProviderRequest[] {
	const requests: ProviderRequest[] = [];
	const answer =
		(endpoint: Endpoint, fallback: () => Response) =>
		async ({ request }: { request: Request }) => {
			const url = new URL(request.url);
			requests.push({
				method: request.method,
				path: url.pathname,
				search: url.search,
				authorization: request.headers.get("authorization"),
				body: request.method === "GET" ? undefined : await request.json(),
			});

			return (overrides[endpoint] ?? fallback)();
		};

	server.use(
		http.get(
			`${TEST_PROVIDER_URL}/aspsps`,
			answer("aspsps", () => HttpResponse.json(fixtures.aspsps)),
		),
		http.post(
			`${TEST_PROVIDER_URL}/auth`,
			answer("auth", () => HttpResponse.json(fixtures.auth)),
		),
		http.post(
			`${TEST_PROVIDER_URL}/sessions`,
			answer("sessions", () => HttpResponse.json(fixtures.session)),
		),
	);

	return requests;
}
