import { BlockList, isIP, isIPv4 } from "node:net";

/**
 * The `x-forwarded-for` Better Auth reads its client address from, rebuilt
 * from the TCP peer, as Express's `trust proxy` does. Better Auth believes a
 * single header value by default, which any client can write: rotating it
 * would defeat the sign-in limit.
 *
 * - No peer (an in-process request): no header at all.
 * - No trusted proxy: the peer alone, whatever the client sent.
 * - Trusted proxies: the incoming header with the peer appended, as a proxy
 *   would; Better Auth walks it right to left past the trusted entries.
 */
export function forwardedFor(
	incoming: string | null,
	peer: string | undefined,
	trustsProxies: boolean,
): string | null {
	if (peer === undefined || peer === "") {
		return null;
	}

	if (!trustsProxies || incoming === null || incoming.trim() === "") {
		return peer;
	}

	return `${incoming}, ${peer}`;
}

/** `request` with its `x-forwarded-for` replaced by `forwardedFor`. */
export function withForwardedFor(
	request: Request,
	peer: string | undefined,
	trustsProxies: boolean,
): Request {
	const headers = new Headers(request.headers);
	const value = forwardedFor(headers.get("x-forwarded-for"), peer, trustsProxies);

	if (value === null) {
		headers.delete("x-forwarded-for");
	} else {
		headers.set("x-forwarded-for", value);
	}

	return new Request(request, { headers });
}

/** The bucket every request shares when no address can be believed, as in Better Auth. */
export const SHARED_CLIENT_KEY = "no-trusted-ip";

/** The eight groups of an IPv6 address, four hex digits each; a trailing IPv4 becomes two. */
function ipv6Groups(address: string): string[] {
	const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/u.exec(address);
	let hex = address.toLowerCase();

	if (dotted !== null) {
		const [a = 0, b = 0, c = 0, d = 0] = dotted.slice(1).map(Number);
		hex = `${hex.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
	}

	const [left = "", right] = hex.split("::");
	const head = left === "" ? [] : left.split(":");
	const tail = right === undefined || right === "" ? [] : right.split(":");
	const zeros = right === undefined ? [] : Array<string>(8 - head.length - tail.length).fill("0");

	return [...head, ...zeros, ...tail].map((group) => group.padStart(4, "0"));
}

/**
 * Better Auth's normalisation: an IPv4-mapped IPv6 address is its IPv4, and
 * any other IPv6 address counts as its /64, which one household's router
 * hands out whole.
 */
function normalizeAddress(address: string): string {
	if (isIPv4(address)) {
		return address;
	}

	const groups = ipv6Groups(address);

	if (groups.slice(0, 5).every((group) => group === "0000") && groups[5] === "ffff") {
		const [high = 0, low = 0] = groups.slice(6).map((group) => Number.parseInt(group, 16));

		return [high >> 8, high & 255, low >> 8, low & 255].join(".");
	}

	return [...groups.slice(0, 4), "0000", "0000", "0000", "0000"].join(":");
}

function trustedList(trustedProxies: readonly string[]): BlockList {
	const list = new BlockList();

	for (const entry of trustedProxies) {
		const [network = "", prefix] = entry.split("/");
		const type = isIPv4(network) ? "ipv4" : "ipv6";

		if (prefix === undefined) {
			list.addAddress(network, type);
		} else {
			list.addSubnet(network, Number(prefix), type);
		}
	}

	return list;
}

/**
 * The client address Better Auth's `getIP` picks from the `x-forwarded-for`
 * that `forwardedFor` rebuilds, for a limit of our own keyed like its
 * sign-in limit. Better Auth does not export `getIP`. With trusted proxies,
 * the header is walked right to left past them; without, only a single value
 * is believed. Anything unreadable falls back to the shared bucket.
 */
export function clientKey(forwarded: string | null, trustedProxies: readonly string[]): string {
	const hops = (forwarded ?? "")
		.split(",")
		.map((hop) => hop.trim())
		.filter((hop) => hop !== "");

	if (trustedProxies.length === 0) {
		const [only] = hops;

		return hops.length === 1 && only !== undefined && isIP(only) !== 0
			? normalizeAddress(only)
			: SHARED_CLIENT_KEY;
	}

	const trusted = trustedList(trustedProxies);

	for (const hop of hops.toReversed()) {
		const family = isIP(hop);

		if (family === 0) {
			return SHARED_CLIENT_KEY;
		}

		if (!trusted.check(hop, family === 4 ? "ipv4" : "ipv6")) {
			return normalizeAddress(hop);
		}
	}

	return SHARED_CLIENT_KEY;
}
