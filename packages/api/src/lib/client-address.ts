import { getIP } from "better-auth/api";

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

/**
 * The client address Better Auth's `getIP` picks from the `x-forwarded-for`
 * that `forwardedFor` rebuilds, for a limit of our own keyed like its
 * sign-in limit. Anything unreadable falls back to the shared bucket, except
 * under `NODE_ENV` test or development, where `getIP` answers `127.0.0.1`.
 */
export function clientKey(forwarded: string | null, trustedProxies: readonly string[]): string {
	return (
		getIP(new Headers({ "x-forwarded-for": forwarded ?? "" }), {
			advanced: { ipAddress: { trustedProxies: [...trustedProxies] } },
		}) ?? SHARED_CLIENT_KEY
	);
}
