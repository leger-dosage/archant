import { connect } from "node:net";

const LOOPBACKS = ["127.0.0.1", "::1"] as const;

const TIMEOUT_MS = 500;

/** Whether something accepts a TCP connection on `host:port`; any failure counts as no. */
export function accepts(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect({ host, port });
		const settle = (accepted: boolean) => {
			socket.destroy();
			resolve(accepted);
		};

		socket.setTimeout(TIMEOUT_MS, () => settle(false));
		socket.once("connect", () => settle(true));
		socket.once("error", () => settle(false));
	});
}

/**
 * The first loopback address where another server already listens on `port`,
 * or `null`. With `HOST=0.0.0.0`, Node binds the wildcard with `SO_REUSEADDR`,
 * so on macOS the API starts beside a server on `127.0.0.1` or `::1` without an
 * error. With the default `HOST=127.0.0.1`, a server on `::1` binds no
 * conflict at all, yet Vite's proxy to `localhost` tries `::1` first. Either
 * way the proxy would reach that other server instead.
 */
export async function loopbackListener(port: number): Promise<string | null> {
	const accepted = await Promise.all(LOOPBACKS.map((host) => accepts(host, port)));

	return LOOPBACKS[accepted.indexOf(true)] ?? null;
}
