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
	balances: await load("balances.json"),
	transactionsPage1: await load("transactions-page-1.json"),
	transactionsPage2: await load("transactions-page-2.json"),
	redirectNotAllowed: await load("error-redirect-not-allowed.json"),
	unauthorized: await load("error-unauthorized.json"),
};

export const FIXTURE_SESSION_ID = "4b1a9f0e-2c3d-4e5f-8a9b-0c1d2e3f4a5b";
export const FIXTURE_AUTH_URL =
	"https://tilisy.enablebanking.com/welcome?sessionid=0d6c1b52-7a47-4e0c-9f6c-3f0b1c2d3e4f";
export const FIXTURE_CONSENT_END = Date.parse("2026-12-20T10:00:00Z");
/** The session's current account, `CACC`, and its card, `CARD`. */
export const FIXTURE_CHECKING_UID = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
export const FIXTURE_CARD_UID = "2f3e4d5c-6b7a-4980-a1b2-c3d4e5f6a7b8";
/** Every character of the checking account's IBAN but the last four. */
export const FIXTURE_IBAN_HEAD = "FR763000100794123456789";

export type ProviderRequest = {
	method: string;
	path: string;
	search: string;
	authorization: string | null;
	body: unknown;
};

type Endpoint = "aspsps" | "auth" | "sessions" | "revoke" | "balances" | "transactions";

/** The fixture pages: the first without a key, the second on `page-2`. */
export function transactionsPage(url: URL): Response {
	return HttpResponse.json(
		url.searchParams.get("continuation_key") === "page-2"
			? fixtures.transactionsPage2
			: fixtures.transactionsPage1,
	);
}

/**
 * Serves the six endpoints from the fixtures, or from `overrides`, and
 * records every request so a spec can read what was sent.
 */
export function mockProvider(
	overrides: Partial<Record<Endpoint, (url: URL) => Response>> = {},
): ProviderRequest[] {
	const requests: ProviderRequest[] = [];
	const answer =
		(endpoint: Endpoint, fallback: (url: URL) => Response) =>
		async ({ request }: { request: Request }) => {
			const url = new URL(request.url);
			requests.push({
				method: request.method,
				path: url.pathname,
				search: url.search,
				authorization: request.headers.get("authorization"),
				body: request.method === "POST" ? await request.json() : undefined,
			});

			return (overrides[endpoint] ?? fallback)(url);
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
		http.delete(
			`${TEST_PROVIDER_URL}/sessions/:id`,
			answer("revoke", () => HttpResponse.json({ message: "OK" })),
		),
		http.get(
			`${TEST_PROVIDER_URL}/accounts/:uid/balances`,
			answer("balances", () => HttpResponse.json(fixtures.balances)),
		),
		http.get(
			`${TEST_PROVIDER_URL}/accounts/:uid/transactions`,
			answer("transactions", transactionsPage),
		),
	);

	return requests;
}
