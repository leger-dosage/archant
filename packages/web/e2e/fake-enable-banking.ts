import type { KeyObject } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { randomUUID, verify } from "node:crypto";
import { createServer } from "node:http";
import { z } from "zod";

import { TIME_ZONE } from "./settings.ts";

/**
 * A stand-in for Enable Banking on loopback, so the suite never reaches the
 * network (AD-16). It serves what the API calls, `/aspsps`, `/auth`,
 * `/sessions`, `DELETE /sessions/{id}` and `/accounts/{uid}/balances`, plus
 * the bank's consent page, which approves at once and
 * sends the browser back to `redirect_url` with a `code` and the `state`,
 * and `/accounts/{uid}/transactions`, two pages of lines dated a few days
 * back.
 * It checks each request's RS256 token against the public key, as the real
 * service would refuse an unsigned one.
 */

/**
 * The bank whose card fails to list its transactions: a connection to it
 * syncs its current account and records the card's error.
 */
export const FAILING_BANK = "Néobanque Test";

/**
 * The bank that gives each account's balance once, when it is linked, then
 * answers 500: its syncs bring the lines in and keep the linked balance.
 */
export const BALANCELESS_BANK = "Banque Sans Solde";

/** The French banks the fake lists. `Banque Démo` is the one the tests connect. */
export const FAKE_BANKS = [
	"Banque Démo",
	"Caisse Régionale Exemple",
	"Néobanque Test",
	BALANCELESS_BANK,
] as const;

/**
 * The accounts every session shares: a current account and a card. Each
 * session gets fresh uids, as the real service does, and the same hashes.
 */
export const FAKE_ACCOUNTS = {
	checking: {
		name: "Compte courant Démo",
		ibanLast4: "0185",
		/** `ITBD`, as the bank prints it. */
		balance: "1234.56",
	},
	card: { name: "Carte Démo", balance: "-300.00" },
} as const;

/**
 * The lines every account lists, as their labels show: three booked, one
 * pending, dated today and without a reference, and an informational one,
 * which never shows.
 */
export const FAKE_LINES = {
	groceries: { label: "Supermarché Démo", amount: "-42.90", daysAgo: 3 },
	salary: { label: "Salaire Démo", amount: "2500.00", daysAgo: 10 },
	subscription: { label: "ABONNEMENT DEMO", amount: "-9.99", daysAgo: 2 },
	pending: { label: "Boulangerie en attente", amount: "-3.20" },
} as const;

/** A day `days` before today in the suite's zone, as the bank prints it. */
function daysAgo(days: number): string {
	const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());

	return new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

/** A signed amount as Enable Banking prints it: unsigned, the direction apart. */
const unsigned = (value: string) => ({ currency: "EUR", amount: value.replace("-", "") });

const direction = (value: string) => (value.startsWith("-") ? "DBIT" : "CRDT");

/** One page of `uid`'s statement: the first without a key, the second on `page-2`. */
function transactionsPage(uid: string, continuationKey: string | null) {
	const { groceries, salary, subscription, pending } = FAKE_LINES;

	if (continuationKey === "page-2") {
		return {
			transactions: [
				{
					entry_reference: `${uid}-3`,
					transaction_amount: unsigned(subscription.amount),
					credit_debit_indicator: direction(subscription.amount),
					status: "BOOK",
					booking_date: daysAgo(subscription.daysAgo),
					remittance_information: [subscription.label],
				},
				{
					entry_reference: `${uid}-4`,
					transaction_amount: unsigned("-1.00"),
					credit_debit_indicator: "DBIT",
					status: "INFO",
					booking_date: daysAgo(1),
					remittance_information: ["INFORMATION"],
				},
			],
			continuation_key: null,
		};
	}

	return {
		transactions: [
			{
				entry_reference: `${uid}-1`,
				transaction_id: randomUUID(),
				transaction_amount: unsigned(groceries.amount),
				creditor: { name: groceries.label },
				credit_debit_indicator: direction(groceries.amount),
				status: "BOOK",
				booking_date: daysAgo(groceries.daysAgo),
				remittance_information: ["CB SUPERMARCHE DEMO"],
			},
			{
				entry_reference: `${uid}-2`,
				transaction_amount: unsigned(salary.amount),
				debtor: { name: salary.label },
				credit_debit_indicator: direction(salary.amount),
				status: "BOOK",
				value_date: daysAgo(salary.daysAgo),
			},
			{
				transaction_amount: unsigned(pending.amount),
				creditor: { name: pending.label },
				credit_debit_indicator: "DBIT",
				status: "PDNG",
				transaction_date: daysAgo(0),
			},
		],
		continuation_key: "page-2",
	};
}

/** 180 days, above the 90-day cap, so the API must ask for 90. */
const MAXIMUM_CONSENT_SECONDS = 180 * 86_400;

type Pending = { state: string; redirectUrl: string; validUntil: string; bank: string };

function base64url(text: string): Buffer {
	return Buffer.from(text, "base64url");
}

function tokenIsValid(header: string | undefined, publicKey: KeyObject, applicationId: string) {
	const token = header?.replace(/^Bearer /u, "") ?? "";
	const [head = "", payload = "", signature = ""] = token.split(".");

	try {
		const parsedHead: unknown = JSON.parse(base64url(head).toString("utf8"));
		const claims: unknown = JSON.parse(base64url(payload).toString("utf8"));

		return (
			typeof parsedHead === "object" &&
			parsedHead !== null &&
			"kid" in parsedHead &&
			parsedHead.kid === applicationId &&
			typeof claims === "object" &&
			claims !== null &&
			"aud" in claims &&
			claims.aud === "api.enablebanking.com" &&
			verify("RSA-SHA256", Buffer.from(`${head}.${payload}`), publicKey, base64url(signature))
		);
	} catch {
		return false;
	}
}

const bodySchema = z.record(z.string(), z.unknown());

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];

	for await (const chunk of request) {
		if (chunk instanceof Buffer) {
			chunks.push(chunk);
		}
	}

	return bodySchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
}

function json(response: ServerResponse, status: number, body: unknown) {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
}

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="6" fill="#2563eb"/></svg>`;

/** Starts the fake on a free loopback port and returns its origin. */
export async function startFakeEnableBanking(options: {
	publicKey: KeyObject;
	applicationId: string;
}): Promise<{ url: string; close: () => void }> {
	const pending = new Map<string, Pending>();
	const codes = new Map<string, Pending>();
	// uid → the balance the bank reports for it.
	const balances = new Map<string, string>();
	// The uids whose transactions answer 500.
	const failing = new Set<string>();
	// The uids whose balance answers once, then 500; those already read.
	const balanceless = new Set<string>();
	const balanceRead = new Set<string>();
	// Every session opened and not revoked yet.
	const sessions = new Set<string>();
	let origin = "";

	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", origin);

		void (async () => {
			if (request.method === "GET" && url.pathname === "/logo.svg") {
				response.writeHead(200, { "content-type": "image/svg+xml" });
				response.end(LOGO);
				return;
			}

			// The bank's consent page: the user approves, the bank redirects.
			if (request.method === "GET" && url.pathname.startsWith("/consent/")) {
				const attempt = pending.get(url.pathname.slice("/consent/".length));

				if (attempt === undefined) {
					json(response, 404, { error: "NOT_FOUND" });
					return;
				}

				const code = randomUUID();
				codes.set(code, attempt);
				const back = new URL(attempt.redirectUrl);
				back.searchParams.set("code", code);
				back.searchParams.set("state", attempt.state);
				response.writeHead(302, { location: back.toString() });
				response.end();
				return;
			}

			if (!tokenIsValid(request.headers.authorization, options.publicKey, options.applicationId)) {
				json(response, 401, { code: 401, message: "Invalid token", error: "UNAUTHORIZED" });
				return;
			}

			if (request.method === "GET" && url.pathname === "/aspsps") {
				const country = url.searchParams.get("country") ?? "";
				const names = country === "FR" ? FAKE_BANKS : [`Banque ${country}`];

				json(response, 200, {
					aspsps: names.map((name, index) => ({
						name,
						country,
						logo: index === 0 ? `${origin}/logo.svg` : null,
						bic: index === 0 ? "DEMOFRPP" : undefined,
						maximum_consent_validity: MAXIMUM_CONSENT_SECONDS,
						psu_types: ["personal"],
					})),
				});
				return;
			}

			if (request.method === "POST" && url.pathname === "/auth") {
				const body = await readJson(request);
				const access = body["access"];
				const aspsp = body["aspsp"];
				const authorizationId = randomUUID();
				pending.set(authorizationId, {
					state: String(body["state"]),
					redirectUrl: String(body["redirect_url"]),
					validUntil:
						typeof access === "object" && access !== null && "valid_until" in access
							? String(access.valid_until)
							: "",
					bank:
						typeof aspsp === "object" && aspsp !== null && "name" in aspsp
							? String(aspsp.name)
							: "",
				});

				json(response, 200, {
					url: `${origin}/consent/${authorizationId}`,
					authorization_id: authorizationId,
				});
				return;
			}

			if (request.method === "POST" && url.pathname === "/sessions") {
				const body = await readJson(request);
				const attempt = codes.get(String(body["code"]));

				if (attempt === undefined) {
					json(response, 400, { code: 400, message: "Unknown code", error: "WRONG_AUTH_CODE" });
					return;
				}

				codes.delete(String(body["code"]));
				const checkingUid = randomUUID();
				const cardUid = randomUUID();
				balances.set(checkingUid, FAKE_ACCOUNTS.checking.balance);
				balances.set(cardUid, FAKE_ACCOUNTS.card.balance);

				if (attempt.bank === FAILING_BANK) {
					failing.add(cardUid);
				}

				if (attempt.bank === BALANCELESS_BANK) {
					balanceless.add(checkingUid);
					balanceless.add(cardUid);
				}

				const sessionId = randomUUID();
				sessions.add(sessionId);

				json(response, 200, {
					session_id: sessionId,
					accounts: [
						{
							uid: checkingUid,
							identification_hash: "fake-hash-checking",
							account_id: { iban: `FR76300010079412345678${FAKE_ACCOUNTS.checking.ibanLast4}` },
							name: "M. Démo",
							product: FAKE_ACCOUNTS.checking.name,
							currency: "EUR",
							cash_account_type: "CACC",
						},
						{
							uid: cardUid,
							identification_hash: "fake-hash-card",
							name: FAKE_ACCOUNTS.card.name,
							currency: "EUR",
							cash_account_type: "CARD",
						},
					],
					access: { valid_until: attempt.validUntil },
				});
				return;
			}

			const sessionPath = /^\/sessions\/([^/]+)$/u.exec(url.pathname);

			if (request.method === "DELETE" && sessionPath !== null) {
				// A second revocation finds nothing, as at the real service.
				if (!sessions.delete(decodeURIComponent(sessionPath[1] ?? ""))) {
					json(response, 404, { code: 404, message: "Unknown session", error: "NOT_FOUND" });
					return;
				}

				json(response, 200, { message: "OK" });
				return;
			}

			const balancePath = /^\/accounts\/([^/]+)\/balances$/u.exec(url.pathname);

			if (request.method === "GET" && balancePath !== null) {
				const uid = decodeURIComponent(balancePath[1] ?? "");
				const amount = balances.get(uid);

				if (amount === undefined) {
					json(response, 404, { code: 404, message: "Unknown account", error: "NOT_FOUND" });
					return;
				}

				if (balanceless.has(uid) && balanceRead.has(uid)) {
					json(response, 500, { code: 500, message: "Bank down", error: "ASPSP_ERROR" });
					return;
				}

				balanceRead.add(uid);

				json(response, 200, {
					balances: [
						{ balance_amount: { currency: "EUR", amount: "0.00" }, balance_type: "XPCD" },
						{ balance_amount: { currency: "EUR", amount }, balance_type: "ITBD" },
					],
				});
				return;
			}

			const transactionsPath = /^\/accounts\/([^/]+)\/transactions$/u.exec(url.pathname);

			if (request.method === "GET" && transactionsPath !== null) {
				const uid = decodeURIComponent(transactionsPath[1] ?? "");

				if (!balances.has(uid)) {
					json(response, 404, { code: 404, message: "Unknown account", error: "NOT_FOUND" });
					return;
				}

				if (failing.has(uid)) {
					json(response, 500, { code: 500, message: "Bank down", error: "ASPSP_ERROR" });
					return;
				}

				json(response, 200, transactionsPage(uid, url.searchParams.get("continuation_key")));
				return;
			}

			json(response, 404, { error: "NOT_FOUND" });
		})().catch(() => json(response, 500, { error: "FAKE_FAILED" }));
	});

	await new Promise<void>((resolve) => {
		// No host, as the API's own server: `localhost` resolves to ::1 or to
		// 127.0.0.1 depending on the client, and both must answer.
		server.listen(0, resolve);
	});
	// `localhost`, not an IP: the suite's guard lets the browser reach
	// localhost only, and the browser loads the consent page and the logo.
	const address = server.address();

	if (address === null || typeof address === "string") {
		throw new Error("The fake Enable Banking server has no port.");
	}

	origin = `http://localhost:${address.port}`;

	return { url: origin, close: () => server.close() };
}
