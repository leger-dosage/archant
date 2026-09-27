import { BlockList, isIP } from "node:net";

/**
 * Addresses a stranger on the internet cannot reach: loopback, the private
 * ranges, link-local, and the ranges a tailnet hands out. `100.64.0.0/10` is
 * carrier-grade NAT space in general, but warning on the owner's own tailnet
 * would be the worse mistake. An IPv4-mapped IPv6 address matches its IPv4.
 */
const PRIVATE_ADDRESSES = (() => {
	const list = new BlockList();

	for (const [network, prefix] of [
		["127.0.0.0", 8],
		["10.0.0.0", 8],
		["172.16.0.0", 12],
		["192.168.0.0", 16],
		["169.254.0.0", 16],
		["100.64.0.0", 10],
	] as const) {
		list.addSubnet(network, prefix, "ipv4");
	}

	list.addAddress("::1", "ipv6");
	// Unique local addresses, Tailscale's `fd7a:115c:a1e0::/48` among them.
	list.addSubnet("fc00::", 7, "ipv6");
	list.addSubnet("fe80::", 10, "ipv6");

	return list;
})();

/** Names only a local resolver, mDNS or a tailnet's MagicDNS answers. */
const PRIVATE_SUFFIXES = [".localhost", ".local", ".home.arpa", ".internal", ".ts.net"];

function isPrivateHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/\.$/u, "");
	// `URL` keeps the brackets around an IPv6 literal.
	const address = host.startsWith("[") ? host.slice(1, -1) : host;
	const family = isIP(address);

	if (family !== 0) {
		return PRIVATE_ADDRESSES.check(address, family === 4 ? "ipv4" : "ipv6");
	}

	// `http://nas:8787`: a single label resolves on the home network only.
	if (host === "localhost" || !host.includes(".")) {
		return true;
	}

	return PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Whether a browser on this origin sends the password and the session cookie
 * unencrypted over a network strangers can reach: plain `http://` on an
 * address that is neither loopback nor private.
 */
export function isInsecurePublicOrigin(origin: string): boolean {
	const url = new URL(origin);

	return url.protocol === "http:" && !isPrivateHost(url.hostname);
}
